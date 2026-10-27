/** Real 0.1.6 host and importer with synthetic public-API mocks, never live Figma. */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const compiled = await build({ entryPoints: ['src/code.ts'], bundle: true, write: false, format: 'cjs', platform: 'node', target: 'es2020', logLevel: 'silent' });
const bundle = compiled.outputFiles[0].text;
const plain = value => JSON.parse(JSON.stringify(value));
const options = { keepTextBackup: false, fontMap: {} };
const layer = i => ({ id: `shape-${i}`, name: `Shape ${i}`, kind: 'shape', x: i, y: i, width: 5, height: 5, visible: true, opacity: 1, blendMode: 'NORMAL', fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }] });
const doc = (name = 'Same', count = 2) => ({ version: 1, name, width: 100, height: 80, layers: Array.from({ length: count }, (_, i) => layer(i)), report: [] });
function boot(settings = {}) {
  let next = 0, seq = 0;
  const tickets = new Map();
  const replies = [], nodes = [], images = [];
  const appendChild = function(node) { if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1); this.children.push(node); node.parent = this; };
  const page = id => ({ id, type: 'PAGE', children: [], removed: false, selection: [], appendChild });
  const pages = [page('page-1'), page('page-2')];
  const api = {
    currentPage: pages[0], root: { setRelaunchData() {} }, showUI() {},
    ui: { postMessage(message) { if (settings.dropSuccess && message.type === 'ack' && message.result?.status === 'success') throw new Error('injected delivery failure'); replies.push(message); settings.onMessage?.(message, instance); } },
    listAvailableFontsAsync: () => settings.fonts ? settings.fonts() : Promise.resolve([{ fontName: { family: 'Inter', style: 'Regular' } }]),
    loadFontAsync: async () => {}, createImage: bytes => { images.push(Array.from(bytes)); return { hash: `hash-${images.length}` }; },
    viewport: { scrollAndZoomIntoView() { if (settings.viewportFailure) throw new Error('optional viewport failure'); } },
  };
  function make(type) {
    const node = { id: `node-${++next}`, type, name: '', x: 0, y: 0, width: 100, height: 100, fills: [], strokes: [], effects: [], opacity: 1, blendMode: 'NORMAL', visible: true, removed: false, children: [],
      resize(w, h) { this.width = w; this.height = h; }, appendChild, setRelaunchData() {},
      remove() { if (settings.failRemove) throw new Error('injected remove failure'); for (const child of [...this.children]) child.remove(); if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; this.removed = true; },
    };
    nodes.push(node); api.currentPage.appendChild(node); return node;
  }
  api.createFrame = () => make('FRAME'); api.createRectangle = () => { if (settings.failRectangle) throw new Error('injected rectangle failure'); return make('RECTANGLE'); };
  api.createText = () => make('TEXT');
  const existing = make('FRAME'); existing.name = 'User content'; existing.x = 200; existing.width = 120;
  const context = vm.createContext({ figma: api, __html__: '', console, setTimeout, clearTimeout });
  // Test-only observer is appended to an unminified test bundle, never shipped.
  vm.runInContext(bundle + '\n globalThis.inspectHost = () => ({ session, terminals, batch });', context);
  const instance = { api, pages, nodes, replies, existing, settings, state: () => context.inspectHost() };
  instance.send = async message => {
    const requestId = `test-${++seq}`;
    if (['begin', 'cancel'].includes(message.type)) {
      if (!tickets.has(message.sessionId)) tickets.set(message.sessionId, tickets.size + 1);
      message = { clientId: 'host-test-client', sessionSequence: tickets.get(message.sessionId), ...message };
    }
    await api.ui.onmessage({ ...message, requestId });
    const matching = replies.filter(reply => reply.type === 'ack' && reply.requestId === requestId);
    assert.equal(matching.length, 1); return matching[0];
  };
  instance.begin = (id, name = 'Same', batchId = 'batch-1') => instance.send({ type: 'begin', sessionId: id, batchId, name, width: 100, height: 80 });
  instance.import = (id, document = doc()) => instance.send({ type: 'import', sessionId: id, document, options });
  instance.cancel = id => instance.send({ type: 'cancel', sessionId: id });
  return instance;
}
const tests = [];
async function test(name, action) { await action(); tests.push(name); }
await test('Idle and writing sessions cannot be overwritten; terminal cancellation releases assets and allows restart', async () => {
  const x = boot(); assert.equal((await x.begin('a')).ok, true);
  const active = x.state().session;
  assert.equal((await x.send({ type: 'asset', sessionId: 'a', assetId: 'png', bytes: [1, 2] })).ok, true);
  assert.equal((await x.begin('b')).ok, false);
  assert.equal(Object.keys(active.hashes).length, 1);
  assert.equal((await x.cancel('a')).result.terminal, true);
  assert.equal(x.state().session, undefined); assert.equal(Object.keys(active.hashes).length, 0); assert.equal(active.bytes, 0);
  assert.equal((await x.begin('b')).ok, true);
  assert.equal((await x.send({ type: 'asset', sessionId: 'a', assetId: 'late', bytes: [1] })).ok, false);
  assert.equal((await x.cancel('a')).result.status, 'cancelled'); assert.equal(x.state().session.id, 'b');
});
await test('Cancel ACK waits for font-stage importer termination; late font resolution cannot mutate a new session', async () => {
  let release; const x = boot({ fonts: () => new Promise(resolve => { release = resolve; }) });
  await x.begin('a'); const importing = x.import('a');
  let cancelDone = false; const cancelling = x.cancel('a').then(value => { cancelDone = true; return value; });
  assert.equal(cancelDone, false); assert.equal((await x.begin('early')).ok, false);
  const cancelled = await cancelling; assert.equal(cancelled.result.terminal, true); assert.equal(cancelled.result.status, 'cancelled');
  assert.equal((await importing).ok, false); assert.equal(x.nodes.length, 1);
  assert.equal((await x.begin('b')).ok, true);
  release([{ fontName: { family: 'Inter', style: 'Regular' } }]); await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(x.nodes.length, 1); assert.equal(x.state().session.id, 'b');
});
await test('Cancellation during node creation rolls back only current file before terminal ACK', async () => {
  const x = boot(); await x.begin('success'); const success = await x.import('success'); assert.equal(success.ok, true);
  const saved = [...x.pages[0].children]; let cancellation, blocked;
  x.settings.onMessage = message => { if (message.type === 'progress' && message.sessionId === 'cancel-me' && !cancellation) { cancellation = x.cancel('cancel-me'); blocked = x.begin('too-early'); } };
  await x.begin('cancel-me'); const result = await x.import('cancel-me', doc('Same', 12));
  assert.equal(result.ok, false); assert.equal((await blocked).ok, false);
  const cancelled = await cancellation; assert.equal(cancelled.result.status, 'cancelled'); assert.equal(cancelled.result.terminal, true);
  assert.deepEqual(x.pages[0].children, saved); assert.ok(saved.every(node => !node.removed));
  assert.equal((await x.begin('next')).ok, true);
});
await test('Rollback failure is nonterminal and blocks cancel, restart and new batches', async () => {
  const x = boot({ failRemove: true, failRectangle: true }); await x.begin('a'); const result = await x.import('a');
  assert.equal(result.ok, false); assert.equal(result.result.terminal, false); assert.equal(result.result.status, 'failed');
  assert.match(result.error, /回滚未完成/); assert.equal((await x.cancel('a')).result.terminal, false);
  assert.equal((await x.begin('b', 'Same', 'new-batch')).ok, false);
  assert.equal(x.existing.removed, false); assert.equal(Object.keys(x.state().session.hashes).length, 0);
});
await test('Batch destination survives page switches; duplicate filenames get distinct names and nonoverlapping roots', async () => {
  const x = boot(); const name = '../Same\n.psd'; const normalized = '.._Same_.psd';
  assert.equal((await x.begin('a', name)).result.targetPageId, 'page-1');
  x.api.currentPage = x.pages[1]; assert.equal((await x.import('a', doc(name))).ok, true);
  assert.equal((await x.begin('b', name)).result.targetPageId, 'page-1'); assert.equal((await x.import('b', doc(name))).ok, true);
  const roots = x.pages[0].children.filter(node => node !== x.existing);
  assert.equal(roots.length, 2); assert.equal(x.pages[1].children.length, 0);
  assert.equal(roots[0].name, `${normalized} · 可编辑`); assert.equal(roots[1].name, `${normalized} (2) · 可编辑`);
  assert.ok(roots[0].x > x.existing.x + x.existing.width); assert.ok(roots[1].x > roots[0].x + roots[0].width);
  assert.equal((await x.begin('new-batch-job', 'Same', 'new-batch')).result.targetPageId, 'page-2');
  assert.equal((await x.import('new-batch-job')).ok, true); assert.equal(x.pages[1].children.length, 1);
});
await test('Success receipt survives late cancellation without deleting committed content or reporting it cancelled', async () => {
  const x = boot({ viewportFailure: true }); await x.begin('a'); const result = await x.import('a');
  assert.equal(result.ok, true); assert.equal(result.result.terminal, true); assert.equal(result.result.status, 'success');
  assert.ok(result.result.report.some(issue => issue.code === 'VIEWPORT_UNCHANGED'));
  const receipt = (await x.cancel('a')).result;
  assert.equal(receipt.status, 'success'); assert.equal(receipt.result.frameId, result.result.frameId);
  assert.equal(x.pages[0].children.length, 2); assert.equal(x.state().session, undefined);
  assert.equal('createdNodeIds' in receipt.result, false); assert.equal('report' in receipt.result, false); assert.equal('layers' in receipt.result, false);
});
await test('Unseen cancellation fences delayed begin; invalid batch/session requests cannot mutate an active job', async () => {
  const x = boot(); assert.equal((await x.cancel('delayed')).result.terminal, true);
  assert.equal((await x.begin('delayed')).ok, false);
  assert.equal((await x.begin('live')).ok, true);
  for (const sessionId of ['', undefined, 7]) assert.equal((await x.cancel(sessionId)).ok, false);
  assert.equal((await x.cancel('unrelated')).result.terminal, true); assert.equal(x.state().session.id, 'live');
  assert.equal((await x.send({ type: 'import', sessionId: 'delayed', document: doc(), options })).ok, false);
  assert.equal(x.state().session.id, 'live');
});
await test('Deleted destination fails before node creation; file-level failure terminal allows safe next attempt', async () => {
  const x = boot(); await x.begin('a'); x.pages[0].removed = true;
  assert.equal((await x.import('a')).result.terminal, true); assert.equal(x.nodes.length, 1);
  assert.equal((await x.begin('b')).ok, false);
  x.api.currentPage = x.pages[1]; assert.equal((await x.begin('c', 'Same', 'fresh')).ok, true); assert.equal((await x.import('c')).ok, true);
});
await test('Terminal receipt cache stays bounded and contains only compact metadata after many sequential sessions', async () => {
  const x = boot();
  await x.begin('old-success'); assert.equal((await x.import('old-success')).ok, true);
  for (let i = 0; i < 160; i++) { await x.begin(`job-${i}`); await x.cancel(`job-${i}`); }
  assert.equal(x.state().terminals.size, 128); assert.equal(x.state().session, undefined);
  assert.ok([...x.state().terminals.values()].every(value => !('document' in value) && !('hashes' in value) && !('bytes' in value)));
  assert.equal((await x.begin('old-success')).ok, false, 'Evicted begin never revives');
  assert.equal((await x.begin('job-0')).ok, false, 'Evicted cancelled begin never revives');
  const unknown = (await x.cancel('old-success')).result;
  assert.equal(unknown.terminal, false); assert.equal(unknown.status, 'unknown');
  assert.equal(x.pages[0].children.length, 2, 'Evicted success remains on the canvas');
});
await test('Client identity and monotonic session ticket validation isolate stale or malformed UI instances', async () => {
  const x = boot();
  for (const sessionSequence of [undefined, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal((await x.send({ type: 'begin', sessionId: 'invalid', clientId: 'host-test-client', sessionSequence, name: 'Same', width: 100, height: 80 })).ok, false);
  }
  await x.begin('valid'); await x.cancel('valid');
  assert.equal((await x.send({ type: 'begin', sessionId: 'other-ui', clientId: 'stale-client', sessionSequence: 900, name: 'Same', width: 100, height: 80 })).ok, false);
  assert.equal((await x.begin('next')).ok, true);
});
await test('Lost success delivery never changes committed receipt into failure; cancellation can recover compact success', async () => {
  const x = boot({ dropSuccess: true }); await x.begin('a');
  await x.api.ui.onmessage({ type: 'import', sessionId: 'a', document: doc(), options, requestId: 'lost-success' });
  assert.equal(x.replies.some(reply => reply.requestId === 'lost-success'), false);
  assert.equal(x.state().session, undefined); assert.equal(x.pages[0].children.length, 2);
  x.settings.dropSuccess = false;
  assert.equal((await x.cancel('a')).result.status, 'success');
});
await fs.mkdir('test-output', { recursive: true });
const report = { passed: tests.length, scope: 'Synthetic documents, real host/importer code and mocked public Figma API; no live Figma or pixel rendering test.', tests };
await fs.writeFile('test-output/queue-host-tests.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

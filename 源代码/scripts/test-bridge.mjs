/**
 * Focused main-thread transport tests. Run `npm run build` first, then:
 *   node scripts/test-bridge.mjs
 * Optional: --bundle /path/to/code.js --report /path/to/report.json
 *
 * Executes the real dist/code.js in isolated Node VM contexts with a deliberately
 * small Figma API mock. This is not a live Figma host, UI/browser test, image
 * decoder, or native document/rendering test. No source file is converted.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const paths = {};
for (let index = 0; index < args.length; index += 2) {
  const flag = args[index], value = args[index + 1];
  if (!['--bundle', '--report'].includes(flag) || !value || value.startsWith('--')) {
    throw new Error('Usage: node scripts/test-bridge.mjs [--bundle path] [--report path]');
  }
  if (paths[flag]) throw new Error(`Duplicate argument: ${flag}`);
  paths[flag] = path.resolve(value);
}
const bundlePath = paths['--bundle'] || path.join(root, 'dist/code.js');
const reportPath = paths['--report'] || path.join(root, 'test-output/bridge-tests.json');
const bundle = fs.readFileSync(bundlePath, 'utf8');
const results = [];
const available = [{ fontName: { family: 'Inter', style: 'Regular' } }];
const validBegin = (sessionId = 'session-one') => ({
  type: 'begin', sessionId, name: 'tiny-fixture', width: 16, height: 12,
});
const validAsset = (sessionId = 'session-one', assetId = 'asset-one') => ({
  type: 'asset', sessionId, assetId, bytes: [137, 80, 78, 71],
});
const plain = value => JSON.parse(JSON.stringify(value));

function boot({ throwRelaunch = false, listFonts, onShow } = {}) {
  const replies = [], images = [], warnings = [], lifecycle = [], nodeCreationCalls = [];
  const figma = {
    ui: { postMessage(message) { replies.push(message); } },
    root: {
      setRelaunchData() {
        lifecycle.push('relaunch');
        if (throwRelaunch) throw new Error('Injected optional relaunch failure');
      },
    },
    showUI(html, options) {
      lifecycle.push('showUI');
      assert.equal(html, '<html>mock-ui</html>');
      assert.equal(typeof figma.ui.onmessage, 'function', 'Handler must exist when showUI is called');
      assert.equal(options.width, 440);
      assert.equal(options.height, 680);
      onShow?.(figma, replies);
    },
    listAvailableFontsAsync: listFonts || (async () => available),
    createImage(bytes) {
      images.push(Array.from(bytes));
      return { hash: `mock-image-${images.length}` };
    },
  };
  for (const method of ['createFrame', 'createRectangle', 'createText', 'createVector', 'createTextPath']) {
    figma[method] = () => {
      nodeCreationCalls.push(method);
      throw new Error(`Unexpected node creation in transport-only test: ${method}`);
    };
  }
  const context = vm.createContext({
    figma, __html__: '<html>mock-ui</html>', setTimeout, clearTimeout,
    console: { warn(...args) { warnings.push(args.map(String).join(' ')); } },
  });
  vm.runInContext(bundle, context, { filename: bundlePath, timeout: 1000 });
  let sequence = 0;
  async function send(message) {
    const requestId = `test-${++sequence}`;
    let deadline;
    try {
      await Promise.race([
        figma.ui.onmessage({ ...message, requestId }),
        new Promise((_, reject) => {
          deadline = setTimeout(() => reject(new Error(`No handler completion for ${message.type}`)), 1000);
        }),
      ]);
    } finally { clearTimeout(deadline); }
    const acks = replies.filter(value => value.type === 'ack' && value.requestId === requestId);
    assert.equal(acks.length, 1, `${message.type} must produce exactly one matching ack`);
    return acks[0];
  }
  return { figma, context, replies, images, warnings, lifecycle, nodeCreationCalls, send };
}

async function test(name, action) {
  try {
    await action();
    results.push({ name, passed: true });
  } catch (error) {
    results.push({ name, passed: false, error: error.message });
    throw error;
  }
}

let failure;
try {
  await test('Handler is registered before showUI; synchronous startup ping and begin receive immediate replies', async () => {
    const instance = boot({ onShow(figma, replies) {
      void figma.ui.onmessage({ type: 'ping', requestId: 'startup-ping' });
      void figma.ui.onmessage({ ...validBegin('startup-session'), requestId: 'startup-begin' });
      assert.equal(replies.find(value => value.requestId === 'startup-ping')?.ok, true);
      assert.equal(replies.find(value => value.requestId === 'startup-begin')?.ok, true);
    } });
    assert.equal((await instance.send(validAsset('startup-session'))).ok, true);
    assert.deepEqual(instance.lifecycle, ['showUI', 'relaunch']);
  });

  await test('Optional relaunch exception is contained; fonts, ping, and begin still answer', async () => {
    const instance = boot({ throwRelaunch: true });
    assert.equal(instance.warnings.length, 1);
    assert.match(instance.warnings[0], /Injected optional relaunch failure/);
    const fonts = await instance.send({ type: 'fonts' });
    assert.equal(fonts.ok, true);
    assert.deepEqual(plain(fonts.result), { fonts: available.map(value => value.fontName) });
    const ping = await instance.send({ type: 'ping' });
    assert.equal(ping.ok, true);
    assert.equal(ping.result.protocol, 2);
    assert.equal(typeof ping.result.version, 'string');
    assert.equal((await instance.send(validBegin())).ok, true);
    assert.equal((await instance.send(validAsset())).ok, true);
  });

  await test('Begin validates session, name, and dimensions without replacing a valid session on failure', async () => {
    const instance = boot();
    assert.equal((await instance.send(validBegin())).ok, true);
    const invalid = [
      { sessionId: undefined }, { sessionId: '' }, { sessionId: 1 }, { sessionId: 'x'.repeat(201) },
      { name: undefined }, { name: null }, { name: 1 },
      { width: undefined }, { width: '16' }, { width: NaN }, { width: Infinity },
      { width: 0 }, { width: -1 }, { width: 300001 },
      { height: undefined }, { height: '12' }, { height: NaN }, { height: -Infinity },
      { height: 0 }, { height: -1 }, { height: 300001 },
    ];
    for (const [index, changed] of invalid.entries()) {
      const ack = await instance.send({ ...validBegin(`invalid-${index}`), ...changed });
      assert.equal(ack.ok, false, `Invalid begin case ${index} must be rejected`);
      assert.equal(typeof ack.error, 'string');
      assert.ok(ack.error.length > 0);
    }
    assert.equal((await instance.send(validAsset())).ok, true, 'Invalid begin must preserve old valid session');
    for (const dimension of [1, 300000]) {
      assert.equal((await instance.send({ ...validBegin(`boundary-${dimension}`), width: dimension, height: dimension })).ok, true);
    }
  });

  await test('Array and Uint8Array assets work; duplicate, empty, and stale assets never call createImage', async () => {
    const instance = boot();
    assert.equal((await instance.send(validAsset())).ok, false, 'Asset before begin must be rejected');
    assert.equal((await instance.send(validBegin())).ok, true);
    assert.equal((await instance.send(validAsset())).ok, true);
    const bytes = vm.runInContext('new Uint8Array([1, 2, 3])', instance.context);
    assert.equal((await instance.send({ ...validAsset('session-one', 'typed'), bytes })).ok, true);
    assert.deepEqual(instance.images, [[137, 80, 78, 71], [1, 2, 3]]);
    for (const asset of [validAsset(), validAsset('wrong-session'), { ...validAsset('session-one', 'empty'), bytes: [] }, { ...validAsset('session-one', '') }]) {
      assert.equal((await instance.send(asset)).ok, false);
    }
    assert.equal(instance.images.length, 2);
  });

  await test('Cancel is session-scoped and repeatable; stale assets are rejected and a new begin can retry', async () => {
    const instance = boot();
    assert.equal((await instance.send(validBegin())).ok, true);
    assert.equal((await instance.send({ type: 'cancel', sessionId: 'unrelated' })).ok, true);
    assert.equal((await instance.send(validAsset())).ok, true, 'Unrelated cancellation must preserve session');
    assert.equal((await instance.send({ type: 'cancel', sessionId: 'session-one' })).ok, true);
    assert.equal((await instance.send({ type: 'cancel', sessionId: 'session-one' })).ok, true);
    assert.equal((await instance.send(validAsset('session-one', 'after-cancel'))).ok, false);
    assert.equal(instance.images.length, 1);
    assert.equal((await instance.send(validBegin('retry-session'))).ok, true);
    assert.equal((await instance.send(validAsset('retry-session'))).ok, true, 'Retry gets a new asset namespace');
    assert.equal((await instance.send(validAsset('session-one', 'late-old-asset'))).ok, false);
    assert.equal(instance.images.length, 2);
  });

  await test('A replacement begin invalidates a previous idle session and retains only the replacement session', async () => {
    const instance = boot();
    assert.equal((await instance.send(validBegin('old'))).ok, true);
    assert.equal((await instance.send(validBegin('new'))).ok, true);
    assert.equal((await instance.send(validAsset('old'))).ok, false);
    assert.equal((await instance.send(validAsset('new'))).ok, true);
    assert.equal((await instance.send({ type: 'cancel', sessionId: 'old' })).ok, true);
    assert.equal((await instance.send(validAsset('new', 'still-new'))).ok, true);
  });

  await test('An unresolved fonts promise does not block ping, begin, assets, or cancel', async () => {
    let releaseFonts;
    const instance = boot({ listFonts: () => new Promise(resolve => { releaseFonts = resolve; }) });
    const fontsTask = instance.figma.ui.onmessage({ type: 'fonts', requestId: 'hanging-fonts' });
    assert.equal(typeof releaseFonts, 'function');
    assert.equal((await instance.send({ type: 'ping' })).ok, true);
    assert.equal((await instance.send(validBegin())).ok, true);
    assert.equal((await instance.send(validAsset())).ok, true);
    assert.equal((await instance.send({ type: 'cancel', sessionId: 'session-one' })).ok, true);
    assert.equal(instance.replies.some(value => value.requestId === 'hanging-fonts'), false);
    releaseFonts(available);
    await fontsTask;
    const ack = instance.replies.find(value => value.requestId === 'hanging-fonts');
    assert.equal(ack?.ok, true);
    assert.deepEqual(plain(ack.result), { fonts: available.map(value => value.fontName) });
  });

  await test('Cancel releases an import blocked on fonts that never settle; no nodes are created and begin can retry', async () => {
    let fontCalls = 0;
    const instance = boot({ listFonts: () => {
      fontCalls++;
      return new Promise(() => {});
    } });
    assert.equal((await instance.send(validBegin())).ok, true);
    const importTask = instance.send({
      type: 'import', sessionId: 'session-one',
      document: { version: 1, name: 'tiny-fixture', width: 16, height: 12, layers: [], report: [] },
      options: { includeReference: false, keepTextBackup: false, fontMap: {} },
    });
    assert.equal(fontCalls, 1, 'Real importer must reach the unresolved font enumeration');
    const blocked = await instance.send(validBegin('too-early'));
    assert.equal(blocked.ok, false, 'Begin must not replace an import while the font call is pending');
    assert.match(blocked.error, /导入正在运行/);
    assert.equal((await instance.send({ type: 'cancel', sessionId: 'session-one' })).ok, true);
    const result = await importTask;
    assert.equal(result.ok, false);
    assert.match(result.error, /取消/);
    assert.deepEqual(instance.nodeCreationCalls, []);
    assert.equal((await instance.send(validBegin('retry-after-font-cancel'))).ok, true);
    assert.equal((await instance.send(validAsset('session-one'))).ok, false);
    assert.equal((await instance.send(validAsset('retry-after-font-cancel'))).ok, true);
    assert.equal(fontCalls, 1, 'Retry begin must not depend on old font promise settling');
    assert.deepEqual(instance.nodeCreationCalls, []);
  });

  await test('Font resolution or rejection after cancellation neither creates nodes nor changes the replacement session', async () => {
    const unhandled = [];
    const onUnhandled = error => { unhandled.push(String(error)); };
    process.on('unhandledRejection', onUnhandled);
    try {
      for (const settlement of ['resolve', 'reject']) {
        let resolveFonts, rejectFonts;
        const instance = boot({ listFonts: () => new Promise((resolve, reject) => {
          resolveFonts = resolve;
          rejectFonts = reject;
        }) });
        assert.equal((await instance.send(validBegin('cancelled-session'))).ok, true);
        const importTask = instance.send({
          type: 'import', sessionId: 'cancelled-session',
          document: { version: 1, name: 'tiny-fixture', width: 16, height: 12, layers: [], report: [] },
          options: { includeReference: false, keepTextBackup: false, fontMap: {} },
        });
        assert.equal(typeof resolveFonts, 'function');
        assert.equal((await instance.send({ type: 'cancel', sessionId: 'cancelled-session' })).ok, true);
        const cancelled = await importTask;
        assert.equal(cancelled.ok, false);
        assert.match(cancelled.error, /取消/);
        assert.equal((await instance.send(validBegin('replacement-session'))).ok, true);
        const replyCount = instance.replies.length;
        if (settlement === 'resolve') resolveFonts(available);
        else rejectFonts(new Error('Injected late font rejection'));
        // Let native Promise callbacks and Node's unhandled-rejection check run.
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(instance.replies.length, replyCount, `${settlement}: cancelled import must not reply again`);
        assert.deepEqual(instance.nodeCreationCalls, [], `${settlement}: late font result must not resume node creation`);
        assert.equal((await instance.send(validAsset('cancelled-session'))).ok, false);
        assert.equal((await instance.send(validAsset('replacement-session'))).ok, true, `${settlement}: new session must remain active`);
        assert.equal((await instance.send({ type: 'ping' })).ok, true);
      }
      assert.deepEqual(unhandled, [], 'Late rejection must retain a rejection handler');
    } finally { process.removeListener('unhandledRejection', onUnhandled); }
  });

  await test('Font rejection and unknown operations return errors; malformed requests are ignored without throwing', async () => {
    const instance = boot({ listFonts: async () => { throw new Error('Injected font enumeration failure'); } });
    const fonts = await instance.send({ type: 'fonts' });
    assert.equal(fonts.ok, false);
    assert.match(fonts.error, /Injected font enumeration failure/);
    const unknown = await instance.send({ type: 'unknown-test-operation' });
    assert.equal(unknown.ok, false);
    assert.match(unknown.error, /unknown-test-operation/);
    const count = instance.replies.length;
    for (const malformed of [undefined, null, false, 0, 'x', {}, { type: 7 }]) {
      await instance.figma.ui.onmessage(malformed);
    }
    assert.equal(instance.replies.length, count);
    assert.equal((await instance.send({ type: 'ping' })).ok, true);
  });
} catch (error) { failure = error; }

const report = {
  passed: !failure,
  scope: 'Selected real plugin main bundle executed in isolated Node VM contexts against a mocked Figma API. The complete suite includes cancellation during importer font discovery. No native Figma runtime, browser transport, successful document creation, or rendering was verified.',
  stoppedAfterFirstFailure: Boolean(failure),
  executionNote: failure ? 'Execution stopped at the first failure; later test groups were not run for this bundle.' : 'All 10 test groups completed.',
  mockLimits: [
    'showUI synchronously dispatches test messages to model an adversarial startup ordering; this does not establish the real Figma scheduler.',
    'Relaunch failure is deliberately injected; no claim is made that Figma throws for an unknown relaunch command.',
    'createImage records bytes only and does not decode images or upload to Figma.',
    'No UI event.source, request timeout, cancellation UI, or cloud bootstrap behavior is tested here.',
  ],
  bundle: { path: path.relative(root, bundlePath), bytes: Buffer.byteLength(bundle), sha256: createHash('sha256').update(bundle).digest('hex') },
  tests: results,
};
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (failure) throw failure;

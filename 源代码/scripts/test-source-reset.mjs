import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'test-output/source-reset-tests.json');
const sourceText = fs.readFileSync(path.join(root, 'src/ui.ts'), 'utf8');
const html = fs.readFileSync(path.join(root, 'src/ui.html'), 'utf8');
const version = sourceText.match(/version:\s*['"]([\d.]+)['"]/)?.[1];
assert.ok(version, 'Read the UI version for a matching simulated host');
const compiled = await build({
  stdin: {
    contents: sourceText + `\nglobalThis.testSourceUI = {
      chooseFile, clearSource, startImport, setBusy,
      state() { return { source, inputFile, report, sessionId, generation, isBusy, isParsing, isCancelled, fonts, fontsLoaded,
        fontMap: { ...fontMap }, fontSearchQueries: Array.from(fontSearchQueries.entries()) }; }
    };`,
    loader: 'ts', resolveDir: path.join(root, 'src'),
  },
  bundle: true, write: false, platform: 'browser',
  plugins: [{ name: 'deferred-source-fixture', setup(builder) {
    builder.onResolve({ filter: /^\.\/pipeline$/ }, () => ({ path: 'pipeline', namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `
      export function inspectFile(file, progress, isCancelled) { return globalThis.testPipeline.inspectFile(file, progress, isCancelled); }
      export async function convertPsd(psd, name, options, callbacks) {
        callbacks.onProgress(1, 1, 'fixture converted');
        await callbacks.onAsset('tiny-fixture', new Uint8Array([1, 2, 3]));
        return { name, width: 8, height: 8, layers: [], report: [{ code: 'FIXTURE', message: 'fixture report' }] };
      }
    `, loader: 'js' }));
  } }],
});

// This deliberately small DOM checks the real UI's state/event logic. It does
// not claim browser layout, native keyboard, actual PSD parsing, or Figma QA.
function descendants(element) { return element.children.flatMap(child => [child, ...descendants(child)]); }
function matchesSelector(element, selector) {
  const attribute = selector.match(/\[([\w-]+)(?:=["']?([^\]"']+)["']?)?\]/);
  if (attribute && (attribute[2] === undefined ? !element.hasAttribute(attribute[1]) : String(element.getAttribute(attribute[1]) ?? element[attribute[1]]) !== attribute[2])) return false;
  selector = selector.replace(/\[[^\]]+\]/g, '');
  const id = selector.match(/#([\w-]+)/)?.[1];
  if (id && element.id !== id) return false;
  if (![...selector.matchAll(/\.([\w-]+)/g)].every(match => element.className.split(/\s+/).includes(match[1]))) return false;
  const tag = selector.match(/^[a-zA-Z][\w-]*/)?.[0];
  return !tag || element.tagName.toLowerCase() === tag.toLowerCase();
}
function queryAll(element, selectors) {
  return descendants(element).filter(candidate => selectors.split(',').some(selector => {
    const parts = selector.trim().split(/\s+/);
    if (!matchesSelector(candidate, parts.pop())) return false;
    let ancestor = candidate.parentElement;
    while (parts.length) {
      const part = parts.pop();
      while (ancestor && !matchesSelector(ancestor, part)) ancestor = ancestor.parentElement;
      if (!ancestor) return false;
      ancestor = ancestor.parentElement;
    }
    return true;
  }));
}
function createDom() {
  let document;
  class Element {
    constructor(tag = 'div') {
      this.tagName = tag.toUpperCase(); this.children = []; this.parentElement = null;
      this.id = ''; this.className = ''; this.hidden = false; this.disabled = false; this.checked = false;
      this.style = {}; this.attributes = {}; this.handlers = new Map(); this._value = ''; this._text = ''; this.selected = false;
      this.classList = {
        add: name => { if (!this.className.split(/\s+/).includes(name)) this.className = `${this.className} ${name}`.trim(); },
        remove: name => { this.className = this.className.split(/\s+/).filter(item => item !== name).join(' '); },
        toggle: (name, force) => { const enabled = force ?? !this.classList.contains(name); this.classList[enabled ? 'add' : 'remove'](name); return enabled; },
        contains: name => this.className.split(/\s+/).includes(name),
      };
    }
    get value() { return this.tagName === 'SELECT' ? this.options.find(option => option.selected)?.value ?? '' : this._value; }
    set value(value) { if (this.tagName === 'SELECT') this.options.forEach(option => { option.selected = option.value === String(value); }); else this._value = String(value); }
    get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
    set textContent(value) { this._text = String(value); this.replaceChildren(); }
    get options() { return descendants(this).filter(child => child.tagName === 'OPTION'); }
    get childElementCount() { return this.children.length; }
    get firstElementChild() { return this.children[0] ?? null; }
    append(...nodes) {
      for (const node of nodes) {
        node.remove(); node.parentElement = this; this.children.push(node);
        if (this.tagName === 'SELECT' && !this.options.some(option => option.selected)) this.options[0].selected = true;
      }
    }
    appendChild(node) { this.append(node); return node; }
    replaceChildren(...nodes) { this.children.forEach(child => { child.parentElement = null; }); this.children = []; this.append(...nodes); }
    remove() { if (this.parentElement) { this.parentElement.children = this.parentElement.children.filter(child => child !== this); this.parentElement = null; } }
    setAttribute(name, value) { this.attributes[name] = String(value); if (['title', 'id', 'class'].includes(name)) this[name === 'class' ? 'className' : name] = String(value); }
    getAttribute(name) { return this.attributes[name] ?? (name === 'title' ? this.title ?? null : null); }
    hasAttribute(name) { return Object.hasOwn(this.attributes, name); }
    removeAttribute(name) { delete this.attributes[name]; }
    addEventListener(type, handler) { const handlers = this.handlers.get(type) ?? []; handlers.push(handler); this.handlers.set(type, handlers); }
    emit(type, fields = {}) {
      const event = { currentTarget: this, target: this, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.propagationStopped = true; }, ...fields };
      for (const handler of this.handlers.get(type) ?? []) handler(event);
      return event;
    }
    click() { if (!this.disabled) this.emit('click'); }
    focus() { document.activeElement = this; }
    querySelectorAll(selector) { return queryAll(this, selector); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  }
  const body = new Element('body');
  const elements = new Map();
  // Parse attributes for actual ID-bearing controls so missing markup is not
  // silently invented by getElementById. The real nested font DOM is rendered.
  for (const match of html.matchAll(/<([a-z][\w-]*)\b([^<>]*\bid="([^"]+)"[^<>]*)>/gi)) {
    const [, tag, attrs, id] = match;
    const node = new Element(tag); node.id = id;
    for (const attribute of attrs.matchAll(/([\w-]+)(?:="([^"]*)")?/g)) {
      const [, name, value] = attribute;
      node.setAttribute(name, value ?? '');
      if (['hidden', 'disabled', 'checked', 'open'].includes(name)) node[name] = true;
    }
    elements.set(id, node); body.append(node);
  }
  for (const id of ['include-hidden', 'include-reference', 'keep-text-backup', 'rasterize-gradients']) {
    const option = new Element('label'); option.className = 'option'; body.append(option); option.append(elements.get(id));
  }
  const el = id => descendants(body).find(node => node.id === id) ?? null;
  document = { body, activeElement: null, getElementById: el, createElement: tag => new Element(tag), querySelectorAll: selector => body.querySelectorAll(selector), addEventListener() {} };
  return { document, el };
}
const availableFonts = [ { family: 'Arial', style: 'Regular' }, { family: 'Inter', style: 'Bold' } ];
const optionIds = ['include-hidden', 'include-reference', 'keep-text-backup', 'rasterize-gradients'];
const plain = value => JSON.parse(JSON.stringify(value));
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
async function until(predicate, description) {
  for (let i = 0; i < 100; i++) { if (predicate()) return; await flush(); }
  assert.ok(predicate(), description);
}
function file(name = 'fixture.psd') { return { name, size: 64, fixtureOnly: true }; }
function fixture(name = 'fixture.psd', overrides = {}) {
  return { name, psd: {}, summary: { width: 8, height: 8, layers: 7, textLayers: 2, imageLayers: 3, groups: 1,
    hiddenLayers: 1, fonts: ['Arial', 'Missing'], visibleFonts: ['Arial', 'Missing'], warnings: ['fixture source warning'], ...overrides } };
}
async function createHarness() {
  const { document, el } = createDom();
  const reads = [], requests = [], frames = [], timers = new Set(), windowHandlers = {};
  let stalledType;
  function schedule(fn, delay) { const timer = setTimeout(() => { timers.delete(timer); fn(); }, delay); timers.add(timer); return timer; }
  function ack(message, result) { windowHandlers.message({ source: null, data: { pluginMessage: { type: 'ack', requestId: message.requestId, ok: true, result } } }); }
  function defaultAck(message) {
    const result = message.type === 'fonts' ? { fonts: availableFonts.map(font => ({ ...font })) }
      : message.type === 'import' ? { frameId: `fixture-frame-${frames.length + 1}` }
        : { protocol: 2, version, handlerRegistered: true };
    if (message.type === 'import') frames.push(result.frameId);
    ack(message, result);
  }
  const parent = { postMessage({ pluginMessage: message }) {
    requests.push(message);
    if (message.type !== stalledType) queueMicrotask(() => defaultAck(message));
  } };
  const testPipeline = { inspectFile(file, progress, isCancelled) {
    return new Promise((resolve, reject) => { reads.push({ file, progress, isCancelled, resolve, reject }); });
  } };
  const context = vm.createContext({ console, crypto: webcrypto, Uint32Array, Uint8Array, Map, Set, Date, Math, Error, Blob, URL,
    parent, testPipeline, document, window: { addEventListener(type, handler) { windowHandlers[type] = handler; } },
    setTimeout: schedule, clearTimeout(timer) { clearTimeout(timer); timers.delete(timer); }, requestAnimationFrame: fn => schedule(fn, 0),
  });
  vm.runInContext(compiled.outputFiles[0].text, context);
  const api = context.testSourceUI;
  await until(() => api.state().fontsLoaded, 'Available host fonts loaded');
  const h = { api, el, reads, requests, frames, document,
    stall(type) { stalledType = type; },
    release(message) { defaultAck(message); },
    reject(message, error) { windowHandlers.message({ source: null, data: { pluginMessage: { type: 'ack', requestId: message.requestId, ok: false, error } } }); },
    hostProgress(sessionId, label) { windowHandlers.message({ source: null, data: { pluginMessage: { type: 'progress', sessionId, done: 1, total: 1, label } } }); },
    dispose() { for (const timer of timers) clearTimeout(timer); },
    async begin(nextFile = file()) {
      const index = reads.length;
      const run = api.chooseFile(nextFile);
      await until(() => reads.length > index, 'Deferred source parse started');
      return { read: reads[index], run };
    },
    async load(nextFile = file(), result = fixture(nextFile.name)) {
      const operation = await h.begin(nextFile); operation.read.resolve(result); await operation.run; return result;
    },
  };
  return h;
}
function assertEmpty(h) {
  const state = h.api.state();
  assert.equal(state.source, undefined, 'Parsed source cleared');
  assert.equal(state.inputFile, undefined, 'Original File reference cleared');
  assert.equal(state.report, undefined, 'Report cleared');
  assert.equal(state.sessionId, '', 'Import session cleared');
  assert.equal(state.isBusy, false, 'No active UI operation');
  assert.equal(state.isParsing, false, 'No current parse');
  assert.deepEqual(plain(state.fontMap), {}, 'Source font mappings cleared');
  assert.deepEqual(plain(state.fontSearchQueries), [], 'Source font search queries cleared');
  assert.equal(h.el('file-input').value, '', 'Input value permits selecting the same file again');
  assert.equal(h.el('file-input').disabled, false);
  assert.equal(h.el('drop-zone').hidden, false, 'Upload drop zone restored');
  assert.equal(h.el('drop-zone').classList.contains('disabled'), false);
  assert.equal(h.el('drop-zone').getAttribute('aria-disabled'), 'false');
  for (const id of ['file-card', 'stats', 'canvas-row', 'warnings', 'log', 'report-btn', 'cancel-btn', 'status']) assert.equal(h.el(id).hidden, true, `${id} hidden`);
  for (const id of ['font-list', 'warnings', 'log']) assert.equal(h.el(id).childElementCount, 0, `${id} cleared`);
  for (const id of ['file-name', 'file-meta', 'file-glyph', 'canvas-size', 'hidden-count', 'status-title', 'status-detail', 'status-percent']) assert.equal(h.el(id).textContent, '', `${id} text cleared`);
  for (const id of ['stat-layers', 'stat-text', 'stat-images', 'stat-groups']) assert.match(h.el(id).textContent, /^(?:|—|–|-)$/, `${id} no longer shows old counts`);
  assert.equal(h.el('import-btn').disabled, true, 'Cannot import without a source');
  assert.match(h.el('font-empty').textContent, /等待源文件|选择文件/);
  assert.equal(h.el('font-empty').hidden, false);
  assert.equal(h.el('font-details').open, false, 'Mapping panel reset');
  assert.equal(h.el('progress-bar').style.width, '0');
  assert.equal(h.el('progress-bar').classList.contains('indeterminate'), false);
  assert.equal(h.document.activeElement, h.el('drop-zone'), 'Focus returns to upload control');
}
function viewSnapshot(h) {
  const ids = ['file-name', 'file-meta', 'stats', 'canvas-row', 'canvas-size', 'status', 'status-title', 'status-detail', 'status-percent', 'progress-bar', 'log', 'warnings', 'font-list', 'import-btn', 'file-input', 'clear-source-btn'];
  return plain(Object.fromEntries(ids.map(id => { const node = h.el(id); return [id, { hidden: node.hidden, disabled: node.disabled, text: node.textContent, className: node.className, style: node.style }]; })));
}
const tests = [], failures = [];
async function test(name, fn) {
  let h;
  try { h = await createHarness(); await fn(h); tests.push(name); console.log(`PASS ${name}`); }
  catch (error) { failures.push({ name, error: error.stack || String(error) }); console.error(`FAIL ${name}: ${error.message}`); }
  finally { h?.dispose(); }
}

await test('Source × is a named native button beside Replace', async h => {
  const markup = html.match(/<button\b(?=[^>]*\bid="clear-source-btn")([^>]*)>([\s\S]*?)<\/button>/i);
  assert.ok(markup, 'The clear source control exists in real HTML');
  assert.match(markup[1], /\btype="button"/);
  assert.match(markup[1], /\baria-label="[^"]+"/);
  assert.match(markup[1], /\btitle="[^"]+"/);
  assert.match(markup[2], /×|&times;|&#215;/);
  assert.match(html, /id="replace-btn"[^>]*>[\s\S]*?<\/button>\s*<button\b[^>]*id="clear-source-btn"/, 'Source clear is next to Replace');
  assert.equal(h.el('clear-source-btn').tagName, 'BUTTON');
});

await test('Clicking × clears loaded source, statistics, mappings, queries, and file input', async h => {
  await h.load();
  const row = h.el('font-list').querySelector('.font-row');
  const search = row.querySelector('input'); search.value = 'bold'; search.emit('input');
  const select = row.querySelector('select'); select.value = '1'; select.emit('change');
  h.el('file-input').value = 'C:\\fakepath\\fixture.psd';
  assert.ok(h.api.state().fontSearchQueries.length);
  h.el('clear-source-btn').click(); assertEmpty(h);
});

await test('Source clear retains chosen options and the loaded host font catalog', async h => {
  optionIds.forEach((id, index) => { h.el(id).checked = [true, false, true, true][index]; });
  await h.load();
  const fontCatalog = h.api.state().fonts;
  const fontRequests = h.requests.filter(request => request.type === 'fonts').length;
  h.api.clearSource(); assertEmpty(h);
  assert.deepEqual(optionIds.map(id => h.el(id).checked), [true, false, true, true]);
  assert.equal(h.api.state().fonts, fontCatalog, 'Existing host font array preserved');
  assert.equal(h.api.state().fontsLoaded, true);
  assert.equal(h.requests.filter(request => request.type === 'fonts').length, fontRequests, 'No redundant font fetch');
  assert.deepEqual(plain(h.api.state().fonts), availableFonts);
  for (const id of optionIds) assert.equal(h.el(id).disabled, false);
});

await test('Repeated source clears are harmless and send no host commands', async h => {
  await h.load(); const before = h.requests.length;
  h.api.clearSource(); assertEmpty(h);
  const snapshot = viewSnapshot(h);
  h.api.clearSource(); h.api.clearSource(); assertEmpty(h);
  assert.deepEqual(viewSnapshot(h), snapshot);
  assert.equal(h.requests.length, before);
  await h.api.startImport(); assert.equal(h.requests.length, before, 'Empty import does not contact host');
});

await test('Clearing before the first paint invalidates a parse before it starts', async h => {
  const before = h.api.state().generation;
  const run = h.api.chooseFile(file());
  assert.equal(h.api.state().isParsing, true);
  assert.equal(h.el('clear-source-btn').disabled, false);
  h.api.clearSource(); await run;
  assertEmpty(h); assert.ok(h.api.state().generation > before);
  assert.equal(h.reads.length, 0, 'Discarded selection does not start a delayed parser');
});

await test('Clearing an in-flight async parse immediately restores picking and ignores late progress', async h => {
  const { read, run } = await h.begin();
  read.progress(1, 3, 'current progress');
  assert.equal(h.el('status-detail').textContent, 'current progress');
  assert.equal(h.el('clear-source-btn').disabled, false, '× remains usable while parsing');
  h.el('clear-source-btn').click(); assertEmpty(h);
  const snapshot = viewSnapshot(h);
  read.progress(2, 3, 'obsolete progress');
  assert.deepEqual(viewSnapshot(h), snapshot);
  read.resolve(fixture()); await run;
  assertEmpty(h); assert.deepEqual(viewSnapshot(h), snapshot, 'Late parse success cannot resurrect source');
});

await test('Late parse rejection after clear cannot resurrect error, log, or file state', async h => {
  const { read, run } = await h.begin();
  h.api.clearSource(); const snapshot = viewSnapshot(h);
  read.reject(new Error('obsolete parse failure')); await run;
  assertEmpty(h); assert.deepEqual(viewSnapshot(h), snapshot);
});

await test('A newer file parses while old read is pending; stale success and progress cannot replace it', async h => {
  const old = await h.begin(file('old.psb')); h.api.clearSource();
  const currentFile = file('new.psd');
  const current = await h.begin(currentFile);
  assert.equal(h.reads.length, 2, 'New read starts before old read settles');
  current.read.resolve(fixture('new.psd', { layers: 11 })); await current.run;
  const snapshot = viewSnapshot(h);
  old.read.progress(1, 1, 'old success progress'); old.read.resolve(fixture('old.psb')); await old.run;
  assert.equal(h.api.state().source.name, 'new.psd'); assert.equal(h.api.state().inputFile, currentFile);
  assert.deepEqual(viewSnapshot(h), snapshot);
});

await test('Late old rejection cannot overwrite a newer ready source', async h => {
  const old = await h.begin(file('old.psb')); h.api.clearSource();
  await h.load(file('new.psd')); const snapshot = viewSnapshot(h);
  old.read.progress('late legacy progress'); old.read.reject(new Error('old file failed')); await old.run;
  assert.equal(h.api.state().source.name, 'new.psd'); assert.deepEqual(viewSnapshot(h), snapshot);
});

for (const outcome of ['success', 'error']) await test(`Old ${outcome} finally cannot unlock or overwrite a newer active parse`, async h => {
  const old = await h.begin(file('old.psd')); h.api.clearSource();
  const current = await h.begin(file('new.psd'));
  current.read.progress(1, 4, 'new parsing'); const snapshot = viewSnapshot(h);
  old.read.progress(1, 1, 'old parsing');
  if (outcome === 'success') old.read.resolve(fixture('old.psd')); else old.read.reject(new Error('old parse error'));
  await old.run;
  assert.equal(h.api.state().isBusy, true); assert.equal(h.api.state().isParsing, true);
  assert.equal(h.el('import-btn').disabled, true); assert.equal(h.el('file-input').disabled, true);
  assert.deepEqual(viewSnapshot(h), snapshot);
  current.read.resolve(fixture('new.psd')); await current.run;
  assert.equal(h.api.state().source.name, 'new.psd'); assert.equal(h.api.state().isBusy, false);
});

await test('Inspection cancellation callbacks invalidate only the cleared generation', async h => {
  const old = await h.begin(file('old.psd'));
  assert.equal(typeof old.read.isCancelled, 'function'); assert.equal(old.read.isCancelled(), false);
  h.api.clearSource(); assert.equal(old.read.isCancelled(), true);
  const current = await h.begin(file('new.psd'));
  assert.equal(old.read.isCancelled(), true); assert.equal(current.read.isCancelled(), false);
  old.read.reject(new Error('cleared inspection cancelled')); await old.run;
  assert.equal(current.read.isCancelled(), false);
  h.api.clearSource(); assert.equal(current.read.isCancelled(), true);
  current.read.reject(new Error('second inspection cancelled')); await current.run; assertEmpty(h);
});

await test('The actual file change handler supports clearing and reuploading the exact same File', async h => {
  const sameFile = file('same-name.psd'); const input = h.el('file-input');
  async function selectSameFile(index) {
    input.files = [sameFile]; input.value = 'C:\\fakepath\\same-name.psd'; input.emit('change');
    assert.equal(input.value, '', 'File input reset by change handler');
    await until(() => h.reads.length > index, 'Same file parse starts');
    h.reads[index].resolve(fixture(sameFile.name));
    await until(() => !h.api.state().isBusy, 'Same file parse completes');
    assert.equal(h.api.state().source.name, sameFile.name);
  }
  await selectSameFile(0); h.el('clear-source-btn').click(); assertEmpty(h);
  await selectSameFile(1);
  assert.equal(h.reads[0].file, sameFile); assert.equal(h.reads[1].file, sameFile);
});

await test('Clear after a real current parse error removes its warning/log and allows retry', async h => {
  const operation = await h.begin(); operation.read.reject(new Error('current fixture failure')); await operation.run;
  assert.match(h.el('status-detail').textContent, /current fixture failure/);
  assert.equal(h.el('log').hidden, false); assert.ok(h.el('log').childElementCount);
  h.el('clear-source-btn').click(); assertEmpty(h);
  assert.doesNotMatch(h.el('status-detail').textContent, /current fixture failure/);
  await h.load(); assert.equal(h.el('import-btn').disabled, false);
});

await test('Active import disables × and direct/synthetic clear is guarded without sending cancel', async h => {
  await h.load(); h.stall('import'); const run = h.api.startImport();
  await until(() => h.requests.some(message => message.type === 'import'), 'Import reaches stalled host stage');
  const request = h.requests.findLast(message => message.type === 'import');
  assert.equal(h.el('clear-source-btn').disabled, true);
  assert.match(h.el('clear-source-btn').title || h.el('clear-source-btn').getAttribute('title') || '', /取消|cancel/i);
  assert.equal(h.api.state().isParsing, false);
  const state = h.api.state(), snapshot = viewSnapshot(h), requestCount = h.requests.length;
  h.el('clear-source-btn').click(); h.el('clear-source-btn').emit('click'); h.api.clearSource();
  assert.equal(h.api.state().source, state.source); assert.equal(h.api.state().inputFile, state.inputFile);
  assert.equal(h.api.state().sessionId, state.sessionId); assert.equal(h.api.state().generation, state.generation);
  assert.equal(h.api.state().isBusy, true); assert.equal(h.api.state().isCancelled, false);
  assert.deepEqual(viewSnapshot(h), snapshot); assert.equal(h.requests.length, requestCount);
  h.release(request); await run;
  assert.equal(h.el('status-title').textContent, '导入完成'); assert.equal(h.el('clear-source-btn').disabled, false);
});

await test('Clear after successful import removes report/session only locally and preserves created Figma frame', async h => {
  await h.load(); await h.api.startImport();
  assert.equal(h.el('status-title').textContent, '导入完成'); assert.ok(h.api.state().report); assert.ok(h.api.state().sessionId);
  assert.equal(h.el('report-btn').hidden, false); assert.equal(h.frames.length, 1);
  const priorSession = h.api.state().sessionId, frames = [...h.frames], requestCount = h.requests.length;
  h.el('clear-source-btn').click(); assertEmpty(h);
  assert.equal(h.requests.length, requestCount, 'Clear does not send cancel, delete, or any other host operation');
  assert.deepEqual(h.frames, frames, 'Existing mock document frame remains');
  const snapshot = viewSnapshot(h); h.hostProgress(priorSession, 'stale finished-session progress');
  assert.deepEqual(viewSnapshot(h), snapshot);
  h.el('report-btn').click(); assert.equal(h.requests.length, requestCount);
});

await test('After explicit import cancellation settles, clear restores source-free state without another cancellation', async h => {
  await h.load(); h.stall('import'); const run = h.api.startImport();
  await until(() => h.requests.some(message => message.type === 'import'), 'Import reaches cancellable stage');
  h.el('cancel-btn').click(); await run;
  assert.equal(h.el('status-title').textContent, '已取消导入');
  const cancellationCount = h.requests.filter(message => message.type === 'cancel').length;
  assert.equal(cancellationCount, 1);
  h.el('clear-source-btn').click(); assertEmpty(h);
  assert.equal(h.requests.filter(message => message.type === 'cancel').length, cancellationCount);
});

await test('Late host cancellation rejection after clear cannot re-open the log', async h => {
  await h.load(); h.stall('import'); const run = h.api.startImport();
  await until(() => h.requests.some(message => message.type === 'import'), 'Import reaches cancellable stage');
  h.stall('cancel'); h.el('cancel-btn').click(); await run;
  const cancellation = h.requests.findLast(message => message.type === 'cancel'); assert.ok(cancellation);
  h.api.clearSource(); const snapshot = viewSnapshot(h);
  h.reject(cancellation, 'late host cancellation failure'); await flush();
  assertEmpty(h); assert.deepEqual(viewSnapshot(h), snapshot);
});

// Exercise the actual inspection orchestration too. Parser and ZIP functions
// are tiny instrumented stubs: these tests verify cancellation boundaries only.
const pipelineCompiled = await build({
  entryPoints: [path.join(root, 'src/pipeline.ts')], bundle: true, write: false, platform: 'node', format: 'cjs',
  plugins: [{ name: 'inspection-boundary-fixtures', setup(builder) {
    builder.onResolve({ filter: /^(ag-psd|fflate|\.\/normalize|\.\/raster)$/ }, args => ({ path: args.path, namespace: 'boundary' }));
    builder.onLoad({ filter: /.*/, namespace: 'boundary' }, args => ({ contents: {
      'ag-psd': `export function readPsd() { globalThis.boundary.parserCalls++; return { width: 8, height: 8, colorMode: 3, children: [] }; }`,
      'fflate': `export function unzipSync() { globalThis.boundary.unzipCalls++; return { 'folder/tiny.psd': globalThis.boundary.bytes }; }`,
      './normalize': `export function normalizePsd() { throw new Error('not exercised'); }`,
      './raster': `export function yieldUI() { return globalThis.boundary.yieldUI(); } export function createRasterizer() {} export function cancelled() {}`,
    }[args.path], loader: 'js' }));
  } }],
});
async function boundaryTest(name, fn) {
  try {
    const bytes = new Uint8Array(26); bytes.set([56, 66, 80, 83]);
    const header = new DataView(bytes.buffer); header.setUint16(4, 1); header.setUint16(24, 3);
    const boundary = { bytes, parserCalls: 0, unzipCalls: 0, readCalls: 0, yields: [], cancelled: false,
      yieldUI() { return new Promise(resolve => boundary.yields.push(resolve)); } };
    const context = vm.createContext({ module: { exports: {} }, exports: {}, Uint8Array, DataView, Error, Set, Object, boundary });
    vm.runInContext(pipelineCompiled.outputFiles[0].text, context);
    const inspectFile = context.module.exports.inspectFile;
    const makeFile = (name = 'tiny.psd', read) => ({ name, size: 26, arrayBuffer() { boundary.readCalls++; return read ? read() : Promise.resolve(bytes.buffer); } });
    const yieldStep = async index => { await until(() => boundary.yields.length > index, 'Inspection reached expected yield'); boundary.yields[index](); await flush(); };
    await fn({ boundary, inspectFile, makeFile, yieldStep }); tests.push(name); console.log(`PASS ${name}`);
  } catch (error) { failures.push({ name, error: error.stack || String(error) }); console.error(`FAIL ${name}: ${error.message}`); }
}
await boundaryTest('Real inspectFile rejects an already-cleared generation before I/O', async ({ boundary, inspectFile, makeFile }) => {
  await assert.rejects(inspectFile(makeFile(), undefined, () => true), /取消/);
  assert.equal(boundary.readCalls, 0); assert.equal(boundary.yields.length, 0); assert.equal(boundary.parserCalls, 0);
});
await boundaryTest('Real inspectFile checks cancellation after its first yield before reading bytes', async ({ boundary, inspectFile, makeFile, yieldStep }) => {
  const run = inspectFile(makeFile(), undefined, () => boundary.cancelled);
  const rejected = assert.rejects(run, /取消/); boundary.cancelled = true;
  await yieldStep(0); await rejected;
  assert.equal(boundary.readCalls, 0); assert.equal(boundary.parserCalls, 0); assert.equal(boundary.unzipCalls, 0);
});
await boundaryTest('Real inspectFile stops after pending arrayBuffer resolves and before ZIP decompression', async ({ boundary, inspectFile, makeFile, yieldStep }) => {
  let releaseRead;
  const run = inspectFile(makeFile('tiny.zip', () => new Promise(resolve => { releaseRead = resolve; })), undefined, () => boundary.cancelled);
  const rejected = assert.rejects(run, /取消/);
  await yieldStep(0); assert.equal(boundary.readCalls, 1); assert.equal(typeof releaseRead, 'function');
  boundary.cancelled = true; releaseRead(boundary.bytes.buffer); await rejected;
  assert.equal(boundary.unzipCalls, 0); assert.equal(boundary.parserCalls, 0);
});
await boundaryTest('Real inspectFile checks cancellation at ZIP and parser yield boundaries', async ({ boundary, inspectFile, makeFile, yieldStep }) => {
  const zipRun = inspectFile(makeFile('tiny.zip'), undefined, () => boundary.cancelled);
  const zipRejected = assert.rejects(zipRun, /取消/); await yieldStep(0);
  await until(() => boundary.yields.length === 2, 'ZIP decompression yield reached');
  boundary.cancelled = true; await yieldStep(1); await zipRejected;
  assert.equal(boundary.unzipCalls, 0); assert.equal(boundary.parserCalls, 0);
  boundary.cancelled = false;
  const psdRun = inspectFile(makeFile(), undefined, () => boundary.cancelled);
  const psdRejected = assert.rejects(psdRun, /取消/); await yieldStep(2);
  await until(() => boundary.yields.length === 4, 'Parser yield reached');
  boundary.cancelled = true; await yieldStep(3); await psdRejected;
  assert.equal(boundary.parserCalls, 0);
});
await boundaryTest('Real inspectFile preserves normal ZIP inspection when cancellation is omitted', async ({ boundary, inspectFile, makeFile, yieldStep }) => {
  const progress = []; const run = inspectFile(makeFile('tiny.zip'), message => progress.push(message));
  await yieldStep(0); await yieldStep(1); await yieldStep(2); const result = await run;
  assert.equal(result.name, 'tiny.psd'); assert.equal(result.summary.width, 8); assert.equal(result.summary.height, 8);
  assert.equal(boundary.readCalls, 1); assert.equal(boundary.unzipCalls, 1); assert.equal(boundary.parserCalls, 1);
  assert.equal(progress.length, 3);
});

const result = {
  passed: failures.length === 0, passedCount: tests.length, failedCount: failures.length,
  runtime: 'Node VM executing bundled real UI plus real inspectFile orchestration; minimal DOM, deferred inspection fixture, stub parser/ZIP/yield, tiny conversion fixture and mock host. No browser rendering, real PSD/PSB, or live Figma validation. A synchronous parser cannot be preempted on the same JS thread; tests cover invalidation before parse starts and ignored async callbacks/results after control returns.',
  tests, failures,
};
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
if (failures.length) process.exitCode = 1;

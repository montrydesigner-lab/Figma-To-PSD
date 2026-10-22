import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'test-output/font-search-tests.json');
const tests = [];
const fonts = Object.freeze([
  Object.freeze({ family: 'Arial', style: 'Regular' }),
  Object.freeze({ family: 'Arial', style: 'Bold Italic' }),
  Object.freeze({ family: 'Inter', style: 'Regular' }),
  Object.freeze({ family: 'Source Han Sans SC', style: 'Bold' }),
  Object.freeze({ family: '思源黑体', style: '常规' }),
  Object.freeze({ family: '思源黑体', style: '粗体' }),
]);

// The helper is compiled independently so these assertions exercise its actual
// TypeScript implementation, rather than a second test-only search algorithm.
const helperBuild = await build({ entryPoints: [path.join(root, 'src/font-search.ts')], bundle: true, write: false, platform: 'node', format: 'cjs' });
const helperContext = vm.createContext({ module: { exports: {} }, exports: {} });
vm.runInContext(helperBuild.outputFiles[0].text, helperContext);
const { filterFonts } = helperContext.module.exports;
assert.equal(typeof filterFonts, 'function', 'font-search.ts exports filterFonts');
const matches = query => Array.from(filterFonts(fonts, query));
function checkSearch(query, expected, description) {
  const result = matches(query);
  assert.deepEqual(result, expected, description);
  result.forEach(font => assert.ok(fonts.includes(font), 'Search preserves original Font object identities'));
  tests.push(description);
}
checkSearch('', [...fonts], 'Empty query returns every font in original order');
checkSearch(' \t\n ', [...fonts], 'Whitespace-only query returns every font');
checkSearch('  aRI  ', [fonts[0], fonts[1]], 'Latin family search is case-insensitive, partial, and trimmed');
checkSearch('黑体', [fonts[4], fonts[5]], 'Chinese family substring search');
checkSearch('itaL', [fonts[1]], 'Latin style substring search');
checkSearch('粗', [fonts[5]], 'Chinese style substring search');
checkSearch('han  \t BOLD', [fonts[3]], 'Whitespace-separated family and style tokens search together');
checkSearch('Arial · Bold Italic', [fonts[1]], 'Copy-pasted displayed family and style label searches correctly');
checkSearch('ＡＲＩＡＬ　ｂｏｌｄ', [fonts[1]], 'Full-width Latin input and ideographic spaces normalize consistently');
checkSearch('not-a-real-font', [], 'No match returns an empty result');
assert.deepEqual(Array.from(filterFonts([], 'Arial')), [], 'An empty available-font list remains empty');
tests.push('Empty available-font list is handled safely');
assert.deepEqual(matches('Arial'), [fonts[0], fonts[1]], 'Repeated queries do not alter the immutable input');
tests.push('Frozen font array and objects remain unchanged across repeated searches');

// Minimal, deterministic DOM supporting only controls the real UI creates.
// This checks behavior, not browser layout or native keyboard implementation.
let document;
function descendants(element) { return element.children.flatMap(child => [child, ...descendants(child)]); }
function matchesSelector(element, selector) {
  const attribute = selector.match(/\[([\w-]+)(?:=["']?([^\]"']+)["']?)?\]/);
  if (attribute && (attribute[2] === undefined ? !element.hasAttribute(attribute[1]) : String(element.getAttribute(attribute[1]) ?? element[attribute[1]]) !== attribute[2])) return false;
  selector = selector.replace(/\[[^\]]+\]/g, '');
  const id = selector.match(/#([\w-]+)/)?.[1];
  if (id && element.id !== id) return false;
  const classes = [...selector.matchAll(/\.([\w-]+)/g)].map(match => match[1]);
  if (!classes.every(name => element.className.split(/\s+/).includes(name))) return false;
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
class Element {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase(); this.children = []; this.parentElement = null;
    this.id = ''; this.className = ''; this.hidden = false; this.disabled = false;
    this.checked = false; this.style = {}; this.attributes = {}; this.handlers = new Map();
    this._value = ''; this._text = ''; this.selected = false;
    this.classList = {
      add: name => { if (!this.className.split(/\s+/).includes(name)) this.className = `${this.className} ${name}`.trim(); },
      remove: name => { this.className = this.className.split(/\s+/).filter(item => item !== name).join(' '); },
      toggle: (name, force) => { const enable = force ?? !this.className.split(/\s+/).includes(name); this.classList[enable ? 'add' : 'remove'](name); return enable; },
      contains: name => this.className.split(/\s+/).includes(name),
    };
  }
  get value() { return this.tagName === 'SELECT' ? this.options.find(option => option.selected)?.value ?? '' : this._value; }
  set value(value) {
    value = String(value);
    if (this.tagName === 'SELECT') this.options.forEach(option => { option.selected = option.value === value; });
    else this._value = value;
  }
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
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  hasAttribute(name) { return Object.hasOwn(this.attributes, name); }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener(type, fn) { const handlers = this.handlers.get(type) ?? []; handlers.push(fn); this.handlers.set(type, handlers); }
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
const elements = new Map();
const body = new Element('body');
const el = id => {
  const dynamic = descendants(body).find(element => element.id === id);
  if (dynamic) return dynamic;
  if (!elements.has(id)) { const node = new Element(); node.id = id; elements.set(id, node); body.append(node); }
  return elements.get(id);
};
document = { body, activeElement: null, getElementById: el, createElement: tag => new Element(tag), querySelectorAll: selector => body.querySelectorAll(selector), addEventListener() {} };
const sourceText = fs.readFileSync(path.join(root, 'src/ui.ts'), 'utf8');
const version = sourceText.match(/version:\s*['"]([\d.]+)['"]/)?.[1];
assert.ok(version, 'Version is available for the simulated host handshake');
const uiBuild = await build({
  stdin: { contents: sourceText + '\nglobalThis.testFontUI = { renderFonts, setBusy, startImport, setSource(value) { source = value; }, getMap() { return fontMap; }, getFonts() { return fonts; } };', loader: 'ts', resolveDir: path.join(root, 'src') },
  bundle: true, write: false, platform: 'browser',
  plugins: [{ name: 'font-search-fixture-pipeline', setup(builder) {
    builder.onResolve({ filter: /^\.\/pipeline$/ }, () => ({ path: 'pipeline', namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `export async function inspectFile() { throw new Error('not exercised'); } export async function convertPsd() { return { name: 'tiny.psd', width: 8, height: 8, layers: [], report: [] }; }`, loader: 'js' }));
  } }],
});
const windowHandlers = {};
const requests = [];
const parent = { postMessage({ pluginMessage: message }) {
  requests.push(message);
  const result = message.type === 'fonts' ? { fonts: [...fonts] } : message.type === 'import' ? { frameId: 'mock-fonts' } : { protocol: 2, version, handlerRegistered: true };
  queueMicrotask(() => windowHandlers.message({ source: null, data: { pluginMessage: { type: 'ack', requestId: message.requestId, ok: true, result } } }));
} };
const context = vm.createContext({ console, crypto: webcrypto, Uint32Array, Uint8Array, Map, Set, Date, Math, Error, Blob, URL, parent, setTimeout, clearTimeout,
  requestAnimationFrame: fn => setTimeout(fn, 0), document, window: { addEventListener(type, fn) { windowHandlers[type] = fn; } } });
vm.runInContext(uiBuild.outputFiles[0].text, context);
await new Promise(resolve => setTimeout(resolve, 0));
const api = context.testFontUI;
assert.equal(api.getFonts().length, fonts.length, 'Available-font handshake completed');
const fixture = { name: 'tiny.psd', psd: {}, summary: { width: 8, height: 8, layers: 3, textLayers: 3, imageLayers: 0, groups: 0, hiddenLayers: 1,
  fonts: ['Arial', 'Uninstalled Source', 'Hidden Source'], visibleFonts: ['Arial', 'Uninstalled Source'], warnings: [] } };
api.setSource(fixture); api.renderFonts();
const rows = () => el('font-list').querySelectorAll('.font-row');
const control = (row, selector) => { const found = row.querySelector(selector); assert.ok(found, `Font row contains ${selector}`); return found; };
const search = row => control(row, 'input');
const select = row => control(row, 'select');
const clear = row => control(row, 'button');
const allLabels = () => body.querySelectorAll('label');
const hasAccessibleName = node => Boolean(node.getAttribute('aria-label') || (node.id && allLabels().some(label => label.htmlFor === node.id && label.textContent.trim())) ||
  (node.getAttribute('aria-labelledby') && node.getAttribute('aria-labelledby').split(/\s+/).some(id => descendants(body).some(element => element.id === id && element.textContent.trim()))));
const serializedMap = () => JSON.parse(JSON.stringify(api.getMap()));
const query = (row, value) => { search(row).value = value; search(row).emit('input'); };
const choose = (row, font) => {
  const index = Array.from(api.getFonts()).findIndex(item => item.family === font.family && item.style === font.style);
  assert.ok(index >= 0);
  select(row).value = String(index); select(row).emit('change');
};
assert.equal(rows().length, 2, 'Only visible source fonts are initially shown');
for (const row of rows()) {
  assert.equal(search(row).type, 'search', 'Search uses the semantic search input type');
  assert.ok(hasAccessibleName(search(row)), 'Each search input has an accessible name');
  assert.ok(hasAccessibleName(select(row)), 'Each destination-font select has an accessible name');
  assert.ok(clear(row).textContent.trim() || hasAccessibleName(clear(row)), 'Each clear button has an accessible name');
  const liveStatus = row.querySelector('[aria-live]');
  assert.ok(liveStatus, 'Each row has an announced search-result status');
  assert.equal(liveStatus.getAttribute('aria-live'), 'polite');
  assert.equal(search(row).getAttribute('aria-controls'), select(row).id, 'Search identifies its controlled list');
  assert.equal(search(row).getAttribute('aria-describedby'), liveStatus.id, 'Search is described by result status');
  assert.equal(select(row).getAttribute('aria-describedby'), liveStatus.id, 'Select is described by result status');
}
const initialIds = descendants(body).map(element => element.id).filter(Boolean);
assert.equal(new Set(initialIds).size, initialIds.length, 'Accessible relationships have unique target IDs');
tests.push('Every font row has a named search input, named destination selector, clear button, and live result status');

choose(rows()[0], fonts[2]); choose(rows()[1], fonts[5]);
const originalMap = serializedMap();
const otherRow = rows()[1];
const otherValue = select(otherRow).value;
query(rows()[0], 'bold');
assert.deepEqual(serializedMap(), originalMap, 'Typing a query must not remap a font');
assert.equal(rows()[1], otherRow, 'Searching one row does not recreate other rows');
assert.equal(select(otherRow).value, otherValue, 'Searching one row preserves other row selection');
assert.equal(search(otherRow).value, '', 'Search is independent per source font');
const filtered = select(rows()[0]).options.filter(option => option.value !== '');
assert.ok(filtered.some(option => /Arial.*Bold/.test(option.textContent)), 'Matching family/style appears');
assert.ok(filtered.some(option => /Inter.*Regular/.test(option.textContent)), 'Current selection stays available when it does not match');
assert.ok(!filtered.some(option => /Arial.*Regular/.test(option.textContent)), 'Unselected nonmatching font is filtered out');
tests.push('Per-row filtering preserves current mapping and other rows, while retaining the selected nonmatching font');

query(rows()[0], 'no-such-font-xyz');
assert.deepEqual(serializedMap(), originalMap, 'No-match search preserves all mappings');
assert.equal(select(rows()[0]).value, String(Array.from(api.getFonts()).findIndex(font => font.family === 'Inter')), 'No-match search preserves selected value');
assert.match(rows()[0].textContent, /无匹配|未找到|没有匹配|0\s*(?:个|种|项)/, 'No-match state is visible');
tests.push('No-match search keeps the chosen font and shows an explicit empty-result state');
clear(rows()[0]).click();
assert.equal(search(rows()[0]).value, '', 'Clear empties the query');
assert.equal(select(rows()[0]).options.filter(option => option.value !== '').length, fonts.length, 'Clear restores all choices');
assert.deepEqual(serializedMap(), originalMap, 'Clear does not change the saved mapping');
assert.equal(document.activeElement, search(rows()[0]), 'Clear returns focus to the search input');
tests.push('Clear restores all choices, preserves selection, and returns search focus');
query(rows()[0], '思源');
const escape = search(rows()[0]).emit('keydown', { key: 'Escape' });
assert.equal(escape.defaultPrevented, true, 'Escape handles the search action');
assert.equal(escape.propagationStopped, true, 'Handled Escape does not propagate to the plugin host');
assert.equal(search(rows()[0]).value, '');
assert.deepEqual(serializedMap(), originalMap);
assert.equal(select(rows()[0]).options.filter(option => option.value !== '').length, fonts.length);
assert.equal(document.activeElement, search(rows()[0]));
assert.equal(clear(rows()[0]).disabled, true, 'Empty search disables redundant clear');
assert.equal(search(rows()[0]).emit('keydown', { key: 'Escape' }).defaultPrevented, undefined, 'Empty-search Escape is not consumed');
tests.push('Escape clears a nonempty query with focus retained; empty-search Escape remains available to the host');

query(rows()[1], 'source han');
choose(rows()[1], fonts[3]);
assert.deepEqual(serializedMap()['Uninstalled Source'], fonts[3], 'Filtered selection uses the original font index');
assert.deepEqual(serializedMap().Arial, fonts[2], 'Changing a filtered choice leaves another mapping intact');
tests.push('Choosing a filtered result uses the correct original font, rather than the result-array index');

query(rows()[0], 'Arial');
select(rows()[0]).value = ''; select(rows()[0]).emit('change');
assert.equal(Object.hasOwn(serializedMap(), 'Arial'), false, 'Auto option clears explicit mapping');
query(rows()[0], 'Regular');
assert.equal(select(rows()[0]).value, '', 'Filtering keeps the automatic choice selected');
assert.equal(Object.hasOwn(serializedMap(), 'Arial'), false, 'Filtering does not reinstate an automatic-match mapping');
clear(rows()[0]).click();
assert.equal(Object.hasOwn(serializedMap(), 'Arial'), false, 'Clearing search keeps automatic choice');
tests.push('Automatic fallback option stays automatic through search and clear');

choose(rows()[0], fonts[2]);
const beforeRerender = serializedMap();
el('include-hidden').checked = true; el('include-hidden').emit('change');
assert.equal(rows().length, 3, 'Include-hidden reveals the hidden font row');
assert.deepEqual(serializedMap().Arial, beforeRerender.Arial);
assert.deepEqual(serializedMap()['Uninstalled Source'], beforeRerender['Uninstalled Source']);
assert.equal(search(rows()[1]).value, 'source han', 'Each row search query survives a rerender');
el('include-hidden').checked = false; el('include-hidden').emit('change');
assert.equal(rows().length, 2);
assert.deepEqual(serializedMap(), beforeRerender, 'Visible-row mappings survive hidden-font toggle rerender');
assert.equal(search(rows()[1]).value, 'source han', 'Each row search query survives hiding hidden fonts again');
tests.push('Source font mappings survive include-hidden toggles and row rebuilding');

query(rows()[0], 'arial');
api.setBusy(true);
for (const row of rows()) for (const node of [search(row), select(row), clear(row)]) assert.equal(node.disabled, true, 'All font controls lock during import');
api.setBusy(false);
for (const row of rows()) { assert.equal(search(row).disabled, false); assert.equal(select(row).disabled, false); }
assert.equal(clear(rows()[0]).disabled, false, 'Nonempty search can be cleared after import');
tests.push('Search, selection, and clear controls lock while busy and restore afterward');

await api.startImport();
const imported = requests.findLast(request => request.type === 'import');
assert.ok(imported, 'Mock import reaches host');
assert.deepEqual(JSON.parse(JSON.stringify(imported.options.fontMap)), beforeRerender, 'Import receives exactly the chosen mappings even while a query is active');
assert.equal(el('status-title').textContent, '导入完成');
tests.push('Real UI import flow forwards selected mappings unchanged while a search query is active');

const result = { passed: true, runtime: 'Node VM executing real bundled helper and UI; minimal DOM, stub conversion and Figma host; no browser layout, real keyboard, or real Figma validation', tests };
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));

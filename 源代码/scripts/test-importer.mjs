import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
await mkdir('test-output', { recursive: true });
await build({ entryPoints: ['src/importer.ts'], bundle: true, platform: 'node', format: 'cjs', outfile: 'test-output/importer-test.cjs', logLevel: 'silent' });
const { importDocument, validateDocument } = require('../test-output/importer-test.cjs');

// Deliberately small public-API mock: these tests verify importer invariants,
// not Photoshop/Figma rendering equivalence (covered by the native file test).
function apiMock() {
  let next = 0;
  const all = [], loaded = [], available = [
    { family: 'Noto Sans SC', style: 'Regular' }, { family: 'Noto Sans SC', style: 'Bold' },
    { family: 'Noto Sans SC', style: 'Black' }, { family: 'Inter', style: 'Regular' },
  ];
  const page = { children: [], appendChild(node) { if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1); this.children.push(node); node.parent = this; } };
  function node(type) {
    const n = { id: `mock:${++next}`, type, x: 0, y: 0, width: 100, height: 100, visible: true, opacity: 1, blendMode: 'NORMAL', effects: [], strokes: [], fills: [], isMask: false, maskType: 'ALPHA', children: [], removed: false,
      resize(w, h) { this.width = w; this.height = h; }, appendChild: page.appendChild,
      remove() { for (const c of [...this.children]) c.remove(); if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; this.removed = true; },
      findAll() { return this.children.flatMap(c => [c, ...c.findAll()]); },
      clone() { const c = node(this.type); for (const k of ['name', 'x', 'y', 'width', 'height', 'visible', 'opacity']) c[k] = this[k]; for (const ch of this.children) c.appendChild(ch.clone()); return c; },
    };
    if (type === 'TEXT' || type === 'TEXT_PATH') {
      n.fontName = { family: 'Inter', style: 'Regular' }; n.characters = ''; n.ranges = [];
      for (const method of ['FontName', 'FontSize', 'Fills', 'LetterSpacing', 'LineHeight', 'TextDecoration', 'TextCase']) n[`setRange${method}`] = (start, end, value) => n.ranges.push({ method, start, end, value });
    }
    page.appendChild(n); all.push(n); return n;
  }
  const api = { currentPage: page, listAvailableFontsAsync: async () => available.map(fontName => ({ fontName })), loadFontAsync: async f => { assert.ok(available.some(a => a.family === f.family && a.style === f.style)); loaded.push(f); }, createFrame: () => node('FRAME'), createText: () => node('TEXT'), createRectangle: () => node('RECTANGLE'), createVector: () => { const n = node('VECTOR'); n.setVectorNetworkAsync = async value => { n.vectorNetwork = value; }; return n; }, createTextPath: (vector, segment, position) => { const n = node('TEXT_PATH'); n.vectorNetwork = vector.vectorNetwork; n.textPathStartData = { segment, position }; vector.remove(); return n; } };
  const existing = node('FRAME'); existing.name = 'unrelated'; existing.x = 40; existing.y = 50;
  return { api, all, loaded, existing };
}
const black = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
const yellow = [{ type: 'SOLID', color: { r: 1, g: 1, b: 0 } }];
const goldGradient = { type: 'GRADIENT_LINEAR', gradientTransform: [[1, 0, 0], [0, 1, 0]], gradientStops: [{ position: 0, color: { r: 1, g: 0.9, b: 0.7, a: 1 } }, { position: 1, color: { r: 0.7, g: 0.4, b: 0.2, a: 1 } }] };
const base = { id: 'a', name: 'Title', kind: 'text', x: 30, y: 92, width: 285, height: 24, visible: true, opacity: 1, blendMode: 'NORMAL', fills: black,
  text: { characters: '中文AB', fontPostScript: 'MissingBrand-Bold', fontSize: 48, fill: black, transform: [0.5, 0, 0, 0.5, 30, 113], lineHeight: 60, letterSpacing: 2,
    runs: [{ start: 0, end: 2, fontPostScript: 'MissingBrand-Bold', fontSize: 50, fill: yellow }, { start: 2, end: 4, fontPostScript: 'Inter-Regular', fontFamily: 'Inter', fontStyle: 'Regular', fontSize: 40, fill: black }] } };
const doc = { version: 1, name: 'Test', width: 1625, height: 1000, layers: [base], report: [] };
const options = { includeReference: false, keepTextBackup: false, fontMap: {} };
const results = [];

{
  const { api, all, existing, loaded } = apiMock();
  const result = await importDocument(api, doc, {}, options);
  const frame = all.find(n => n.id === result.frameId), text = all.find(n => n.type === 'TEXT');
  assert.equal(frame.width, 1625); assert.equal(frame.height, 1000); assert.ok(frame.x > existing.x + existing.width);
  assert.deepEqual(text.fontName, { family: 'Noto Sans SC', style: 'Bold' });
  assert.equal(text.fontSize, 24); assert.deepEqual(text.lineHeight, { unit: 'PIXELS', value: 30 });
  assert.equal(text.characters, '中文AB'); assert.equal(text.x, 30); assert.equal(text.y, 92);
  assert.deepEqual(text.ranges.find(r => r.method === 'Fills' && r.start === 0).value, yellow);
  assert.deepEqual(text.ranges.find(r => r.method === 'FontName' && r.start === 2).value, { family: 'Inter', style: 'Regular' });
  assert.equal(text.ranges.find(r => r.method === 'FontSize').value, 25);
  assert.equal(result.missingFonts.length, 1); assert.ok(result.report.some(r => r.code === 'FONT_SUBSTITUTED'));
  assert.ok(loaded.length >= 2); assert.deepEqual([existing.x, existing.y, existing.removed], [40, 50, false]);
  results.push('Exact canvas, font discovery/substitution, weighted CJK fallback, scaled typography, editable rich ranges, unrelated nodes preserved');
}
{
  const { api, all, existing } = apiMock(); let cancelled = false;
  const two = { ...doc, layers: [base, { ...base, id: 'b', name: 'Second' }] };
  await assert.rejects(importDocument(api, two, {}, options, { onProgress: () => { cancelled = true; }, isCancelled: () => cancelled }), /取消/);
  assert.deepEqual(api.currentPage.children, [existing]); assert.ok(all.filter(n => n !== existing).every(n => n.removed));
  results.push('Mid-import cancellation rolls back every new node without deleting unrelated content');
}
{
  const { api, all, existing } = apiMock(); api.createRectangle = () => { throw new Error('simulated API failure'); };
  const image = { ...base, kind: 'image', text: undefined, raster: { width: 10, height: 10, tiles: [{ assetId: 'x', x: 30, y: 92, width: 10, height: 10 }] } };
  await assert.rejects(importDocument(api, { ...doc, layers: [image] }, { x: 'hash' }, options), /simulated API failure/);
  assert.deepEqual(api.currentPage.children, [existing]); assert.ok(all.filter(n => n !== existing).every(n => n.removed));
  results.push('API failure rollback includes unattached/intermediate nodes');
}
{
  const { api, all } = apiMock();
  const path = { segments: [[100, 200, 110, 200, 130, 200, 140, 200], [140, 200, 140, 210, 140, 230, 140, 240], [140, 240, 130, 240, 110, 240, 100, 240], [100, 240, 100, 230, 100, 210, 100, 200]], reversed: true, textRange: [1.25, 3] };
  const layer = { ...base, text: { ...base.text, shapeType: 'box', characters: '中文AB\nCD', path, textAlignHorizontal: 'LEFT' } };
  const result = await importDocument(api, { ...doc, layers: [layer] }, {}, options);
  const text = all.find(n => n.type === 'TEXT_PATH');
  assert.equal(text.characters, '中文AB\nCD'); assert.equal(text.x, 100); assert.equal(text.y, 200); assert.equal(text.fontSize, 24);
  assert.deepEqual(text.textPathStartData, { segment: 2, position: .75 });
  assert.deepEqual(text.vectorNetwork.vertices[1], { x: 0, y: 40 });
  const vector = all.find(n => n.type === 'VECTOR'); assert.equal(vector.removed, true);
  assert.ok(result.createdNodeIds.includes(vector.id) && result.createdNodeIds.includes(text.id)); assert.ok(result.removedNodeIds.includes(vector.id));
  assert.equal(result.counts.texts, 1);
  results.push('Editable cubic path text preserves full overflow content, source geometry, reversed segment anchor, scaled typography and consumed-vector lifecycle');
}
{
  const { api, all } = apiMock();
  const create = api.createText;
  api.createText = () => {
    const n = create();
    Object.defineProperty(n, 'absoluteBoundingBox', { get: () => ({ x: n.x, y: n.y, width: 110, height: 108 }) });
    Object.defineProperty(n, 'absoluteRenderBounds', { get: () => ({ x: n.x + 3.15, y: n.y + 22.14, width: 100, height: 64.86 }) });
    return n;
  };
  await importDocument(api, doc, {}, options);
  const text = all.find(n => n.type === 'TEXT');
  assert.equal(text.x, 26.85); assert.equal(text.y, 69.86);
  assert.equal(text.fontSize, 24);
  assert.equal(text.absoluteRenderBounds.x, 30); assert.equal(text.absoluteRenderBounds.y, 92);
  results.push('Point text aligns actual glyph ink to source pixels before effects and clipping without changing font size');
}
{
  const { api, all } = apiMock();
  const paints = [goldGradient, ...black];
  const text = { ...base, fills: paints, strokes: paints, strokeWeight: 1, text: { ...base.text, fill: paints, runs: [{ start: 0, end: 4, fill: paints }] } };
  const shape = { id: 'shape', name: 'Shape', kind: 'shape', x: 0, y: 0, width: 20, height: 20, visible: true, opacity: 1, blendMode: 'NORMAL', fills: paints };
  await importDocument(api, { ...doc, layers: [text, shape] }, {}, options);
  const node = all.find(n => n.type === 'TEXT');
  assert.deepEqual(node.fills.map(p => p.type), ['SOLID', 'GRADIENT_LINEAR']);
  assert.deepEqual(node.strokes.map(p => p.type), ['SOLID', 'GRADIENT_LINEAR']);
  assert.deepEqual(node.ranges.find(r => r.method === 'Fills').value.map(p => p.type), ['SOLID', 'GRADIENT_LINEAR']);
  assert.deepEqual(all.find(n => n.name === 'Shape').fills.map(p => p.type), ['SOLID', 'GRADIENT_LINEAR']);
  assert.deepEqual(paints.map(p => p.type), ['GRADIENT_LINEAR', 'SOLID']);
  results.push('Photoshop top-first overlay stacks reverse only at native text/range/shape/stroke assignment; source paint order remains unchanged');
}
{
  const { api, all } = apiMock();
  const image = { ...base, kind: 'image', text: undefined, raster: { width: 10, height: 10, tiles: [{ assetId: 'missing', x: 0, y: 0, width: 10, height: 10 }] } };
  await assert.rejects(importDocument(api, { ...doc, layers: [image] }, {}, options), /缺少图像资产/);
  assert.equal(all.length, 1);
  assert.throws(() => validateDocument({ ...doc, width: Infinity }), /画布宽度/);
  assert.throws(() => validateDocument({ ...doc, layers: [base, base] }), /重复图层/);
  assert.throws(() => validateDocument({ ...doc, layers: [{ ...base, text: { ...base.text, runs: [{ start: 0, end: 999 }] } }] }), /文字段结束/);
  results.push('Missing assets, non-finite dimensions, duplicate IDs, invalid text ranges rejected before mutations');
}
{
  const { api, all } = apiMock();
  const artboard = { id: 'board', name: 'Artboard', kind: 'group', x: 875, y: 0, width: 750, height: 1000, visible: true, opacity: 1, blendMode: 'PASS_THROUGH', metadata: { artboard: { backgroundType: 1 } }, children: [{ ...base, x: 900 }] };
  await importDocument(api, { ...doc, layers: [artboard] }, {}, options);
  const group = all.find(n => n.name === 'Artboard'); assert.equal(group.clipsContent, true); assert.equal(group.x, 875); assert.equal(group.width, 750);
  const text = all.find(n => n.type === 'TEXT'); assert.equal(text.x, 25);
  results.push('Artboards clip content and children retain source absolute-to-local coordinates');
}
await writeFile('test-output/importer-tests.json', JSON.stringify({ passed: results.length, scope: 'Public API mock invariants; no pixel-rendering claim', tests: results }, null, 2));
console.log(JSON.stringify({ passed: results.length, tests: results }, null, 2));

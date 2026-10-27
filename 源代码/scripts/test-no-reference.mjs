/** Offline regression for editable-only imports. Uses public Figma API mocks,
 * not a live Figma document or rendering-equivalence test. Run after build. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { build } from 'esbuild';
import agPsd from 'ag-psd';
import { createCanvas, ImageData } from '@napi-rs/canvas';

const require = createRequire(import.meta.url);
await fs.mkdir('test-output', { recursive: true });
await build({ entryPoints: ['src/importer.ts'], bundle: true, platform: 'node', format: 'cjs', outfile: 'test-output/no-reference-importer.cjs', logLevel: 'silent' });
const { importDocument } = require('../test-output/no-reference-importer.cjs');
const plain = value => JSON.parse(JSON.stringify(value));

function apiMock() {
  let next = 0;
  const all = [], replies = [];
  const page = {
    id: 'no-reference-page', type: 'PAGE', removed: false,
    children: [], selection: [],
    appendChild(node) {
      if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1);
      this.children.push(node); node.parent = this;
    },
  };
  function make(type) {
    const node = {
      id: `no-reference:${++next}`, type, name: '', x: 0, y: 0, width: 100, height: 100,
      visible: true, locked: false, opacity: 1, blendMode: 'NORMAL', effects: [], strokes: [], fills: [], children: [], removed: false,
      resize(width, height) { this.width = width; this.height = height; },
      appendChild: page.appendChild,
      remove() {
        for (const child of [...this.children]) child.remove();
        if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1);
        this.parent = null; this.removed = true;
      },
      setRelaunchData() {},
    };
    if (type === 'TEXT') {
      node.fontName = { family: 'Inter', style: 'Regular' }; node.characters = ''; node.ranges = [];
      for (const method of ['FontName', 'FontSize', 'Fills', 'LetterSpacing', 'LineHeight', 'TextDecoration', 'TextCase']) {
        node[`setRange${method}`] = (start, end, value) => node.ranges.push({ method, start, end, value });
      }
    }
    all.push(node); page.appendChild(node); return node;
  }
  const api = {
    currentPage: page,
    listAvailableFontsAsync: async () => [{ fontName: { family: 'Inter', style: 'Regular' } }],
    loadFontAsync: async () => {},
    createFrame: () => make('FRAME'), createRectangle: () => make('RECTANGLE'), createText: () => make('TEXT'),
    ui: { postMessage(message) { replies.push(message); } },
    root: { setRelaunchData() {} }, showUI() {},
    createImage: () => ({ hash: `uploaded-${++next}` }),
    getNodeByIdAsync: async id => all.find(node => node.id === id),
    viewport: { scrollAndZoomIntoView() {} },
  };
  // An existing user-created board may share the former generated name.
  const existing = make('FRAME'); existing.name = 'Fixture · 原始合成预览'; existing.x = 12; existing.y = 27; existing.locked = true;
  const userImage = make('RECTANGLE'); userImage.name = '原始合成图'; userImage.fills = [{ type: 'IMAGE', imageHash: 'user-image', scaleMode: 'FILL' }]; existing.appendChild(userImage);
  return { api, all, replies, existing, userImage };
}

const raster = (assetId, x, y, width = 30, height = 20) => ({ width, height, tiles: [{ assetId, x, y, width, height }] });
const base = (id, name, kind, x, y, width, height) => ({ id, name, kind, x, y, width, height, visible: true, opacity: 1, blendMode: 'NORMAL' });
const text = {
  ...base('title', 'Title', 'text', 20, 35, 80, 20),
  text: { characters: 'Editable title', fontFamily: 'Inter', fontStyle: 'Regular', fontSize: 20 },
  raster: raster('text-backup', 20, 35, 80, 20),
};
const document = {
  version: 1, name: 'Fixture', width: 500, height: 250, report: [],
  composite: raster('comparison-only', 0, 0, 500, 250),
  layers: [
    { ...base('board-a', 'Artboard A', 'group', 10, 20, 200, 200), metadata: { artboard: { backgroundType: 3 } }, children: [
      text,
      { ...base('photo-a', '原始合成图', 'image', 25, 80, 30, 20), raster: raster('photo-a', 25, 80) },
    ] },
    { ...base('board-b', '原始合成预览', 'group', 250, 20, 200, 200), metadata: { artboard: { backgroundType: 1 } }, children: [
      { ...base('photo-b', 'Photo B', 'image', 270, 50, 30, 20), raster: raster('photo-b', 270, 50) },
      { ...base('shape', 'Native shape', 'shape', 270, 100, 40, 30), fills: [{ type: 'SOLID', color: { r: 0.2, g: 0.4, b: 0.6 } }] },
    ] },
  ],
};
const hashes = { 'photo-a': 'hash-a', 'photo-b': 'hash-b', 'text-backup': 'hash-text', 'comparison-only': 'hash-comparison' };
const options = { keepTextBackup: true, fontMap: {} };
const descendants = node => node.children.flatMap(child => [child, ...descendants(child)]);
const snapshot = nodes => nodes.map(node => ({ id: node.id, parent: node.parent?.id, name: node.name, type: node.type, x: node.x, y: node.y, width: node.width, height: node.height, visible: node.visible, locked: node.locked, removed: node.removed, fills: plain(node.fills), characters: node.characters }));
const results = [];

function verifyEditableOnly(instance, result, beforeRoots, beforeNodes, beforeSnapshot) {
  const { api, all } = instance;
  const main = all.find(node => node.id === result.frameId);
  assert.ok(main && !main.removed, 'Editable root is retained');
  assert.deepEqual(api.currentPage.children, [...beforeRoots, main], 'Exactly one new editable root, no separate comparison board');
  assert.deepEqual(snapshot(beforeNodes), beforeSnapshot, 'Previously existing nodes and images remain unchanged');
  assert.equal(result.referenceFrameId, undefined);
  assert.equal(main.name, 'Fixture · 可编辑');
  assert.deepEqual([main.width, main.height], [500, 250]);
  assert.ok(main.clipsContent);
  assert.deepEqual(main.children.map(node => node.name), ['Artboard A', '原始合成预览'], 'Both source artboards survive, including a name resembling the former preview');
  assert.deepEqual(main.children.map(node => [node.x, node.y, node.width, node.height, node.clipsContent]), [[10, 20, 200, 200, true], [250, 20, 200, 200, true]]);
  const children = descendants(main), nativeText = children.find(node => node.type === 'TEXT');
  assert.equal(nativeText.characters, 'Editable title');
  assert.equal(nativeText.name, 'Title · 可编辑文字');
  assert.equal(nativeText.fontSize, 20);
  const backup = children.find(node => node.name === '原始文字像素备份（隐藏）');
  assert.ok(backup && !backup.visible && backup.locked, 'Necessary original text raster backup survives');
  const imageHashes = children.flatMap(node => node.fills.filter(paint => paint.type === 'IMAGE').map(paint => paint.imageHash));
  assert.deepEqual(imageHashes.sort(), ['hash-a', 'hash-b', 'hash-text'].sort(), 'Only source image and text-backup rasters appear; no composite raster is inserted');
  assert.ok(children.some(node => node.name === '原始合成图'), 'Actual source image with preview-like name is preserved');
  assert.ok(children.some(node => node.name === 'Native shape' && node.type === 'RECTANGLE'));
  assert.deepEqual(plain(result.counts), { layers: 6, texts: 1, images: 2, groups: 2, shapes: 1, tiles: 3 });
  assert.equal(result.report.some(issue => issue.code === 'NO_REFERENCE'), false);
  assert.ok(all.filter(node => !beforeNodes.includes(node)).every(node => !node.removed), 'Successful import does not create and then delete comparison nodes');
  return main;
}

for (const includeReference of [undefined, false, true]) {
  const instance = apiMock();
  const beforeRoots = [...instance.api.currentPage.children], beforeNodes = [...instance.all], beforeSnapshot = snapshot(beforeNodes);
  const requested = includeReference === undefined ? options : { ...options, includeReference };
  const result = await importDocument(instance.api, document, hashes, requested);
  verifyEditableOnly(instance, result, beforeRoots, beforeNodes, beforeSnapshot);
  results.push(`Editable-only output preserves source artboards, images, native text and text backup with includeReference ${includeReference === undefined ? 'omitted' : includeReference}`);
}

{
  const instance = apiMock();
  await importDocument(instance.api, document, hashes, options);
  const beforeRoots = [...instance.api.currentPage.children], beforeNodes = [...instance.all], beforeSnapshot = snapshot(beforeNodes);
  const second = await importDocument(instance.api, document, hashes, { ...options, includeReference: true });
  const main = verifyEditableOnly(instance, second, beforeRoots, beforeNodes, beforeSnapshot);
  const previous = beforeRoots.at(-1);
  assert.ok(main.x > previous.x + previous.width, 'Repeated import is placed beside prior content');
  assert.equal(instance.all.filter(node => !node.removed && node.name === 'Fixture · 可编辑').length, 2);
  results.push('Repeated same-name and same-layer-ID import preserves all prior editable content and user images');

  const committedRoots = [...instance.api.currentPage.children], committedNodes = [...instance.all], committedSnapshot = snapshot(committedNodes);
  let cancelled = false;
  await assert.rejects(importDocument(instance.api, document, hashes, { ...options, includeReference: true }, {
    onProgress() { cancelled = true; }, isCancelled: () => cancelled,
  }), /取消/);
  assert.deepEqual(instance.api.currentPage.children, committedRoots);
  assert.deepEqual(snapshot(committedNodes), committedSnapshot);
  const currentAttempt = instance.all.filter(node => !committedNodes.includes(node));
  assert.ok(currentAttempt.length > 0 && currentAttempt.every(node => node.removed), 'Cancellation removes only nodes created by the current attempt');
  results.push('Cancellation after repeated import removes only current-attempt nodes, preserving both prior imports and the user comparison-named board');
}

// Exercise the actual compiled host boundary as well as the importer. The host
// must not opt back into comparison output for an absent or stale option.
const bundle = await fs.readFile('dist/code.js', 'utf8');
for (const requested of [undefined, { includeReference: true, keepTextBackup: true, fontMap: {} }]) {
  const instance = apiMock();
  vm.runInNewContext(bundle, { figma: instance.api, __html__: '<html></html>', setTimeout, clearTimeout, console }, { filename: 'dist/code.js', timeout: 1000 });
  let sequence = 0;
  const sessionId = 'editable-only-host';
  async function send(message) {
    const requestId = `no-reference-${++sequence}`;
    await instance.api.ui.onmessage({ ...message, requestId });
    const ack = instance.replies.find(reply => reply.type === 'ack' && reply.requestId === requestId);
    assert.ok(ack?.ok, ack?.error || 'Host did not acknowledge'); return ack.result;
  }
  await send({ type: 'begin', sessionId, clientId: 'no-reference-client', sessionSequence: 1, name: document.name, width: document.width, height: document.height });
  for (const assetId of Object.keys(hashes)) await send({ type: 'asset', sessionId, assetId, bytes: [137, 80, 78, 71] });
  const before = [...instance.api.currentPage.children];
  const result = await send({ type: 'import', sessionId, document, ...(requested ? { options: requested } : {}) });
  const main = instance.all.find(node => node.id === result.frameId);
  assert.deepEqual(instance.api.currentPage.children, [...before, main]);
  assert.equal(result.referenceFrameId, undefined);
  assert.equal(descendants(main).filter(node => node.fills.some(paint => paint.type === 'IMAGE')).length, 3);
  assert.deepEqual(main.children.map(node => node.name), ['Artboard A', '原始合成预览']);
  assert.equal(instance.api.currentPage.selection.length, 1);
  assert.equal(instance.api.currentPage.selection[0], main);
  results.push(`Compiled host import creates only the editable root with ${requested ? 'legacy includeReference:true' : 'options omitted'}`);
}

{
  const html = await fs.readFile('src/ui.html', 'utf8');
  const ui = await fs.readFile('src/ui.ts', 'utf8');
  assert.doesNotMatch(html, /id=["']include-reference["']/);
  assert.doesNotMatch(ui, /el(?:<[^>]+>)?\(["']include-reference["']\)/);
  assert.match(ui, /includeComposite:\s*false/);
  results.push('UI no longer exposes the reference checkbox and explicitly disables composite conversion');
}

// Compare independently parsed real PSD and PSB fixture bytes with the sole
// changed conversion option. Layer objects (including effects, masks, fonts,
// visibility and coordinates) and every non-composite PNG must be identical.
agPsd.initializeCanvas(createCanvas, (width, height) => new ImageData(width, height));
await build({ entryPoints: ['src/pipeline.ts'], bundle: true, platform: 'node', format: 'cjs', external: ['ag-psd'], outfile: 'test-output/no-reference-pipeline.cjs', logLevel: 'silent' });
const { inspectFile, convertPsd } = require('../test-output/no-reference-pipeline.cjs');
const flatten = layers => layers.flatMap(layer => [layer, ...flatten(layer.children || [])]);
for (const format of ['psd', 'psb']) {
  const bytes = await fs.readFile(`samples/layered-fixture.${format}`);
  assert.equal(bytes.readUInt16BE(4), format === 'psb' ? 2 : 1);
  for (const includeHidden of [false, true]) {
    async function convert(includeComposite) {
      const input = await inspectFile(new File([bytes], `layered-fixture.${format}`));
      const assets = new Map();
      const doc = await convertPsd(input.psd, input.name, { includeHidden, includeComposite, rasterizeGradients: true }, {
        onAsset: async (id, data) => assets.set(id, Buffer.from(data)), isCancelled: () => false,
      });
      return { doc, assets };
    }
    const withReference = await convert(true), editableOnly = await convert(false);
    assert.ok(withReference.doc.composite?.tiles.length, 'Fixture has a genuine saved composite for comparison');
    assert.equal(editableOnly.doc.composite, undefined);
    assert.deepEqual(editableOnly.doc.layers, withReference.doc.layers, `${format}: all source layer data remain unchanged`);
    assert.deepEqual(
      [editableOnly.doc.version, editableOnly.doc.name, editableOnly.doc.width, editableOnly.doc.height],
      [withReference.doc.version, withReference.doc.name, withReference.doc.width, withReference.doc.height],
    );
    const sourceLayers = flatten(editableOnly.doc.layers);
    assert.ok(sourceLayers.some(layer => layer.mask?.tiles.length), 'Fixture exercises original bitmap-mask assets');
    assert.ok(sourceLayers.some(layer => layer.kind === 'text' && layer.raster?.tiles.length), 'Fixture exercises editable text and its pixel backup');
    assert.ok(sourceLayers.some(layer => layer.kind === 'image' && layer.raster?.tiles.length), 'Fixture exercises original image assets');
    assert.ok(sourceLayers.some(layer => layer.effects?.length), 'Fixture exercises source image/text effects');
    assert.equal(sourceLayers.some(layer => !layer.visible), includeHidden, 'The hidden-layer option keeps its existing behavior');
    const compositeIds = new Set(withReference.doc.composite.tiles.map(tile => tile.assetId));
    const layerIds = sourceLayers.flatMap(layer => [layer.raster, layer.mask].filter(Boolean).flatMap(raster => raster.tiles.map(tile => tile.assetId)));
    assert.ok(layerIds.length > 0);
    assert.deepEqual([...editableOnly.assets.keys()].sort(), [...withReference.assets.keys()].filter(id => !compositeIds.has(id)).sort(), 'Only composite assets are removed from conversion');
    for (const id of layerIds) {
      assert.ok(editableOnly.assets.has(id), `Original layer/mask asset remains available: ${id}`);
      assert.deepEqual(editableOnly.assets.get(id), withReference.assets.get(id), `${format}: asset ${id} is byte-for-byte unchanged`);
    }
    for (const id of compositeIds) assert.equal(editableOnly.assets.has(id), false);
    results.push(`${format.toUpperCase()} real-file conversion, hidden layers ${includeHidden ? 'included' : 'skipped'}: complete layer structure and ${layerIds.length} layer/mask PNG assets are byte-identical; only composite assets are omitted`);
  }
}

const report = { passed: results.length, scope: 'Offline PSD/PSB fixture conversion plus importer and compiled-host public API mocks; no live Figma or rendering-equivalence claim', tests: results };
await fs.writeFile('test-output/no-reference-tests.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

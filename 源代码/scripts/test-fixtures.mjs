import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import agPsd from 'ag-psd';
import { createCanvas, ImageData } from '@napi-rs/canvas';
import { build } from 'esbuild';
import { unzlibSync, zipSync } from 'fflate';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureDir = path.join(root, 'test-output/fixtures');
fs.mkdirSync(fixtureDir, { recursive: true });
agPsd.initializeCanvas(createCanvas, (w, h) => new ImageData(w, h));
await build({ entryPoints: [path.join(root, 'src/pipeline.ts')], outfile: path.join(fixtureDir, 'pipeline-test.cjs'), bundle: true, platform: 'node', format: 'cjs', external: ['ag-psd'] });
await build({ entryPoints: [path.join(root, 'src/png.ts')], outfile: path.join(fixtureDir, 'png-test.cjs'), bundle: true, platform: 'node', format: 'cjs' });
const require = createRequire(import.meta.url);
const { inspectFile, convertPsd } = require(path.join(fixtureDir, 'pipeline-test.cjs'));
const { encodePng } = require(path.join(fixtureDir, 'png-test.cjs'));

// Decode PNG samples without Canvas: Canvas premultiplication would discard
// RGB under alpha=0 and hide a regression in the lossless PNG transport.
function decodePNG(bytes) {
  const b = Buffer.from(bytes); const chunks = [];
  assert.deepEqual(b.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  let width = 0, height = 0;
  for (let offset = 8; offset < b.length;) {
    const size = b.readUInt32BE(offset), type = b.toString('ascii', offset + 4, offset + 8);
    const data = b.subarray(offset + 8, offset + 8 + size);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); assert.equal(data[8], 8); assert.equal(data[9], 6); }
    if (type === 'IDAT') chunks.push(data);
    offset += size + 12;
  }
  const scan = unzlibSync(Buffer.concat(chunks));
  const stride = width * 4, data = new Uint8ClampedArray(stride * height);
  for (let y = 0; y < height; y++) {
    const start = y * (stride + 1), filter = scan[start];
    assert.ok(filter === 0 || filter === 1, 'Fixture encoder uses lossless None/Sub filters');
    for (let x = 0; x < stride; x++) data[y * stride + x] = (scan[start + 1 + x] + (filter === 1 && x >= 4 ? data[y * stride + x - 4] : 0)) & 255;
  }
  return { width, height, data };
}
function flatten(nodes) { return nodes.flatMap(node => [node, ...flatten(node.children || [])]); }

function bitmap(width, height, sample) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(sample(x, y), (y * width + x) * 4);
  return { width, height, data };
}
const checker = bitmap(96, 80, (x, y) => [(x * 3) % 256, (y * 5) % 256, (x + y) % 2 ? 220 : 20, 255]);
const red = bitmap(20, 16, (x, y) => [200, 50, 30, x < 4 || y < 4 ? 0 : 128]);
const mask = bitmap(20, 16, (x) => [x < 10 ? 0 : 255, x < 10 ? 0 : 255, x < 10 ? 0 : 255, 255]);
const textPixels = bitmap(32, 10, (x, y) => [210, 180, 20, x % 5 && y > 1 ? 255 : 0]);
const gradient = {
  enabled: true, opacity: 0.8, blendMode: 'normal', type: 'linear', angle: 90,
  scale: 1, reverse: false, align: true, offset: { x: 0, y: 0 },
  gradient: {
    name: 'Gold', type: 'solid', smoothness: 1,
    colorStops: [
      { location: 0, midpoint: 0.5, color: { r: 255, g: 220, b: 90 } },
      { location: 1, midpoint: 0.5, color: { r: 160, g: 80, b: 10 } },
    ],
    opacityStops: [{ location: 0, midpoint: 0.5, opacity: 1 }, { location: 1, midpoint: 0.5, opacity: 1 }],
  },
};
const document = {
  width: 96, height: 80, imageData: checker,
  children: [
    { name: 'Background', left: 0, top: 0, imageData: checker },
    { name: 'Nested group', blendMode: 'pass through', children: [
      { name: 'Masked alpha image', left: 8, top: 12, imageData: red, mask: { left: 8, top: 12, defaultColor: 0, imageData: mask } },
      { name: 'Clipped image', left: 8, top: 12, imageData: red, clipping: true, hidden: true },
      { name: 'Editable mixed text', left: 22, top: 40, imageData: textPixels,
        text: {
          text: 'SALE 15%', transform: [1.2, 0, 0, 1.1, 22, 50],
          shapeType: 'point', pointBase: [0, 0],
          style: { font: { name: 'ArialMT' }, fontSize: 12, fillColor: { r: 20, g: 30, b: 40 } },
          styleRuns: [{ length: 5, style: { fontSize: 12 } }, { length: 3, style: { fontSize: 16, font: { name: 'Arial-BoldMT' } } }],
          paragraphStyle: { justification: 'left' },
        },
        effects: {
          gradientOverlay: [gradient],
          solidFill: [{ enabled: false, color: { r: 255, g: 0, b: 0 }, opacity: 1, blendMode: 'normal' }],
          dropShadow: [{ enabled: true, color: { r: 0, g: 0, b: 0 }, opacity: 0.3, blendMode: 'multiply', angle: 120, distance: { value: 3, units: 'Pixels' }, size: { value: 4, units: 'Pixels' } }],
        },
      },
    ] },
    { name: 'Hidden group', hidden: true, children: [{ name: 'Inherited hidden image', left: 70, top: 50, imageData: red }] },
  ],
};
const results = [];
const alphaTransport = bitmap(5, 3, (x, y) => [17 + x * 40, 45 + y * 55, 211 - x * 15, [0, 1, 127, 254, 255][x]]);
const lossless = decodePNG(encodePng(alphaTransport.width, alphaTransport.height, alphaTransport.data));
assert.deepEqual(lossless, alphaTransport);
results.push({ name: 'PNG lossless alpha and hidden RGB', passed: true });
for (const format of ['psd', 'psb']) {
  const encoded = agPsd.writePsdBuffer(document, { psb: format === 'psb', noBackground: true });
  const file = path.join(fixtureDir, `layered-fixture.${format}`);
  fs.writeFileSync(file, encoded);
  assert.equal(encoded.readUInt16BE(4), format === 'psb' ? 2 : 1);
  const decoded = agPsd.readPsd(encoded, { useRawData: true, useImageData: true, skipThumbnail: true });
  assert.equal(decoded.width, 96);
  assert.equal(decoded.height, 80);
  assert.deepEqual(decoded.children.map(x => x.name), ['Background', 'Nested group', 'Hidden group']);
  const nested = decoded.children[1];
  assert.equal(nested.children[1].clipping, true);
  assert.equal(nested.children[1].hidden, true);
  assert.equal(decoded.children[2].hidden, true);
  assert.equal(nested.children[2].text.text, 'SALE 15%');
  assert.equal(nested.children[2].text.styleRuns[0].style.font.name, 'ArialMT');
  assert.equal(nested.children[2].text.styleRuns[1].style.font.name, 'Arial-BoldMT');
  assert.deepEqual(nested.children[2].text.transform, [1.2, 0, 0, 1.1, 22, 50]);
  assert.equal(nested.children[2].effects.gradientOverlay[0].enabled, true);
  assert.equal(nested.children[2].effects.solidFill[0].enabled, false);
  assert.equal(nested.children[2].effects.dropShadow[0].enabled, true);
  assert.deepEqual(agPsd.getLayerImageData(nested.children[0]).data, red.data);
  assert.deepEqual(agPsd.getLayerMaskImageData(nested.children[0]).data, mask.data);
  // Integration guard: PSB composites must be decoded using the original
  // header context. getCompositeImageData(raw) loses its large/globalAlpha.
  const merged = agPsd.readPsd(encoded, { useImageData: true, skipLayerImageData: true, skipThumbnail: true }).imageData;
  assert.deepEqual(merged.data, checker.data);
  const input = await inspectFile(new File([encoded], `layered-fixture.${format}`));
  assert.equal(input.summary.layers, 7);
  assert.equal(input.summary.textLayers, 1);
  assert.equal(input.summary.hiddenLayers, 3);
  assert.deepEqual(input.summary.fonts, ['Arial-BoldMT', 'ArialMT']);
  const assets = new Map();
  const converted = await convertPsd(input.psd, input.name, { includeHidden: true, includeComposite: true, rasterizeGradients: true }, {
    onAsset: async (id, data) => assets.set(id, data), isCancelled: () => false,
  });
  const nodes = flatten(converted.layers);
  assert.deepEqual(converted.layers.map(x => x.name), ['Background', 'Nested group', 'Hidden group']);
  assert.equal(nodes.length, 7);
  assert.equal(nodes.filter(x => x.kind === 'text').length, 1);
  const text = nodes.find(x => x.kind === 'text');
  assert.equal(text.text.characters, 'SALE 15%');
  assert.equal(text.text.fontPostScript, 'ArialMT');
  assert.equal(text.text.fontSize, 12);
  assert.equal(text.text.runs[1].fontPostScript, 'Arial-BoldMT');
  assert.equal(text.text.runs[1].fontSize, 16);
  assert.ok(text.effects.some(x => x.type === 'DROP_SHADOW'));
  assert.ok(text.text.fill.some(x => x.type === 'GRADIENT_LINEAR'));
  assert.deepEqual(decodePNG(assets.get(converted.composite.tiles[0].assetId)).data, checker.data);
  const masked = nodes.find(x => x.name === 'Masked alpha image');
  assert.deepEqual(decodePNG(assets.get(masked.raster.tiles[0].assetId)).data, red.data);
  const alphaMask = decodePNG(assets.get(masked.mask.tiles[0].assetId));
  for (let y = 0; y < 16; y++) for (let x = 0; x < 20; x++) assert.equal(alphaMask.data[(y * 20 + x) * 4 + 3], x < 10 ? 0 : 255);
  const onlyVisible = await convertPsd(input.psd, input.name, { includeHidden: false, includeComposite: false, rasterizeGradients: true }, {
    onAsset: async () => {}, isCancelled: () => false,
  });
  assert.equal(flatten(onlyVisible.layers).length, 4);
  results.push({ format, fileBytes: encoded.byteLength, passed: true, pipelineNodes: nodes.length, assets: assets.size });
}
const zipBytes = zipSync({ 'folder/layered-fixture.psb': fs.readFileSync(path.join(fixtureDir, 'layered-fixture.psb')), 'folder/readme.txt': new TextEncoder().encode('fixture') });
const zipped = await inspectFile(new File([zipBytes], 'fixture.zip'));
assert.equal(zipped.name, 'layered-fixture.psb');
assert.equal(zipped.summary.layers, 7);
await assert.rejects(() => inspectFile(new File([new Uint8Array(30)], 'invalid.psd')), /有效/);
results.push({ name: 'ZIP single PSD/PSB and invalid signature', passed: true });
const report = { tests: results, summary: 'PSD/PSB pipeline preserves hierarchy, editable mixed text, enabled effects, hidden flags, clipping metadata, mask pixels, RGBA including alpha=0 RGB, and the correct full-resolution PSB composite.' };
fs.writeFileSync(path.join(root, 'test-output/fixture-tests.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

if (process.argv.includes('--source')) {
  const requestedPath = process.argv[process.argv.indexOf('--source') + 1];
  if (!requestedPath || requestedPath.startsWith('--')) throw new Error('Usage: node scripts/test-fixtures.mjs [--source /absolute/path/to/authorized-legacy-fixture.psb]');
  const sourcePath = path.resolve(requestedPath);
  const sourceBytes = fs.readFileSync(sourcePath);
  const source = await inspectFile(new File([sourceBytes], 'S3 Steam 甄选版-价格公式调整.psb'));
  assert.equal(source.summary.width, 1625);
  assert.equal(source.summary.height, 1000);
  assert.equal(source.summary.layers, 328);
  assert.equal(source.summary.groups, 90);
  assert.equal(source.summary.textLayers, 114);
  assert.equal(source.summary.hiddenLayers, 150);
  assert.equal(source.summary.fonts.length, 11);
  const assetsDir = path.join(root, 'test-output/source-assets');
  fs.mkdirSync(assetsDir, { recursive: true });
  const assets = new Map();
  const assetRecords = [];
  const started = Date.now();
  const converted = await convertPsd(source.psd, source.name, { includeHidden: true, includeComposite: true, rasterizeGradients: true }, {
    onAsset: async (id, data) => {
      const filename = `${id.replace(/[^a-zA-Z0-9_.-]/g, '_')}.png`;
      const png = decodePNG(data);
      fs.writeFileSync(path.join(assetsDir, filename), data);
      assets.set(id, filename);
      assetRecords.push({ id, filename, bytes: data.byteLength, width: png.width, height: png.height, sha256: createHash('sha256').update(data).digest('hex') });
    },
    isCancelled: () => false,
  });
  const nodes = flatten(converted.layers);
  assert.equal(nodes.length, 328);
  assert.equal(nodes.filter(x => x.kind === 'group').length, 90);
  assert.equal(nodes.filter(x => x.kind === 'text').length, 114);
  const effective = [];
  function visibleWalk(nodes, parent = true) {
    for (const node of nodes) { if (parent && node.visible) effective.push(node); visibleWalk(node.children || [], parent && node.visible); }
  }
  visibleWalk(converted.layers);
  assert.equal(effective.length, 178);
  assert.equal(effective.filter(x => x.kind === 'text').length, 62);
  assert.deepEqual(converted.layers.map(({ x, y, width, height }) => ({ x, y, width, height })), [
    { x: 0, y: 0, width: 800, height: 800 },
    { x: 875, y: 0, width: 750, height: 1000 },
  ]);
  assert.equal(nodes.filter(x => x.metadata?.sourceKind === 'smart-object').length, 55);
  for (const raster of [...nodes.flatMap(x => [x.raster, x.mask]), converted.composite].filter(Boolean)) {
    for (const tile of raster.tiles) {
      assert.ok(assets.has(tile.assetId), `Missing asset ${tile.assetId}`);
      assert.ok(tile.width <= 2048 && tile.height <= 2048);
    }
  }
  const referenceComposite = agPsd.readPsd(sourceBytes, { useImageData: true, skipLayerImageData: true, skipLinkedFilesData: true, skipThumbnail: true }).imageData;
  const compositeFilename = assets.get(converted.composite.tiles[0].assetId);
  assert.deepEqual(decodePNG(fs.readFileSync(path.join(assetsDir, compositeFilename))).data, referenceComposite.data);
  const severityCounts = {}, codeCounts = {};
  for (const issue of converted.report) {
    severityCounts[issue.severity] = (severityCounts[issue.severity] || 0) + 1;
    codeCounts[issue.code] = (codeCounts[issue.code] || 0) + 1;
  }
  const sourceReport = {
    input: source.name, fileBytes: sourceBytes.byteLength,
    sourceSha256: createHash('sha256').update(sourceBytes).digest('hex'),
    canvas: { width: converted.width, height: converted.height },
    nodes: nodes.length, groups: 90, editableText: 114, visibleNodes: effective.length,
    visibleEditableText: 62, fonts: source.summary.fonts,
    assets: assetRecords.length, assetBytes: assetRecords.reduce((sum, asset) => sum + asset.bytes, 0),
    severityCounts, codeCounts, durationSeconds: (Date.now() - started) / 1000,
    compositeExactPixelMatch: true,
    assetManifest: assetRecords,
  };
  fs.writeFileSync(path.join(root, 'test-output/source-document.json'), JSON.stringify(converted, null, 2));
  fs.writeFileSync(path.join(root, 'test-output/source-pipeline-test.json'), JSON.stringify(sourceReport, null, 2));
  assert.equal(severityCounts.error || 0, 0, 'Actual source conversion must not hide decode errors');
  console.log(JSON.stringify({ ...sourceReport, assetManifest: `${assetRecords.length} assets saved` }, null, 2));
}

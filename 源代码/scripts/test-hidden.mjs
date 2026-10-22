import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import agPsd from 'ag-psd';
import { createCanvas, ImageData } from '@napi-rs/canvas';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'test-output/hidden');
fs.mkdirSync(output, { recursive: true });
agPsd.initializeCanvas(createCanvas, (w, h) => new ImageData(w, h));
await build({ entryPoints: [path.join(root, 'src/pipeline.ts')], outfile: path.join(output, 'pipeline-test.cjs'), bundle: true, platform: 'node', format: 'cjs', external: ['ag-psd'] });
await build({ entryPoints: [path.join(root, 'src/normalize.ts')], outfile: path.join(output, 'normalize-test.cjs'), bundle: true, platform: 'node', format: 'cjs', external: ['ag-psd'] });
const require = createRequire(import.meta.url);
const { inspectFile, convertPsd } = require(path.join(output, 'pipeline-test.cjs'));
const { countLayers, normalizePsd } = require(path.join(output, 'normalize-test.cjs'));
const flatten = layers => layers.flatMap(layer => [layer, ...flatten(layer.children || [])]);
const pixels = (width, height, rgba) => ({ width, height, data: new Uint8ClampedArray(Array.from({ length: width * height }, () => rgba).flat()) });
const tile = pixels(2, 2, [210, 90, 30, 255]);
const leaf = (name, extra = {}) => ({ name, left: 1, top: 2, imageData: tile, ...extra });
const text = (name, font) => leaf(name, { text: { text: 'Hi', transform: [1, 0, 0, 1, 1, 4], style: { font: { name: font }, fontSize: 2, fillColor: { r: 0, g: 0, b: 0 } } } });
const fixture = {
  width: 8, height: 8, imageData: pixels(8, 8, [21, 42, 63, 255]),
  children: [
    leaf('Visible background'),
    { name: 'Visible group', children: [
      text('Visible text', 'ArialMT'),
      leaf('Hidden masked image', { hidden: true, mask: { left: 1, top: 2, defaultColor: 0, imageData: tile } }),
      { name: 'Visible subgroup', children: [leaf('Visible nested image')] },
      { name: 'Hidden subgroup', hidden: true, children: [text('Inherited hidden text', 'HiddenOnlyFont-Regular')] },
    ] },
    { name: 'Hidden root group', hidden: true, children: [
      leaf('Inherited hidden image'),
      { name: 'Inherited hidden group', children: [leaf('Deep inherited hidden image')] },
    ] },
    leaf('Hidden root image', { hidden: true }),
  ],
};
assert.equal(countLayers(fixture.children, true), 13);
assert.equal(countLayers(fixture.children), 5);
assert.equal(countLayers(fixture.children, false), 5);
const tests = [];
for (const format of ['psd', 'psb']) {
  const bytes = agPsd.writePsdBuffer(fixture, { psb: format === 'psb', noBackground: true });
  fs.writeFileSync(path.join(output, `hidden-fixture.${format}`), bytes);
  assert.ok(bytes.length < 100_000, 'Only a tiny fixture is used');
  const input = await inspectFile(new File([bytes], `hidden-fixture.${format}`));
  assert.equal(input.summary.layers, 13);
  assert.equal(input.summary.visibleLayers, 5);
  assert.equal(input.summary.hiddenLayers, 8);
  assert.deepEqual(input.summary.fonts, ['ArialMT', 'HiddenOnlyFont-Regular']);
  assert.deepEqual(input.summary.visibleFonts, ['ArialMT']);
  const originalNames = flatten(input.psd.children).map(layer => layer.name);
  let savedComposite;
  for (const includeHidden of [undefined, false, true]) {
    const assets = new Map(), progress = [];
    const options = { includeComposite: true, rasterizeGradients: false };
    if (includeHidden !== undefined) options.includeHidden = includeHidden;
    const document = await convertPsd(input.psd, input.name, options, {
      onAsset: async (id, data) => assets.set(id, data), isCancelled: () => false,
      onProgress: (done, total) => progress.push([done, total]),
    });
    const nodes = flatten(document.layers);
    const expectedCount = includeHidden === true ? 13 : 5;
    assert.equal(nodes.length, expectedCount);
    assert.deepEqual(progress, Array.from({ length: expectedCount }, (_, i) => [i + 1, expectedCount]));
    assert.ok(document.composite?.tiles.length, 'Saved reference composite is still available');
    const composite = Buffer.from(assets.get(document.composite.tiles[0].assetId));
    if (savedComposite) assert.deepEqual(composite, savedComposite, 'Visibility options do not rewrite the saved PSD composite');
    else savedComposite = composite;
    const skipped = document.report.find(issue => issue.code === 'HIDDEN_LAYERS_SKIPPED');
    if (includeHidden === true) {
      assert.equal(skipped, undefined);
      assert.equal(nodes.find(node => node.name === 'Hidden root group').visible, false);
      assert.equal(nodes.find(node => node.name === 'Inherited hidden image').visible, true, 'Child local visibility is preserved under its hidden parent');
      assert.ok([...assets.keys()].some(id => id.includes('-mask-')), 'Opting in also includes the hidden layer mask');
    } else {
      assert.deepEqual(document.layers.map(node => node.name), ['Visible background', 'Visible group']);
      assert.deepEqual(document.layers[1].children.map(node => node.name), ['Visible text', 'Visible subgroup']);
      assert.equal(document.layers[1].children[1].children[0].name, 'Visible nested image');
      assert.ok(nodes.every(node => node.visible));
      assert.equal(assets.size, 4, 'Only three visible layer images plus the saved composite are emitted');
      assert.ok(![...assets.keys()].some(id => id.includes('-mask-')), 'Hidden mask assets are excluded');
      assert.match(skipped?.message || '', /已跳过 8 个隐藏图层/);
      assert.match(skipped.message, /不重新合成/);
      assert.equal(skipped.severity, 'info');
    }
    assert.deepEqual(flatten(input.psd.children).map(layer => layer.name), originalNames, 'Source tree remains intact for retry with hidden layers enabled');
  }
  const allHidden = { ...input.psd, children: [{ name: 'Hidden wrapper', hidden: true, children: input.psd.children }] };
  let assetCalls = 0;
  const empty = await convertPsd(allHidden, input.name, { includeHidden: false, includeComposite: false, rasterizeGradients: false }, {
    onAsset: async () => { assetCalls++; }, isCancelled: () => false,
    onProgress: () => assert.fail('Excluded layers must not enter conversion progress'),
  });
  assert.deepEqual(empty.layers, []);
  assert.equal(empty.composite, undefined);
  assert.equal(assetCalls, 0);
  assert.match(empty.report.find(issue => issue.code === 'HIDDEN_LAYERS_SKIPPED')?.message || '', /已跳过 14 个隐藏图层/);
  tests.push({ format, bytes: bytes.length, passed: true, checks: ['default and explicit exclusion', 'hidden-group descendants', 'visible hierarchy and complete progress', 'no hidden image/mask assets', 'include-hidden opt-in', 'unchanged saved composite', 'hidden-only fonts excluded from visible summary', 'all-hidden document'] });
}
// Guard the normalization boundary directly: a skipped source is never handed
// to the rasterizer, even if it has cached pixels, effects, and a mask.
const calls = [];
await normalizePsd({ width: 8, height: 8, colorMode: 3, children: [{ name: 'Hidden', hidden: true, left: 0, top: 0, right: 8, bottom: 8, mask: { left: 0, top: 0, right: 8, bottom: 8 }, children: [{ name: 'Hidden child', left: 0, top: 0, right: 8, bottom: 8 }] }] }, 'No assets', { includeComposite: false, rasterizeGradients: false }, async (layer, context) => { calls.push(context); throw new Error('Hidden sources must never be rasterized'); });
assert.deepEqual(calls, []);
const html = fs.readFileSync(path.join(root, 'src/ui.html'), 'utf8');
const checkbox = html.match(/<input\b[^>]*\bid="include-hidden"[^>]*>/)?.[0];
assert.ok(checkbox, 'The optional include-hidden control remains available');
assert.ok(!/\bchecked\b/.test(checkbox), 'Hidden layers are unchecked by default in the real UI markup');
const result = { passed: true, scope: 'Small PSD/PSB and normalization fixtures only; no live Figma or large-file validation', tests };
fs.writeFileSync(path.join(root, 'test-output/hidden-tests.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));

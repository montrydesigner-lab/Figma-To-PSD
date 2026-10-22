import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';

mkdirSync('test-output', { recursive: true });
await build({ entryPoints: ['src/raster-effects.ts', 'src/styles.ts', 'src/normalize.ts'], bundle: true, platform: 'node', format: 'cjs', outdir: 'test-output/mapping-tests', external: ['ag-psd'] });
const require = createRequire(import.meta.url);
const { bakeOverlays } = require('../test-output/mapping-tests/raster-effects.js');
const { gradientStops, gradientPaint } = require('../test-output/mapping-tests/styles.js');
const { normalizeText, normalizePsd } = require('../test-output/mapping-tests/normalize.js');
const solid = { effects: { solidFill: [{ enabled: true, color: { r: 255, g: 0, b: 0 }, opacity: 1 }] } };
let pixels = Uint8Array.from([0, 0, 255, 0, 0, 0, 255, 128, 0, 0, 255, 255]);
bakeOverlays(pixels, 3, 1, 0, 0, 3, 1, solid);
assert.equal(pixels[3], 0, 'Transparent pixels must not become opaque');
assert.deepEqual([...pixels.slice(4)], [255, 0, 0, 128, 255, 0, 0, 255], 'Overlay must use subject alpha');
pixels = Uint8Array.from([0, 0, 255, 128]);
bakeOverlays(pixels, 1, 1, 0, 0, 1, 1, { ...solid, fillOpacity: 0 });
assert.deepEqual([...pixels], [255, 0, 0, 128], 'Fill opacity must not suppress layer effects');
pixels = Uint8Array.from([128, 128, 128, 255]);
bakeOverlays(pixels, 1, 1, 0, 0, 1, 1, { effects: { solidFill: [{ enabled: true, color: { r: 128, g: 255, b: 0 }, opacity: 1, blendMode: 'multiply' }] } });
assert.deepEqual([...pixels], [64, 128, 0, 255]);
const gradient = { type: 'solid', name: 'test', colorStops: [{ color: { r: 0, g: 0, b: 0 }, location: 0, midpoint: .25 }, { color: { r: 255, g: 255, b: 255 }, location: 1, midpoint: .5 }], opacityStops: [{ opacity: 1, location: 0, midpoint: .5 }, { opacity: 1, location: 1, midpoint: .5 }] };
const stops = gradientStops(gradient);
assert.equal(stops.find(s => s.position === .25).color.r, .5, 'Photoshop midpoint must map to halfway colour');
const effect = { effects: { gradientOverlay: [{ enabled: true, gradient, angle: 111, type: 'linear', scale: 1.2 }] } };
const full = new Uint8Array(8 * 4); for (let i = 3; i < full.length; i += 4) full[i] = 255;
const first = full.slice(0, 4 * 4), second = full.slice(4 * 4);
bakeOverlays(full, 8, 1, 0, 0, 8, 1, effect); bakeOverlays(first, 4, 1, 0, 0, 8, 1, effect); bakeOverlays(second, 4, 1, 4, 0, 8, 1, effect);
assert.deepEqual([...full], [...first, ...second], 'Tile boundary must not restart gradient');
const p = gradientPaint(gradient, { angle: 0 }, 100, 100); assert.equal(p.gradientTransform[0][0], 1); assert.equal(p.gradientTransform[0][2], 0);
const t = normalizeText({ text: 'AB', style: { fillColor: { r: 20, g: 30, b: 40 } }, styleRuns: [{ length: 1, style: { font: { name: 'ArialMT' }, fontSize: 12 } }, { length: 1, style: { font: { name: 'Arial-BoldMT' }, fontSize: 18 } }] }, [], 72, .25);
assert.equal(t.fontSize, 12); assert.equal(t.runs[1].fontSize, 18); assert.equal(t.runs[0].fill[0].opacity, .25); assert.equal(t.runs[0].fontFamily, 'Arial');
const layerPixels = [];
const groupGradient = { ...gradient, colorStops: gradient.colorStops.map(s => ({ ...s, midpoint: .5 })) };
const group = { name: 'overlay group', artboard: { rect: { left: 0, top: 0, right: 8, bottom: 1 } }, effects: { gradientOverlay: [{ enabled: true, gradient: groupGradient, type: 'linear', angle: 0 }] }, children: [
  { name: 'left', left: 0, top: 0, right: 4, bottom: 1, text: { text: 'A', style: { fontSize: 12, fillColor: { r: 255, g: 0, b: 0 } } } },
  { name: 'right', left: 4, top: 0, right: 8, bottom: 1, text: { text: 'B', style: { fontSize: 12, fillColor: { r: 0, g: 0, b: 255 } } }, effects: solid.effects },
] };
const normalized = await normalizePsd({ width: 8, height: 1, children: [group] }, 'test', { includeHidden: true, includeComposite: false, rasterizeGradients: false }, async (layer, ctx) => {
  const data = Uint8Array.from([255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255]);
  bakeOverlays(data, 4, 1, 0, 0, 4, 1, layer); layerPixels.push(...data); return { width: 4, height: 1, tiles: [] };
});
const nodes = normalized.layers[0].children;
assert.equal(nodes[1].fills[0].type, 'GRADIENT_LINEAR', 'Parent group overlay is above child solid overlay');
assert.equal(nodes[1].fills[1].type, 'SOLID', 'Own solid overlay follows group overlay');
assert.equal(nodes[1].fills[0].gradientTransform[0][0], .5);
assert.equal(nodes[1].fills[0].gradientTransform[0][2], .5, 'Parent-space gradient carries child offset');
const expected = new Uint8Array(8 * 4); for (let i = 3; i < expected.length; i += 4) expected[i] = 255;
bakeOverlays(expected, 8, 1, 0, 0, 8, 1, { effects: group.effects });
assert.deepEqual(layerPixels, [...expected], 'Inherited group gradient must be continuous across sibling layer images');
assert(normalized.report.some(issue => issue.code === 'GROUP_OVERLAY_PROPAGATION'));
console.log('Raster mapping checks passed: alpha clipping, fill opacity, blend mode, midpoint, tile continuity, native transforms/paint order, mixed text runs, inherited parent-space group overlays.');

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import agPsd from 'ag-psd';
import { createCanvas, ImageData } from '@napi-rs/canvas';

// Read metadata and compressed channel bytes first. Only the merged preview is
// decoded below; hundreds of full-resolution layer bitmaps never coexist.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!process.argv[2]) throw new Error('Usage: node scripts/inspect-source.mjs /absolute/path/to/authorized-source.psd [output-directory]');
const input = path.resolve(process.argv[2]);
const outDir = path.resolve(process.argv[3] || path.join(root, 'test-output'));
fs.mkdirSync(outDir, { recursive: true });
agPsd.initializeCanvas(createCanvas, (w, h) => new ImageData(w, h));
const started = Date.now();
const warnings = [];
const buffer = fs.readFileSync(input);
const psd = agPsd.readPsd(buffer, {
  useRawData: true,
  useImageData: true,
  useRawThumbnail: true,
  skipLinkedFilesData: true,
  logMissingFeatures: true,
  log: (...args) => warnings.push(args.map(String).join(' ')),
});
const counts = {
  all: 0, groups: 0, leaves: 0, ownVisible: 0, ownHidden: 0,
  effectiveVisible: 0, effectiveHidden: 0, text: 0, visibleText: 0,
  placedObjects: 0, pixelLayers: 0, masks: 0, realMasks: 0,
  vectorMasks: 0, clipping: 0, adjustments: 0, withEffects: 0,
};
const fonts = new Set();
const effectCounts = {};
const visibleEffectCounts = {};
const blendModes = {};
const adjustments = {};
const layers = [];
const texts = [];
const objects = [];
let rawLayerBytes = 0;
const summarizeBinary = (_key, value) => {
  if (ArrayBuffer.isView(value)) return { type: value.constructor.name, byteLength: value.byteLength };
  return value;
};
function walk(nodes, parentPath = '', parentVisible = true, depth = 0) {
  for (const [index, layer] of (nodes || []).entries()) {
    const layerPath = `${parentPath}/${index}:${layer.name || 'Unnamed'}`;
    const effectiveVisible = parentVisible && !layer.hidden;
    const width = (layer.right || 0) - (layer.left || 0);
    const height = (layer.bottom || 0) - (layer.top || 0);
    counts.all++;
    counts[layer.children ? 'groups' : 'leaves']++;
    counts[layer.hidden ? 'ownHidden' : 'ownVisible']++;
    counts[effectiveVisible ? 'effectiveVisible' : 'effectiveHidden']++;
    for (const [property, counter] of Object.entries({ text: 'text', placedLayer: 'placedObjects', mask: 'masks', realMask: 'realMasks', vectorMask: 'vectorMasks', clipping: 'clipping', adjustment: 'adjustments', effects: 'withEffects' })) {
      if (layer[property]) counts[counter]++;
    }
    const effects = Object.keys(layer.effects || {}).filter(key => {
      const value = layer.effects[key];
      if (!value || typeof value !== 'object' || layer.effects.disabled) return false;
      return (Array.isArray(value) ? value : [value]).some(effect => effect.enabled !== false);
    });
    for (const effect of effects) {
      effectCounts[effect] = (effectCounts[effect] || 0) + 1;
      if (effectiveVisible) visibleEffectCounts[effect] = (visibleEffectCounts[effect] || 0) + 1;
    }
    blendModes[layer.blendMode || 'normal'] = (blendModes[layer.blendMode || 'normal'] || 0) + 1;
    if (layer.adjustment) adjustments[layer.adjustment.type] = (adjustments[layer.adjustment.type] || 0) + 1;
    const channelBytes = layer.rawData?.channels.reduce((sum, ch) => sum + (ch.data?.byteLength || 0), 0) || 0;
    rawLayerBytes += channelBytes;
    if (channelBytes) counts.pixelLayers++;
    const summary = {
      path: layerPath, id: layer.id, name: layer.name, depth,
      kind: layer.children ? 'group' : layer.text ? 'text' : layer.placedLayer ? 'placed-object' : layer.adjustment ? 'adjustment' : layer.vectorFill ? 'vector' : 'image',
      x: layer.left || 0, y: layer.top || 0, width, height,
      hidden: !!layer.hidden, effectiveVisible, opacity: layer.opacity,
      fillOpacity: layer.fillOpacity, blendMode: layer.blendMode,
      clipping: !!layer.clipping, mask: !!layer.mask, realMask: !!layer.realMask,
      maskSettings: layer.mask, realMaskSettings: layer.realMask,
      vectorMask: !!layer.vectorMask, effects, effectSettings: layer.effects,
      vectorFill: layer.vectorFill, vectorStroke: layer.vectorStroke,
      adjustment: layer.adjustment, artboard: layer.artboard, channelBytes,
    };
    layers.push(summary);
    if (layer.text) {
      if (effectiveVisible) counts.visibleText++;
      const styles = [layer.text.style, ...(layer.text.styleRuns || []).map(run => run.style)];
      for (const style of styles) if (style?.font?.name) fonts.add(style.font.name);
      texts.push({ ...summary, textData: layer.text });
    }
    if (layer.placedLayer) objects.push({ path: layerPath, ...layer.placedLayer });
    walk(layer.children, layerPath, effectiveVisible, depth + 1);
  }
}
walk(psd.children);
const audit = {
  input: path.basename(input), fileBytes: buffer.byteLength,
  sha256: createHash('sha256').update(buffer).digest('hex'),
  formatVersion: buffer.readUInt16BE(4),
  canvas: { width: psd.width, height: psd.height, channels: psd.channels, bitsPerChannel: psd.bitsPerChannel, colorMode: psd.colorMode },
  counts, fonts: [...fonts].sort(), effectCounts, visibleEffectCounts, blendModes, adjustments,
  linkedFiles: psd.linkedFiles?.map(({ data, ...entry }) => ({ ...entry, embeddedBytes: data?.byteLength })),
  rawLayerBytes, rawCompositeBytes: psd.rawCompositeData?.byteLength,
  warnings: [...new Set(warnings)], layers, texts, objects,
};
fs.writeFileSync(path.join(outDir, 'source-audit.json'), JSON.stringify(audit, summarizeBinary, 2));
if (psd.width * psd.height <= 100_000_000) {
  // ag-psd 31 getCompositeImageData() drops PSB's large/globalAlpha flags.
  // Read only the composite with the original header context instead.
  const compositePsd = agPsd.readPsd(buffer, {
    skipLayerImageData: true, skipLinkedFilesData: true, skipThumbnail: true,
    useImageData: true, log: () => {},
  });
  const pixels = compositePsd.imageData;
  if (pixels) {
    if (!(pixels.data instanceof Uint8ClampedArray || pixels.data instanceof Uint8Array)) throw new Error('Preview requires 8-bit source');
    const canvas = createCanvas(pixels.width, pixels.height);
    canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(pixels.data.buffer, pixels.data.byteOffset, pixels.data.byteLength), pixels.width, pixels.height), 0, 0);
    fs.writeFileSync(path.join(outDir, 'source-composite.png'), canvas.toBuffer('image/png'));
    const previewScale = Math.min(1, 1600 / Math.max(psd.width, psd.height));
    const preview = createCanvas(Math.round(psd.width * previewScale), Math.round(psd.height * previewScale));
    preview.getContext('2d').drawImage(canvas, 0, 0, preview.width, preview.height);
    fs.writeFileSync(path.join(outDir, 'source-preview.png'), preview.toBuffer('image/png'));
  }
}
console.log(JSON.stringify({ canvas: audit.canvas, counts, fonts: audit.fonts, effectCounts, visibleEffectCounts, blendModes, adjustments, warnings: audit.warnings, seconds: (Date.now() - started) / 1000, outDir }, null, 2));

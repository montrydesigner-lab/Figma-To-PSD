import type { Layer, LayerTextData, Psd } from 'ag-psd';
// These decoder modules are bundled from the pinned ag-psd version. Its public
// reader retains global engineData even when a valid ASCII literal defeats its
// UTF-16-only decoder, allowing us to recover source curves without guessing.
import { parseEngineData } from 'ag-psd/dist/engineData';
import { decodeEngineData2 } from 'ag-psd/dist/engineData2';
import type { BridgeText } from './types';

function utf16Literals(data: Uint8Array): { data: Uint8Array; count: number } {
  const output: number[] = [];
  let count = 0;
  for (let i = 0; i < data.length; i++) {
    const byte = data[i]; output.push(byte);
    if (byte !== 40) continue;
    const literal: number[] = [];
    i++;
    while (i < data.length && data[i] !== 41) {
      let next = data[i++];
      if (next === 92) {
        if (i >= data.length) throw new Error('Incomplete engine-data string escape');
        next = data[i++];
      }
      literal.push(next);
    }
    if (i >= data.length) throw new Error('Unterminated engine-data string');
    const unicode = !literal.length || literal[0] === 254 && literal[1] === 255;
    if (!unicode && literal.some(value => value > 127)) throw new Error('Unknown engine-data string encoding');
    const bytes = unicode ? literal : [254, 255, ...literal.flatMap(value => [0, value])];
    if (!unicode) count++;
    for (const value of bytes) {
      if (value === 40 || value === 41 || value === 92) output.push(92);
      output.push(value);
    }
    output.push(41);
  }
  return { data: new Uint8Array(output), count };
}

/** Restore only source-provided curves, and only when ag-psd missed them. */
export function recoverTextPaths(psd: Psd): { recovered: number; asciiStrings: number; error?: string } {
  if (!psd.engineData) return { recovered: 0, asciiStrings: 0 };
  const layers: Layer[] = [];
  const walk = (nodes: Layer[]) => { for (const layer of nodes) { if (layer.text) layers.push(layer); if (layer.children) walk(layer.children); } };
  walk(psd.children || []);
  if (!layers.some(layer => !layer.text?.textPath)) return { recovered: 0, asciiStrings: 0 };
  try {
    const binary = atob(psd.engineData);
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    let decoded: ReturnType<typeof decodeEngineData2>;
    let asciiStrings = 0;
    try { decoded = decodeEngineData2(parseEngineData(bytes)); }
    catch (error) {
      if (!(error instanceof Error) || !error.message.includes('Invalid utf-16 BOM')) throw error;
      const fixed = utf16Literals(bytes);
      if (!fixed.count) throw error;
      asciiStrings = fixed.count;
      decoded = decodeEngineData2(parseEngineData(fixed.data));
    }
    const frames = decoded.ResourceDict?.TextFrameSet;
    let recovered = 0;
    for (const layer of layers) {
      const text = layer.text!;
      if (text.textPath || text.index == null) continue;
      const path = frames?.[text.index]?.path;
      const points = path?.bezierCurve?.controlPoints;
      if (!points?.length || points.length % 8 || !points.every(Number.isFinite)) continue;
      text.textPath = path; recovered++;
    }
    return { recovered, asciiStrings };
  } catch (error) { return { recovered: 0, asciiStrings: 0, error: error instanceof Error ? error.message : String(error) }; }
}

export function normalizeTextPath(text: LayerTextData): BridgeText['path'] {
  const path = text.textPath;
  const points = path?.bezierCurve?.controlPoints;
  if (!points?.length || points.length % 8 || !points.every(Number.isFinite)) return undefined;
  const frame = path?.data.frameMatrix?.length === 6 ? path.data.frameMatrix : [1, 0, 0, 1, 0, 0];
  const transform = text.transform?.length === 6 ? text.transform : [1, 0, 0, 1, 0, 0];
  const segments: number[][] = [];
  for (let i = 0; i < points.length; i += 8) {
    const segment: number[] = [];
    for (let j = 0; j < 8; j += 2) {
      const x = points[i + j], y = points[i + j + 1];
      const fx = x * frame[0] + y * frame[2] + frame[4];
      const fy = x * frame[1] + y * frame[3] + frame[5];
      segment.push(fx * transform[0] + fy * transform[2] + transform[4], fx * transform[1] + fy * transform[3] + transform[5]);
    }
    if (!segment.every(Number.isFinite)) return undefined;
    segments.push(segment);
  }
  return { segments, reversed: path?.data.pathData?.reversed === true, textRange: path?.data.textRange?.slice() };
}

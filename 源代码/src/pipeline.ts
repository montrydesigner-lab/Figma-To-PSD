import { readPsd } from 'ag-psd';
import type { Psd, Layer } from 'ag-psd';
import { unzipSync } from 'fflate';
import { normalizePsd } from './normalize';
import type { NormalizeOptions, Progress } from './types';
import { createRasterizer, yieldUI, cancelled, type RasterHooks } from './raster';

export function inspectPsd(psd: Psd) {
  const fonts = new Set<string>();
  const visibleFonts = new Set<string>();
  const summary = {width: psd.width, height: psd.height, layers: 0, textLayers: 0, imageLayers: 0, groups: 0, hiddenLayers: 0, visibleLayers: 0, fonts: [] as string[], visibleFonts: [] as string[], warnings: [] as string[]};
  function visit(layers: Layer[], hidden = false) {
    for (const l of layers) {
      const effectivelyHidden = hidden || l.hidden === true;
      summary.layers++;
      if (effectivelyHidden) summary.hiddenLayers++;
      else summary.visibleLayers++;
      if (l.children) { summary.groups++; visit(l.children, effectivelyHidden); }
      else if (l.text) {
        summary.textLayers++;
        const styles = [l.text.style, ...(l.text.styleRuns ?? []).map(r => r.style)];
        for (const s of styles) if (s?.font?.name) {
          fonts.add(s.font.name);
          if (!effectivelyHidden) visibleFonts.add(s.font.name);
        }
      } else summary.imageLayers++;
    }
  }
  visit(psd.children ?? []);
  summary.fonts = [...fonts].sort();
  summary.visibleFonts = [...visibleFonts].sort();
  if ((psd.bitsPerChannel ?? 8) !== 8) summary.warnings.push(`${psd.bitsPerChannel} 位源文件将转换成 Figma 可用的 8 位 PNG，保留尺寸但不能保留高位深。`);
  if (psd.colorMode !== 3) summary.warnings.push('源文件不是 RGB；颜色转换可能与 Photoshop 显示不同。');
  summary.warnings.push('PSD 文字度量与 Figma 不同；缺失字体、复杂效果与调整图层会在报告中列出。');
  return summary;
}

export async function inspectFile(file: File, onProgress?: (message: string) => void, isCancelled: () => boolean = () => false) {
  const checkActive = () => { if (isCancelled()) throw new Error('源文件读取已取消'); };
  checkActive();
  if (file.size > 1_500_000_000) throw new Error('此版本支持 1.5 GB 以内文件。请拆分较大的 PSB。');
  onProgress?.('读取文件…'); await yieldUI();
  checkActive();
  let bytes: Uint8Array = new Uint8Array(await file.arrayBuffer());
  checkActive();
  let name = file.name;
  if (/\.zip$/i.test(name)) {
    onProgress?.('解压 PSD / PSB…'); await yieldUI();
    checkActive();
    let accepted = 0;
    const files = unzipSync(bytes, {filter: entry => {
      const match = /\.(psd|psb)$/i.test(entry.name) && !entry.name.startsWith('__MACOSX/');
      if (match) {
        accepted++;
        if (accepted > 1) throw new Error('ZIP 内含多个 PSD / PSB，请每次只放入一个文件。');
        if (entry.originalSize > 1_500_000_000) throw new Error('解压后的 PSB 超过 1.5 GB，请拆分文件。');
      }
      return match;
    }});
    const names = Object.keys(files);
    if (names.length !== 1) throw new Error('ZIP 中没有找到唯一的 PSD / PSB 文件。');
    name = names[0].split('/').pop()!; bytes = files[names[0]];
  }
  if (bytes.length < 26 || String.fromCharCode(...bytes.subarray(0,4)) !== '8BPS') throw new Error('文件不是有效的 PSD / PSB。');
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = header.getUint16(4), mode = header.getUint16(24);
  if (version !== 1 && version !== 2) throw new Error('不支持的 PSD 文件版本。');
  if (![0,1,2,3].includes(mode)) throw new Error('此文件为 CMYK / Lab 等色彩模式，请先在 Photoshop 中另存为 RGB PSD / PSB。');
  onProgress?.('解析图层和文字（大文件可能需要稍等）…'); await yieldUI();
  checkActive();
  const parserWarnings: string[] = [];
  const psd = readPsd(bytes, {useRawData: true, useImageData: true, skipThumbnail: true, skipLinkedFilesData: true, logMissingFeatures: true, log: (...args) => {
    if (parserWarnings.length < 40) parserWarnings.push(args.map(String).join(' '));
  }});
  const summary = inspectPsd(psd);
  if (parserWarnings.length) summary.warnings.push(`解析器记录 ${parserWarnings.length} 条兼容性提示；详见导入报告。`);
  Object.defineProperty(psd, '__bridgeWarnings', {value: parserWarnings});
  // ag-psd's lazy composite helper loses the PSB RLE/global-alpha reader flags.
  // Retain the input view for a correctly contextualized composite-only read.
  Object.defineProperty(psd, '__bridgeSourceBytes', {value: bytes});
  return {psd, name, summary};
}

export async function convertPsd(psd: Psd, name: string, options: NormalizeOptions, hooks: RasterHooks & {onProgress?: Progress}) {
  cancelled(hooks);
  const rasterize = createRasterizer(psd, hooks);
  const doc = await normalizePsd(psd, name.replace(/\.(psd|psb)$/i, ''), options, rasterize, (done, total, label) => {
    cancelled(hooks); hooks.onProgress?.(done, total, label);
  });
  const warnings = (psd as Psd & {__bridgeWarnings?: string[]}).__bridgeWarnings ?? [];
  for (const message of warnings) doc.report.push({severity:'warning',code:'PARSER_WARNING',message});
  return doc;
}

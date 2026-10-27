import type { Layer, LayerTextData, Psd, TextStyle } from 'ag-psd';
import type { BridgeDocument, BridgeLayer, BridgeText, BridgeTextRun, Issue, NormalizeOptions, Progress, Rasterize } from './types';
import { blendMode, clamp, gradientPaint, isSupportedBlendMode, mapLayerStyles, number, solidPaint, unitPixels } from './styles';
import { supportedRasterBlendModes } from './raster-effects';
import type { GroupOverlayContext, LayerWithGroupOverlays } from './raster-effects';
import { normalizeTextPath, recoverTextPaths } from './text-paths';

interface Bounds { x: number; y: number; width: number; height: number }

const isFiniteBounds = (b: Bounds) => [b.x, b.y, b.width, b.height].every(Number.isFinite);
const drawableBounds = (b: Bounds) => isFiniteBounds(b) && b.width > 0 && b.height > 0;

function layerBounds(layer: Layer, dpi: number): Bounds {
  const rect = layer.artboard?.rect;
  if (rect) return { x: rect.left, y: rect.top, width: rect.right - rect.left, height: rect.bottom - rect.top };
  let x = number(layer.left), y = number(layer.top);
  let width = number(layer.right, x) - x, height = number(layer.bottom, y) - y;
  if (layer.children?.length) {
    const children = layer.children.map(c => layerBounds(c, dpi)).filter(drawableBounds);
    if (children.length) {
      x = Math.min(...children.map(c => c.x)); y = Math.min(...children.map(c => c.y));
      width = Math.max(...children.map(c => c.x + c.width)) - x;
      height = Math.max(...children.map(c => c.y + c.height)) - y;
    }
  }
  if (width <= 0 || height <= 0) {
    const box = layer.text?.bounds || layer.text?.boundingBox;
    if (box) {
      const left = unitPixels(box.left, dpi), top = unitPixels(box.top, dpi);
      const right = unitPixels(box.right, dpi), bottom = unitPixels(box.bottom, dpi);
      const t = layer.text?.transform || [1, 0, 0, 1, 0, 0];
      const points = [[left, top], [right, top], [right, bottom], [left, bottom]].map(([px, py]) => ({ x: px * t[0] + py * t[2] + t[4], y: px * t[1] + py * t[3] + t[5] }));
      x = Math.min(...points.map(p => p.x)); y = Math.min(...points.map(p => p.y));
      width = Math.max(...points.map(p => p.x)) - x; height = Math.max(...points.map(p => p.y)) - y;
    }
  }
  return { x, y, width: Math.max(0, width), height: Math.max(0, height) };
}

function fontInfo(postScript: string | undefined): { fontPostScript?: string; fontFamily?: string; fontStyle?: string } {
  if (!postScript) return {};
  const split = postScript.lastIndexOf('-');
  let family = split > 0 ? postScript.slice(0, split) : postScript;
  let style = split > 0 ? postScript.slice(split + 1) : 'Regular';
  const suffix = family.match(/(BoldItalic|BoldOblique|SemiBold|ExtraBold|Bold|Medium|Light|Regular|Italic|Oblique)(?:MT)?$/i);
  if (split < 0 && suffix && family.length > suffix[0].length) { family = family.slice(0, -suffix[0].length); style = suffix[1]; }
  family = family.replace(/MT$/, '');
  style = style.replace(/MT$/, '').replace(/([a-z])([A-Z])/g, '$1 $2') || 'Regular';
  return { fontPostScript: postScript, fontFamily: family, fontStyle: style };
}

function textStyle(style: TextStyle, overlays: Paint[], baseSize: number, fillOpacity = 1): Omit<BridgeTextRun, 'start' | 'end'> {
  const fontSize = Math.max(.01, number(style.fontSize, baseSize));
  let font = fontInfo(style.font?.name);
  if (style.fauxBold || style.fauxItalic) {
    const suffix = [style.fauxBold ? 'Bold' : '', style.fauxItalic ? 'Italic' : ''].filter(Boolean).join(' ');
    font = { ...font, fontStyle: suffix || font.fontStyle };
  }
  const fill = [...overlays, solidPaint(style.fillColor, fillOpacity)];
  return {
    ...font, fontSize, fill,
    letterSpacing: number(style.tracking) / 1000 * fontSize,
    ...(style.autoLeading === false && number(style.leading) > 0 ? { lineHeight: style.leading } : {}),
    textDecoration: style.underline ? 'UNDERLINE' : style.strikethrough ? 'STRIKETHROUGH' : 'NONE',
    textCase: style.fontCaps === 2 ? 'UPPER' : style.fontCaps === 1 ? 'SMALL_CAPS' : 'ORIGINAL',
    baselineShift: number(style.baselineShift),
    horizontalScale: number(style.horizontalScale, 1), verticalScale: number(style.verticalScale, 1),
  };
}

export function normalizeText(text: LayerTextData, overlays: Paint[] = [], dpi = 72, fillOpacity = 1): BridgeText {
  const characters = (text.text || '').replace(/\r/g, '\n').replace(/\u0000+$/, '');
  const base = { ...(text.styleRuns?.[0]?.style || {}), ...(text.style || {}) };
  const baseSize = Math.max(.01, number(base.fontSize, 16));
  const result: BridgeText = {
    ...textStyle(base, overlays, baseSize, fillOpacity), characters, fontSize: baseSize,
    transform: text.transform?.slice(0, 6), shapeType: text.shapeType,
    path: normalizeTextPath(text),
    boxBounds: text.boxBounds?.slice(), pointBase: text.pointBase?.slice(),
    orientation: text.orientation,
    textAlignHorizontal: text.paragraphStyle?.justification === 'center' ? 'CENTER' : text.paragraphStyle?.justification === 'right' ? 'RIGHT' : text.paragraphStyle?.justification?.startsWith('justify') ? 'JUSTIFIED' : 'LEFT',
    paragraphSpacing: number(text.paragraphStyle?.spaceAfter), paragraphIndent: number(text.paragraphStyle?.firstLineIndent),
  };
  const b = text.bounds || text.boundingBox;
  if (b) result.bounds = { x: unitPixels(b.left, dpi), y: unitPixels(b.top, dpi), width: unitPixels(b.right, dpi) - unitPixels(b.left, dpi), height: unitPixels(b.bottom, dpi) - unitPixels(b.top, dpi) };
  const glyphs = text.boundingBox;
  if (glyphs) result.glyphBounds = { x: unitPixels(glyphs.left, dpi), y: unitPixels(glyphs.top, dpi), width: unitPixels(glyphs.right, dpi) - unitPixels(glyphs.left, dpi), height: unitPixels(glyphs.bottom, dpi) - unitPixels(glyphs.top, dpi) };
  if (text.styleRuns?.length) {
    let start = 0;
    result.runs = text.styleRuns.map(run => {
      const end = Math.min(characters.length, start + Math.max(0, run.length));
      const normalized = { start, end, ...textStyle({ ...base, ...run.style }, overlays, baseSize, fillOpacity) };
      start = end; return normalized;
    }).filter(run => run.end > run.start);
  }
  return result;
}

function cleanMetadata(value: unknown): unknown {
  if (value == null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return undefined;
  if (Array.isArray(value)) return value.map(cleanMetadata);
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([key]) => !['canvas', 'imageData', 'rawData', 'engineData', 'data'].includes(key)).map(([key, item]) => [key, cleanMetadata(item)]).filter(([, item]) => item !== undefined));
  return undefined;
}

function inheritedPaints(contexts: GroupOverlayContext[], bounds: Bounds, dpi: number, globalAngle: number): Paint[] {
  const paints: Paint[] = [];
  for (const context of contexts) {
    const mapping = mapLayerStyles({ effects: context.effects }, context.width, context.height, dpi, globalAngle);
    for (const paint of mapping.fills) {
      if (paint.type.startsWith('GRADIENT_') && 'gradientTransform' in paint) {
        const matrix = paint.gradientTransform;
        const sx = bounds.width / Math.max(1, context.width), sy = bounds.height / Math.max(1, context.height);
        const tx = (bounds.x - context.x) / Math.max(1, context.width), ty = (bounds.y - context.y) / Math.max(1, context.height);
        paints.push({ ...paint, gradientTransform: [
          [matrix[0][0] * sx, matrix[0][1] * sy, matrix[0][0] * tx + matrix[0][1] * ty + matrix[0][2]],
          [matrix[1][0] * sx, matrix[1][1] * sy, matrix[1][0] * tx + matrix[1][1] * ty + matrix[1][2]],
        ] });
      } else paints.push(paint);
    }
  }
  return paints;
}

export async function normalizePsd(psd: Psd, name: string, options: NormalizeOptions, rasterize: Rasterize, onProgress?: Progress): Promise<BridgeDocument> {
  if (!Number.isFinite(psd.width) || !Number.isFinite(psd.height) || psd.width <= 0 || psd.height <= 0) throw new Error('PSD 画布尺寸无效');
  const document: BridgeDocument = { version: 1, name, width: psd.width, height: psd.height, layers: [], report: [] };
  const dpi = number(psd.imageResources?.resolutionInfo?.horizontalResolution, 72);
  const globalAngle = number(psd.imageResources?.globalAngle, 120);
  // Hidden layers are opt-in. A hidden group's complete subtree is excluded,
  // even when an individual child still has its own visibility flag enabled.
  const includeHidden = options.includeHidden === true;
  const total = countLayers(psd.children || [], includeHidden);
  const skippedHidden = includeHidden ? 0 : countLayers(psd.children || [], true) - total;
  let completed = 0;
  const addIssue = (layer: BridgeLayer | undefined, code: string, message: string, severity: Issue['severity'] = 'warning') => {
    document.report.push({ layerId: layer?.id, layerName: layer?.name, code, message, severity });
  };
  if (skippedHidden) addIssue(undefined, 'HIDDEN_LAYERS_SKIPPED', `已跳过 ${skippedHidden} 个隐藏图层（含隐藏组及其所有子图层），不生成对应节点、图片或蒙版资源。${options.includeComposite ? '原稿参考图仍使用 PSD 保存的合成预览，不重新合成。' : ''}`, 'info');
  const recoveredPaths = recoverTextPaths(psd);
  if (recoveredPaths.recovered) addIssue(undefined, 'TEXT_PATH_RECOVERED', `已从 Photoshop 全局文字数据恢复 ${recoveredPaths.recovered} 条原始贝塞尔文字路径。`, 'info');
  else if (recoveredPaths.error) addIssue(undefined, 'TEXT_PATH_DECODE', `全局文字路径读取失败：${recoveredPaths.error}`);
  if (psd.bitsPerChannel && psd.bitsPerChannel !== 8) addIssue(undefined, 'BIT_DEPTH_CONVERSION', `${psd.bitsPerChannel} 位图像转换为 Figma 可用的 8 位 PNG；保留像素尺寸，但动态范围会改变。`);
  if (psd.colorMode !== undefined && psd.colorMode !== 3) addIssue(undefined, 'COLOR_MODE_CONVERSION', '源文件色彩模式将转换为 RGB，建议与 Photoshop 原稿对照。');
  if (psd.imageResources?.printInformation?.printerProfile) addIssue(undefined, 'COLOR_PROFILE', 'Photoshop 与 Figma 的色彩管理可能存在差异，导入完成后请核对关键品牌颜色。', 'info');

  async function convert(source: Layer, path: string, inheritedVisible: boolean, groupOverlays: GroupOverlayContext[] = []): Promise<BridgeLayer | undefined> {
    const visible = source.hidden !== true;
    if (!includeHidden && (!visible || !inheritedVisible)) return undefined;
    const id = source.id != null ? `${path}-${source.id}` : path;
    let bounds = layerBounds(source, dpi);
    const nativeText = Boolean(source.text);
    const isGroup = Array.isArray(source.children);
    if (!drawableBounds(bounds) && source.vectorFill && !source.vectorMask) bounds = { x: 0, y: 0, width: psd.width, height: psd.height };
    const node: BridgeLayer = {
      id, name: source.name || (isGroup ? '未命名组' : '未命名图层'), kind: isGroup ? 'group' : nativeText ? 'text' : 'image',
      ...bounds, visible, opacity: clamp(number(source.opacity, 1)), blendMode: blendMode(source.blendMode), clipping: Boolean(source.clipping),
      metadata: { sourceLayerId: source.id, fillOpacity: number(source.fillOpacity, 1), sourceKind: isGroup ? 'group' : nativeText ? 'text' : source.placedLayer ? 'smart-object' : source.adjustment ? 'adjustment' : source.vectorFill ? 'shape' : 'pixel' },
    };
    if (!isSupportedBlendMode(source.blendMode)) addIssue(node, 'BLEND_MODE_APPROXIMATION', `混合模式“${source.blendMode}”在 Figma 中使用正常模式近似。`);
    const styles = mapLayerStyles(source, bounds.width, bounds.height, dpi, globalAngle);
    const overlayFills = [...inheritedPaints(groupOverlays, bounds, dpi, globalAngle), ...styles.fills];
    node.effects = styles.effects; node.strokes = styles.strokes; node.strokeWeight = styles.strokeWeight; node.strokeAlign = styles.strokeAlign;
    node.unsupported = styles.unsupported;
    if (source.effects) node.metadata!.sourceEffects = cleanMetadata(source.effects);
    if (source.vectorMask) node.metadata!.vectorMask = cleanMetadata(source.vectorMask);
    if (source.placedLayer) node.metadata!.smartObject = cleanMetadata(source.placedLayer);
    if (source.artboard) node.metadata!.artboard = cleanMetadata(source.artboard);
    if (groupOverlays.length) node.metadata!.inheritedOverlayCount = groupOverlays.length;
    if (number(source.fillOpacity, 1) !== 1) {
      if (nativeText) {
        node.metadata!.fillOpacity = number(source.fillOpacity, 1);
        addIssue(node, 'FILL_OPACITY', '已记录 Photoshop 填充不透明度；其与图层样式的交互采用近似映射。', 'info');
      }
    }
    if (isGroup) {
      node.children = [];
      const childOverlays = styles.fills.length && source.effects ? [...groupOverlays, { effects: source.effects, ...bounds }] : groupOverlays;
      if (styles.fills.length) addIssue(node, 'GROUP_OVERLAY_PROPAGATION', '组的颜色/渐变叠加按组坐标映射到子图层，以保留文字编辑性；半透明图层交叠和特殊混合可能有差异。');
      for (let index = 0; index < source.children!.length; index++) {
        const child = await convert(source.children![index], `${path}.${index}`, visible && inheritedVisible, childOverlays);
        if (child) node.children.push(child);
      }
    } else {
      if (source.text) {
        node.text = normalizeText(source.text, overlayFills, dpi, clamp(number(source.fillOpacity, 1))); node.fills = node.text.fill;
        node.metadata!.sourceText = cleanMetadata(source.text);
        if (source.text.warp?.style && source.text.warp.style !== 'none') node.unsupported!.push('文字变形不能在 Figma 原生文字上完全还原，已保留原始像素副本');
        if (source.text.textPath && !node.text.path) node.unsupported!.push('源文字路径无法解码，采用普通可编辑文字近似，已保留原始像素副本');
        if (source.text.orientation === 'vertical') node.unsupported!.push('竖排文字采用可编辑文字近似，已保留原始像素副本');
        if (source.text.paragraphStyleRuns && source.text.paragraphStyleRuns.length > 1) node.unsupported!.push('混合段落格式采用首段对齐和逐字符样式近似');
        if ([source.text.style, ...(source.text.styleRuns || []).map(run => run.style)].some(style => style?.fauxBold || style?.fauxItalic)) addIssue(node, 'FAUX_FONT_STYLE', 'Photoshop 伪粗体或伪斜体使用可用字体字重近似。', 'info');
      } else if (source.vectorFill && !source.vectorMask) {
        if (source.vectorFill.type === 'color') {
          node.kind = 'shape'; node.fills = [...overlayFills, solidPaint(source.vectorFill.color, clamp(number(source.fillOpacity, 1)))];
        } else if (source.vectorFill.type === 'solid' && !options.rasterizeGradients) {
          const paint = gradientPaint(source.vectorFill, source.vectorFill, bounds.width, bounds.height);
          if (paint) { node.kind = 'shape'; node.fills = [...overlayFills, { ...paint, opacity: clamp(number(source.fillOpacity, 1)) }]; }
        }
      }
      if (drawableBounds(bounds)) {
        const sourceWithOverlays = source as LayerWithGroupOverlays;
        sourceWithOverlays.__bridgeGroupOverlays = groupOverlays;
        try { node.raster = await rasterize(sourceWithOverlays, { id, ...bounds, role: 'layer' }); }
        catch (error) { addIssue(node, 'LAYER_RASTER_ERROR', `图层像素读取失败：${error instanceof Error ? error.message : String(error)}`, 'error'); }
        finally { delete sourceWithOverlays.__bridgeGroupOverlays; }
      }
      if (!node.raster && node.kind === 'image') {
        if (!drawableBounds(bounds) && !source.adjustment) addIssue(node, 'EMPTY_LAYER', '保留空图层的名称与结构。', 'info');
        else addIssue(node, 'MISSING_LAYER_PIXELS', source.adjustment ? '调整图层无法单独转换为图片；已记录参数，请对照源 PSD / PSB 文件复核。' : '此图层没有可读取的缓存像素，已记录其源结构。');
      }
      if (source.adjustment) { node.metadata!.adjustment = cleanMetadata(source.adjustment); node.unsupported!.push(`调整图层“${source.adjustment.type}”需要 Photoshop 合成结果`); }
      if (source.vectorFill?.type === 'noise' || source.vectorFill?.type === 'pattern') addIssue(node, 'RASTER_GRADIENT_PATTERN', '杂色渐变或图案通过源缓存像素导入。', 'info');
      if (source.placedLayer) addIssue(node, 'SMART_OBJECT_RASTER', '智能对象按 PSD 已渲染像素导入 Figma 图片；原始变换与对象标识已保存。', 'info');
    }
    if (node.kind === 'image' && node.strokes?.length) {
      node.strokes = []; node.strokeWeight = undefined; node.strokeAlign = undefined;
      node.unsupported!.push('图片轮廓描边不映射为矩形边框，已保留源参数，请对照源 PSD / PSB 文件复核');
    }
    if (node.kind === 'image' || node.kind === 'text') {
      for (const overlay of [...(source.effects?.solidFill || []), ...(source.effects?.gradientOverlay || [])]) {
        if (overlay.enabled === false || overlay.present === false || source.effects?.disabled) continue;
        if (overlay.blendMode && !supportedRasterBlendModes.has(overlay.blendMode)) addIssue(node, 'RASTER_OVERLAY_BLEND', `像素副本的叠加混合模式“${overlay.blendMode}”按正常模式近似。`);
      }
    }
    const mask = source.realMask && !source.realMask.disabled ? source.realMask : source.mask && !source.mask.disabled ? source.mask : undefined;
    if (mask) {
      const mx = number(mask.left), my = number(mask.top), mw = number(mask.right, mx) - mx, mh = number(mask.bottom, my) - my;
      node.metadata!.mask = cleanMetadata(mask);
      // The mask must span the layer bounds, including defaultColor beyond the explicit mask rectangle.
      const maskBounds = drawableBounds(bounds) ? bounds : { x: mx, y: my, width: Math.max(0, mw), height: Math.max(0, mh) };
      try { node.mask = await rasterize(source, { id: `${id}-mask`, ...maskBounds, role: 'mask' }); }
      catch (error) { addIssue(node, 'MASK_RASTER_ERROR', `蒙版读取失败：${error instanceof Error ? error.message : String(error)}`, 'error'); }
      if (number(mask.userMaskFeather) > 0 || number(mask.userMaskDensity, 1) !== 1) addIssue(node, 'MASK_PARAMETERS', '蒙版羽化与密度由图片蒙版近似，需与原稿对照。', 'info');
    }
    for (const message of node.unsupported || []) addIssue(node, 'UNSUPPORTED_STYLE', message);
    if (source.clipping) addIssue(node, 'CLIPPING_MASK', '剪贴层采用 Figma 蒙版关系重建。', 'info');
    completed++; onProgress?.(completed, total, node.name);
    return node;
  }

  for (let index = 0; index < (psd.children || []).length; index++) {
    const layer = await convert(psd.children![index], `layer-${index}`, true);
    if (layer) document.layers.push(layer);
  }
  if (options.includeComposite) {
    try { document.composite = await rasterize(undefined, { id: 'composite', x: 0, y: 0, width: psd.width, height: psd.height, role: 'composite' }); }
    catch (error) { addIssue(undefined, 'COMPOSITE_RASTER_ERROR', `整图对照读取失败：${error instanceof Error ? error.message : String(error)}`, 'error'); }
    if (!document.composite) addIssue(undefined, 'MISSING_COMPOSITE', 'PSD 未保存可读取的合并预览，无法创建完整原稿对照。');
  }
  return document;
}

export function countLayers(layers: Layer[], includeHidden = false): number {
  return layers.reduce((total, layer) => total + (includeHidden || layer.hidden !== true ? 1 + countLayers(layer.children || [], includeHidden) : 0), 0);
}

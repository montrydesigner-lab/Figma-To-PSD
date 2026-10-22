import type { BridgeDocument, BridgeLayer, BridgeText, BridgeTextRun, Issue, Raster } from './types';

export interface ImportOptions {
  includeReference: boolean;
  keepTextBackup: boolean;
  fontMap: Record<string, FontName>;
}
export interface ImportCallbacks {
  onProgress?: (completed: number, total: number, name: string) => void;
  isCancelled?: () => boolean;
  yieldControl?: () => Promise<void>;
}
export interface FontSubstitution { source: string; replacement: FontName; reason: string }
export interface ImportResult {
  frameId: string;
  referenceFrameId?: string;
  createdNodeIds: string[];
  removedNodeIds: string[];
  width: number;
  height: number;
  report: Issue[];
  missingFonts: FontSubstitution[];
  counts: { layers: number; texts: number; images: number; groups: number; shapes: number; tiles: number };
}

const MAX_DIMENSION = 300000;
const MAX_LAYERS = 50000;
const MAX_TILES = 100000;
const MAX_CHARACTERS = 10000000;
const BLENDS = new Set(['PASS_THROUGH', 'NORMAL', 'DARKEN', 'MULTIPLY', 'LINEAR_BURN', 'COLOR_BURN', 'LIGHTEN', 'SCREEN', 'LINEAR_DODGE', 'COLOR_DODGE', 'OVERLAY', 'SOFT_LIGHT', 'HARD_LIGHT', 'DIFFERENCE', 'EXCLUSION', 'HUE', 'SATURATION', 'COLOR', 'LUMINOSITY']);
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
// Bridge paints are stored top-first for Photoshop compositing. Native Figma
// stacks render their final paint over earlier entries, so reverse at this boundary.
const nativePaints = (values: readonly Paint[]): Paint[] => copy([...values]).reverse();
const normal = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[\s_\-.,()]+/g, '');
const fontId = (value: FontName) => `${value.family}\u0000${value.style}`;
const sourceId = (value: Partial<BridgeTextRun>) => value.fontPostScript || `${value.fontFamily || ''} ${value.fontStyle || 'Regular'}`.trim();
const styleKey = (value: Partial<BridgeTextRun>) => `${value.fontPostScript || ''}|${value.fontFamily || ''}|${value.fontStyle || ''}`;

function requireNumber(value: unknown, label: string, minimum: number, maximum: number): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) throw new Error(`${label} 必须在 ${minimum}–${maximum} 之间。`);
}
function requireString(value: unknown, label: string, maximum = 2048): asserts value is string {
  if (typeof value !== 'string' || value.length > maximum) throw new Error(`${label} 不是有效文本。`);
}
function color(value: unknown, alpha: boolean) {
  if (!value || typeof value !== 'object') throw new Error('颜色数据无效。');
  const c = value as Record<string, unknown>;
  for (const key of alpha ? ['r', 'g', 'b', 'a'] : ['r', 'g', 'b']) requireNumber(c[key], `颜色 ${key}`, 0, 1);
}
function paints(values: unknown, label: string): void {
  if (values === undefined) return;
  if (!Array.isArray(values) || values.length > 64) throw new Error(`${label} 填色数组无效。`);
  for (const p of values) {
    if (!p || typeof p !== 'object') throw new Error(`${label} 填色无效。`);
    if (p.opacity !== undefined) requireNumber(p.opacity, '填色透明度', 0, 1);
    if (p.blendMode !== undefined && !BLENDS.has(p.blendMode)) throw new Error('填色混合模式无效。');
    if (p.type === 'SOLID') color(p.color, false);
    else if (['GRADIENT_LINEAR', 'GRADIENT_RADIAL', 'GRADIENT_ANGULAR', 'GRADIENT_DIAMOND'].includes(p.type)) {
      if (!Array.isArray(p.gradientStops) || p.gradientStops.length < 2 || p.gradientStops.length > 256) throw new Error('渐变色标无效。');
      for (const stop of p.gradientStops) { requireNumber(stop.position, '色标位置', 0, 1); color(stop.color, true); }
      const t = p.gradientTransform;
      if (!Array.isArray(t) || t.length !== 2 || t.some((row: unknown) => !Array.isArray(row) || row.length !== 3)) throw new Error('渐变矩阵无效。');
      for (const row of t) for (const n of row) requireNumber(n, '渐变矩阵', -1e7, 1e7);
      if (Math.abs(t[0][0] * t[1][1] - t[0][1] * t[1][0]) < 1e-12) throw new Error('渐变矩阵不可逆。');
    } else throw new Error(`${label} 包含不受支持的填色：${String(p.type)}。图像必须通过资产导入。`);
  }
}
function effects(values: unknown): void {
  if (values === undefined) return;
  if (!Array.isArray(values) || values.length > 64) throw new Error('效果数组无效。');
  for (const effect of values) {
    if (!effect || !['DROP_SHADOW', 'INNER_SHADOW', 'LAYER_BLUR', 'BACKGROUND_BLUR'].includes(effect.type)) throw new Error('效果类型无效。');
    requireNumber(effect.radius, '效果半径', 0, 10000);
    if (effect.type.endsWith('SHADOW')) {
      color(effect.color, true);
      requireNumber(effect.offset?.x, '阴影 X', -1e6, 1e6);
      requireNumber(effect.offset?.y, '阴影 Y', -1e6, 1e6);
      if (effect.spread !== undefined) requireNumber(effect.spread, '阴影扩展', -10000, 10000);
      if (!BLENDS.has(effect.blendMode)) throw new Error('阴影混合模式无效。');
    }
  }
}

/** Validate the untrusted UI/package payload before creating any Figma node. */
export function validateDocument(input: unknown): { layerCount: number; tileCount: number; assetIds: string[] } {
  if (!input || typeof input !== 'object') throw new Error('未收到有效文档。');
  const doc = input as BridgeDocument;
  if (doc.version !== 1) throw new Error('不支持此转译文件版本。');
  requireString(doc.name, '文档名称');
  requireNumber(doc.width, '画布宽度', 1, MAX_DIMENSION);
  requireNumber(doc.height, '画布高度', 1, MAX_DIMENSION);
  if (!Array.isArray(doc.layers) || !Array.isArray(doc.report) || doc.report.length > 200000) throw new Error('文档结构无效。');
  const ids = new Set<string>(), assetIds = new Set<string>();
  let layerCount = 0, tileCount = 0, characters = 0;
  function raster(r: Raster | undefined) {
    if (!r) return;
    requireNumber(r.width, '图像宽度', 0, MAX_DIMENSION);
    requireNumber(r.height, '图像高度', 0, MAX_DIMENSION);
    if (!Array.isArray(r.tiles)) throw new Error('图像切片无效。');
    for (const tile of r.tiles) {
      if (++tileCount > MAX_TILES) throw new Error('切片数量超过 100000。');
      requireString(tile.assetId, '资产 ID');
      requireNumber(tile.x, '图像 X', -1e7, 1e7); requireNumber(tile.y, '图像 Y', -1e7, 1e7);
      requireNumber(tile.width, '切片宽度', 0.001, MAX_DIMENSION); requireNumber(tile.height, '切片高度', 0.001, MAX_DIMENSION);
      assetIds.add(tile.assetId);
    }
  }
  function textStyle(t: Partial<BridgeTextRun>) {
    for (const key of ['fontPostScript', 'fontFamily', 'fontStyle'] as const) if (t[key] !== undefined) requireString(t[key], key);
    if (t.fontSize !== undefined) requireNumber(t.fontSize, '字号', 0.01, 100000);
    if (t.letterSpacing !== undefined) requireNumber(t.letterSpacing, '字间距', -100000, 100000);
    if (t.lineHeight !== undefined) requireNumber(t.lineHeight, '行高', 0.01, 1000000);
    paints(t.fill, '文字');
  }
  function visit(list: BridgeLayer[], depth: number) {
    if (!Array.isArray(list) || depth > 128) throw new Error('图层嵌套超过安全上限。');
    for (const l of list) {
      if (!l || ++layerCount > MAX_LAYERS) throw new Error('图层数量超过 50000。');
      requireString(l.id, '图层 ID'); requireString(l.name, '图层名称');
      if (ids.has(l.id)) throw new Error(`重复图层 ID：${l.id}`); ids.add(l.id);
      if (!['group', 'text', 'image', 'shape'].includes(l.kind)) throw new Error(`无效图层类型：${l.kind}`);
      requireNumber(l.x, '图层 X', -1e7, 1e7); requireNumber(l.y, '图层 Y', -1e7, 1e7);
      requireNumber(l.width, '图层宽度', 0, MAX_DIMENSION); requireNumber(l.height, '图层高度', 0, MAX_DIMENSION);
      requireNumber(l.opacity, '图层透明度', 0, 1);
      if (typeof l.visible !== 'boolean' || !BLENDS.has(l.blendMode)) throw new Error('图层显示或混合模式无效。');
      paints(l.fills, l.name); paints(l.strokes, l.name); effects(l.effects);
      if (l.strokeWeight !== undefined) requireNumber(l.strokeWeight, '描边宽度', 0, 10000);
      if (l.kind === 'text') {
        if (!l.text) throw new Error(`文字图层缺少文字数据：${l.name}`);
        const t = l.text; requireString(t.characters, '文字内容', MAX_CHARACTERS);
        characters += t.characters.length; if (characters > MAX_CHARACTERS) throw new Error('全文字数超过 1000 万。');
        textStyle(t); requireNumber(t.fontSize, '字号', 0.01, 100000);
        if (t.transform) { if (t.transform.length !== 6) throw new Error('文字矩阵无效。'); for (const n of t.transform) requireNumber(n, '文字矩阵', -1e7, 1e7); }
        if (t.path) {
          if (!Array.isArray(t.path.segments) || !t.path.segments.length || t.path.segments.length > 4096 || typeof t.path.reversed !== 'boolean') throw new Error('文字路径无效。');
          for (let i = 0; i < t.path.segments.length; i++) {
            const segment = t.path.segments[i]; if (!Array.isArray(segment) || segment.length !== 8) throw new Error('文字路径曲线无效。');
            for (const v of segment) requireNumber(v, '文字路径坐标', -1e7, 1e7);
            if (i && (Math.abs(t.path.segments[i - 1][6] - segment[0]) > .01 || Math.abs(t.path.segments[i - 1][7] - segment[1]) > .01)) throw new Error('文字路径曲线不连续。');
          }
          if (t.path.textRange) { if (t.path.textRange.length !== 2) throw new Error('文字路径区间无效。'); for (const v of t.path.textRange) requireNumber(v, '文字路径区间', -1e6, 1e6); }
        }
        if (t.runs) {
          if (!Array.isArray(t.runs) || t.runs.length > 100000) throw new Error('文字样式段无效。');
          for (const run of t.runs) {
            requireNumber(run.start, '文字段开始', 0, t.characters.length); requireNumber(run.end, '文字段结束', run.start, t.characters.length);
            if (!Number.isInteger(run.start) || !Number.isInteger(run.end)) throw new Error('文字段索引必须是整数。'); textStyle(run);
          }
        }
      }
      raster(l.raster); raster(l.mask); if (l.children) visit(l.children, depth + 1);
    }
  }
  visit(doc.layers, 0); raster(doc.composite);
  return { layerCount, tileCount, assetIds: [...assetIds] };
}

/** Only public Plugin API methods are used; the API object is injected for testing. */
export async function importDocument(api: PluginAPI, document: BridgeDocument, hashes: Record<string, string>, options: ImportOptions, callbacks: ImportCallbacks = {}): Promise<ImportResult> {
  const checked = validateDocument(document);
  for (const id of checked.assetIds) if (!Object.prototype.hasOwnProperty.call(hashes, id) || typeof hashes[id] !== 'string' || !hashes[id]) throw new Error(`缺少图像资产：${id}`);
  const report: Issue[] = copy(document.report), missingFonts: FontSubstitution[] = [];
  const created: SceneNode[] = [], resolved = new Map<string, FontName>(), loaded = new Set<string>();
  const counts = { layers: 0, texts: 0, images: 0, groups: 0, shapes: 0, tiles: 0 };
  const checkCancel = () => { if (callbacks.isCancelled?.()) throw new Error('导入已取消；本次创建的图层已撤销。'); };
  function issue(layer: BridgeLayer | undefined, code: string, message: string, severity: Issue['severity'] = 'warning') {
    report.push({ layerId: layer?.id, layerName: layer?.name, code, message, severity });
  }
  // Font discovery/loading can hang in the host. A cancelled session must be
  // released even if the host promise never settles. The promise still has a
  // rejection handler, and no code resumes into node creation after cancellation.
  function hostCall<T>(promise: Promise<T>, label: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const started = Date.now(); let settled = false;
      let timer: ReturnType<typeof setTimeout>;
      const finish = (error?: Error, value?: T) => {
        if (settled) return;
        settled = true; clearTimeout(timer);
        if (error) reject(error); else resolve(value as T);
      };
      const poll = () => {
        if (callbacks.isCancelled?.()) { finish(new Error('导入已取消；本次创建的图层已撤销。')); return; }
        if (Date.now() - started >= 30_000) { finish(new Error(`Figma ${label}超时；本次导入已停止，请检查字体服务后重试。`)); return; }
        timer = setTimeout(poll, 50);
      };
      poll();
      promise.then(value => finish(undefined, value), error => finish(error instanceof Error ? error : new Error(String(error))));
    });
  }
  const available = (await hostCall(api.listAvailableFontsAsync(), '字体列表')).map(f => f.fontName);
  checkCancel();
  const byId = new Map(available.map(f => [fontId(f), f]));
  const defaultStyles = (f: FontName) => ['regular', 'normal', 'roman', 'book'].includes(normal(f.style));
  const preferRegular = (fs: FontName[]) => fs.find(defaultStyles) || fs[0];
  const fallbackFamilies = ['Noto Sans SC', 'Source Han Sans SC', 'Noto Sans CJK SC', 'PingFang SC', 'Microsoft YaHei', 'WenQuanYi Zen Hei', 'SimHei', 'Arial Unicode MS', 'Noto Sans', 'Inter', 'Roboto'];
  const fallback = fallbackFamilies.map(f => preferRegular(available.filter(a => normal(a.family) === normal(f)))).find(Boolean) || available[0];
  async function load(font: FontName) { if (!loaded.has(fontId(font))) { await hostCall(api.loadFontAsync(font), '字体加载'); loaded.add(fontId(font)); } }
  function resolve(style: Partial<BridgeTextRun>): FontName {
    const key = styleKey(style); const cached = resolved.get(key); if (cached) return cached;
    if (!fallback) throw new Error('Figma 没有可用字体；请启用字体后重试。');
    const source = sourceId(style) || '(未记录字体)';
    const mapped = options.fontMap?.[source] || options.fontMap?.[style.fontPostScript || ''] || options.fontMap?.[style.fontFamily || ''];
    let result: FontName | undefined, reason = '';
    if (mapped) {
      result = byId.get(fontId(mapped));
      if (!result) throw new Error(`指定的映射字体未安装：${mapped.family} ${mapped.style}`);
      reason = '使用用户指定的字体映射';
    } else {
      const ps = normal(style.fontPostScript || '');
      if (ps) result = available.find(f => normal(f.family + f.style) === ps) || available.find(f => defaultStyles(f) && normal(f.family) === ps);
      if (!result && style.fontFamily) {
        const family = available.filter(f => normal(f.family) === normal(style.fontFamily!));
        const wanted = normal(style.fontStyle || 'Regular');
        result = family.find(f => normal(f.style) === wanted || wanted === 'regular' && defaultStyles(f));
        if (!result && family.length) { result = preferRegular(family); reason = '同名字族中缺少原始字重／样式'; }
      }
      if (!result) {
        const requested = normal(`${style.fontStyle || ''} ${source}`);
        const desired = /(?:black|heavy)/.test(requested) ? 'black' : /(?:semibold|demibold)/.test(requested) ? 'semibold' : /bold/.test(requested) ? 'bold' : /medium/.test(requested) ? 'medium' : /light/.test(requested) ? 'light' : 'regular';
        const family = available.filter(f => f.family === fallback.family);
        result = family.find(f => normal(f.style) === desired) || (desired === 'semibold' ? family.find(f => normal(f.style) === 'bold') : undefined) || fallback;
        reason = '未找到原始字体，使用已验证可用的替代字体';
      }
    }
    resolved.set(key, result);
    if (reason) {
      missingFonts.push({ source, replacement: result, reason });
      issue(undefined, mapped ? 'FONT_MAPPED' : 'FONT_SUBSTITUTED', `${source} → ${result.family} ${result.style}；${reason}。`, mapped ? 'info' : 'warning');
    }
    return result;
  }
  function walk(list: BridgeLayer[], fn: (l: BridgeLayer) => void) { for (const l of list) { fn(l); if (l.children) walk(l.children, fn); } }
  walk(document.layers, l => { if (l.text) { resolve(l.text); for (const r of l.text.runs || []) resolve({ ...l.text, ...r }); } });
  for (const font of resolved.values()) { checkCancel(); await load(font); }
  // createText's current default font must also be loaded before editing it.
  for (const f of available.filter(f => ['Inter', 'Roboto'].includes(f.family) && f.style === 'Regular')) await load(f);
  checkCancel();
  const register = <T extends SceneNode>(node: T): T => { created.push(node); return node; };
  function frame(name: string, width: number, height: number): FrameNode {
    const f = register(api.createFrame()); f.name = name; f.resize(Math.max(0.01, width), Math.max(0.01, height));
    f.fills = []; f.clipsContent = false; f.layoutMode = 'NONE'; return f;
  }
  function append(parent: FrameNode, node: SceneNode, x: number, y: number) { parent.appendChild(node); node.x = x; node.y = y; }
  function appearance(node: SceneNode, layer: BridgeLayer, withEffects = true) {
    node.name = layer.name; node.visible = layer.visible;
    if ('opacity' in node) node.opacity = layer.opacity;
    if ('blendMode' in node) node.blendMode = layer.blendMode === 'PASS_THROUGH' && node.type !== 'FRAME' && node.type !== 'GROUP' ? 'NORMAL' : layer.blendMode;
    if (withEffects && 'effects' in node && layer.effects?.length) {
      const values = copy(layer.effects);
      if (node.type === 'TEXT' || node.type === 'TEXT_PATH') for (const e of values) if ((e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW') && e.spread) {
        issue(layer, 'TEXT_SHADOW_SPREAD', 'Figma 文字阴影不支持 Photoshop 扩展值；保留模糊、位移和颜色，扩展值设为 0。'); (e as { spread?: number }).spread = 0;
      }
      node.effects = values;
    }
    if ('strokes' in node && layer.strokes?.length) { node.strokes = nativePaints(layer.strokes); node.strokeWeight = layer.strokeWeight || 0; node.strokeAlign = layer.strokeAlign || 'CENTER'; }
  }
  function addRaster(raster: Raster, parent: FrameNode, originX: number, originY: number, name: string): void {
    for (let i = 0; i < raster.tiles.length; i++) {
      checkCancel(); const tile = raster.tiles[i]; const node = register(api.createRectangle());
      node.name = raster.tiles.length === 1 ? name : `${name} · ${i + 1}/${raster.tiles.length}`;
      node.resize(tile.width, tile.height); node.strokes = [];
      node.fills = [{ type: 'IMAGE', imageHash: hashes[tile.assetId], scaleMode: 'FILL' }];
      append(parent, node, tile.x - originX, tile.y - originY); counts.tiles++;
    }
  }
  function rasterLayer(raster: Raster | undefined, parent: FrameNode, layer: BridgeLayer, name = layer.name): FrameNode {
    const node = frame(name, layer.width, layer.height); append(parent, node, layer.x, layer.y);
    if (raster?.tiles.length) addRaster(raster, node, layer.x, layer.y, name);
    else issue(layer, 'NO_PIXEL_DATA', '此图层没有可导入的缓存像素；已保留空图层位置。');
    return node;
  }
  async function textLayer(layer: BridgeLayer, parent: FrameNode): Promise<SceneNode> {
    const t = layer.text!;
    let node: TextNode | TextPathNode;
    let originX = layer.x, originY = layer.y;
    if (t.path) {
      const raw = t.path.segments;
      const segs = t.path.reversed ? [...raw].reverse().map(s => [s[6], s[7], s[4], s[5], s[2], s[3], s[0], s[1]]) : raw;
      originX = Infinity; originY = Infinity;
      for (const s of segs) {
        originX = Math.min(originX, s[0], s[2], s[4], s[6]);
        originY = Math.min(originY, s[1], s[3], s[5], s[7]);
      }
      const last = segs[segs.length - 1], first = segs[0];
      const closed = Math.abs(last[6] - first[0]) < .01 && Math.abs(last[7] - first[1]) < .01;
      const vertices: VectorVertex[] = segs.map(s => ({ x: s[0] - originX, y: s[1] - originY }));
      if (!closed) vertices.push({ x: last[6] - originX, y: last[7] - originY });
      const segments: VectorSegment[] = segs.map((s, i) => ({ start: i, end: (i + 1) % vertices.length, tangentStart: { x: s[2] - s[0], y: s[3] - s[1] }, tangentEnd: { x: s[4] - s[6], y: s[5] - s[7] } }));
      const vector = register(api.createVector());
      await hostCall(vector.setVectorNetworkAsync({ vertices, segments }), '文字路径');
      const range = t.path.textRange || [0, segs.length];
      const align = t.textAlignHorizontal || 'LEFT';
      let parameter = align === 'CENTER' ? (range[0] + range[1]) / 2 : align === 'RIGHT' ? range[1] : range[0];
      if (t.path.reversed) parameter = segs.length - parameter;
      parameter = closed ? ((parameter % segs.length) + segs.length) % segs.length : Math.max(0, Math.min(segs.length - .000001, parameter));
      // Native conversion consumes the vector and returns a new TEXT_PATH ID.
      node = register(api.createTextPath(vector, Math.floor(parameter), parameter % 1));
    } else node = register(api.createText());
    // A newly created TextNode is already on the page. Load its current font before parenting or editing.
    if (typeof node.fontName === 'object') await load(node.fontName);
    checkCancel(); node.fontName = resolve(t); node.characters = t.characters;
    const tr = t.transform;
    const sx = tr ? Math.hypot(tr[0], tr[1]) : 1, sy = tr ? Math.hypot(tr[2], tr[3]) : 1;
    const scale = sy > 1e-6 ? sy : 1;
    const appliedSize = t.fontSize * scale;
    if (appliedSize > 100000) throw new Error(`文字尺寸过大：${layer.name}`);
    node.fontSize = appliedSize;
    if (node.type === 'TEXT') node.textAutoResize = t.shapeType === 'box' ? 'NONE' : 'WIDTH_AND_HEIGHT';
    node.textAlignHorizontal = t.textAlignHorizontal || 'LEFT';
    node.textAlignVertical = 'TOP';
    node.fills = nativePaints(layer.fills || t.fill || [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }]);
    if (t.letterSpacing !== undefined) node.letterSpacing = { unit: 'PIXELS', value: t.letterSpacing * scale };
    if (node.type === 'TEXT') {
      if (t.lineHeight !== undefined) node.lineHeight = { unit: 'PIXELS', value: t.lineHeight * scale };
      if (t.paragraphSpacing !== undefined && Number.isFinite(t.paragraphSpacing)) node.paragraphSpacing = Math.max(0, t.paragraphSpacing * scale);
      if (t.paragraphIndent !== undefined && Number.isFinite(t.paragraphIndent)) node.paragraphIndent = t.paragraphIndent * scale;
      if (t.textDecoration) node.textDecoration = t.textDecoration;
    } else if (t.textDecoration && t.textDecoration !== 'NONE') issue(layer, 'PATH_TEXT_DECORATION', '路径文字保留编辑能力，Figma 路径文字 API 不支持此装饰线。');
    if (t.textCase) node.textCase = t.textCase;
    for (const run of t.runs || []) {
      if (run.end <= run.start) continue;
      node.setRangeFontName(run.start, run.end, resolve({ ...t, ...run }));
      if (run.fontSize !== undefined) node.setRangeFontSize(run.start, run.end, run.fontSize * scale);
      // The normalizer already prepends layer overlays to each run's foreground paints.
      if (run.fill) node.setRangeFills(run.start, run.end, nativePaints(run.fill));
      if (run.letterSpacing !== undefined) node.setRangeLetterSpacing(run.start, run.end, { unit: 'PIXELS', value: run.letterSpacing * scale });
      if (node.type === 'TEXT' && run.lineHeight !== undefined) node.setRangeLineHeight(run.start, run.end, { unit: 'PIXELS', value: run.lineHeight * scale });
      if (node.type === 'TEXT' && run.textDecoration) node.setRangeTextDecoration(run.start, run.end, run.textDecoration);
      if (run.textCase) node.setRangeTextCase(run.start, run.end, run.textCase);
    }
    if (node.type === 'TEXT' && t.shapeType === 'box') {
      const b = t.boxBounds;
      const w = b && b.length === 4 ? Math.abs(b[2] - b[0]) * Math.max(sx, 1e-6) : layer.width;
      const h = b && b.length === 4 ? Math.abs(b[3] - b[1]) * scale : layer.height;
      node.resize(Math.max(0.01, w), Math.max(0.01, h));
    }
    // PSD layer bounds describe the cached glyph pixels, whereas Figma x/y
    // describe its font line box. Measure fresh visible text on the unclipped
    // page, before strokes/effects, and place its ink at the PSD pixel origin.
    // Rotated/box/vertical text need their own layout/anchor semantics.
    let inkOffsetX = 0, inkOffsetY = 0;
    if (!t.path && t.shapeType !== 'box' && t.orientation !== 'vertical' && (!tr || Math.abs(Math.atan2(tr[1], tr[0])) < 1e-6)) {
      const ink = node.absoluteRenderBounds;
      const box = node.absoluteBoundingBox;
      if (ink && box && ink.width > 0 && ink.height > 0) {
        const dx = box.x - ink.x, dy = box.y - ink.y;
        if (Number.isFinite(dx) && Number.isFinite(dy) && Math.abs(dx) < 100000 && Math.abs(dy) < 100000) { inkOffsetX = dx; inkOffsetY = dy; }
      }
    }
    appearance(node, layer);
    let output: SceneNode = node;
    if (options.keepTextBackup && layer.raster?.tiles.length) {
      const wrapper = frame(layer.name, layer.width, layer.height);
      appearance(wrapper, { ...layer, strokes: undefined }, false); append(parent, wrapper, layer.x, layer.y);
      append(wrapper, node, originX - layer.x + inkOffsetX, originY - layer.y + inkOffsetY); node.visible = true; node.opacity = 1; node.blendMode = 'NORMAL'; node.name = `${layer.name} · 可编辑文字`;
      const backup = frame('原始文字像素备份（隐藏）', layer.width, layer.height); append(wrapper, backup, 0, 0);
      addRaster(layer.raster, backup, layer.x, layer.y, '原始文字'); backup.visible = false; backup.locked = true;
      output = wrapper;
    } else append(parent, node, originX + inkOffsetX, originY + inkOffsetY);
    if (tr && !t.path) {
      const angle = Math.atan2(tr[1], tr[0]);
      if (Math.abs(angle) > 1e-6) {
        const x = node.x, y = node.y;
        node.relativeTransform = [[Math.cos(angle), -Math.sin(angle), x], [Math.sin(angle), Math.cos(angle), y]];
      }
      const dot = sx && sy ? (tr[0] * tr[2] + tr[1] * tr[3]) / (sx * sy) : 0;
      if (Math.abs(sx - sy) > 0.01 || Math.abs(dot) > 0.001 || tr[0] * tr[3] - tr[1] * tr[2] < 0) issue(layer, 'TEXT_TRANSFORM_APPROXIMATION', '原文字含非等比缩放、倾斜或镜像；当前保留可编辑文字、字号和旋转，其他形变需与原图核对。');
    }
    if (t.orientation === 'vertical') issue(layer, 'VERTICAL_TEXT_APPROXIMATION', 'Figma 原生文字不支持 Photoshop 竖排；当前为可编辑横排文字，请参照像素备份。');
    if ([t, ...(t.runs || [])].some(r => r.baselineShift || r.horizontalScale && r.horizontalScale !== 1 || r.verticalScale && r.verticalScale !== 1)) issue(layer, 'TEXT_ADVANCED_METRICS', '基线偏移／字符独立缩放不能直接映射，已保留内容和常规文字样式。');
    return output;
  }
  function withMask(layer: BridgeLayer, content: SceneNode, parent: FrameNode, parentX: number, parentY: number): SceneNode {
    if (!layer.mask?.tiles.length) return content;
    const contentX = content.x - (layer.x - parentX), contentY = content.y - (layer.y - parentY);
    const wrapper = frame(`${layer.name} · 蒙版`, layer.width, layer.height);
    append(parent, wrapper, layer.x - parentX, layer.y - parentY);
    const mask = frame('图层蒙版', layer.width, layer.height); append(wrapper, mask, 0, 0);
    addRaster(layer.mask, mask, layer.x, layer.y, '蒙版'); mask.isMask = true; mask.maskType = 'ALPHA'; mask.locked = true;
    append(wrapper, content, contentX, contentY); return wrapper;
  }
  async function one(layer: BridgeLayer, parent: FrameNode, px: number, py: number): Promise<SceneNode> {
    checkCancel(); let node: SceneNode;
    if (layer.kind === 'group') {
      const group = frame(layer.name, layer.width, layer.height); append(parent, group, layer.x - px, layer.y - py); appearance(group, layer);
      if (layer.metadata?.artboard) {
        group.clipsContent = true;
        const artboard = layer.metadata.artboard as { backgroundType?: number; color?: { r?: number; g?: number; b?: number } };
        // Photoshop: 1=white, 2=black, 3=transparent, 4=custom. Preserve transparent artboards.
        if (artboard.backgroundType === 1) group.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
        else if (artboard.backgroundType === 2) group.fills = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
        else if (artboard.backgroundType === 4 && artboard.color && ['r', 'g', 'b'].every(k => Number.isFinite(artboard.color![k as 'r' | 'g' | 'b']))) group.fills = [{ type: 'SOLID', color: { r: Math.max(0, Math.min(1, (artboard.color.r || 0) / 255)), g: Math.max(0, Math.min(1, (artboard.color.g || 0) / 255)), b: Math.max(0, Math.min(1, (artboard.color.b || 0) / 255)) } }];
      }
      if (layer.children?.length) await children(layer.children, group, layer.x, layer.y);
      else if (layer.raster) addRaster(layer.raster, group, layer.x, layer.y, layer.name);
      node = group; counts.groups++;
    } else if (layer.kind === 'text') {
      node = await textLayer(layer, parent); node.x -= px; node.y -= py; counts.texts++;
    } else if (layer.kind === 'shape' && layer.fills?.length) {
      const shape = register(api.createRectangle()); shape.resize(Math.max(0.01, layer.width), Math.max(0.01, layer.height)); shape.fills = nativePaints(layer.fills); shape.strokes = [];
      append(parent, shape, layer.x - px, layer.y - py); appearance(shape, layer); node = shape; counts.shapes++;
    } else {
      const image = rasterLayer(layer.raster, parent, layer); image.x -= px; image.y -= py; appearance(image, layer); node = image; counts.images++;
    }
    node = withMask(layer, node, parent, px, py);
    counts.layers++;
    callbacks.onProgress?.(counts.layers, checked.layerCount, layer.name);
    if (counts.layers % 8 === 0) { await callbacks.yieldControl?.(); checkCancel(); }
    return node;
  }
  async function children(list: BridgeLayer[], parent: FrameNode, px: number, py: number) {
    for (let i = 0; i < list.length; i++) {
      const layer = list[i]; const base = await one(layer, parent, px, py);
      if (layer.clipping) { issue(layer, 'ORPHAN_CLIPPING_LAYER', '此剪贴图层没有同组的下方基底，已按普通图层导入。'); continue; }
      if (!list[i + 1]?.clipping) continue;
      const clipped: BridgeLayer[] = [];
      while (list[i + 1]?.clipping) clipped.push(list[++i]);
      const minX = Math.min(layer.x, ...clipped.map(l => l.x)), minY = Math.min(layer.y, ...clipped.map(l => l.y));
      const maxX = Math.max(layer.x + layer.width, ...clipped.map(l => l.x + l.width)), maxY = Math.max(layer.y + layer.height, ...clipped.map(l => l.y + l.height));
      const stack = frame(`${layer.name} · 剪贴组`, maxX - minX, maxY - minY); append(parent, stack, minX - px, minY - py); stack.visible = layer.visible;
      append(stack, base, base.x + px - minX, base.y + py - minY);
      const mask = base.clone(); register(mask);
      if ('children' in mask) for (const n of mask.findAll()) register(n);
      mask.name = '剪贴基底透明度'; append(stack, mask, base.x, base.y); mask.visible = true; mask.locked = true;
      if ('opacity' in mask) mask.opacity = 1;
      if ('blendMode' in mask) mask.blendMode = 'NORMAL';
      if ('isMask' in mask) { mask.isMask = true; mask.maskType = 'ALPHA'; }
      for (const item of clipped) await one(item, stack, minX, minY);
      issue(layer, 'CLIPPING_APPROXIMATION', '剪贴栈已转为 Figma 透明度蒙版；Photoshop 的特殊混合／填充不透明度行为可能有差异。', 'info');
    }
  }
  let main: FrameNode | undefined, reference: FrameNode | undefined;
  try {
    const page = api.currentPage;
    const right = page.children.reduce((max, n) => Math.max(max, n.x + n.width), 0);
    main = frame(`${document.name} · 可编辑`, document.width, document.height);
    page.appendChild(main); main.x = Math.ceil(right + 160); main.y = 0; main.clipsContent = true;
    await children(document.layers, main, 0, 0);
    if (options.includeReference && document.composite?.tiles.length) {
      reference = frame(`${document.name} · 原始合成预览`, document.width, document.height);
      page.appendChild(reference); reference.x = main.x + document.width + 160; reference.y = main.y; reference.clipsContent = true;
      addRaster(document.composite, reference, 0, 0, '原始合成图'); reference.locked = true;
    } else if (options.includeReference) issue(undefined, 'NO_REFERENCE', '源文件没有可用合成预览；未创建原图对照画板。');
    checkCancel();
    if (counts.texts) issue(undefined, 'TEXT_METRICS_REVIEW', '文字保留可编辑；Photoshop 与 Figma 的字体排版、字形边界和行距可能不同，请用原始合成预览复核。', 'info');
    return { frameId: main.id, referenceFrameId: reference?.id, createdNodeIds: [...new Set(created.map(n => n.id))], removedNodeIds: created.filter(n => n.removed).map(n => n.id), width: document.width, height: document.height, report, missingFonts, counts };
  } catch (error) {
    for (let i = created.length - 1; i >= 0; i--) { const node = created[i]; if (!node.removed) { try { node.remove(); } catch { /* A removed ancestor already owns this descendant. */ } } }
    throw error;
  }
}

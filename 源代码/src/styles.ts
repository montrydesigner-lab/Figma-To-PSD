import type { Color, EffectSolidGradient, ExtraGradientInfo, Layer, LayerEffectGradientOverlay, LayerEffectsInfo, UnitsValue } from 'ag-psd';

export const clamp = (n: number, min = 0, max = 1): number => Math.min(max, Math.max(min, Number.isFinite(n) ? n : min));
export const number = (value: unknown, fallback = 0): number => typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/** Photoshop colour descriptors can use several colour spaces even in RGB documents. */
export function colorToRGBA(color: Color | undefined, fallback: RGBA = { r: 0, g: 0, b: 0, a: 1 }): RGBA {
  if (!color) return { ...fallback };
  if ('r' in color) return { r: clamp(color.r / 255), g: clamp(color.g / 255), b: clamp(color.b / 255), a: 'a' in color ? clamp(color.a / 255) : 1 };
  if ('fr' in color) return { r: clamp(color.fr), g: clamp(color.fg), b: clamp(color.fb), a: 1 };
  if ('h' in color) {
    const h = ((color.h % 1) + 1) % 1 * 6, s = clamp(color.s), v = clamp(color.b);
    const c = v * s, x = c * (1 - Math.abs(h % 2 - 1)), m = v - c;
    const channels = h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x] : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x];
    return { r: channels[0] + m, g: channels[1] + m, b: channels[2] + m, a: 1 };
  }
  if ('c' in color) {
    const k = clamp(color.k / 255);
    return { r: (1 - clamp(color.c / 255)) * (1 - k), g: (1 - clamp(color.m / 255)) * (1 - k), b: (1 - clamp(color.y / 255)) * (1 - k), a: 1 };
  }
  if ('l' in color) {
    // Descriptor Lab: L=0..1, a/b=-1..1. D50 Lab -> XYZ -> sRGB; this is an approximation without ICC profiles.
    const fy = (color.l * 100 + 16) / 116, fx = fy + color.a * 128 / 500, fz = fy - color.b * 128 / 200;
    const f = (t: number) => t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27);
    const X = f(fx) * 0.96422, Y = f(fy), Z = f(fz) * 0.82521;
    const srgb = (n: number) => clamp(n <= .0031308 ? 12.92 * n : 1.055 * n ** (1 / 2.4) - .055);
    return { r: srgb(3.1338561 * X - 1.6168667 * Y - .4906146 * Z), g: srgb(-.9787684 * X + 1.9161415 * Y + .033454 * Z), b: srgb(.0719453 * X - .2289914 * Y + 1.4052427 * Z), a: 1 };
  }
  const gray = clamp(color.k / 255);
  return { r: gray, g: gray, b: gray, a: 1 };
}

export function solidPaint(color?: Color, opacity = 1, mode?: string): SolidPaint {
  const c = colorToRGBA(color);
  return { type: 'SOLID', color: { r: c.r, g: c.g, b: c.b }, opacity: clamp(c.a * opacity), blendMode: blendMode(mode) };
}

const blendModes: Record<string, BlendMode> = {
  'pass through': 'PASS_THROUGH', normal: 'NORMAL', darken: 'DARKEN', multiply: 'MULTIPLY',
  'color burn': 'COLOR_BURN', 'linear burn': 'LINEAR_BURN', lighten: 'LIGHTEN', screen: 'SCREEN', 'color dodge': 'COLOR_DODGE',
  'linear dodge': 'LINEAR_DODGE', overlay: 'OVERLAY', 'soft light': 'SOFT_LIGHT', 'hard light': 'HARD_LIGHT',
  difference: 'DIFFERENCE', exclusion: 'EXCLUSION', hue: 'HUE', saturation: 'SATURATION', color: 'COLOR', luminosity: 'LUMINOSITY',
};
export function blendMode(mode?: string): BlendMode { return blendModes[mode || 'normal'] || 'NORMAL'; }
export function isSupportedBlendMode(mode?: string): boolean { return !mode || Object.prototype.hasOwnProperty.call(blendModes, mode); }

export function unitPixels(value: UnitsValue | undefined, dpi = 72, fallback = 0): number {
  if (!value) return fallback;
  const v = number(value.value);
  switch (value.units) {
    case 'Points': return v * dpi / 72;
    case 'Picas': return v * dpi / 6;
    case 'Inches': return v * dpi;
    case 'Centimeters': return v * dpi / 2.54;
    case 'Millimeters': return v * dpi / 25.4;
    default: return v;
  }
}

function interpolate<T extends { location: number; midpoint: number }>(stops: T[], position: number, read: (s: T) => number): number {
  if (!stops.length) return 1;
  if (position <= stops[0].location) return read(stops[0]);
  for (let i = 1; i < stops.length; i++) {
    if (position <= stops[i].location) {
      const a = stops[i - 1], b = stops[i];
      let t = clamp((position - a.location) / Math.max(1e-10, b.location - a.location));
      const midpoint = clamp(number(a.midpoint, .5), .001, .999);
      // Photoshop midpoint marks the halfway colour. Piecewise interpolation keeps it exact at that point.
      t = t <= midpoint ? t / midpoint / 2 : .5 + (t - midpoint) / (1 - midpoint) / 2;
      return read(a) + (read(b) - read(a)) * t;
    }
  }
  return read(stops[stops.length - 1]);
}

export function gradientStops(gradient: EffectSolidGradient, reverse = false): ColorStop[] {
  const colors = [...gradient.colorStops].sort((a, b) => a.location - b.location);
  const alpha = [...(gradient.opacityStops || [])].sort((a, b) => a.location - b.location);
  if (!colors.length) return [{ position: 0, color: { r: 0, g: 0, b: 0, a: 1 } }, { position: 1, color: { r: 1, g: 1, b: 1, a: 1 } }];
  const positions = new Set<number>([0, 1]);
  for (const stops of [colors, alpha]) {
    stops.forEach((s, i) => {
      positions.add(clamp(s.location));
      if (i + 1 < stops.length && Math.abs(number(s.midpoint, .5) - .5) > .0001) positions.add(clamp(s.location + (stops[i + 1].location - s.location) * s.midpoint));
    });
  }
  const result = [...positions].sort((a, b) => a - b).map(position => ({
    position: reverse ? 1 - position : position,
    color: {
      r: clamp(interpolate(colors, position, s => colorToRGBA(s.color).r)),
      g: clamp(interpolate(colors, position, s => colorToRGBA(s.color).g)),
      b: clamp(interpolate(colors, position, s => colorToRGBA(s.color).b)),
      a: clamp(interpolate(alpha, position, s => s.opacity)),
    },
  }));
  return result.sort((a, b) => a.position - b.position);
}

type GradientInfo = ExtraGradientInfo & { type?: string; opacity?: number; blendMode?: string };
export function gradientPaint(gradient: EffectSolidGradient, info: GradientInfo, width: number, height: number): GradientPaint | undefined {
  const style = info.style || info.type || 'linear';
  if (!['linear', 'radial', 'angle', 'diamond', 'reflected'].includes(style)) return undefined;
  const w = Math.max(1, width), h = Math.max(1, height), angle = number(info.angle) * Math.PI / 180;
  const scale = Math.max(.0001, number(info.scale, 1));
  const cos = Math.cos(angle), sin = -Math.sin(angle);
  const distance = (Math.abs(cos) * w + Math.abs(sin) * h) * scale;
  const dx = cos * distance / w, dy = sin * distance / h;
  const ex = -sin * distance / w, ey = cos * distance / h;
  const det = dx * ey - ex * dy;
  const cx = .5 + number(info.offset?.x), cy = .5 + number(info.offset?.y);
  const sx = cx - dx / 2, sy = cy - dy / 2;
  const a = ey / det, b = -ex / det, c = -dy / det, d = dx / det;
  let stops = gradientStops(gradient, info.reverse);
  if (style === 'reflected') {
    stops = [...stops.map(s => ({ position: .5 - s.position / 2, color: s.color })).reverse(), ...stops.slice(1).map(s => ({ position: .5 + s.position / 2, color: s.color }))];
  }
  return {
    type: style === 'radial' ? 'GRADIENT_RADIAL' : style === 'angle' ? 'GRADIENT_ANGULAR' : style === 'diamond' ? 'GRADIENT_DIAMOND' : 'GRADIENT_LINEAR',
    gradientStops: stops,
    gradientTransform: [[a, b, -a * sx - b * sy], [c, d, .5 - c * sx - d * sy]],
    opacity: clamp(number(info.opacity, 1)), blendMode: blendMode(info.blendMode),
  };
}

export interface StyleMapping {
  fills: Paint[];
  effects: Effect[];
  strokes: Paint[];
  strokeWeight?: number;
  strokeAlign?: 'INSIDE' | 'CENTER' | 'OUTSIDE';
  unsupported: string[];
}

/** Native equivalents are intentionally separate from the source bitmap. */
export function mapLayerStyles(layer: Layer, width: number, height: number, dpi = 72, globalAngle = 120): StyleMapping {
  const result: StyleMapping = { fills: [], effects: [], strokes: [], unsupported: [] };
  const fx: LayerEffectsInfo | undefined = layer.effects;
  if (!fx || fx.disabled) return result;
  const scale = number(fx.scale, 1);
  const enabled = <T extends { enabled?: boolean; present?: boolean }>(items?: T[]) => (items || []).filter(item => item.enabled !== false && item.present !== false);
  for (const shadow of enabled(fx.dropShadow)) result.effects.push(shadowEffect(shadow, 'DROP_SHADOW'));
  for (const shadow of enabled(fx.innerShadow)) result.effects.push(shadowEffect(shadow, 'INNER_SHADOW'));
  function shadowEffect(shadow: NonNullable<LayerEffectsInfo['dropShadow']>[number], type: 'DROP_SHADOW' | 'INNER_SHADOW'): Effect {
    const angle = (shadow.useGlobalLight ? globalAngle : number(shadow.angle, 120)) * Math.PI / 180;
    const distance = unitPixels(shadow.distance, dpi) * scale;
    const sourceColor = colorToRGBA(shadow.color);
    const color = { ...sourceColor, a: sourceColor.a * clamp(number(shadow.opacity, 1)) };
    const size = Math.max(0, unitPixels(shadow.size, dpi) * scale);
    const choke = unitPixels(shadow.choke, dpi);
    if (shadow.contour?.curve && shadow.contour.curve.length > 2) result.unsupported.push('阴影等高线无法与 Figma 完全对应');
    return { type, visible: true, color, blendMode: blendMode(shadow.blendMode), offset: { x: -Math.cos(angle) * distance, y: Math.sin(angle) * distance }, radius: size, spread: choke, ...(type === 'DROP_SHADOW' ? { showShadowBehindNode: !shadow.layerConceals } : {}) };
  }
  for (const fill of enabled(fx.solidFill)) result.fills.push(solidPaint(fill.color, number(fill.opacity, 1), fill.blendMode));
  for (const gradient of enabled(fx.gradientOverlay)) {
    if (gradient.gradient?.type === 'solid') {
      const paint = gradientPaint(gradient.gradient, gradient as LayerEffectGradientOverlay, width, height);
      if (paint) result.fills.push(paint);
      if (gradient.align === false) result.unsupported.push('未与图层对齐的渐变使用图层坐标近似');
      if (gradient.interpolationMethod && gradient.interpolationMethod !== 'classic') result.unsupported.push('渐变插值色彩空间使用 Figma 近似');
    } else result.unsupported.push('杂色渐变没有 Figma 原生等价效果');
  }
  const strokes = enabled(fx.stroke);
  if (strokes.length > 1) result.unsupported.push('多重描边仅映射最上层一道，原始结构保存在元数据中');
  const stroke = strokes[strokes.length - 1];
  if (stroke) {
    result.strokeWeight = Math.max(0, unitPixels(stroke.size, dpi) * scale);
    result.strokeAlign = (stroke.position || 'outside').toUpperCase() as 'INSIDE' | 'CENTER' | 'OUTSIDE';
    if ((!stroke.fillType || stroke.fillType === 'color') && stroke.color) result.strokes.push(solidPaint(stroke.color, number(stroke.opacity, 1), stroke.blendMode));
    else if (stroke.gradient?.type === 'solid') {
      const paint = gradientPaint(stroke.gradient, { ...stroke.gradient, opacity: stroke.opacity, blendMode: stroke.blendMode }, width, height);
      if (paint) result.strokes.push(paint);
    } else result.unsupported.push('图案描边无法直接转为 Figma 描边');
  }
  for (const [key, label] of [['bevel', '斜面和浮雕'], ['satin', '光泽'], ['patternOverlay', '图案叠加'], ['innerGlow', '内发光'], ['outerGlow', '外发光']] as const) {
    if (fx[key]?.enabled !== false && fx[key]) result.unsupported.push(`${label}没有完整原生映射`);
  }
  return result;
}

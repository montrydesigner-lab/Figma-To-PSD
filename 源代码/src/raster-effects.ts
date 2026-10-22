import type { Layer, LayerEffectsInfo } from 'ag-psd';
import { clamp, colorToRGBA, gradientStops, number } from './styles';

type Channels = [number, number, number, number];
interface Overlay {
  mode: string;
  opacity: number;
  solid?: Channels;
  stops?: readonly ColorStop[];
  style?: string;
  cos?: number;
  sin?: number;
  length?: number;
  centerX?: number;
  centerY?: number;
}

export interface GroupOverlayContext {
  effects: LayerEffectsInfo;
  x: number;
  y: number;
  width: number;
  height: number;
}
export type LayerWithGroupOverlays = Layer & { __bridgeGroupOverlays?: GroupOverlayContext[] };

export const supportedRasterBlendModes = new Set(['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'hard light', 'soft light', 'difference', 'exclusion', 'linear dodge', 'linear burn', 'color dodge', 'color burn']);

function blend(base: number, over: number, mode: string): number {
  switch (mode) {
    case 'multiply': return base * over;
    case 'screen': return 1 - (1 - base) * (1 - over);
    case 'overlay': return base <= .5 ? 2 * base * over : 1 - 2 * (1 - base) * (1 - over);
    case 'hard light': return over <= .5 ? 2 * base * over : 1 - 2 * (1 - base) * (1 - over);
    case 'soft light': {
      const d = base <= .25 ? ((16 * base - 12) * base + 4) * base : Math.sqrt(base);
      return over <= .5 ? base - (1 - 2 * over) * base * (1 - base) : base + (2 * over - 1) * (d - base);
    }
    case 'darken': return Math.min(base, over);
    case 'lighten': return Math.max(base, over);
    case 'difference': return Math.abs(base - over);
    case 'exclusion': return base + over - 2 * base * over;
    case 'linear dodge': return Math.min(1, base + over);
    case 'linear burn': return Math.max(0, base + over - 1);
    case 'color dodge': return over >= 1 ? 1 : Math.min(1, base / (1 - over));
    case 'color burn': return over <= 0 ? 0 : 1 - Math.min(1, (1 - base) / over);
    default: return over;
  }
}

function sampleStops(stops: readonly ColorStop[], position: number, out: Channels): void {
  position = clamp(position);
  let left = stops[0], right = left;
  for (let i = 1; i < stops.length; i++) {
    right = stops[i];
    if (position <= right.position) break;
    left = right;
  }
  const t = right.position > left.position ? clamp((position - left.position) / (right.position - left.position)) : 0;
  out[0] = left.color.r + (right.color.r - left.color.r) * t;
  out[1] = left.color.g + (right.color.g - left.color.g) * t;
  out[2] = left.color.b + (right.color.b - left.color.b) * t;
  out[3] = left.color.a + (right.color.a - left.color.a) * t;
}

/**
 * Bake Photoshop overlay effects into an RGBA tile, always clipping effects to source alpha.
 * Offsets are pixel offsets within the complete untrimmed layer, not document coordinates.
 * Shadows/strokes remain separate because their pixels extend past the source layer bounds.
 */
export function bakeOverlays(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number, offsetX: number, offsetY: number, fullWidth: number, fullHeight: number, layer: Layer): void {
  const fillOpacity = clamp(number(layer.fillOpacity, 1));
  const overlays: Overlay[] = [];
  const contexts: GroupOverlayContext[] = [
    { effects: layer.effects || {}, x: number(layer.left), y: number(layer.top), width: fullWidth, height: fullHeight },
    ...[...((layer as LayerWithGroupOverlays).__bridgeGroupOverlays || [])].reverse(),
  ];
  for (const context of contexts) {
    const fx = context.effects;
    if (fx.disabled) continue;
    // Photoshop paints Gradient Overlay beneath Color Overlay; each effect list is top-first.
    for (const effect of [...(fx.gradientOverlay || [])].reverse()) {
      if (effect.enabled === false || effect.present === false || effect.gradient?.type !== 'solid') continue;
      const angle = number(effect.angle) * Math.PI / 180;
      const cos = Math.cos(angle), sin = -Math.sin(angle);
      const length = Math.max(.0001, (Math.abs(cos) * context.width + Math.abs(sin) * context.height) * number(effect.scale, 1));
      overlays.push({ mode: effect.blendMode || 'normal', opacity: clamp(number(effect.opacity, 1)), stops: gradientStops(effect.gradient, effect.reverse), style: effect.type || 'linear', cos, sin, length, centerX: context.x - number(layer.left) + context.width * (.5 + number(effect.offset?.x)), centerY: context.y - number(layer.top) + context.height * (.5 + number(effect.offset?.y)) });
    }
    for (const effect of [...(fx.solidFill || [])].reverse()) {
      if (effect.enabled === false || effect.present === false) continue;
      const c = colorToRGBA(effect.color);
      overlays.push({ mode: effect.blendMode || 'normal', opacity: clamp(number(effect.opacity, 1)), solid: [c.r, c.g, c.b, c.a] });
    }
  }
  if (!overlays.length && fillOpacity === 1) return;
  const sample: Channels = [0, 0, 0, 1];
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const index = (py * width + px) * 4;
      const sourceAlpha = rgba[index + 3] / 255;
      if (!sourceAlpha) continue;
      let r = rgba[index] / 255, g = rgba[index + 1] / 255, b = rgba[index + 2] / 255;
      let coverage = fillOpacity;
      for (const overlay of overlays) {
        let color = overlay.solid;
        if (!color) {
          const x = offsetX + px + .5 - overlay.centerX!, y = offsetY + py + .5 - overlay.centerY!;
          const along = x * overlay.cos! + y * overlay.sin!;
          const cross = -x * overlay.sin! + y * overlay.cos!;
          let position = .5 + along / overlay.length!;
          switch (overlay.style) {
            case 'radial': position = Math.hypot(x, y) / (overlay.length! / 2); break;
            case 'angle': position = ((Math.atan2(cross, along) / (2 * Math.PI)) % 1 + 1) % 1; break;
            case 'reflected': position = Math.abs(along) / (overlay.length! / 2); break;
            case 'diamond': position = (Math.abs(along) + Math.abs(cross)) / (overlay.length! / 2); break;
          }
          sampleStops(overlay.stops!, position, sample); color = sample;
        }
        const alpha = clamp(color[3] * overlay.opacity);
        const nextCoverage = coverage + alpha - coverage * alpha;
        if (nextCoverage > 0) {
          const weight = alpha / nextCoverage;
          r += (blend(r, color[0], overlay.mode) - r) * weight;
          g += (blend(g, color[1], overlay.mode) - g) * weight;
          b += (blend(b, color[2], overlay.mode) - b) * weight;
        }
        coverage = nextCoverage;
      }
      rgba[index] = Math.round(clamp(r) * 255); rgba[index + 1] = Math.round(clamp(g) * 255); rgba[index + 2] = Math.round(clamp(b) * 255);
      rgba[index + 3] = Math.round(sourceAlpha * coverage * 255);
    }
  }
}

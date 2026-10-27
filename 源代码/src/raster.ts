import { readPsd, getCompositeImageData, getLayerImageData, getLayerMaskImageData, getLayerRealMaskImageData } from 'ag-psd';
import type { Layer, Psd, PixelData } from 'ag-psd';
import type { Raster, Rasterize } from './types';
import { encodePng } from './png';
import { bakeOverlays } from './raster-effects';

export const TILE_SIZE = 2048;
export const MAX_LAYER_PIXELS = 100_000_000;
export interface RasterHooks {
  onAsset: (assetId: string, bytes: Uint8Array) => Promise<void>;
  isCancelled: () => boolean;
}
export const yieldUI = () => new Promise<void>(resolve => setTimeout(resolve, 0));
export function readCompositePixels(psd: Psd): PixelData | undefined {
  if (psd.imageData) return psd.imageData;
  const source = (psd as Psd & {__bridgeSourceBytes?: Uint8Array}).__bridgeSourceBytes;
  if (source) return readPsd(source, {skipLayerImageData:true, skipLinkedFilesData:true, skipThumbnail:true, useImageData:true}).imageData;
  if (psd.children?.some(l => l.rawData?.large)) throw new Error('PSB 合成图需要完整源文件上下文');
  return getCompositeImageData(psd);
}
export function cancelled(hooks: { isCancelled: () => boolean }): void {
  if (hooks.isCancelled()) throw new Error('已取消导入');
}
function sample(data: PixelData['data'], i: number): number {
  const v = data[i] ?? 0;
  if (data instanceof Uint16Array) return Math.round(v / 257);
  if (data instanceof Float32Array) return Math.round(Math.max(0, Math.min(1, v)) * 255);
  return v;
}

export function createRasterizer(psd: Psd, hooks: RasterHooks): Rasterize {
  return async (layer, context) => {
    cancelled(hooks);
    let pixels: PixelData | undefined;
    let x = Math.floor(context.x), y = Math.floor(context.y);
    let width = Math.ceil(context.width), height = Math.ceil(context.height);
    let mask: Layer['mask'];
    if (context.role === 'mask' && layer) {
      mask = layer.realMask && !layer.realMask.disabled ? layer.realMask : layer.mask;
      if (!mask || mask.disabled) return undefined;
      const mw = (mask.right ?? 0) - (mask.left ?? 0), mh = (mask.bottom ?? 0) - (mask.top ?? 0);
      if (mw * mh > MAX_LAYER_PIXELS) throw new Error('蒙版超过安全解码上限（1 亿像素），请在 Photoshop 中拆分图层');
      pixels = mask.imageData ?? (mask === layer.realMask ? getLayerRealMaskImageData(layer) : getLayerMaskImageData(layer));
    } else {
      const pw = layer ? Math.max(0, (layer.right ?? 0) - (layer.left ?? 0)) : psd.width;
      const ph = layer ? Math.max(0, (layer.bottom ?? 0) - (layer.top ?? 0)) : psd.height;
      if (pw * ph > MAX_LAYER_PIXELS) throw new Error('单图层超过安全解码上限（1 亿像素），请拆分后再导入');
      pixels = layer ? layer.imageData ?? getLayerImageData(layer) : readCompositePixels(psd);
      if (!pixels) return undefined;
      width = pixels.width; height = pixels.height;
      if (layer) { x = layer.left ?? x; y = layer.top ?? y; }
    }
    if (width < 1 || height < 1 || width * height > MAX_LAYER_PIXELS) return undefined;
    const result: Raster = { width, height, tiles: [] };
    for (let ty = 0; ty < height; ty += TILE_SIZE) {
      for (let tx = 0; tx < width; tx += TILE_SIZE) {
        cancelled(hooks);
        const tw = Math.min(TILE_SIZE, width - tx), th = Math.min(TILE_SIZE, height - ty);
        const rgba = new Uint8Array(tw * th * 4);
        let nonzero = false;
        for (let py = 0; py < th; py++) {
          for (let px = 0; px < tw; px++) {
            const di = (py * tw + px) * 4;
            if (mask) {
              const mx = x + tx + px - (mask.left ?? 0), my = y + ty + py - (mask.top ?? 0);
              const inside = pixels && mx >= 0 && my >= 0 && mx < pixels.width && my < pixels.height;
              const value = inside ? sample(pixels!.data, (my * pixels!.width + mx) * 4) : (mask.defaultColor ?? 0);
              const density = Math.max(0, Math.min(1, mask.userMaskDensity ?? mask.vectorMaskDensity ?? 1));
              rgba[di] = rgba[di + 1] = rgba[di + 2] = 255;
              rgba[di + 3] = Math.round(255 - (255 - value) * density);
            } else if (pixels) {
              const si = ((ty + py) * pixels.width + tx + px) * 4;
              for (let c = 0; c < 4; c++) rgba[di + c] = sample(pixels.data, si + c);
            }
            if (rgba[di + 3]) nonzero = true;
          }
        }
        if (!mask && layer) bakeOverlays(rgba, tw, th, tx, ty, width, height, layer);
        // Keep a single transparent tile for empty masks: omission would unmask the layer.
        if (!nonzero && !mask) continue;
        const assetId = `${context.id}-${context.role}-${tx}-${ty}`;
        await hooks.onAsset(assetId, encodePng(tw, th, rgba));
        result.tiles.push({ assetId, x: x + tx, y: y + ty, width: tw, height: th });
        await yieldUI();
      }
    }
    return result.tiles.length ? result : undefined;
  };
}

import { zlibSync } from 'fflate';

const table = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  table[n] = c;
}
function crc(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = table[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array): Uint8Array {
  const b = new Uint8Array(12 + data.length), v = new DataView(b.buffer);
  v.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) b[4 + i] = type.charCodeAt(i);
  b.set(data, 8); v.setUint32(b.length - 4, crc(b.subarray(4, b.length - 4)));
  return b;
}
/** Lossless RGBA8 encoder; no Canvas roundtrip or premultiplication. */
export function encodePng(width: number, height: number, rgba: Uint8Array | Uint8ClampedArray): Uint8Array {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || rgba.length !== width * height * 4)
    throw new Error('PNG 像素尺寸无效');
  const ihdr = new Uint8Array(13), view = new DataView(ihdr.buffer);
  view.setUint32(0, width); view.setUint32(4, height); ihdr[8] = 8; ihdr[9] = 6;
  const stride = width * 4, scan = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const a = y * stride, b = y * (stride + 1);
    scan[b] = 1; // Sub filtering retains all samples, including transparent RGB.
    for (let x = 0; x < stride; x++) scan[b + 1 + x] = (rgba[a + x] - (x >= 4 ? rgba[a + x - 4] : 0)) & 255;
  }
  const chunks = [new Uint8Array([137,80,78,71,13,10,26,10]), chunk('IHDR', ihdr), chunk('IDAT', zlibSync(scan, {level: 6})), chunk('IEND', new Uint8Array())];
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0; for (const c of chunks) { out.set(c, offset); offset += c.length; }
  return out;
}

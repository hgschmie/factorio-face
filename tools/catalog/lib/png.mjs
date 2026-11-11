// Minimal PNG codec on top of node:zlib (no image dependency is installed). Decodes non-interlaced PNGs of any colour
// type to straight RGBA8 and encodes RGBA8.
import zlib from "node:zlib";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

function unfilter(raw, height, stride, bpp) {
  const out = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[dst + x - bpp] : 0;
      const b = y > 0 ? out[dst + x - stride] : 0;
      const c = x >= bpp && y > 0 ? out[dst + x - stride - bpp] : 0;
      let predictor = 0;
      if (filter === 1) predictor = a;
      else if (filter === 2) predictor = b;
      else if (filter === 3) predictor = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) throw new Error(`Unsupported PNG filter ${filter}`);
      out[dst + x] = (raw[src + x] + predictor) & 0xff;
    }
  }
  return out;
}

/** Returns { width, height, data } with data as straight (non-premultiplied) RGBA8. */
export function decodePng(buffer) {
  if (!buffer.subarray(0, 8).equals(SIGNATURE)) throw new Error("Not a PNG file");
  let header, palette, transparency;
  const idat = [];
  for (let offset = 8; offset < buffer.length; ) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("latin1", offset + 4, offset + 8);
    const body = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") header = { width: body.readUInt32BE(0), height: body.readUInt32BE(4), depth: body[8], colorType: body[9], interlace: body[12] };
    else if (type === "PLTE") palette = body;
    else if (type === "tRNS") transparency = body;
    else if (type === "IDAT") idat.push(body);
    else if (type === "IEND") break;
    offset += length + 12;
  }
  if (!header) throw new Error("PNG without IHDR");
  const { width, height, depth, colorType, interlace } = header;
  if (interlace !== 0) throw new Error("Interlaced PNGs are not supported");
  const channels = CHANNELS[colorType];
  if (!channels || (depth !== 8 && depth !== 16 && colorType !== 3 && colorType !== 0)) throw new Error(`Unsupported PNG format (colour type ${colorType}, depth ${depth})`);
  const bitsPerPixel = channels * depth;
  const stride = Math.ceil((width * bitsPerPixel) / 8);
  const pixels = unfilter(zlib.inflateSync(Buffer.concat(idat)), height, stride, Math.max(1, bitsPerPixel >> 3));
  const data = Buffer.alloc(width * height * 4);
  const sample = (row, index) => {
    if (depth === 8) return pixels[row + index];
    if (depth === 16) return pixels[row + index * 2];
    const bit = index * depth;
    const value = (pixels[row + (bit >> 3)] >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
    return colorType === 3 ? value : Math.round((value * 255) / ((1 << depth) - 1));
  };
  for (let y = 0; y < height; y++) {
    const row = y * stride;
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const first = sample(row, x * channels);
      if (colorType === 3) {
        data[o] = palette[first * 3];
        data[o + 1] = palette[first * 3 + 1];
        data[o + 2] = palette[first * 3 + 2];
        data[o + 3] = transparency && first < transparency.length ? transparency[first] : 255;
      } else if (colorType === 0 || colorType === 4) {
        data[o] = data[o + 1] = data[o + 2] = first;
        data[o + 3] = colorType === 4 ? sample(row, x * 2 + 1) : 255;
      } else {
        data[o] = first;
        data[o + 1] = sample(row, x * channels + 1);
        data[o + 2] = sample(row, x * channels + 2);
        data[o + 3] = colorType === 6 ? sample(row, x * 4 + 3) : 255;
      }
    }
  }
  return { width, height, data };
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function chunk(type, body) {
  const out = Buffer.alloc(body.length + 12);
  out.writeUInt32BE(body.length, 0);
  out.write(type, 4, "latin1");
  body.copy(out, 8);
  let crc = 0xffffffff;
  for (let i = 4; i < body.length + 8; i++) crc = CRC_TABLE[(crc ^ out[i]) & 0xff] ^ (crc >>> 8);
  out.writeUInt32BE((crc ^ 0xffffffff) >>> 0, body.length + 8);
  return out;
}

/** Encodes straight RGBA8. Tries the None/Sub/Up/Paeth row filters for the whole image and keeps the smallest result. */
export function encodePng({ width, height, data }) {
  const stride = width * 4;
  let best;
  for (const filter of [0, 1, 2, 4]) {
    const raw = Buffer.alloc(height * (stride + 1));
    for (let y = 0; y < height; y++) {
      raw[y * (stride + 1)] = filter;
      for (let x = 0; x < stride; x++) {
        const a = x >= 4 ? data[y * stride + x - 4] : 0;
        const b = y > 0 ? data[(y - 1) * stride + x] : 0;
        const c = x >= 4 && y > 0 ? data[(y - 1) * stride + x - 4] : 0;
        let predictor = 0;
        if (filter === 1) predictor = a;
        else if (filter === 2) predictor = b;
        else if (filter === 4) {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        }
        raw[y * (stride + 1) + 1 + x] = (data[y * stride + x] - predictor) & 0xff;
      }
    }
    const packed = zlib.deflateSync(raw, { level: 9 });
    if (!best || packed.length < best.length) best = packed;
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([SIGNATURE, chunk("IHDR", header), chunk("IDAT", best), chunk("IEND", Buffer.alloc(0))]);
}

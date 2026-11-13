// PNG codec for icon images on top of node:zlib (no image dependency is installed). Decodes to straight RGBA8 and encodes
// RGBA8. The decoder reads files from a folder the user chose, so every length is checked before it is used and the image
// data is never inflated beyond the size the header declares. Chunk checksums are not verified; zlib verifies the one of
// the image data. Kept free of syntax that Node's type stripping cannot run: the catalog generator is to import this file
// as it is.
import { deflateSync, inflateSync } from "node:zlib";

/** Straight (non-premultiplied) RGBA8, rows top to bottom. */
export interface RgbaImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

export class PngError extends Error {
  override readonly name = "PngError";
}

export const MAX_PNG_DIMENSION = 1024;

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** Samples per pixel by colour type: gray, RGB, palette, gray with alpha, RGBA. */
const CHANNELS: Readonly<Record<number, number>> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

function fail(message: string): never {
  throw new PngError(message);
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function unfilter(raw: Uint8Array, height: number, stride: number, bpp: number): Uint8Array {
  const out = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    if (filter > 4) fail(`Unsupported PNG filter ${filter}`);
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[dst + x - bpp]! : 0;
      const b = y > 0 ? out[dst + x - stride]! : 0;
      const c = x >= bpp && y > 0 ? out[dst + x - stride - bpp]! : 0;
      const predictor = filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b : filter === 3 ? (a + b) >> 1 : paeth(a, b, c);
      out[dst + x] = (raw[src + x]! + predictor) & 0xff;
    }
  }
  return out;
}

interface Chunks {
  readonly header: Uint8Array;
  readonly palette: Uint8Array | undefined;
  readonly transparency: Uint8Array | undefined;
  readonly data: Uint8Array[];
}

function readChunks(bytes: Uint8Array): Chunks {
  if (bytes.length < SIGNATURE.length || SIGNATURE.some((value, index) => bytes[index] !== value)) fail("Not a PNG file");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let header: Uint8Array | undefined, palette: Uint8Array | undefined, transparency: Uint8Array | undefined;
  const data: Uint8Array[] = [];
  for (let offset = SIGNATURE.length; ; ) {
    // Length, type and checksum frame every chunk; a chunk that does not fit ends the file early.
    if (offset + 12 > bytes.length) fail("Truncated PNG file");
    const end = offset + 8 + view.getUint32(offset);
    if (end + 4 > bytes.length) fail("Truncated PNG file");
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const body = bytes.subarray(offset + 8, end);
    if ((type === "IHDR") !== (offset === SIGNATURE.length)) fail("PNG header is missing or misplaced");
    if (type === "IHDR") header = body;
    else if (type === "PLTE") palette = body;
    else if (type === "tRNS") transparency = body;
    else if (type === "IDAT") data.push(body);
    else if (type === "IEND") break;
    offset = end + 4;
  }
  if (!header || header.length !== 13) fail("PNG header is missing or misplaced");
  return { header, palette, transparency, data };
}

/**
 * Decodes a non-interlaced PNG with 8 bits per sample (RGBA, RGB, gray with or without alpha, palette with optional tRNS;
 * a colour key on RGB or gray is not applied). Throws PngError for everything else, including images larger than
 * `maxDimension` on a side and image data that is shorter or longer than the header says.
 */
export function decodePng(bytes: Uint8Array, maxDimension = MAX_PNG_DIMENSION): RgbaImage {
  const { header, palette, transparency, data: chunks } = readChunks(bytes);
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  const width = view.getUint32(0), height = view.getUint32(4);
  const depth = header[8]!, colorType = header[9]!;
  if (width === 0 || height === 0 || width > maxDimension || height > maxDimension) fail(`PNG dimensions ${width}x${height} are outside 1..${maxDimension}`);
  const channels = CHANNELS[colorType];
  if (!channels || depth !== 8) fail(`Unsupported PNG format (colour type ${colorType}, depth ${depth})`);
  if (header[10] !== 0 || header[11] !== 0) fail("Unsupported PNG compression or filter method");
  if (header[12] !== 0) fail("Interlaced PNGs are not supported");
  if (colorType === 3 && (!palette || palette.length === 0 || palette.length % 3 !== 0 || palette.length > 768)) fail("PNG palette is missing or malformed");
  if (chunks.length === 0) fail("PNG without image data");

  const stride = width * channels;
  const expected = height * (stride + 1);
  let raw: Uint8Array;
  try {
    raw = inflateSync(chunks.length === 1 ? chunks[0]! : Buffer.concat(chunks), { maxOutputLength: expected });
  } catch {
    fail("PNG image data is damaged or larger than the header declares");
  }
  if (raw.length !== expected) fail("PNG image data is shorter than the header declares");
  const pixels = unfilter(raw, height, stride, channels);

  const data = new Uint8Array(width * height * 4);
  for (let s = 0, o = 0; o < data.length; s += channels, o += 4) {
    const first = pixels[s]!;
    if (colorType === 3) {
      if (first * 3 >= palette!.length) fail("PNG pixel refers to a colour outside the palette");
      data[o] = palette![first * 3]!;
      data[o + 1] = palette![first * 3 + 1]!;
      data[o + 2] = palette![first * 3 + 2]!;
      data[o + 3] = transparency && first < transparency.length ? transparency[first]! : 255;
    } else if (colorType === 0 || colorType === 4) {
      data[o] = data[o + 1] = data[o + 2] = first;
      data[o + 3] = colorType === 4 ? pixels[s + 1]! : 255;
    } else {
      data[o] = first;
      data[o + 1] = pixels[s + 1]!;
      data[o + 2] = pixels[s + 2]!;
      data[o + 3] = colorType === 6 ? pixels[s + 3]! : 255;
    }
  }
  return { width, height, data };
}

/** Row filters to try (0 None, 1 Sub, 2 Up, 4 Paeth; the smallest result is kept) and the deflate level. */
export interface PngEncoding {
  readonly filters: readonly number[];
  readonly level: number;
}

/** What the catalog generator writes to disk: the best of four filters at the highest level, about 6 ms for a 64 px icon. */
export const COMPACT_ENCODING: PngEncoding = { filters: [0, 1, 2, 4], level: 9 };
/** For icons rendered while the app runs and kept in memory: one filter and a fast level, about 0.3 ms and a tenth larger. */
export const FAST_ENCODING: PngEncoding = { filters: [0], level: 1 };

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(body.length + 12);
  const view = new DataView(out.buffer);
  view.setUint32(0, body.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(body, 8);
  let crc = 0xffffffff;
  for (let i = 4; i < body.length + 8; i++) crc = CRC_TABLE[(crc ^ out[i]!) & 0xff]! ^ (crc >>> 8);
  view.setUint32(body.length + 8, (crc ^ 0xffffffff) >>> 0);
  return out;
}

function filtered({ width, height, data }: RgbaImage, filter: number): Uint8Array {
  const stride = width * 4;
  const raw = new Uint8Array(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = filter;
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? data[y * stride + x - 4]! : 0;
      const b = y > 0 ? data[(y - 1) * stride + x]! : 0;
      const c = x >= 4 && y > 0 ? data[(y - 1) * stride + x - 4]! : 0;
      const predictor = filter === 1 ? a : filter === 2 ? b : filter === 4 ? paeth(a, b, c) : 0;
      raw[y * (stride + 1) + 1 + x] = (data[y * stride + x]! - predictor) & 0xff;
    }
  }
  return raw;
}

/** Encodes straight RGBA8, with one filter for the whole image. */
export function encodePng(image: RgbaImage, encoding: PngEncoding = FAST_ENCODING): Uint8Array {
  const { width, height, data } = image;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || data.length !== width * height * 4) throw new PngError(`Not an RGBA image of ${width}x${height}`);
  let best: Uint8Array | undefined;
  for (const filter of encoding.filters) {
    if (![0, 1, 2, 4].includes(filter)) throw new PngError(`Unsupported PNG filter ${filter}`);
    const packed = deflateSync(filtered(image, filter), { level: encoding.level });
    if (!best || packed.length < best.length) best = packed;
  }
  if (!best) throw new PngError("No PNG filter given");
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Uint8Array.from(SIGNATURE), chunk("IHDR", header), chunk("IDAT", best), chunk("IEND", new Uint8Array(0))]);
}

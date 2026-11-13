// Composites prototype icons from the game's source images following the IconData rules (layers, tint, scale, shift).
// Pure: pixels in, pixels out; whoever calls decides where the source images come from. The arithmetic and its order are
// those of the catalog generator, so both produce the same pixels. Kept free of syntax that Node's type stripping
// cannot run: the generator is to import this file as it is.
import { DEFAULT_ICON_SIZE, type IconLayer } from "./iconTable.ts";
import { encodePng, type PngEncoding, type RgbaImage } from "./png.ts";

/** A colour as prototypes write it: a list or named components, in 0..1 or 0..255. */
export type PrototypeColor = readonly number[] | { readonly r?: number; readonly g?: number; readonly b?: number; readonly a?: number };

interface PrototypeIconLayer {
  readonly icon: string;
  readonly icon_size?: number;
  readonly scale?: number;
  readonly shift?: readonly number[] | { readonly x?: number; readonly y?: number };
  readonly tint?: PrototypeColor;
  readonly floating?: boolean;
}

/** The icon fields of a prototype in the game's data dump. */
export interface IconPrototype {
  readonly icon?: string;
  readonly icon_size?: number;
  readonly icons?: readonly PrototypeIconLayer[];
}

/** Factorio colours are 0..1 unless any component exceeds 1, in which case they are 0..255; alpha defaults to opaque. */
export function normaliseColor(color: PrototypeColor): [number, number, number, number] {
  const raw: readonly (number | undefined)[] = "length" in color ? color : [color.r ?? 0, color.g ?? 0, color.b ?? 0, color.a];
  const divisor = raw.some((v) => v !== undefined && v > 1) ? 255 : 1;
  const component = (v: number | undefined): number => (v === undefined ? 1 : v / divisor);
  return [component(raw[0]), component(raw[1]), component(raw[2]), component(raw[3])];
}

/** Normalises `icon`/`icons`/`icon_size` of a prototype into a layer list, or undefined when it has no icon. */
export function iconLayers(proto: IconPrototype): IconLayer[] | undefined {
  const layers = Array.isArray(proto.icons) && proto.icons.length ? proto.icons : proto.icon ? [{ icon: proto.icon, icon_size: proto.icon_size }] : undefined;
  return layers?.map((layer: PrototypeIconLayer) => {
    // Fields are added in a fixed order: the generator recognises identical icons by their serialised layers.
    const out: { -readonly [K in keyof IconLayer]: IconLayer[K] } = { icon: layer.icon, size: layer.icon_size ?? DEFAULT_ICON_SIZE };
    if (layer.scale !== undefined) out.scale = layer.scale;
    const shift = layer.shift && ("length" in layer.shift ? [layer.shift[0] ?? 0, layer.shift[1] ?? 0] as const : [layer.shift.x ?? 0, layer.shift.y ?? 0] as const);
    if (shift && (shift[0] || shift[1])) out.shift = shift;
    const tint = layer.tint && normaliseColor(layer.tint);
    if (tint && tint.some((v) => v !== 1)) out.tint = tint;
    if (layer.floating) out.floating = true;
    return out;
  });
}

/** The first mip level of a source image (its top-left `size` square) as premultiplied floats in 0..1. */
export function iconSource(image: RgbaImage, size: number): Float64Array {
  if (image.width < size || image.height < size) throw new RangeError(`Image is ${image.width}x${image.height}, smaller than icon size ${size}`);
  const source = new Float64Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const s = (y * image.width + x) * 4, d = (y * size + x) * 4, alpha = image.data[s + 3]! / 255;
      for (let c = 0; c < 3; c++) source[d + c] = (image.data[s + c]! / 255) * alpha;
      source[d + 3] = alpha;
    }
  }
  return source;
}

/** Samples the source square (premultiplied float RGBA, edge `size`) into a destination of `dest` pixels by area averaging. */
function resample(source: Float64Array, size: number, dest: number): Float64Array {
  const ratio = size / dest;
  // Per destination index, the contributing source indices and their weights: at most `width` taps each, unused ones weigh 0.
  const width = ratio <= 1 ? 2 : Math.ceil(ratio) + 1;
  const index = new Int32Array(dest * width), weight = new Float64Array(dest * width);
  for (let d = 0; d < dest; d++) {
    const from = d * ratio, to = (d + 1) * ratio;
    let tap = d * width;
    if (ratio <= 1) {
      // Magnification: bilinear between the two nearest texel centres.
      const centre = (d + 0.5) * ratio - 0.5;
      const low = Math.floor(centre), frac = centre - low;
      index[tap] = Math.min(size - 1, Math.max(0, low));
      weight[tap] = 1 - frac;
      index[tap + 1] = Math.min(size - 1, Math.max(0, low + 1));
      weight[tap + 1] = frac;
    } else {
      for (let s = Math.floor(from); s < Math.min(size, Math.ceil(to)); s++, tap++) {
        index[tap] = s;
        weight[tap] = (Math.min(to, s + 1) - Math.max(from, s)) / ratio;
      }
    }
  }
  const out = new Float64Array(dest * dest * 4);
  for (let y = 0; y < dest; y++) {
    for (let x = 0; x < dest; x++) {
      const o = (y * dest + x) * 4;
      for (let ty = y * width; ty < (y + 1) * width; ty++) {
        const wy = weight[ty]!;
        // A tap of weight 0 adds exactly nothing, so skipping it leaves the sums as they are.
        if (wy === 0) continue;
        for (let tx = x * width; tx < (x + 1) * width; tx++) {
          const w = weight[tx]! * wy;
          if (w === 0) continue;
          const s = (index[ty]! * size + index[tx]!) * 4;
          for (let c = 0; c < 4; c++) out[o + c]! += source[s + c]! * w;
        }
      }
    }
  }
  return out;
}

export interface RenderOptions {
  /** The icon size the prototype expects (64, or 128 for item groups); layer scale and shift are expressed in a coordinate system that is `expected / 2` units wide. */
  readonly expected?: number;
  /** Edge of the rendered square in pixels. */
  readonly output?: number;
}

/** A layer that would be scaled beyond this edge is refused instead of allocated; no icon of the game comes near it. */
const MAX_LAYER_PIXELS = 2048;

/**
 * Composites the layers, bottom first, into an `output`-pixel square of straight RGBA8. `sources[i]` is the first mip level
 * of layer i as `iconSource` returns it, for that layer's size.
 */
export function renderIcon(layers: readonly IconLayer[], sources: readonly Float64Array[], { expected = DEFAULT_ICON_SIZE, output = DEFAULT_ICON_SIZE }: RenderOptions = {}): RgbaImage {
  const units = expected / 2;
  const placed = layers.map((layer, index) => {
    const source = sources[index];
    if (source?.length !== layer.size * layer.size * 4) throw new RangeError(`Source ${index} is not a ${layer.size} pixel square`);
    const extent = layer.size * (layer.scale ?? units / layer.size);
    const [sx, sy] = layer.shift ?? [0, 0];
    return { layer, source, extent, sx, sy, reach: layer.floating ? 0 : Math.max(Math.abs(sx), Math.abs(sy)) + extent / 2 };
  });
  // The GUI shrinks the whole icon when a non-floating layer would leave the slot.
  const fit = Math.min(1, units / 2 / Math.max(...placed.map((p) => p.reach), units / 2));
  const pixelsPerUnit = (output / units) * fit;
  const canvas = new Float64Array(output * output * 4);
  for (const { layer, source, extent, sx, sy } of placed) {
    const dest = Math.max(1, Math.round(extent * pixelsPerUnit));
    if (dest > MAX_LAYER_PIXELS) throw new RangeError(`Layer ${layer.icon} would be ${dest} pixels wide`);
    const pixels = resample(source, layer.size, dest);
    const left = Math.round(output / 2 + sx * pixelsPerUnit - dest / 2), top = Math.round(output / 2 + sy * pixelsPerUnit - dest / 2);
    const tint = layer.tint ?? [1, 1, 1, 1];
    for (let y = Math.max(0, -top); y < Math.min(dest, output - top); y++) {
      for (let x = Math.max(0, -left); x < Math.min(dest, output - left); x++) {
        const s = (y * dest + x) * 4, d = ((y + top) * output + x + left) * 4;
        // Tints multiply the premultiplied texel channel-wise, so a tint's alpha only scales coverage.
        const alpha = pixels[s + 3]! * tint[3];
        for (let c = 0; c < 3; c++) canvas[d + c] = pixels[s + c]! * tint[c]! + canvas[d + c]! * (1 - alpha);
        canvas[d + 3] = alpha + canvas[d + 3]! * (1 - alpha);
      }
    }
  }
  const data = new Uint8Array(output * output * 4);
  for (let i = 0; i < output * output; i++) {
    const alpha = Math.min(1, canvas[i * 4 + 3]!);
    for (let c = 0; c < 3; c++) data[i * 4 + c] = alpha > 0 ? Math.round(Math.min(1, canvas[i * 4 + c]! / alpha) * 255) : 0;
    data[i * 4 + 3] = Math.round(alpha * 255);
  }
  return { width: output, height: output, data };
}

export function renderIconPng(layers: readonly IconLayer[], sources: readonly Float64Array[], options?: RenderOptions, encoding?: PngEncoding): Uint8Array {
  return encodePng(renderIcon(layers, sources, options), encoding);
}

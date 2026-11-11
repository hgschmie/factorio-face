// Renders prototype icons from the game's source PNGs following the IconData rules (layers, tint, scale, shift).
// Used instead of `--dump-icon-sprites` because that command starts the graphics stack, which makes macOS touch the
// per-user Metal shader cache outside the workspace.
import fs from "node:fs";
import path from "node:path";
import { decodePng, encodePng } from "./png.mjs";

/** Normalises `icon`/`icons`/`icon_size` of a prototype into a layer list, or undefined when it has no icon. */
export function iconLayers(proto) {
  const layers = Array.isArray(proto.icons) && proto.icons.length ? proto.icons : proto.icon ? [{ icon: proto.icon, icon_size: proto.icon_size }] : undefined;
  return layers?.map((layer) => {
    const out = { icon: layer.icon, size: layer.icon_size ?? 64 };
    if (layer.scale !== undefined) out.scale = layer.scale;
    const shift = layer.shift && [layer.shift[0] ?? layer.shift.x ?? 0, layer.shift[1] ?? layer.shift.y ?? 0];
    if (shift && (shift[0] || shift[1])) out.shift = shift;
    const tint = layer.tint && normaliseColor(layer.tint);
    if (tint && tint.some((v) => v !== 1)) out.tint = tint;
    if (layer.floating) out.floating = true;
    return out;
  });
}

/** Factorio colours are 0..1 unless any component exceeds 1, in which case they are 0..255; alpha defaults to opaque. */
export function normaliseColor(color) {
  const raw = Array.isArray(color) ? color : [color.r ?? 0, color.g ?? 0, color.b ?? 0, color.a];
  const divisor = raw.some((v) => v !== undefined && v > 1) ? 255 : 1;
  return [0, 1, 2, 3].map((i) => (raw[i] === undefined ? 1 : raw[i] / divisor));
}

export function resolveDataPath(dataDir, file) {
  const match = /^__([^/]+?)__\/(.*)$/.exec(file);
  if (!match) throw new Error(`Icon path without module prefix: ${file}`);
  return path.join(dataDir, match[1], match[2]);
}

/** Samples the source square (premultiplied float RGBA, edge `size`) into a destination of `dest` pixels by area averaging. */
function resample(source, size, dest) {
  const ratio = size / dest;
  const taps = Array.from({ length: dest }, (_, d) => {
    const from = d * ratio, to = (d + 1) * ratio;
    const weights = [];
    if (ratio <= 1) {
      // Magnification: bilinear between the two nearest texel centres.
      const centre = (d + 0.5) * ratio - 0.5;
      const low = Math.floor(centre), frac = centre - low;
      weights.push([Math.min(size - 1, Math.max(0, low)), 1 - frac], [Math.min(size - 1, Math.max(0, low + 1)), frac]);
    } else {
      for (let s = Math.floor(from); s < Math.min(size, Math.ceil(to)); s++) weights.push([s, (Math.min(to, s + 1) - Math.max(from, s)) / ratio]);
    }
    return weights;
  });
  const out = new Float64Array(dest * dest * 4);
  for (let y = 0; y < dest; y++) {
    for (let x = 0; x < dest; x++) {
      for (const [sy, wy] of taps[y]) {
        for (const [sx, wx] of taps[x]) {
          const s = (sy * size + sx) * 4, weight = wx * wy;
          for (let c = 0; c < 4; c++) out[(y * dest + x) * 4 + c] += source[s + c] * weight;
        }
      }
    }
  }
  return out;
}

export class IconRenderer {
  #dataDir;
  #cache = new Map();

  constructor(dataDir) {
    this.#dataDir = dataDir;
  }

  /** First mip level (the top-left `size` square) as premultiplied floats in 0..1. */
  #source(file, size) {
    const key = `${file}|${size}`;
    let entry = this.#cache.get(key);
    if (!entry) {
      const image = decodePng(fs.readFileSync(resolveDataPath(this.#dataDir, file)));
      if (image.width < size || image.height < size) throw new Error(`${file} is ${image.width}x${image.height}, smaller than icon_size ${size}`);
      entry = new Float64Array(size * size * 4);
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const s = (y * image.width + x) * 4, d = (y * size + x) * 4, alpha = image.data[s + 3] / 255;
          for (let c = 0; c < 3; c++) entry[d + c] = (image.data[s + c] / 255) * alpha;
          entry[d + 3] = alpha;
        }
      }
      this.#cache.set(key, entry);
    }
    return entry;
  }

  /**
   * Composites the layers into an `output`-pixel square. `expected` is the prototype's expected icon size (64, or 128 for
   * item groups); layer scale and shift are expressed in a coordinate system that is `expected / 2` units wide.
   * Returns straight RGBA8 { width, height, data }.
   */
  render(layers, { expected = 64, output = 64 } = {}) {
    const units = expected / 2;
    const placed = layers.map((layer) => {
      const extent = layer.size * (layer.scale ?? units / layer.size);
      const [sx, sy] = layer.shift ?? [0, 0];
      return { layer, extent, sx, sy, reach: layer.floating ? 0 : Math.max(Math.abs(sx), Math.abs(sy)) + extent / 2 };
    });
    // The GUI shrinks the whole icon when a non-floating layer would leave the slot.
    const fit = Math.min(1, units / 2 / Math.max(...placed.map((p) => p.reach), units / 2));
    const pixelsPerUnit = (output / units) * fit;
    const canvas = new Float64Array(output * output * 4);
    for (const { layer, extent, sx, sy } of placed) {
      const dest = Math.max(1, Math.round(extent * pixelsPerUnit));
      const pixels = resample(this.#source(layer.icon, layer.size), layer.size, dest);
      const left = Math.round(output / 2 + sx * pixelsPerUnit - dest / 2), top = Math.round(output / 2 + sy * pixelsPerUnit - dest / 2);
      const tint = layer.tint ?? [1, 1, 1, 1];
      for (let y = Math.max(0, -top); y < Math.min(dest, output - top); y++) {
        for (let x = Math.max(0, -left); x < Math.min(dest, output - left); x++) {
          const s = (y * dest + x) * 4, d = ((y + top) * output + x + left) * 4;
          // Tints multiply the premultiplied texel channel-wise, so a tint's alpha only scales coverage.
          const alpha = pixels[s + 3] * tint[3];
          for (let c = 0; c < 3; c++) canvas[d + c] = pixels[s + c] * tint[c] + canvas[d + c] * (1 - alpha);
          canvas[d + 3] = alpha + canvas[d + 3] * (1 - alpha);
        }
      }
    }
    const data = Buffer.alloc(output * output * 4);
    for (let i = 0; i < output * output; i++) {
      const alpha = Math.min(1, canvas[i * 4 + 3]);
      for (let c = 0; c < 3; c++) data[i * 4 + c] = alpha > 0 ? Math.round(Math.min(1, canvas[i * 4 + c] / alpha) * 255) : 0;
      data[i * 4 + 3] = Math.round(alpha * 255);
    }
    return { width: output, height: output, data };
  }

  renderPng(layers, options) {
    return encodePng(this.render(layers, options));
  }
}

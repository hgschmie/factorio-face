// The image shown for an icon the catalog knows but the installation in use cannot provide, for example an icon of a module
// that is not installed. Drawn here, so it contains no artwork of the game: a neutral gray tile with a lighter outline.
import { DEFAULT_ICON_SIZE } from "@face/catalog/icons";
import { encodePng } from "./png.ts";

const FILL = [65, 65, 65, 150] as const;
const OUTLINE = [142, 142, 142, 190] as const;
const MARGIN = 8;
const RADIUS = 9;
const LINE = 2;

let cached: Uint8Array | undefined;

/** True when the pixel centre lies in the square inset by `inset` on every side, with corners rounded by `radius`. */
function inRoundedSquare(x: number, y: number, inset: number, radius: number): boolean {
  const low = inset + radius, high = DEFAULT_ICON_SIZE - inset - radius;
  const dx = Math.max(low - (x + 0.5), 0, x + 0.5 - high), dy = Math.max(low - (y + 0.5), 0, y + 0.5 - high);
  return dx * dx + dy * dy <= radius * radius;
}

/** The placeholder as PNG bytes, in the size of a rendered icon. The result is shared; treat it as immutable. */
export function placeholderIcon(): Uint8Array {
  if (cached) return cached;
  const size = DEFAULT_ICON_SIZE;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!inRoundedSquare(x, y, MARGIN, RADIUS)) continue;
      data.set(inRoundedSquare(x, y, MARGIN + LINE, RADIUS - LINE) ? FILL : OUTLINE, (y * size + x) * 4);
    }
  }
  cached = encodePng({ width: size, height: size, data });
  return cached;
}

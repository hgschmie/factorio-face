// What a prototype of the game's data dump says about its icon, normalised into the layers of the icon table. Pure, and
// free of syntax that Node's type stripping cannot run: build.mjs imports this file as it is.
import { DEFAULT_ICON_SIZE, type IconLayer } from "@face/catalog/icons";

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

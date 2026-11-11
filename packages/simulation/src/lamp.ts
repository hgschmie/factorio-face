import { signal, type Lamp, type RgbColor, type SignalId } from "@face/model";
import { AGGREGATE, UNBOUND, conditionHolds, planCondition, type ConditionPlan } from "./decider.ts";
import { RULES } from "./rules.ts";
import { selectionOf, type InputView, type SignalMap, type SignalTable } from "./signals.ts";
import type { LampState } from "./types.ts";

/**
 * Color mapping table of the lamp prototype (`signal_to_color_mapping`), scaled to 0..255; grey 0.5 rounds to 128.
 * L-PRIORITY (F-22): the first entry with a value greater than 0 wins.
 */
export const MAPPING_COLORS: readonly (readonly [name: string, color: RgbColor])[] = [
  ["signal-red", { r: 255, g: 0, b: 0 }],
  ["signal-green", { r: 0, g: 255, b: 0 }],
  ["signal-blue", { r: 0, g: 0, b: 255 }],
  ["signal-yellow", { r: 255, g: 255, b: 0 }],
  ["signal-pink", { r: 255, g: 0, b: 255 }],
  ["signal-cyan", { r: 0, g: 255, b: 255 }],
  ["signal-white", { r: 255, g: 255, b: 255 }],
  ["signal-grey", { r: 128, g: 128, b: 128 }],
  ["signal-black", { r: 0, g: 0, b: 0 }],
];

/** Prototype defaults used when a lamp leaves a color signal slot unset. */
export const DEFAULT_COLOR_SIGNALS = {
  red: signal("virtual", "signal-red"),
  green: signal("virtual", "signal-green"),
  blue: signal("virtual", "signal-blue"),
  rgb: signal("virtual", "signal-white"),
} as const;

/** L-CLAMP (F-22): components outside 0..255 are clamped. */
export function colorComponent(value: number): number {
  return Math.min(255, Math.max(0, value));
}

/** L-PACKED (F-22): 0xRRGGBB in the low 24 bits; higher bits (including the sign) are ignored. */
export function unpackRgb(value: number): RgbColor {
  return { r: (value >>> 16) & 255, g: (value >>> 8) & 255, b: value & 255 };
}

export interface LampPlan {
  /** `wired`: the lamp has at least one circuit wire. */
  evaluate(input: InputView, wired: boolean): LampState;
}

const OFF: LampState = Object.freeze({ lit: false });
export const DARK_LAMP: LampPlan = { evaluate: () => OFF };

function sameColor(a: RgbColor | undefined, b: RgbColor | undefined): boolean {
  return a === b || (!!a && !!b && a.r === b.r && a.g === b.g && a.b === b.b);
}

/** Assumes a statically valid entity (see validate.ts). */
export function planLamp(entity: Lamp, signals: SignalTable): LampPlan {
  const selection = selectionOf(entity.inputNetworks);
  // The shared condition evaluator reads through an InputView; the lamp's single selection applies to both operands.
  const condition: ConditionPlan | undefined =
    entity.condition &&
    planCondition(
      {
        first: entity.condition.first,
        firstNetworks: entity.inputNetworks,
        comparator: entity.condition.comparator,
        second: entity.condition.second.type === "signal" ? { ...entity.condition.second, networks: entity.inputNetworks } : entity.condition.second,
      },
      signals,
    );
  const fixed = entity.color && Object.freeze({ r: entity.color.r, g: entity.color.g, b: entity.color.b });
  const intern = (id: SignalId | undefined, fallback: SignalId): number => signals.intern(id ?? fallback);
  const mapping = MAPPING_COLORS.map(([name, color]) => ({ signal: signals.intern(signal("virtual", name)), color: Object.freeze(color) }));
  const red = intern(entity.redSignal, DEFAULT_COLOR_SIGNALS.red);
  const green = intern(entity.greenSignal, DEFAULT_COLOR_SIGNALS.green);
  const blue = intern(entity.blueSignal, DEFAULT_COLOR_SIGNALS.blue);
  const rgb = intern(entity.rgbSignal, DEFAULT_COLOR_SIGNALS.rgb);

  /** L-NOCOLOR (F-22): undefined (no color signal present) falls back to the static color. */
  const signalColor = (view: SignalMap): RgbColor | undefined => {
    if (entity.colorMode === "mapping") return mapping.find((m) => (view.get(m.signal) ?? 0) > 0)?.color;
    if (entity.colorMode === "components") {
      const r = view.get(red) ?? 0;
      const g = view.get(green) ?? 0;
      const b = view.get(blue) ?? 0;
      return r === 0 && g === 0 && b === 0 ? undefined : { r: colorComponent(r), g: colorComponent(g), b: colorComponent(b) };
    }
    const packed = view.get(rgb) ?? 0;
    return packed === 0 ? undefined : unpackRgb(packed);
  };

  let last: LampState = OFF;
  return {
    evaluate(input, wired) {
      // L-ENABLE (F-21): a wired lamp with an enable condition follows the condition only; otherwise it is lit when always-on.
      const controlled = condition !== undefined && (wired || !RULES.lampConditionNeedsWire);
      const lit = controlled ? conditionHolds(condition, input, UNBOUND, AGGREGATE) : entity.alwaysOn;
      if (!lit) return (last = OFF);
      // L-SCOPE (F-22): the input network selection scopes the color signals as well as the condition.
      const color = (entity.useColors && wired ? signalColor(input.select(selection)) : undefined) ?? fixed;
      if (!last.lit || !sameColor(last.color, color)) last = Object.freeze(color ? { lit: true, color: Object.freeze(color) } : { lit: true });
      return last;
    },
  };
}

import { wildcardOf, type SelectorCombinator, type SelectorMode, type SignalId } from "@face/model";
import { COMPARE, toInt32 } from "./int32.ts";
import { SILENT, type Evaluator, type PlanContext } from "./plan.ts";
import { RULES } from "./rules.ts";
import { Accumulator, EMPTY, type SignalMap } from "./signals.ts";
import type { NoteCode } from "./types.ts";

type Mode<K extends SelectorMode["operation"]> = Extract<SelectorMode, { operation: K }>;

/** Assumes a statically valid entity (see validate.ts). The input is always the red + green sum: the selector has no network selection. */
export function planSelector(entity: SelectorCombinator, ctx: PlanContext): Evaluator {
  const mode = entity.mode;
  switch (mode.operation) {
    case "select":
      return planSelect(mode, ctx);
    case "count":
      return planCount(mode, ctx);
    case "random":
      return planRandom(mode, entity.id, ctx);
    case "stack-size":
      return planLookup(ctx, (id) => ctx.env.stackSize(id), "missing-stack-size", "stack size");
    case "rocket-capacity":
      return planLookup(ctx, (id) => ctx.env.rocketCapacity(id), "missing-rocket-capacity", "rocket capacity");
    case "quality-filter":
      return planQualityFilter(mode, ctx);
    case "quality-select":
      return planQualitySelect(mode, ctx);
    case "quality-transfer":
      return planQualityTransfer(mode, ctx);
    case "time":
      return planTime(mode, ctx);
  }
}

function planSelect(mode: Mode<"select">, { signals }: PlanContext): Evaluator {
  const indexSignal = mode.index.type === "signal" ? signals.intern(mode.index.signal) : -1;
  const indexConstant = mode.index.type === "constant" ? toInt32(mode.index.value) : 0;
  const compare = COMPARE[mode.indexComparator];
  const exact = mode.indexComparator === "=";
  const direction = mode.max ? -1 : 1;
  return {
    evaluate(input) {
      const all = input.both;
      if (all.size === 0) return EMPTY;
      const index = indexSignal < 0 ? indexConstant : (all.get(indexSignal) ?? 0);
      let entries = [...all];
      if (indexSignal >= 0 && !RULES.selectIndexSignalIsSorted) entries = entries.filter(([s]) => s !== indexSignal);
      if (exact && entries.length === 1 && RULES.selectSingleInputPassesThrough) return new Map(entries);
      // S-ORDER (F-16): signed values; equal values keep signal order in both sort directions.
      entries.sort((a, b) => (a[1] - b[1]) * direction || signals.rank(a[0]) - signals.rank(b[0]));
      if (exact) {
        const hit = entries[index];
        return hit ? new Map([hit]) : EMPTY;
      }
      // S-RANGE (F-16): every zero-based sorted position p with `p <comparator> index`.
      const selected = entries.filter((_, position) => compare(position, index));
      return selected.length > 0 ? new Map(selected) : EMPTY;
    },
  };
}

function planCount(mode: Mode<"count">, { signals }: PlanContext): Evaluator {
  if (!mode.output) return SILENT;
  const output = signals.intern(mode.output);
  return { evaluate: (input) => (input.both.size > 0 ? new Map([[output, input.both.size]]) : EMPTY) };
}

/** mulberry32: small, fast, deterministic. Not the game's generator; sequences cannot match the game. */
export function createRandom(seed: number): { next(): number; reset(): void } {
  let state = seed | 0;
  return {
    next() {
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    reset() {
      state = seed | 0;
    },
  };
}

/** Per-entity seed (FNV-1a over the entity id), so that results do not depend on entity order. */
export function entitySeed(seed: number, entityId: string): number {
  let hash = (2166136261 ^ seed) | 0;
  for (let i = 0; i < entityId.length; i++) hash = Math.imul(hash ^ entityId.charCodeAt(i), 16777619);
  return hash;
}

/**
 * S-RANDOM (F-19): a new signal is drawn uniformly from the input (in signal order) at every simulation tick divisible by the
 * interval; intervals 0 and 1 draw every tick. Between draws the chosen signal passes with its current value, and nothing
 * passes while it is absent from the input.
 */
function planRandom(mode: Mode<"random">, entityId: string, { signals, seed }: PlanContext): Evaluator {
  const interval = Math.max(1, Math.trunc(mode.interval) || 1);
  const random = createRandom(entitySeed(seed, entityId));
  let selected = -1;
  return {
    volatile: true,
    evaluate(input, tick) {
      const all = input.both;
      if (tick % interval === 0) {
        const candidates = all.size > 0 ? signals.sorted(all) : [];
        selected = candidates.length > 0 ? candidates[Math.floor(random.next() * candidates.length)]! : -1;
      }
      const value = selected >= 0 ? all.get(selected) : undefined;
      return value === undefined ? EMPTY : new Map([[selected, value]]);
    },
    reset() {
      random.reset();
      selected = -1;
    },
  };
}

/**
 * S-LOOKUP (F-17): stack-size and rocket-capacity ignore input values and emit the environment's number on the same signal
 * (quality kept). The environment alone decides which signals have a value; for the others nothing is emitted and a runtime
 * note is raised: a warning for an item (a gap in the game data), an info for other kinds (fluids, virtual signals).
 */
function planLookup(ctx: PlanContext, lookup: (id: SignalId) => number | undefined, code: NoteCode, label: string): Evaluator {
  const { signals } = ctx;
  const cache = new Map<number, number | undefined>();
  const noted = new Set<number>();
  return {
    evaluate(input) {
      const all = input.both;
      if (all.size === 0) return EMPTY;
      const result = new Map<number, number>();
      for (const s of all.keys()) {
        const id = signals.ids[s]!;
        if (!cache.has(s)) cache.set(s, lookup(id));
        const found = cache.get(s);
        if (found === undefined) {
          if (!noted.has(s)) ctx.note(id.kind === "item" ? "warning" : "info", code, `The environment has no ${label} for ${signals.keys[s]}; nothing is emitted for it.`, s);
          noted.add(s);
        } else if (toInt32(found) !== 0) result.set(s, toInt32(found));
      }
      return result.size > 0 ? result : EMPTY;
    },
    reset: () => noted.clear(),
  };
}

function unknownQuality(ctx: PlanContext, noted: Set<number>, s: number): void {
  if (!noted.has(s)) ctx.note("warning", "unknown-quality", `The environment does not know the quality of ${ctx.signals.keys[s]}; the signal is dropped.`, s);
  noted.add(s);
}

/** S-QFILTER (F-18): compares quality levels; without a quality ("any quality") every input passes. */
function planQualityFilter(mode: Mode<"quality-filter">, ctx: PlanContext): Evaluator {
  const level = mode.quality === undefined ? undefined : ctx.env.qualities.find((q) => q.name === mode.quality)?.level;
  if (level === undefined) return mode.quality === undefined ? { evaluate: (input) => input.both } : SILENT;
  const compare = COMPARE[mode.comparator ?? "="];
  const noted = new Set<number>();
  return {
    evaluate(input) {
      const result = new Map<number, number>();
      for (const [s, value] of input.both) {
        const own = ctx.levelOf(s);
        if (own === undefined) unknownQuality(ctx, noted, s);
        else if (compare(own, level)) result.set(s, value);
      }
      return result.size > 0 ? result : EMPTY;
    },
    reset: () => noted.clear(),
  };
}

/** S-QSELECT (F-18): per prototype (kind, name) only the highest or lowest quality level passes, with its value. */
function planQualitySelect(mode: Mode<"quality-select">, ctx: PlanContext): Evaluator {
  const { signals } = ctx;
  const noted = new Set<number>();
  const better = (s: number, level: number, other: number): boolean => {
    const otherLevel = ctx.levelOf(other)!;
    return level === otherLevel ? signals.rank(s) < signals.rank(other) : mode.highest ? level > otherLevel : level < otherLevel;
  };
  return {
    evaluate(input) {
      const all = input.both;
      if (all.size === 0) return EMPTY;
      const best = new Map<number, number>();
      for (const s of all.keys()) {
        const level = ctx.levelOf(s);
        if (level === undefined) {
          unknownQuality(ctx, noted, s);
          continue;
        }
        const prototype = signals.withQuality(s, undefined);
        const current = best.get(prototype);
        if (current === undefined || better(s, level, current)) best.set(prototype, s);
      }
      if (best.size === 0) return EMPTY;
      const result = new Map<number, number>();
      for (const s of best.values()) result.set(s, all.get(s)!);
      return result;
    },
    reset: () => noted.clear(),
  };
}

/**
 * S-QTRANSFER (F-18): the target signal is read exactly as configured and re-emitted with the chosen quality and its value.
 * From-signal mode takes the highest quality level at which the source prototype is present on the input.
 * An each target re-labels every input signal; signals that collapse onto the same identity add up.
 */
function planQualityTransfer(mode: Mode<"quality-transfer">, ctx: PlanContext): Evaluator {
  const { signals } = ctx;
  if (!mode.destination || (mode.source.type === "signal" && !mode.source.signal)) return SILENT;
  const each = wildcardOf(mode.destination) === "each";
  const destination = each ? -1 : signals.intern(mode.destination);
  const fixed = mode.source.type === "quality" ? mode.source.quality : undefined;
  const source = mode.source.type === "signal" ? signals.withQuality(signals.intern(mode.source.signal!), undefined) : -1;
  const variants = [...ctx.env.qualities].sort((a, b) => b.level - a.level).map((q) => ({ quality: q.name, signal: source < 0 ? -1 : signals.withQuality(source, q.name) }));
  const sourceQuality = (all: SignalMap): string | undefined => variants.find((v) => all.has(v.signal))?.quality;
  return {
    evaluate(input) {
      const all = input.both;
      if (all.size === 0) return EMPTY;
      const quality = fixed ?? sourceQuality(all);
      if (quality === undefined) return EMPTY;
      if (!each) {
        const value = all.get(destination);
        return value === undefined ? EMPTY : new Map([[signals.withQuality(destination, quality), value]]);
      }
      const result = new Accumulator();
      for (const [s, value] of all) result.add(signals.withQuality(s, quality), value);
      return result.result();
    },
  };
}

/**
 * S-TIME (F-19): the game tick is `startTick + tick` of the tick at which the selector evaluates (so it shows on the network one
 * tick later, like every combinator output), wrapped to int32; the day tick is the unwrapped game tick modulo the day length.
 * Unset signal slots emit nothing; slots sharing a signal add up.
 */
function planTime(mode: Mode<"time">, { signals, env }: PlanContext): Evaluator {
  const slots = [mode.gameTick, mode.dayTick, mode.dayLength].map((id) => (id ? signals.intern(id) : -1));
  if (slots.every((s) => s < 0)) return SILENT;
  const { startTick, dayLength } = env.time;
  return {
    volatile: true,
    evaluate(_input, tick) {
      const game = startTick + tick;
      const values = [toInt32(game), dayLength > 0 ? ((game % dayLength) + dayLength) % dayLength : 0, toInt32(dayLength)];
      const result = new Accumulator();
      slots.forEach((s, i) => s >= 0 && result.add(s, values[i]!));
      return result.result();
    },
  };
}

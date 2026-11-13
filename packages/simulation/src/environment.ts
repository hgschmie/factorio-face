// Everything the engine needs from game data. The catalog package is not imported; an adapter builds this from it.

import { NORMAL_QUALITY, type SignalId, type SpeakerInstrument } from "@face/model";

export interface QualityLevel {
  readonly name: string;
  /** Factorio quality level; comparisons between qualities compare this number (legendary is 5, not 4). */
  readonly level: number;
}

export interface TimeParameters {
  /** Ticks per day as reported by the selector's time mode. */
  readonly dayLength: number;
  /** Game tick that corresponds to simulation tick 0. */
  readonly startTick: number;
}

export interface SimulationEnvironment {
  /**
   * Total, deterministic order of signals ("signal order" of anything outputs and selector ties). Must be a consistent comparator;
   * the engine breaks remaining ties by signal key, so a partial order is tolerated.
   */
  compareSignals(a: SignalId, b: SignalId): number;
  /** Stack size of an item signal; undefined when unknown or not an item (nothing is emitted, reported as a runtime note). */
  stackSize(signal: SignalId): number | undefined;
  /**
   * Items per rocket (rocket lift weight / item weight, both in the catalog). Undefined for non-items and unknown items
   * (nothing is emitted, reported as a runtime note); 0 for an item that cannot be launched. The result is wrapped to int32.
   */
  rocketCapacity(signal: SignalId): number | undefined;
  readonly qualities: readonly QualityLevel[];
  readonly time: TimeParameters;
  /** The instruments of the game's speaker with their notes, in the game's order; empty when unknown (a pitch signal then picks nothing). */
  readonly instruments: readonly SpeakerInstrument[];
}

/** Plain-data description of an environment, also used by conformance fixtures. Table keys are signal keys without quality. */
export interface EnvironmentData {
  /** Signal keys without quality, lowest first. Unlisted signals follow, ordered by key. Quality variants order by level. */
  readonly signalOrder?: readonly string[];
  readonly stackSizes?: Readonly<Record<string, number>>;
  readonly rocketCapacities?: Readonly<Record<string, number>>;
  readonly qualities?: readonly QualityLevel[];
  readonly time?: Partial<TimeParameters>;
  readonly instruments?: readonly SpeakerInstrument[];
}

export const DEFAULT_QUALITIES: readonly QualityLevel[] = [
  { name: "normal", level: 0 },
  { name: "uncommon", level: 1 },
  { name: "rare", level: 2 },
  { name: "epic", level: 3 },
  { name: "legendary", level: 5 },
];

export const DEFAULT_TIME: TimeParameters = { dayLength: 25000, startTick: 0 };

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function qualityLevels(qualities: readonly QualityLevel[]): ReadonlyMap<string, number> {
  return new Map(qualities.map((q) => [q.name, q.level]));
}

export function createEnvironment(data: EnvironmentData = {}): SimulationEnvironment {
  const qualities = data.qualities ?? DEFAULT_QUALITIES;
  const levels = qualityLevels(qualities);
  const position = new Map((data.signalOrder ?? []).map((key, index) => [key, index]));
  const stackSizes = new Map(Object.entries(data.stackSizes ?? {}));
  const rocketCapacities = new Map(Object.entries(data.rocketCapacities ?? {}));
  const baseKey = (id: SignalId): string => `${id.kind}:${id.name}`;
  const level = (id: SignalId): number => levels.get(id.quality ?? NORMAL_QUALITY) ?? Number.MAX_SAFE_INTEGER;
  return {
    compareSignals(a, b) {
      const ka = baseKey(a);
      const kb = baseKey(b);
      const pa = position.get(ka) ?? Number.MAX_SAFE_INTEGER;
      const pb = position.get(kb) ?? Number.MAX_SAFE_INTEGER;
      return pa - pb || compareText(ka, kb) || level(a) - level(b) || compareText(a.quality ?? NORMAL_QUALITY, b.quality ?? NORMAL_QUALITY);
    },
    stackSize: (id) => (id.kind === "item" ? stackSizes.get(baseKey(id)) : undefined),
    rocketCapacity: (id) => (id.kind === "item" ? rocketCapacities.get(baseKey(id)) : undefined),
    qualities,
    time: { ...DEFAULT_TIME, ...data.time },
    instruments: data.instruments ?? [],
  };
}

/** Orders signals by key (quality variants by level), knows no stack sizes, rocket capacities or speaker instruments, and uses the standard five qualities. */
export const defaultEnvironment: SimulationEnvironment = createEnvironment();

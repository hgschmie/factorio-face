// Shared pieces of the per-entity evaluators.

import { NORMAL_QUALITY } from "@face/model";
import type { SimulationEnvironment } from "./environment.ts";
import { EMPTY, type InputView, type SignalMap, type SignalTable } from "./signals.ts";
import type { NoteCode, NoteSeverity } from "./types.ts";

/** Computes the next output of one combinator from the content its input terminal sees at the current tick. */
export interface Evaluator {
  /** True if the result depends on more than the input (clock, random state): evaluated every tick. */
  readonly volatile?: boolean;
  evaluate(input: InputView, tick: number): SignalMap;
  /** Restores internal state to tick 0. */
  reset?(): void;
}

export const SILENT: Evaluator = { evaluate: () => EMPTY };

export interface PlanContext {
  readonly signals: SignalTable;
  readonly env: SimulationEnvironment;
  readonly seed: number;
  /** Quality level of an interned signal; undefined if the environment does not know the quality. */
  levelOf(s: number): number | undefined;
  /** Reports a runtime note for the entity being planned; the engine removes duplicates. */
  note(severity: NoteSeverity, code: NoteCode, message: string, s?: number): void;
}

export function levelLookup(signals: SignalTable, levels: ReadonlyMap<string, number>): (s: number) => number | undefined {
  const cache: (number | undefined)[] = [];
  const known: boolean[] = [];
  return (s) => {
    if (!known[s]) {
      cache[s] = levels.get(signals.ids[s]!.quality ?? NORMAL_QUALITY);
      known[s] = true;
    }
    return cache[s];
  };
}

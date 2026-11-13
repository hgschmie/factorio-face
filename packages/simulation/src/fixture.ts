// Conformance fixtures: a circuit, a number of ticks and expectations per tick. The format is documented in CONFORMANCE.md.
// Pure data handling; reading files is left to the caller (test/fixtures.test.ts loads tests/fixtures/conformance/*.json).

import { ENTITY_KINDS, WIRE_COLORS, terminalKey, type Circuit, type EntityId, type RgbColor, type TerminalRef, type WireColor } from "@face/model";
import { compile } from "./compile.ts";
import { createSimulation } from "./engine.ts";
import { createEnvironment, type EnvironmentData } from "./environment.ts";
import type { SignalList, TickSnapshot } from "./types.ts";

export const FIXTURE_FORMAT = 1;
export const FIXTURE_PROVENANCES = ["assumed", "documented", "game"] as const;
export type FixtureProvenance = (typeof FIXTURE_PROVENANCES)[number];

/** Signal key -> value. */
export type FixtureSignals = Readonly<Record<string, number>>;

export interface FixtureNetworkExpectation {
  /** Any member terminal of the network. */
  readonly terminal: TerminalRef;
  readonly color: WireColor;
  readonly signals: FixtureSignals;
}

export interface FixtureLampExpectation {
  readonly lit: boolean;
  /** Omitted: not checked. null: the lamp must show no color (default white light or dark). */
  readonly color?: RgbColor | null;
}

export interface FixtureSpeakerExpectation {
  readonly playing: boolean;
  /** Omitted: not checked. */
  readonly instrument?: string;
  readonly note?: string;
  readonly volume?: number;
  readonly alert?: boolean;
}

export interface FixtureExpectation {
  readonly tick: number;
  /** Inclusive last tick; the expectation holds for every tick from `tick` to `through`. */
  readonly through?: number;
  /** Signals an entity emits on its output terminal. */
  readonly outputs?: Readonly<Record<EntityId, FixtureSignals>>;
  readonly networks?: readonly FixtureNetworkExpectation[];
  readonly lamps?: Readonly<Record<EntityId, FixtureLampExpectation>>;
  readonly speakers?: Readonly<Record<EntityId, FixtureSpeakerExpectation>>;
}

export interface ConformanceFixture {
  readonly format: typeof FIXTURE_FORMAT;
  /** Unique name, by convention the file name without extension. */
  readonly id: string;
  /** Audit fixture ids this file covers, e.g. ["F-03"]. */
  readonly covers: readonly string[];
  readonly title: string;
  /** "game": recorded from the running game. "documented": follows statements with a data, api, changelog or web source. "assumed": engine choice. */
  readonly provenance: FixtureProvenance;
  /** Free text: how the expectation was derived or recorded (game version, scenario, command line). */
  readonly source?: string;
  readonly environment?: EnvironmentData;
  /** Seed for the random selector mode. */
  readonly seed?: number;
  readonly circuit: Circuit;
  /** Ticks to simulate; expectations may refer to ticks 0..ticks. */
  readonly ticks: number;
  /** "exact" (default): the listed signals are the complete content. "listed": only listed signals are checked, 0 means absent. */
  readonly match?: "exact" | "listed";
  readonly expect: readonly FixtureExpectation[];
}

export interface FixtureFailure {
  readonly tick: number;
  readonly target: string;
  readonly message: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Structural problems of a parsed fixture file; empty if it can be run. */
export function validateFixture(value: unknown): string[] {
  if (!isRecord(value)) return ["fixture is not an object"];
  const problems: string[] = [];
  const check = (ok: boolean, message: string): void => void (ok || problems.push(message));
  check(value.format === FIXTURE_FORMAT, `format must be ${FIXTURE_FORMAT}`);
  check(typeof value.id === "string" && value.id.length > 0, "id must be a non-empty string");
  check(typeof value.title === "string", "title must be a string");
  check(Array.isArray(value.covers) && value.covers.every((c) => typeof c === "string"), "covers must be an array of strings");
  check((FIXTURE_PROVENANCES as readonly unknown[]).includes(value.provenance), `provenance must be one of ${FIXTURE_PROVENANCES.join(", ")}`);
  check(Number.isInteger(value.ticks) && (value.ticks as number) >= 0, "ticks must be a non-negative integer");
  check(value.match === undefined || value.match === "exact" || value.match === "listed", 'match must be "exact" or "listed"');
  const circuit = value.circuit;
  if (!isRecord(circuit) || !Array.isArray(circuit.entities) || !Array.isArray(circuit.wires)) problems.push("circuit must have entities and wires");
  else {
    for (const entity of circuit.entities) {
      const ok = isRecord(entity) && typeof entity.id === "string" && (ENTITY_KINDS as readonly unknown[]).includes(entity.kind);
      check(ok, `entity ${JSON.stringify(isRecord(entity) ? entity.id : entity)} needs an id and a known kind`);
    }
    for (const wire of circuit.wires) {
      const ok = isRecord(wire) && (WIRE_COLORS as readonly unknown[]).includes(wire.color) && isRecord(wire.a) && isRecord(wire.b);
      check(ok, `wire ${JSON.stringify(wire)} needs a color and two terminals`);
    }
  }
  if (!Array.isArray(value.expect)) problems.push("expect must be an array");
  else {
    value.expect.forEach((e, n) => {
      const ok = isRecord(e) && Number.isInteger(e.tick) && (e.tick as number) >= 0 && (e.through === undefined || (Number.isInteger(e.through) && (e.through as number) >= (e.tick as number)));
      check(ok, `expect[${n}] needs a tick and, if given, a through >= tick`);
      for (const [id, speaker] of Object.entries(isRecord(e) && isRecord(e.speakers) ? e.speakers : {})) check(isRecord(speaker) && typeof speaker.playing === "boolean", `expect[${n}].speakers.${id} needs playing`);
      if (ok && Number.isInteger(value.ticks)) check(((e.through ?? e.tick) as number) <= (value.ticks as number), `expect[${n}] lies beyond ticks`);
    });
  }
  return problems;
}

function compareSignals(actual: SignalList, expected: FixtureSignals, exact: boolean): string | undefined {
  const found = new Map(actual.map((entry) => [entry.key, entry.value]));
  const differences: string[] = [];
  for (const [key, value] of Object.entries(expected)) {
    if ((found.get(key) ?? 0) !== value) differences.push(`${key}: expected ${value}, got ${found.get(key) ?? 0}`);
    found.delete(key);
  }
  if (exact) for (const [key, value] of found) differences.push(`${key}: unexpected ${value}`);
  return differences.length > 0 ? differences.join("; ") : undefined;
}

function checkTick(fixture: ConformanceFixture, expectation: FixtureExpectation, snapshot: TickSnapshot, networkIds: Readonly<Record<string, { red?: string; green?: string }>>): FixtureFailure[] {
  const failures: FixtureFailure[] = [];
  const exact = fixture.match !== "listed";
  const fail = (target: string, message: string): void => void failures.push({ tick: snapshot.tick, target, message });
  for (const [id, signals] of Object.entries(expectation.outputs ?? {})) {
    const output = snapshot.entities[id]?.output;
    if (!output) fail(`output ${id}`, "no such entity output");
    else {
      const difference = compareSignals(output, signals, exact);
      if (difference) fail(`output ${id}`, difference);
    }
  }
  for (const expected of expectation.networks ?? []) {
    const target = `network ${expected.color} ${terminalKey(expected.terminal)}`;
    const id = networkIds[terminalKey(expected.terminal)]?.[expected.color];
    const network = id === undefined ? undefined : snapshot.networks.find((n) => n.id === id);
    if (!network) fail(target, "the terminal has no network of that color");
    else {
      const difference = compareSignals(network.signals, expected.signals, exact);
      if (difference) fail(target, difference);
    }
  }
  for (const [id, expected] of Object.entries(expectation.lamps ?? {})) {
    const lamp = snapshot.entities[id]?.lamp;
    if (!lamp) fail(`lamp ${id}`, "no such lamp");
    else if (lamp.lit !== expected.lit) fail(`lamp ${id}`, `expected lit ${expected.lit}, got ${lamp.lit}`);
    else if (expected.color !== undefined && JSON.stringify(lamp.color ?? null) !== JSON.stringify(expected.color && { r: expected.color.r, g: expected.color.g, b: expected.color.b })) {
      fail(`lamp ${id}`, `expected color ${JSON.stringify(expected.color)}, got ${JSON.stringify(lamp.color ?? null)}`);
    }
  }
  for (const [id, expected] of Object.entries(expectation.speakers ?? {})) {
    const speaker = snapshot.entities[id]?.speaker;
    if (!speaker) fail(`speaker ${id}`, "no such speaker");
    else {
      for (const field of ["playing", "instrument", "note", "volume", "alert"] as const) {
        if (expected[field] !== undefined && speaker[field] !== expected[field]) fail(`speaker ${id}`, `expected ${field} ${JSON.stringify(expected[field])}, got ${JSON.stringify(speaker[field])}`);
      }
    }
  }
  return failures;
}

/** Runs a fixture from tick 0 to `ticks` and returns every mismatch; an empty array means the engine conforms to it. */
export function runFixture(fixture: ConformanceFixture): FixtureFailure[] {
  const environment = createEnvironment(fixture.environment);
  const compiled = compile(fixture.circuit, environment);
  const simulation = createSimulation(compiled, { environment, seed: fixture.seed });
  const failures: FixtureFailure[] = [];
  for (let tick = 0; tick <= fixture.ticks; tick++) {
    if (tick > 0) simulation.step();
    const active = fixture.expect.filter((e) => e.tick <= tick && tick <= (e.through ?? e.tick));
    if (active.length === 0) continue;
    const snapshot = simulation.snapshot();
    for (const expectation of active) failures.push(...checkTick(fixture, expectation, snapshot, compiled.terminals));
  }
  return failures;
}

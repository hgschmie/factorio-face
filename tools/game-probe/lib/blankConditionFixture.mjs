// Fixture F-29 from what blank-condition.lua records: checked, put in a fixed order, the two ways of building an entity folded
// into one reading where they say the same, and one reading per line. `summarise` says what a case comes to.

// The game writes an empty Lua table as an object.
const list = (value) => (Array.isArray(value) ? value : []);

/** A value with the keys of every object in it sorted: the game's own order is that of a hash table. */
export function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeys(value[key])]));
}

const defined = (record) => Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));

function reading(name, recorded) {
  const { state, built, error } = recorded;
  if (typeof state !== "string" || typeof built !== "string") throw new Error(`${name}: a reading without state or way of building: ${JSON.stringify(recorded)}`);
  if (error !== undefined) return { state, built, error: String(error) };
  const { fulfilled, ...condition } = recorded.condition ?? {};
  const unavailable = list(recorded.unavailable).sort();
  // 0: the game found nothing wrong with the blueprint string. Anything else is part of the reading.
  const importResult = recorded.import_result;
  return defined({
    state,
    built,
    importResult: importResult === 0 ? undefined : importResult,
    wires: recorded.wires,
    signal: recorded.signal,
    controlBehavior: recorded.control_behavior,
    flag: recorded.flag,
    condition: recorded.condition === undefined ? undefined : sortKeys(condition),
    fulfilled,
    disabled: recorded.disabled,
    status: recorded.status,
    active: recorded.active,
    disabledByControlBehavior: recorded.disabled_by_control_behavior,
    itemFrom: recorded.item_from,
    itemTo: recorded.item_to,
    switchOn: recorded.switch_on,
    gateOpened: recorded.gate_opened,
    signalState: recorded.signal_state,
    unavailable: unavailable.length ? unavailable : undefined,
    exported: recorded.exported === undefined ? undefined : recorded.exported === "none" ? null : sortKeys(recorded.exported),
  });
}

/** Readings of one state that say the same become one, `built` naming every way of building it holds for. */
function fold(readings) {
  const folded = [];
  for (const { built, ...rest } of readings) {
    const same = folded.find((other) => JSON.stringify(other.rest) === JSON.stringify(rest));
    if (same) same.built.push(built);
    else folded.push({ built: [built], rest });
  }
  return folded.map(({ built, rest: { state, ...rest } }) => ({ state, built, ...rest }));
}

/**
 * The fixture for a recording `{ game_version, ticks, signal, cases: [{ name, type, kind, flag, readings: [{ state, built, ... } |
 * { state, built, error }] }], deciders: [{ state, conditions, output, signal } | { state, error }] }`; `source` says where the
 * recording is from. A step the game refused keeps its error.
 */
export function buildFixture({ game_version: gameVersion, ticks, signal, cases, deciders }, source) {
  if (!gameVersion || !(ticks > 0) || !Array.isArray(cases) || cases.length === 0) throw new Error("the recording has no game version, no ticks or no cases");
  return {
    format: 1,
    id: "F-29-blank-condition",
    covers: ["F-29"],
    title: "Blank conditions: what an entity does whose circuit condition is in use and has no first signal, next to conditions that hold and that do not",
    provenance: "game",
    source,
    gameVersion,
    layout:
      "cases: per prototype the switch of its condition in a blueprint (flag; a speaker has none) and its readings after `ticks` ticks next to a constant combinator that sends `signal` = 1. " +
      "state: blank (switch on, no condition written), blank-unwired (the same without a wire), true (signal > 0), false (signal < 0), false-unwired (the same without a wire), off (switch off, signal < 0), " +
      "blank-equals-zero (no first signal, = 0: holds if a blank signal reads as 0). built: how the entity was made, from a blueprint string with the entity, the combinator and the wire (blueprint) " +
      "or through the runtime API (api); one reading for both where they say the same. wires: red wires on the entity. signal: what it reads of `signal` on red. controlBehavior: whether it has one. " +
      "flag and condition: as the control behaviour gives them back, fulfilled being the game's `fulfilled` of that condition. disabled: LuaGenericOnOffControlBehavior.disabled. status: LuaEntity.status " +
      "by its name in defines.entity_status. active, disabledByControlBehavior: the attributes of LuaEntity. itemFrom, itemTo: an item on a belt, as its distance to the end of the line when it was put there " +
      "and at the end (0: carried to the end). switchOn: LuaEntity.power_switch_state. gateOpened: is_opened of the gate next to a wall. signalState: LuaEntity.signal_state by name. " +
      "unavailable: reads the entity does not have. exported: its control_behavior in a blueprint the game makes of it, null where it writes none. error: what the game refused. " +
      "deciders: decider combinators that send signal-B = 1 when their conditions hold and signal-C = 1 when they do not, with the conditions as the game gives them back, " +
      "what they read of `signal` on red and what they sent in the last tick; empty has no condition, blank-above-minus-one and blank-below-signal hold if a blank signal reads as 0.",
    ticks,
    signal,
    cases: cases.map(({ name, type, kind, flag, readings }) => {
      if (typeof name !== "string" || typeof kind !== "string" || list(readings).length === 0) throw new Error(`a case without name, kind or readings: ${JSON.stringify(name)}`);
      const states = [...new Set(readings.map((recorded) => recorded.state))];
      const read = readings.map((recorded) => reading(name, recorded));
      return defined({ name, type, kind, flag, readings: states.flatMap((state) => fold(read.filter((one) => one.state === state))) });
    }),
    deciders: list(deciders).map(({ state, error, conditions, output, signal: read }) => {
      if (typeof state !== "string") throw new Error(`a decider combinator without state: ${JSON.stringify(state)}`);
      return error !== undefined ? { state, error: String(error) } : { state, signal: read, conditions: sortKeys(list(conditions)), output: sortKeys(Array.isArray(output) ? {} : output) };
    }),
  };
}

/** What the game refused, as readable lines. */
export function fixtureErrors({ cases, deciders }) {
  const refused = cases.flatMap(({ name, readings }) => readings.filter((one) => one.error !== undefined).map((one) => `${name}, ${one.state} (${one.built.join(", ")}): ${one.error}`));
  return [...refused, ...deciders.filter((one) => one.error !== undefined).map((one) => `decider-combinator, ${one.state}: ${one.error}`)];
}

/** One reading per line: readable, small and the same bytes for the same recording. */
export function serialiseFixture({ cases, deciders, ...head }) {
  const fields = (record, indent) => Object.entries(record).map(([key, value]) => `${indent}${JSON.stringify(key)}: ${JSON.stringify(value)}`);
  const lines = (records, indent) => records.map((record) => `${indent}${JSON.stringify(record)}`).join(",\n");
  const one = ({ readings, ...rest }) => ["    {", [...fields(rest, "      "), '      "readings": ['].join(",\n"), lines(readings, "        "), "      ]", "    }"].join("\n");
  return `{\n${fields(head, "  ").join(",\n")},\n  "cases": [\n${cases.map(one).join(",\n")}\n  ],\n  "deciders": [\n${lines(deciders, "    ")}\n  ]\n}\n`;
}

/**
 * What the condition of an entity switches, as the game shows it: true when the entity is enabled, the gate next to the wall
 * open, the rail signal closed by the circuit; undefined where nothing shows it (a speaker).
 */
export function switched(kind, reading) {
  if (kind === "onoff") return reading.disabled === undefined ? undefined : !reading.disabled;
  if (kind === "wall") return reading.gateOpened;
  if (kind === "signal") return reading.signalState === undefined ? undefined : reading.signalState === "reserved_by_circuit_network";
  return undefined;
}

// The value several readings share, "mixed" when they differ, undefined when none has one.
function shared(values) {
  const found = new Set(values.filter((value) => value !== undefined));
  return found.size > 1 ? "mixed" : [...found][0];
}

/**
 * What a case comes to. Per state `{ fulfilled, switched }` over its readings. `trusted`: the controls read as they must, a
 * condition that holds as fulfilled and switched, one that does not as neither, so that the reading of the blank one means
 * something. `agree`: no state has two readings, which is the blueprint and the runtime API saying the same; undefined when only
 * one of the two could be built (`built`).
 */
export function summarise({ name, kind, readings }) {
  const good = readings.filter((one) => one.error === undefined);
  const of = (state) => {
    const found = good.filter((one) => one.state === state);
    return { fulfilled: shared(found.map((one) => one.fulfilled)), switched: shared(found.map((one) => switched(kind, one))) };
  };
  const holds = (state, expected) => {
    const { fulfilled, switched: effect } = of(state);
    return fulfilled === expected && (effect === expected || effect === undefined);
  };
  const built = ["blueprint", "api"].filter((way) => good.some((one) => one.built.includes(way)));
  const states = [...new Set(good.map((one) => one.state))];
  return {
    name,
    kind,
    built,
    trusted: holds("true", true) && holds("false", false),
    agree: built.length < 2 ? undefined : states.every((state) => good.filter((one) => one.state === state).length === 1),
    blank: of("blank"),
    blankEqualsZero: of("blank-equals-zero"),
    unwired: of("blank-unwired"),
    falseUnwired: of("false-unwired"),
    off: of("off"),
  };
}

const EFFECT = { onoff: ["disabled", "enabled"], wall: ["gate closed", "gate open"], signal: ["signal open", "signal closed"] };

/** One line of the answer for a case: what the game does with the blank condition, wired and not, and with one that does not hold on an entity without a wire. */
export function describeCase(summary) {
  const words = ({ fulfilled, switched: effect }) => {
    const said = [fulfilled === undefined ? undefined : fulfilled === "mixed" ? "fulfilled differs" : fulfilled ? "fulfilled" : "not fulfilled"];
    if (effect !== undefined) said.push(effect === "mixed" ? "effect differs" : EFFECT[summary.kind][Number(effect)]);
    return said.filter(Boolean).join(", ") || "nothing to read";
  };
  const ways = summary.agree === undefined ? `${summary.built.join(", ") || "nothing"} only` : summary.agree ? "blueprint and API agree" : "blueprint and API differ";
  const wired = `wired, blank: ${words(summary.blank)}; wired, blank = 0: ${words(summary.blankEqualsZero)}`;
  const unwired = `unwired, blank: ${words(summary.unwired)}; unwired, false: ${words(summary.falseUnwired)}`;
  return `${summary.name}: ${wired}; ${unwired}; controls ${summary.trusted ? "as expected" : "NOT as expected"}; ${ways}`;
}

// The tests that hold this package against the recording of the game (fixture F-01, tools/game-probe/blueprints.mjs): every
// number, default, direction and shape the package has is compared with what the game itself wrote.
import {
  COMPARATORS, DEFAULT_ENTITY, entityTable, newEntity, PROTOTYPE_NAMES, PROTOTYPES, settingDefault, settingFields, settingSpecsOf, signal,
  type Circuit, type Comparator, type Condition, type Entity, type PrototypeName, type SettingSpec, type SignalId, type StandardSignalKind,
} from "@face/model";
import { describe, expect, it } from "vitest";
import { decodeBlueprintString, DIRECTION_NUMBERS, importBlueprint, LAMP_COLOR_MODE_NUMBERS, CONNECTOR, type BlueprintEntity, type BlueprintWire, type ImportReport } from "../src/index.ts";
import { defineGroup, enumSettings } from "./gameNames.ts";
import { exportedSamples, INSTRUMENTS } from "./samples.ts";

export interface RecordedBlueprint {
  readonly string: string;
  readonly blueprint: { readonly blueprint?: { readonly entities?: readonly BlueprintEntity[]; readonly wires?: readonly BlueprintWire[]; readonly version?: number } };
}

export interface RecordedCase {
  readonly label: string;
  readonly importResult?: number;
  readonly ghosts?: number;
  readonly revived?: number;
  /** Entities of the blueprint that stood there before it was built: the hub of a space platform. */
  readonly standing?: number;
  /** Prototypes of the blueprint the game did not build on the surface of the probe. */
  readonly unbuilt?: readonly string[];
  /** What the probe built besides the circuit when it built it through the runtime API: a gate below every wall. */
  readonly helpers?: readonly string[];
  readonly errors: readonly string[];
  readonly sent: RecordedBlueprint;
  readonly reexported?: RecordedBlueprint;
  readonly rebuilt?: RecordedBlueprint;
  readonly native?: RecordedBlueprint;
}

export type RecordedFresh = RecordedBlueprint | { readonly error: string };

/** Sixteen numbers each, one per direction it was given: the direction that became of it, -1 where the game has no such blueprint or entity. */
export interface RecordedDirections {
  readonly supportsDirection: boolean;
  readonly blueprint: readonly number[];
  readonly built: readonly number[];
  readonly exported: readonly number[];
  readonly created: readonly number[];
}

export interface Recording {
  readonly gameVersion: string;
  readonly errors: readonly string[];
  readonly defines: Readonly<Record<string, Readonly<Record<string, number>>>>;
  readonly fresh: Readonly<Record<"placed" | "withControlBehavior" | "placedOnPlatform" | "withControlBehaviorOnPlatform", RecordedFresh>>;
  /** Entities in a state the editor does not write. */
  readonly states: { readonly constantWithoutSections: RecordedFresh };
  /** Per generic prototype and field of its `control_behavior`: what the control behaviour of a new entity says. */
  readonly defaults: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly directions: Readonly<Record<string, RecordedDirections>>;
  readonly cases: readonly RecordedCase[];
}

/** No item builds these (the chests of the game's editor and of the crash site): the game has them in no blueprint. */
const NO_ITEM: ReadonlySet<string> = new Set(PROTOTYPE_NAMES.filter((name) => entityTable().byName.get(name)!.placedBy.length === 0));
/** Why the game builds a prototype of the samples on no plain ground. */
const NOT_ON_PLAIN_GROUND: Readonly<Record<string, string>> = {
  "asteroid-collector": "stands on a space platform only",
  "electric-mining-drill": "wants ore under it",
  "offshore-pump": "wants water in front of it",
};
/** Settings a prototype has no use for, so that the game has no value for them: a turret without ammunition sends nothing. */
const WITHOUT_USE = ["heat-exchanger.output_networks", "infinity-chest.input_networks", "laser-turret.output_networks", "tesla-turret.output_networks"];

function importOf(recorded: RecordedBlueprint): { circuit: Circuit; report: ImportReport } {
  const result = importBlueprint(recorded.blueprint, { instruments: INSTRUMENTS });
  if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
  return result;
}

/**
 * A circuit without what the game does not keep when it builds a blueprint and makes a new one of it: the order and the numbers
 * of the entities, and where the whole stands. Entities are told apart by their place, wires by the places of their ends.
 * `omit` are prototypes to leave out with their wires: the ones the game did not take or did not build.
 */
export function arrangement(circuit: Circuit, omit: ReadonlySet<string> = new Set()): { entities: unknown[]; wires: string[] } {
  const kept = circuit.entities.filter((entity) => !omit.has(entity.prototype));
  const tiles = kept.map((entity) => entity.placement!.tile!);
  const corner = { x: Math.min(...tiles.map((tile) => tile.x)), y: Math.min(...tiles.map((tile) => tile.y)) };
  const place = (entity: Entity): string => `${entity.placement!.tile!.x - corner.x},${entity.placement!.tile!.y - corner.y}`;
  const places = new Map(kept.map((entity) => [entity.id, place(entity)]));
  const entities = kept
    .map((entity) => {
      // What a generic entity keeps of its blueprint is what the editor does not model; the game adds to it as it likes (a station name).
      const { id: _id, name: _name, position: _position, placement, blueprintData: _kept, ...settings } = entity as Entity & { blueprintData?: string };
      return { place: place(entity), ...(placement?.direction && { direction: placement.direction }), ...(JSON.parse(JSON.stringify(settings)) as object) };
    })
    .sort((a, b) => a.place.localeCompare(b.place));
  const wires = circuit.wires
    .filter((wire) => places.has(wire.a.entity) && places.has(wire.b.entity))
    .map((wire) => `${wire.color} ${[wire.a, wire.b].map((end) => `${places.get(end.entity)}.${end.side}`).sort().join(" ")}`)
    .sort();
  return { entities, wires };
}

/** Every number that is not whole to six digits: the game stores volumes, colors and multipliers as 32-bit floats and may write them as such. */
function rounded<T>(value: T): T {
  if (typeof value === "number") return (Number.isInteger(value) ? value : Number(Math.fround(value).toPrecision(6))) as T;
  if (Array.isArray(value)) return value.map((element: unknown) => rounded(element)) as T;
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(Object.entries(value).map(([key, member]) => [key, rounded(member)])) as T;
}

/**
 * The entities of a blueprint without their numbers, in the order of their places, the whole moved to the origin; and the circuit
 * wires between them by those places. What is left is how each entity and each wire is written, field for field and in the order
 * of the fields. Of a generic entity that is its direction and the fields of its control behaviour that are settings of the
 * editor: every other field is one the editor only keeps, and the game fills those in as it likes (the messages of a display
 * panel, the name of a train stop). `omit` are prototypes to leave out with their wires.
 */
export function shape(recorded: RecordedBlueprint["blueprint"], omit: ReadonlySet<string> = new Set()): { entities: unknown[]; wires: string[] } {
  const entities = (recorded.blueprint?.entities ?? []).filter((entity) => !omit.has(entity.name));
  const corner = { x: Math.min(...entities.map((entity) => entity.position.x)), y: Math.min(...entities.map((entity) => entity.position.y)) };
  const place = (entity: BlueprintEntity): string => `${entity.position.x - corner.x},${entity.position.y - corner.y}`;
  const places = new Map(entities.map((entity) => [entity.entity_number, place(entity)]));
  const circuitWires = (recorded.blueprint?.wires ?? []).filter((wire) => wire[1] < CONNECTOR.poleCopper && wire[3] < CONNECTOR.poleCopper && places.has(wire[0]) && places.has(wire[2]));
  const generic = ({ name, direction, control_behavior: behavior }: BlueprintEntity): object => {
    const modelled = new Set(settingSpecsOf(name).flatMap(settingFields));
    const settings = Object.entries(behavior ?? {}).filter(([field]) => modelled.has(field));
    return { name, ...(direction !== undefined && { direction }), ...(settings.length > 0 && { control_behavior: Object.fromEntries(settings) }) };
  };
  return {
    entities: entities
      .map((entity) => {
        const { entity_number: _number, position: _position, ...rest } = entity;
        return { place: place(entity), ...rounded(PROTOTYPES[entity.name]?.kind === "entity" ? generic(entity) : rest) };
      })
      .sort((a, b) => a.place.localeCompare(b.place)),
    wires: circuitWires.map((wire) => [`${places.get(wire[0])}#${wire[1]}`, `${places.get(wire[2])}#${wire[3]}`].sort().join(" ")).sort(),
  };
}

const toSignal = (id: unknown): SignalId | undefined => {
  const { type = "item", name, quality } = (id ?? {}) as { type?: StandardSignalKind; name?: string; quality?: string };
  return name === undefined ? undefined : signal(type, name, quality);
};
const SIGNS: Readonly<Record<string, Comparator>> = { "≠": "!=", "≤": "<=", "≥": ">=", ...Object.fromEntries(COMPARATORS.map((comparator) => [comparator, comparator])) };

/** A CircuitCondition of the runtime API as a condition of the editor; undefined for a blank one. */
function toCondition(value: unknown): Condition | undefined {
  const { first_signal: first, second_signal: second, constant = 0, comparator = "<" } = (value ?? {}) as { first_signal?: unknown; second_signal?: unknown; constant?: number; comparator?: string };
  const [left, right] = [toSignal(first), toSignal(second)];
  return left && { first: left, comparator: SIGNS[comparator]!, second: right ? { type: "signal", signal: right } : { type: "constant", value: constant } };
}

/** What the control behaviour of a new entity says for a setting, in the terms of the settings table; `absent` where the game has no value. */
function gameDefault(spec: SettingSpec, values: Readonly<Record<string, unknown>>): unknown {
  const value = values[spec.field];
  switch (spec.type) {
    case "boolean": return value;
    case "signal": return toSignal(value);
    case "networks": return value;
    case "condition": return { inUse: values[spec.flag], condition: toCondition(value) };
    case "enum": return spec.flag && values[spec.flag.field] === false ? spec.flag.off : (spec.values.find((entry) => entry.value === value)?.word ?? `no word for ${String(value)}`);
  }
}

/** The same for the settings table: what the editor takes for a setting that is not said. */
function tableDefault(spec: SettingSpec, prototype: PrototypeName): unknown {
  const fallback = settingDefault(spec, entityTable().byName.get(prototype)!);
  return spec.type === "condition" ? { inUse: spec.flagOnByDefault ?? false, condition: spec.gameDefault } : fallback;
}

/** What the entity table says becomes of each of the sixteen directions for a prototype that is built in `count` of them. */
function directionsOf(count: number): number[] {
  const step = 16 / Math.max(count, 4);
  return Array.from({ length: 16 }, (_, direction) => (count === 1 ? 0 : (Math.floor(direction / step) * step) % (count === 2 ? 8 : 16)));
}

const QUIET = { dropped: [], settings: [], warnings: [] };

/** The entity of the editor for a prototype as the game places it: the defaults of its kind. */
function freshEntity(prototype: PrototypeName): object {
  return JSON.parse(JSON.stringify(newEntity(prototype))) as object;
}

/** Defines the tests for a recording inside the current `describe`. */
export function recordingTests(recording: Recording): void {
  const freshBlueprints = (variant: "placed" | "withControlBehavior"): RecordedFresh[] => [recording.fresh[variant], recording.fresh[`${variant}OnPlatform`]];
  const blueprints = (): RecordedBlueprint[] => [
    ...[...Object.values(recording.fresh), ...Object.values(recording.states)].filter((fresh): fresh is RecordedBlueprint => "string" in fresh),
    ...recording.cases.flatMap((entry) => [entry.sent, entry.reexported, entry.rebuilt, entry.native].filter((recorded): recorded is RecordedBlueprint => recorded !== undefined)),
  ];
  const current = new Map(exportedSamples().map((sample) => [sample.label, sample.data]));
  const generic = PROTOTYPE_NAMES.filter((name) => PROTOTYPES[name]!.kind === "entity");

  it("was recorded without anything the game could not do", () => {
    expect(recording.errors).toEqual([]);
  });

  it("is of the samples as they are now: a sample that changed is recorded again with `make probe-blueprints`", () => {
    expect(recording.cases.map((entry) => [entry.label, entry.sent.blueprint])).toEqual([...current].map(([label, data]) => [label, data]));
  });

  it("has the numbers behind the defines that the exporter writes (F-02)", () => {
    const { direction, wire_connector_id: connector, lamp_color_mode: colorMode } = recording.defines;
    expect({ north: direction!.north, east: direction!.east, south: direction!.south, west: direction!.west }).toEqual(DIRECTION_NUMBERS);
    expect(connector).toMatchObject({
      circuit_red: CONNECTOR.red, circuit_green: CONNECTOR.green, combinator_input_red: CONNECTOR.red, combinator_input_green: CONNECTOR.green, combinator_output_red: CONNECTOR.outputRed,
      combinator_output_green: CONNECTOR.outputGreen, pole_copper: CONNECTOR.poleCopper, power_switch_right_copper: CONNECTOR.switchRightCopper,
    });
    expect({ mapping: colorMode!.color_mapping, components: colorMode!.components, "packed-rgb": colorMode!.packed_rgb }).toEqual(LAMP_COLOR_MODE_NUMBERS);
  });

  it("has the numbers the settings table gives the modes of the generic entities (F-02)", () => {
    for (const { key, spec, define } of enumSettings()) {
      if (!define) throw new Error(`no define for ${key}`);
      const numbers = recording.defines[defineGroup(define)];
      expect(numbers, defineGroup(define)).toBeDefined();
      const valued = spec.values.filter((entry) => entry.value !== undefined);
      expect(Object.fromEntries(valued.map((entry) => [entry.word, numbers![define.members[entry.word]!]])), key).toEqual(Object.fromEntries(valued.map((entry) => [entry.word, entry.value])));
      // No number of the game is without a word.
      expect(Object.keys(numbers!), key).toHaveLength(valued.length);
    }
  });

  it("has the defaults of the settings table in the control behaviour of every new generic entity", () => {
    const differing: string[] = [];
    const withoutUse: string[] = [];
    for (const prototype of generic) {
      const specs = settingSpecsOf(prototype);
      const values = recording.defaults[prototype];
      if (specs.length === 0) continue;
      if (!values) throw new Error(`the game recorded no defaults for ${prototype}`);
      for (const spec of specs) {
        const [game, table] = [JSON.stringify(gameDefault(spec, values)), JSON.stringify(tableDefault(spec, prototype))];
        if (spec.type === "networks" && values[spec.field] === undefined) withoutUse.push(`${prototype}.${spec.field}`);
        else if (game !== table) differing.push(`${prototype}.${spec.key}: the game has ${game}, the table ${table}`);
      }
    }
    expect(differing).toEqual([]);
    expect(withoutUse).toEqual(WITHOUT_USE);
  });

  it("turns every prototype as the entity table says: what becomes of each of the sixteen directions in a blueprint of the game", () => {
    const differing: string[] = [];
    const never: string[] = [];
    for (const prototype of PROTOTYPE_NAMES) {
      const turns = recording.directions[prototype];
      const game = entityTable().byName.get(prototype)!;
      // The hub of a space platform stands on its platform only, where the probe does not turn it.
      if (!turns) never.push(prototype);
      else if (turns.blueprint.every((direction) => direction === -1)) expect(NO_ITEM.has(prototype), prototype).toBe(true);
      else {
        // A crafting machine has a direction only while its recipe uses its fluid boxes; the probe gives it no recipe, and it faces north.
        const idle = (game.type === "assembling-machine" || game.type === "furnace") && turns.blueprint.every((direction) => direction === 0);
        const expected = directionsOf(game.directions).join();
        if (!idle && turns.blueprint.join() !== expected) differing.push(`${prototype}: ${turns.blueprint.join()}, by the table (${game.directions}) ${expected}`);
        // What the game writes for an entity it built is what the blueprint it was built from said.
        expect(turns.exported.filter((direction) => direction !== -1).join(), prototype).toBe(turns.blueprint.filter((_, index) => turns.exported[index] !== -1).join());
      }
    }
    expect(differing).toEqual([]);
    expect(never).toEqual(["space-platform-hub"]);
  });

  it("decodes every blueprint string of the game to the JSON it holds", () => {
    expect(blueprints().length).toBeGreaterThan(0);
    for (const recorded of blueprints()) expect(decodeBlueprintString(recorded.string)).toEqual({ ok: true, data: recorded.blueprint });
  });

  describe.each(["placed", "withControlBehavior"] as const)("an entity as the game places it (%s)", (variant) => {
    it("was exported by the game, on plain ground and on a space platform", () => {
      for (const fresh of freshBlueprints(variant)) expect(fresh).not.toHaveProperty("error");
    });

    it("is the default of the editor for its kind, and nothing about it is unknown to the importer", () => {
      const prototypes: PrototypeName[] = [];
      for (const fresh of freshBlueprints(variant)) {
        if (!("string" in fresh)) throw new Error(fresh.error);
        const { circuit, report } = importOf(fresh);
        expect(report).toMatchObject(QUIET);
        // What a generic entity keeps of its blueprint is not a setting of the editor (a train stop has a name, a chest a bar).
        const defaults = circuit.entities.map((entity) => {
          const { id: _id, name: _name, position: _position, placement: _placement, blueprintData: _kept, ...settings } = entity as Entity & { blueprintData?: string };
          return [settings.prototype, JSON.parse(JSON.stringify(settings))];
        });
        const placed = (fresh.blueprint.blueprint?.entities ?? []).map((entity) => entity.name as PrototypeName);
        expect(defaults).toEqual(placed.map((prototype) => [prototype, freshEntity(prototype)]));
        // No entity as it is placed has a direction.
        expect((fresh.blueprint.blueprint?.entities ?? []).filter((entity) => entity.direction !== undefined)).toEqual([]);
        prototypes.push(...placed);
      }
      // Every prototype of the editor but the ones no item builds, which the game has in no blueprint.
      expect(PROTOTYPE_NAMES.filter((name) => !prototypes.includes(name))).toEqual([...NO_ITEM].sort());
      expect(prototypes).toHaveLength(PROTOTYPE_NAMES.length - NO_ITEM.size);
    });
  });

  it("reads a constant combinator all of whose sections were removed, which the game writes as no sections at all, as one without sections", () => {
    const recorded = recording.states.constantWithoutSections;
    if (!("string" in recorded)) throw new Error(recorded.error);
    expect(recorded.blueprint.blueprint?.entities).toMatchObject([{ name: "constant-combinator", control_behavior: { sections: null } }]);
    const { circuit, report } = importOf(recorded);
    expect(report).toMatchObject(QUIET);
    expect(circuit.entities).toMatchObject([DEFAULT_ENTITY.constant]);
  });

  it("names every prototype of the samples that the game did not build on plain ground", () => {
    expect([...new Set(recording.cases.flatMap((entry) => entry.unbuilt ?? []))].sort()).toEqual(Object.keys(NOT_ON_PLAIN_GROUND));
    expect(recording.cases.flatMap((entry) => (entry.standing ? [entry.label] : []))).toEqual(["generic entities: space platform hub"]);
    expect([...new Set(recording.cases.flatMap((entry) => entry.helpers ?? []))]).toEqual(["gate"]);
  });

  describe.each(recording.cases.map((entry) => [entry.label, entry] as const))("%s", (_label, entry) => {
    const sent = (): { circuit: Circuit; report: ImportReport } => importOf(entry.sent);
    const entities = entry.sent.blueprint.blueprint?.entities ?? [];
    const unbuilt = new Set([...NO_ITEM, ...(entry.unbuilt ?? [])]);
    const omitted = { reexported: NO_ITEM, rebuilt: unbuilt, native: NO_ITEM };

    it("was imported, built and exported by the game without an error", () => {
      expect(entry.errors).toEqual([]);
      // All of it but what no item builds, which the game leaves out as it reads the blueprint, and what does not stand on plain ground.
      const built = entities.filter((entity) => !unbuilt.has(entity.name)).length;
      // LuaItemStack.import_stack: 0 without errors, -1 with some, which is how the game says that it left an entity out.
      const importResult = entities.some((entity) => NO_ITEM.has(entity.name)) ? -1 : 0;
      expect({ importResult: entry.importResult, built: (entry.revived ?? 0) + (entry.standing ?? 0) }).toEqual({ importResult, built });
      expect((entry.unbuilt ?? []).filter((name) => !entities.some((entity) => entity.name === name))).toEqual([]);
    });

    // What the game understood of the blueprint, and what it says when it writes the circuit itself.
    const steps = [
      { step: "reexported", what: "exports right after importing ours" },
      { step: "rebuilt", what: "exports after building ours" },
      { step: "native", what: "exports after building the circuit through the runtime API" },
    ] as const;
    it.each(steps)("is the same circuit in the blueprint the game $what", ({ step }) => {
      const recorded = entry[step];
      if (!recorded) throw new Error(`the game recorded no '${step}' blueprint: ${entry.errors.join("; ")}`);
      const { circuit, report } = importOf(recorded);
      expect(report).toMatchObject({ ...QUIET, dropped: step === "native" ? (entry.helpers ?? []).map((name) => ({ name, reason: "unknown" })) : [] });
      expect(report.wires).toMatchObject({ toDropped: 0, invalid: 0 });
      expect(arrangement(circuit)).toEqual(arrangement(sent().circuit, omitted[step]));
    });

    // The shapes: every field as the game writes it and where it writes it, defaults left out where the game leaves them out (F-01).
    const shapes = [
      { step: "reexported", what: "after reading the blueprint" },
      { step: "native", what: "when it has built the circuit itself" },
    ] as const;
    it.each(shapes)("is exported with every entity and wire as the game writes them $what", ({ step }) => {
      const recorded = entry[step];
      if (!recorded) throw new Error(`the game recorded no '${step}' blueprint: ${entry.errors.join("; ")}`);
      const [ours, theirs] = [shape(current.get(entry.label) ?? entry.sent.blueprint, NO_ITEM), shape(recorded.blueprint, new Set(entry.helpers))];
      expect(ours).toEqual(theirs);
      // Equal, and written in the same order.
      expect(JSON.stringify(ours)).toBe(JSON.stringify(theirs));
    });
  });
}

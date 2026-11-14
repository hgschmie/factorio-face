// The tests that hold this package against a recording of the game (fixture F-01, tools/game-probe/blueprints.mjs). They are
// written against the shape of the recording, so that game.test.ts can run them on the real one once it exists and, always, on
// a recording made up from this package's own exports, which proves the tests themselves.
import { DEFAULT_ENTITY, PROTOTYPES, type Circuit, type Entity, type PrototypeName } from "@face/model";
import { describe, expect, it } from "vitest";
import { decodeBlueprintString, DIRECTION_NUMBERS, importBlueprint, LAMP_COLOR_MODE_NUMBERS, CONNECTOR, type BlueprintEntity, type BlueprintWire, type ImportReport } from "../src/index.ts";
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
  readonly errors: readonly string[];
  readonly sent: RecordedBlueprint;
  readonly reexported?: RecordedBlueprint;
  readonly rebuilt?: RecordedBlueprint;
  readonly native?: RecordedBlueprint;
}

export type RecordedFresh = RecordedBlueprint | { readonly error: string };

export interface Recording {
  readonly gameVersion: string;
  readonly defines: Readonly<Record<string, Readonly<Record<string, number>>>>;
  readonly fresh: { readonly placed: RecordedFresh; readonly withControlBehavior: RecordedFresh };
  readonly cases: readonly RecordedCase[];
}

function importOf(recorded: RecordedBlueprint): { circuit: Circuit; report: ImportReport } {
  const result = importBlueprint(recorded.blueprint, { instruments: INSTRUMENTS });
  if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
  return result;
}

/**
 * A circuit without what the game does not keep when it builds a blueprint and makes a new one of it: the order and the numbers
 * of the entities, and where the whole stands. Entities are told apart by their place, wires by the places of their ends.
 */
export function arrangement(circuit: Circuit): { entities: unknown[]; wires: string[] } {
  const tiles = circuit.entities.map((entity) => entity.placement!.tile!);
  const corner = { x: Math.min(...tiles.map((tile) => tile.x)), y: Math.min(...tiles.map((tile) => tile.y)) };
  const place = (entity: Entity): string => `${entity.placement!.tile!.x - corner.x},${entity.placement!.tile!.y - corner.y}`;
  const places = new Map(circuit.entities.map((entity) => [entity.id, place(entity)]));
  const entities = circuit.entities
    .map((entity) => {
      const { id: _id, name: _name, position: _position, placement, ...settings } = entity;
      return { place: place(entity), ...(placement?.direction && { direction: placement.direction }), ...(JSON.parse(JSON.stringify(settings)) as object) };
    })
    .sort((a, b) => a.place.localeCompare(b.place));
  const wires = circuit.wires.map((wire) => `${wire.color} ${[wire.a, wire.b].map((end) => `${places.get(end.entity)}.${end.side}`).sort().join(" ")}`).sort();
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
 * wires between them by those places. What is left is how each entity and each wire is written.
 */
export function shape(recorded: RecordedBlueprint["blueprint"]): { entities: unknown[]; wires: string[] } {
  const entities = recorded.blueprint?.entities ?? [];
  const corner = { x: Math.min(...entities.map((entity) => entity.position.x)), y: Math.min(...entities.map((entity) => entity.position.y)) };
  const place = (entity: BlueprintEntity): string => `${entity.position.x - corner.x},${entity.position.y - corner.y}`;
  const places = new Map(entities.map((entity) => [entity.entity_number, place(entity)]));
  const circuitWires = (recorded.blueprint?.wires ?? []).filter((wire) => wire[1] < CONNECTOR.poleCopper && wire[3] < CONNECTOR.poleCopper);
  return {
    entities: entities
      .map((entity) => {
        const { entity_number: _number, position: _position, ...rest } = entity;
        return { place: place(entity), ...rounded(rest) };
      })
      .sort((a, b) => a.place.localeCompare(b.place)),
    wires: circuitWires.map((wire) => [`${places.get(wire[0])}#${wire[1]}`, `${places.get(wire[2])}#${wire[3]}`].sort().join(" ")).sort(),
  };
}

const QUIET = { dropped: [], settings: [], warnings: [] };

/** The entity of the editor for a prototype as the game places it: the defaults of its kind. */
function freshEntity(prototype: PrototypeName): object {
  const kind = PROTOTYPES[prototype].kind;
  return JSON.parse(JSON.stringify(kind === "pole" ? { ...DEFAULT_ENTITY.pole, prototype } : DEFAULT_ENTITY[kind])) as object;
}

/** Defines the tests for a recording inside the current `describe`. */
export function recordingTests(recording: Recording): void {
  const blueprints = (): RecordedBlueprint[] => [
    ...Object.values(recording.fresh).filter((fresh): fresh is RecordedBlueprint => "string" in fresh),
    ...recording.cases.flatMap((entry) => [entry.sent, entry.reexported, entry.rebuilt, entry.native].filter((recorded): recorded is RecordedBlueprint => recorded !== undefined)),
  ];
  const current = new Map(exportedSamples().map((sample) => [sample.label, sample.data]));

  it("has the numbers behind the defines that the exporter writes (F-02)", () => {
    const { direction, wire_connector_id: connector, lamp_color_mode: colorMode } = recording.defines;
    expect({ north: direction!.north, east: direction!.east, south: direction!.south, west: direction!.west }).toEqual(DIRECTION_NUMBERS);
    expect(connector).toMatchObject({
      circuit_red: CONNECTOR.red, circuit_green: CONNECTOR.green, combinator_input_red: CONNECTOR.red, combinator_input_green: CONNECTOR.green, combinator_output_red: CONNECTOR.outputRed,
      combinator_output_green: CONNECTOR.outputGreen, pole_copper: CONNECTOR.poleCopper, power_switch_right_copper: CONNECTOR.switchRightCopper,
    });
    expect({ mapping: colorMode!.color_mapping, components: colorMode!.components, "packed-rgb": colorMode!.packed_rgb }).toEqual(LAMP_COLOR_MODE_NUMBERS);
  });

  it("decodes every blueprint string of the game to the JSON it holds", () => {
    expect(blueprints().length).toBeGreaterThan(0);
    for (const recorded of blueprints()) expect(decodeBlueprintString(recorded.string)).toEqual({ ok: true, data: recorded.blueprint });
  });

  describe.each(["placed", "withControlBehavior"] as const)("an entity as the game places it (%s)", (variant) => {
    const fresh = recording.fresh[variant];

    it("was exported by the game", () => {
      expect(fresh).not.toHaveProperty("error");
    });

    it("is the default of the editor for its kind, and nothing about it is unknown to the importer", () => {
      if (!("string" in fresh)) throw new Error(fresh.error);
      const { circuit, report } = importOf(fresh);
      expect(report).toMatchObject(QUIET);
      const defaults = circuit.entities.map(({ id: _id, name: _name, position: _position, placement: _placement, ...settings }) => [settings.kind === "pole" ? settings.prototype : settings.kind, JSON.parse(JSON.stringify(settings))]);
      const prototypes = (fresh.blueprint.blueprint?.entities ?? []).map((entity) => entity.name as PrototypeName);
      expect(prototypes.length).toBe(Object.keys(PROTOTYPES).length);
      expect(defaults).toEqual(prototypes.map((prototype) => [PROTOTYPES[prototype].kind === "pole" ? prototype : PROTOTYPES[prototype].kind, freshEntity(prototype)]));
    });
  });

  describe.each(recording.cases.map((entry) => [entry.label, entry] as const))("%s", (_label, entry) => {
    const sent = (): { circuit: Circuit; report: ImportReport } => importOf(entry.sent);
    const count = entry.sent.blueprint.blueprint?.entities?.length ?? 0;

    it("was imported, built and exported by the game without an error", () => {
      expect(entry.errors).toEqual([]);
      expect({ importResult: entry.importResult, revived: entry.revived }).toEqual({ importResult: 0, revived: count });
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
      expect(report).toMatchObject(QUIET);
      expect(report.wires).toMatchObject({ toDropped: 0, invalid: 0 });
      expect(arrangement(circuit)).toEqual(arrangement(sent().circuit));
    });

    // The shapes: every field as the game writes it, defaults left out where the game leaves them out (F-01).
    it("is exported with every entity and wire as the game writes them after reading the blueprint", () => {
      if (!entry.reexported) throw new Error(`the game recorded no 'reexported' blueprint: ${entry.errors.join("; ")}`);
      expect(shape(current.get(entry.label) ?? entry.sent.blueprint)).toEqual(shape(entry.reexported.blueprint));
    });

    it("is exported with every entity and wire as the game writes them when it has built the circuit itself", () => {
      if (!entry.native) throw new Error(`the game recorded no 'native' blueprint: ${entry.errors.join("; ")}`);
      expect(shape(current.get(entry.label) ?? entry.sent.blueprint)).toEqual(shape(entry.native.blueprint));
    });
  });
}

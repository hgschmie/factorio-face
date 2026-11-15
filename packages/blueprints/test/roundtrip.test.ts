// The two round trips. Editor to blueprint to editor keeps everything the editor models, in the normal form `afterRoundTrip`
// spells out; blueprint to editor to blueprint keeps everything about the known entities that the editor models.
import { analyze, printCircuit } from "@face/language";
import { canRotate, entityNameBase, facingOf, gamePrototype, prototypeOf, settingSpecsOf, tileCenter, type Circuit, type Entity, type EntityKind, type EntitySettings, type SpeakerInstrument } from "@face/model";
import { describe, expect, it } from "vitest";
import { MODDED_RECORDS, withModdedTable } from "../../../tests/fixtures/game/moddedEntities.ts";
import { Generator, portable, random } from "../../language/test/helpers.ts";
import { decodeBlueprintString, exportBlueprint, importBlueprint, type ImportReport } from "../src/index.ts";
import { A, B, exported, IRON, imported } from "./helpers.ts";
import { INSTRUMENTS, sampleCircuit, SAMPLES } from "./samples.ts";

/** The instruments and notes the generator of the language tests uses, behind a first instrument and a first note that it never names. */
const GENERATED_NOTES = ["zero", "F#3", "C4", "alarm-1", "gui-click-2", "true", "A b"];
const GENERATED_INSTRUMENTS: readonly SpeakerInstrument[] = ["first", "piano", "drum-kit", "odd name", "wire", "2x"].map((name) => ({ name, notes: GENERATED_NOTES }));

const isCombinator = (kind: EntityKind): boolean => kind === "constant" || kind === "arithmetic" || kind === "decider" || kind === "selector";

/** Every signal of the editor's own kind as one the game could have: a blueprint has no place for a custom signal. */
function withoutCustomSignals<T>(value: T): T {
  if (Array.isArray(value)) return value.map((element: unknown) => withoutCustomSignals(element)) as T;
  if (typeof value !== "object" || value === null) return value;
  const record = value as Record<string, unknown>;
  const mapped = Object.fromEntries(Object.entries(record).map(([key, member]) => [key, withoutCustomSignals(member)]));
  return (record.kind === "custom" ? { ...mapped, kind: "virtual", name: `${String(record.name)}.custom` } : mapped) as T;
}

/** A generated circuit as one that can stand in the game: every entity on tiles of its own (the largest covers nine by nine), facing as it does. */
function blueprintable(circuit: Circuit): Circuit {
  const entities = withoutCustomSignals(circuit.entities).map((entity, index): Entity => {
    const origin = { x: (index % 6) * 10, y: Math.floor(index / 6) * 10 };
    return { ...entity, placement: { ...entity.placement, tile: tileCenter(entity, facingOf(entity), origin) } };
  });
  return { ...circuit, entities };
}

/**
 * What a circuit is after it went to a blueprint and back, as far as the trip changes it:
 * - the names are new, by the naming rule of the editor (what the entity is and a number, in the order of the entities), and so are the ids;
 * - the edit positions are derived from the tiles (not compared here);
 * - a circuit with the hub of a space platform stands around its (first) hub, which is at (0, 0) as on every platform of the game;
 * - facing east is not said, and an entity that cannot turn faces nothing;
 * - an empty description is none, and the description of anything but a combinator is not in a blueprint;
 * - an entity that is built in two directions only faces north or east; kept blueprint data that holds nothing is none;
 * - a section group without a name is no group, and one section without anything in it is no section, as in a combinator the game places;
 * - the first instrument and the first note of an instrument go without saying;
 * - the source signal of a quality transfer has no quality of its own;
 * - a side of a splitter that has one of its two conditions has the game's own for the other.
 */
function afterRoundTrip(circuit: Circuit, instruments: readonly SpeakerInstrument[]): Circuit {
  const counters = new Map<string, number>();
  const hub = circuit.entities.find((entity) => entity.kind === "entity" && gamePrototype(entity).type === "space-platform-hub");
  const origin = hub?.placement?.tile ?? { x: 0, y: 0 };
  const entities = circuit.entities.map((entity): Entity => {
    const called = entityNameBase(entity);
    const count = (counters.get(called) ?? 0) + 1;
    counters.set(called, count);
    const { description, placement, ...rest } = entity;
    const facing = facingOf(entity);
    const base = {
      ...rest,
      name: `${called}${count}`,
      placement: { tile: { x: placement!.tile!.x - origin.x, y: placement!.tile!.y - origin.y }, ...(canRotate(entity) && facing !== "east" && { direction: facing }) },
      ...(description && isCombinator(entity.kind) && { description }),
    } as Entity;
    if (base.kind === "entity") {
      const { blueprintData, ...generic } = base;
      const conditions = settingSpecsOf(base.prototype).filter((spec) => spec.type === "condition");
      const inUse = (flag: string): boolean => conditions.some((spec) => spec.flag === flag && base.settings[spec.key] !== undefined);
      const filled = conditions.filter((spec) => spec.gameDefault && base.settings[spec.key] === undefined && inUse(spec.flag)).map((spec) => [spec.key, spec.gameDefault!]);
      const settings: EntitySettings = { ...base.settings, ...Object.fromEntries(filled) };
      return { ...generic, settings, ...(blueprintData !== undefined && blueprintData !== "{}" && { blueprintData }) };
    }
    if (base.kind === "constant") {
      const sections = base.sections.map(({ group, ...section }) => ({ ...(group && { group }), ...section }));
      const [only] = sections;
      const untouched = sections.length === 1 && !only!.group && only!.active && only!.multiplier === 1 && only!.filters.length === 0;
      return { ...base, sections: untouched ? [] : sections };
    }
    if (base.kind === "speaker") {
      const { instrument, note, ...speaker } = base;
      const index = instrument === undefined ? 0 : instruments.findIndex((candidate) => candidate.name === instrument);
      return { ...speaker, ...(index > 0 && { instrument }), ...(note !== undefined && instruments[index]!.notes.indexOf(note) > 0 && { note }) };
    }
    if (base.kind === "selector" && base.mode.operation === "quality-transfer" && base.mode.source.type === "signal" && base.mode.source.signal) {
      const { kind, name } = base.mode.source.signal;
      return { ...base, mode: { ...base.mode, source: { type: "signal", signal: { kind, name } } } };
    }
    return base;
  });
  return { ...circuit, entities };
}

/** Without ids and edit positions; wires by the names of their ends. */
function comparable(circuit: Circuit): unknown {
  const { name, entities, wires } = portable(circuit);
  return { name, wires, entities: (entities as Record<string, unknown>[]).map(({ position: _position, ...entity }) => entity) };
}

const QUIET: Omit<ImportReport, "entities" | "wires"> = { version: "2.1.24.0", dropped: [], settings: [], ignored: ["icons"], warnings: [] };

function roundTrip(circuit: Circuit, instruments: readonly SpeakerInstrument[]): void {
  const first = exportBlueprint(circuit, { instruments });
  if (!first.ok) throw new Error(first.problems.map((problem) => problem.message).join("; "));
  expect(decodeBlueprintString(first.string)).toEqual({ ok: true, data: first.data });
  const back = importBlueprint(first.data, { instruments });
  if (!back.ok) throw new Error(back.message);
  // Nothing is dropped and no setting is reported: the importer understands all the exporter writes.
  expect(back.report).toEqual({ ...QUIET, entities: circuit.entities.length, wires: { imported: circuit.wires.length, copper: 0, toDropped: 0, invalid: 0 } });
  expect(comparable(back.circuit)).toEqual(comparable(afterRoundTrip(circuit, instruments)));
  // The source the editor shows for it is free of errors and says the same.
  const printed = analyze(printCircuit(back.circuit));
  expect(printed.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  expect(comparable(printed.circuit!)).toEqual(comparable(back.circuit));
  // And the blueprint of what came back is the blueprint that went in.
  const second = exportBlueprint(back.circuit, { instruments });
  expect(second.ok && second.data).toEqual(first.data);
  expect(second.ok && second.string).toBe(first.string);
}

describe("round trip: editor to blueprint to editor", () => {
  it("keeps every sample circuit", () => {
    for (const sample of SAMPLES) roundTrip(sampleCircuit(sample), INSTRUMENTS);
  });

  it("keeps generated circuits of every kind of entity and wire", () => {
    const kinds = new Set<string>();
    for (let seed = 1; seed <= 400; seed++) {
      const circuit = blueprintable(new Generator(seed).circuit(1 + (seed % 12)));
      for (const entity of circuit.entities) kinds.add(entity.kind);
      roundTrip(circuit, GENERATED_INSTRUMENTS);
    }
    expect([...kinds].sort()).toEqual(["arithmetic", "constant", "decider", "entity", "lamp", "pole", "selector", "speaker"]);
  });

  it("keeps generated circuits with the entity table of a modded game: every prototype of a kind, and a loader of one tile", () => {
    const prototypes = new Set<string>();
    withModdedTable(() => {
      for (let seed = 1; seed <= 300; seed++) {
        const circuit = blueprintable(new Generator(seed).circuit(1 + (seed % 12)));
        for (const entity of circuit.entities) prototypes.add(prototypeOf(entity));
        roundTrip(circuit, GENERATED_INSTRUMENTS);
      }
    });
    // Every modded prototype that has a kind was among them, the hidden one included; the two without a kind cannot be.
    expect(MODDED_RECORDS.map(({ name }) => name).filter((name) => !prototypes.has(name))).toEqual(["mod-speaker", "mod-oddity"]);
  });

  it("changes exactly what the normal form says", () => {
    const circuit = sampleCircuit({
      label: "",
      source: `
        constant c facing east { description = ""  section "" { virtual:signal-A = 1 } }
        lamp l facing south { description = "note" }
        speaker s { when virtual:signal-A > 0  instrument = alarms  note = alarm-1 }
        speaker t { instrument = piano  note = F3 }
        selector q { operation = quality-transfer  source = signal  source-signal = item:iron-plate@rare }
      `,
    });
    const back = imported(exported(circuit)).circuit;
    expect(printCircuit({ ...back, entities: back.entities.map((entity) => ({ ...entity, position: { x: 0, y: 0 } })) })).toBe(`circuit "" {
    constant constant1 at (0, 0) tile (0.5, 0.5) {
        virtual:signal-A = 1
    }

    lamp lamp1 at (0, 0) tile (2.5, 0.5) {
    }

    speaker speaker1 at (0, 0) tile (4.5, 0.5) {
        when virtual:signal-A > 0
    }

    speaker speaker2 at (0, 0) tile (6.5, 0.5) {
        instrument = piano
    }

    selector selector1 at (0, 0) tile (1, 2.5) {
        operation = quality-transfer
        source = signal
        source-signal = item:iron-plate
    }
}
`);
  });
});

describe("round trip: blueprint to editor to blueprint", () => {
  // A blueprint as another tool or another version of the game may write it: defaults spelled out, the short forms of the
  // network selection, both spellings of the comparators, fields in another order, entities the editor does not know between
  // the others, copper wires, the higher entity number first in a wire.
  const foreign = {
    blueprint: {
      description: "not kept",
      icons: [{ signal: { name: "decider-combinator" }, index: 1 }],
      entities: [
        { entity_number: 10, name: "gate", position: { x: -5.5, y: 0.5 }, direction: 4 },
        {
          entity_number: 20,
          name: "constant-combinator",
          position: { x: 0.5, y: 0.5 },
          control_behavior: { is_on: true, sections: { sections: [{ index: 2, active: true, multiplier: 1, filters: [{ index: 4, type: "item", name: "iron-plate", quality: "normal", comparator: "=", count: 5 }] }, { index: 1, group: "g", filters: [{ index: 1, ...A, count: 1 }] }] } },
          player_description: "source",
        },
        {
          entity_number: 30,
          name: "arithmetic-combinator",
          position: { x: 2.5, y: 1 },
          direction: 8,
          control_behavior: { arithmetic_conditions: { first_signal: A, first_constant: 3, first_signal_networks: { green: false }, second_constant: 2, operation: "*", output_signal: B } },
        },
        {
          entity_number: 40,
          name: "decider-combinator",
          position: { x: 5, y: 0.5 },
          direction: 12,
          control_behavior: {
            decider_conditions: {
              conditions: [{ first_signal: A, constant: 0, comparator: ">=", compare_type: "or", first_signal_networks: { red: true, green: true } }, { first_signal: B, second_signal: IRON, comparator: "!=", compare_type: "and" }],
              outputs: [{ signal: A, copy_count_from_input: true, constant: 1, networks: { red: true, green: true } }, { signal: B, copy_count_from_input: false, constant: 1 }],
              else_outputs: [],
            },
          },
        },
        { entity_number: 50, name: "selector-combinator", position: { x: 8.5, y: 1 }, control_behavior: { selector_conditions: { operation: "random", select_max: true, index_constant: 0, random_update_interval: 15 } } },
        { entity_number: 60, name: "small-lamp", position: { x: 10.5, y: 0.5 }, always_on: false, control_behavior: { circuit_enabled: true, circuit_condition: { first_signal: A, comparator: ">" }, use_colors: false, color_mode: 0 }, color: { r: 255, g: 128, b: 0, a: 255 } },
        { entity_number: 70, name: "big-electric-pole", position: { x: 13, y: 1 }, quality: "normal" },
        { entity_number: 80, name: "substation", position: { x: 16, y: 1 } },
        { entity_number: 90, name: "straight-rail", position: { x: 20, y: 2 } },
        {
          entity_number: 100,
          name: "programmable-speaker",
          position: { x: 12.5, y: 3.5 },
          parameters: { playback_volume: 0.800000011920929, playback_mode: "surface", allow_polyphony: true, volume_controlled_by_signal: false },
          alert_parameters: { show_alert: true, show_on_map: true, alert_message: "low", icon_signal_id: IRON },
          control_behavior: { circuit_condition: { first_signal: IRON, constant: 100, comparator: "<" }, circuit_parameters: { signal_value_is_pitch: false, stop_playing_sounds: false, instrument_id: 3, note_id: 6 } },
        },
      ],
      wires: [[30, 1, 20, 1], [30, 4, 40, 2], [40, 3, 40, 1], [60, 1, 40, 3], [70, 5, 80, 5], [70, 2, 80, 2], [10, 1, 20, 1], [90, 5, 80, 5], [100, 1, 70, 1]],
      item: "blueprint",
      label: "Foreign",
      version: 562949958139904,
    },
  };

  const canonical = {
    blueprint: {
      icons: [
        { signal: { name: "constant-combinator" }, index: 1 },
        { signal: { name: "arithmetic-combinator" }, index: 2 },
        { signal: { name: "decider-combinator" }, index: 3 },
        { signal: { name: "selector-combinator" }, index: 4 },
      ],
      entities: [
        {
          entity_number: 1,
          name: "constant-combinator",
          position: { x: 0.5, y: 0.5 },
          control_behavior: { sections: { sections: [{ index: 1, filters: [{ index: 1, ...A, quality: "normal", comparator: "=", count: 1 }], group: "g" }, { index: 2, filters: [{ index: 1, name: "iron-plate", quality: "normal", comparator: "=", count: 5 }] }] } },
          player_description: "source",
        },
        { entity_number: 2, name: "arithmetic-combinator", position: { x: 2.5, y: 1 }, direction: 8, control_behavior: { arithmetic_conditions: { first_signal: A, second_constant: 2, operation: "*", output_signal: B, first_signal_networks: { red: true, green: false } } } },
        {
          entity_number: 3,
          name: "decider-combinator",
          position: { x: 5, y: 0.5 },
          direction: 12,
          control_behavior: {
            decider_conditions: {
              conditions: [{ first_signal: A, comparator: "≥" }, { first_signal: B, second_signal: IRON, comparator: "≠", compare_type: "and" }],
              outputs: [{ signal: A }, { signal: B, copy_count_from_input: false }],
              else_outputs: [],
            },
          },
        },
        { entity_number: 4, name: "selector-combinator", position: { x: 8.5, y: 1 }, control_behavior: { operation: "random", random_update_interval: 15 } },
        { entity_number: 5, name: "small-lamp", position: { x: 10.5, y: 0.5 }, control_behavior: { circuit_enabled: true, circuit_condition: { first_signal: A, constant: 0, comparator: ">" } }, color: { r: 1, g: 128 / 255, b: 0, a: 1 } },
        { entity_number: 6, name: "big-electric-pole", position: { x: 13, y: 1 } },
        { entity_number: 7, name: "substation", position: { x: 16, y: 1 } },
        {
          entity_number: 8,
          name: "programmable-speaker",
          position: { x: 12.5, y: 3.5 },
          control_behavior: { circuit_condition: { first_signal: IRON, constant: 100, comparator: "<" }, circuit_parameters: { signal_value_is_pitch: false, stop_playing_sounds: false, instrument_id: 3, note_id: 6 } },
          parameters: { playback_volume: 0.8, playback_mode: "surface", allow_polyphony: true, volume_controlled_by_signal: false },
          alert_parameters: { show_alert: true, show_on_map: true, icon_signal_id: IRON, alert_message: "low" },
        },
      ],
      wires: [[1, 1, 2, 1], [2, 4, 3, 2], [3, 1, 3, 3], [3, 3, 5, 1], [6, 1, 8, 1], [6, 2, 7, 2]],
      item: "blueprint",
      label: "Foreign",
      version: 562954249961472,
    },
  };

  it("keeps the known entities with every setting the editor models, and their circuit wires", () => {
    const { circuit, report } = imported(foreign);
    expect(report).toEqual({
      version: "2.0.72.0",
      entities: 8,
      dropped: [{ name: "gate", count: 1, reason: "unknown" }, { name: "straight-rail", count: 1, reason: "unknown" }],
      wires: { imported: 6, copper: 1, toDropped: 2, invalid: 0 },
      settings: [],
      ignored: ["description", "icons"],
      warnings: [],
    });
    const result = exportBlueprint(circuit, { instruments: INSTRUMENTS });
    expect(result.ok && result.data).toEqual(canonical);
    // Field for field in the order of the game.
    expect(result.ok && JSON.stringify(result.data)).toBe(JSON.stringify(canonical));
    expect(result.ok && result.warnings).toEqual([]);
  });

  it("is the same blueprint after every further trip", () => {
    let data: unknown = canonical;
    for (let trip = 0; trip < 3; trip++) {
      const result = exportBlueprint(imported(data).circuit, { instruments: INSTRUMENTS });
      expect(result.ok && result.data).toEqual(canonical);
      data = result.ok ? result.data : undefined;
    }
  });
});

describe("round trip: damaged blueprints", () => {
  const JUNK: readonly unknown[] = [null, true, false, 0, -1, 1.5, 2 ** 40, "", "text", "signal-each", [], [1, 2], {}, { name: "signal-everything", type: "virtual" }, { type: "virtual", name: "signal-each" }, { red: false }];

  /** Replaces a few values anywhere in the JSON by junk. */
  function damaged(data: unknown, next: () => number): unknown {
    const copy = JSON.parse(JSON.stringify(data)) as unknown;
    const holders: { holder: Record<string, unknown> | unknown[]; key: string | number }[] = [];
    const walk = (value: unknown): void => {
      if (typeof value !== "object" || value === null) return;
      for (const [key, member] of Object.entries(value)) {
        holders.push({ holder: value as Record<string, unknown>, key });
        walk(member);
      }
    };
    walk(copy);
    for (let count = 1 + Math.floor(next() * 4); count > 0; count--) {
      const { holder, key } = holders[Math.floor(next() * holders.length)]!;
      (holder as Record<string, unknown>)[key as string] = JUNK[Math.floor(next() * JUNK.length)];
    }
    return copy;
  }

  it("imports whatever is left as a circuit the editor can print without errors and read back as the same", () => {
    const next = random(7);
    let circuits = 0;
    for (const sample of SAMPLES) {
      const exported = exportBlueprint(sampleCircuit(sample), { instruments: INSTRUMENTS });
      if (!exported.ok) throw new Error("sample does not export");
      for (let round = 0; round < 40; round++) {
        const result = importBlueprint(damaged(exported.data, next), { instruments: INSTRUMENTS });
        if (!result.ok) continue;
        circuits++;
        const printed = analyze(printCircuit(result.circuit));
        expect(printed.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
        expect(comparable(printed.circuit!)).toEqual(comparable(result.circuit));
        expect(portable(printed.circuit!).entities).toEqual(portable(result.circuit).entities);
      }
    }
    expect(circuits).toBeGreaterThan(300);
  });
});

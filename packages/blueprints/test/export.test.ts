import { ENTITY_KINDS, prototypesOf, TERMINALS, tileCenter, type Circuit, type Entity, type EntityKind, type TerminalSide } from "@face/model";
import { describe, expect, it } from "vitest";
import { connectorId, decodeBlueprintString, exportBlueprint, EXPORT_VERSION } from "../src/index.ts";
import { A, B, circuitOf, entitiesOf, exported, IRON, parse, settingsOf } from "./helpers.ts";
import { INSTRUMENTS, placed } from "./samples.ts";

const C = { type: "virtual", name: "signal-C" };
const filter = (index: number, signal: object, count: number, quality = "normal") => ({ index, ...signal, quality, comparator: "=", count });

describe("export: the blueprint", () => {
  it("has the item, the version, the label, icons, numbered entities and the string of all of it", () => {
    const circuit = circuitOf("constant-combinator a { virtual:signal-A = 1 }  small-lamp b { }  small-lamp c { }  wire red a.out <-> b.in", "My circuit");
    const result = exportBlueprint(circuit);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual({
      blueprint: {
        icons: [{ signal: { name: "small-lamp" }, index: 1 }, { signal: { name: "constant-combinator" }, index: 2 }],
        entities: [
          { entity_number: 1, name: "constant-combinator", position: { x: 0.5, y: 0.5 }, direction: 4, control_behavior: { sections: { sections: [{ index: 1, filters: [filter(1, A, 1)] }] } } },
          { entity_number: 2, name: "small-lamp", position: { x: 2.5, y: 0.5 } },
          { entity_number: 3, name: "small-lamp", position: { x: 4.5, y: 0.5 } },
        ],
        wires: [[1, 1, 2, 1]],
        item: "blueprint",
        label: "My circuit",
        version: EXPORT_VERSION,
      },
    });
    expect(Object.keys(result.data.blueprint)).toEqual(["icons", "entities", "wires", "item", "label", "version"]);
    expect(decodeBlueprintString(result.string)).toEqual({ ok: true, data: result.data });
    expect(result.warnings).toEqual([]);
  });

  it("leaves out the label of a circuit without a name and the wires of one without any", () => {
    const { blueprint } = exported(circuitOf("small-lamp a { }", ""));
    expect(Object.keys(blueprint)).toEqual(["icons", "entities", "item", "version"]);
    expect(exportBlueprint(circuitOf("small-lamp a { }"), { version: 562949953421312 })).toMatchObject({ ok: true, data: { blueprint: { version: 562949953421312 } } });
  });

  it("takes at most four icons, the most frequent entities first", () => {
    const { blueprint } = exported(circuitOf("small-lamp a { } small-electric-pole b { } small-electric-pole c { } programmable-speaker d { } programmable-speaker e { } programmable-speaker f { } constant-combinator g { } decider-combinator h { }"));
    expect(blueprint.icons).toEqual([
      { signal: { name: "programmable-speaker" }, index: 1 },
      { signal: { name: "small-electric-pole" }, index: 2 },
      { signal: { name: "small-lamp" }, index: 3 },
      { signal: { name: "constant-combinator" }, index: 4 },
    ]);
  });
});

describe("export: place and direction", () => {
  it("writes the tile as the position and the direction of an entity that can turn, north by leaving it out", () => {
    const entities = entitiesOf("decider-combinator n facing north { }  decider-combinator e facing east { }  decider-combinator s facing south { }  decider-combinator w facing west { }  decider-combinator none { }  constant-combinator c facing south { }");
    expect(entities.map((entity) => entity.direction)).toEqual([undefined, 4, 8, 12, 4, 8]);
    expect(entities.map((entity) => entity.position)).toEqual([{ x: 0.5, y: 1 }, { x: 3, y: 0.5 }, { x: 4.5, y: 1 }, { x: 7, y: 0.5 }, { x: 1, y: 2.5 }, { x: 2.5, y: 2.5 }]);
  });

  it("writes no direction for a lamp, a pole or a speaker, whatever the circuit says", () => {
    const entities = entitiesOf("small-lamp a facing south { }  big-electric-pole b facing west { }  programmable-speaker c facing north { }");
    expect(entities.map((entity) => "direction" in entity)).toEqual([false, false, false]);
    expect(entities[1]).toEqual({ entity_number: 2, name: "big-electric-pole", position: { x: 3, y: 1 } });
  });

  it("names every prototype of a pole", () => {
    const entities = entitiesOf("small-electric-pole a { }  medium-electric-pole b { }  big-electric-pole c { }  substation d { }");
    expect(entities.map((entity) => entity.name)).toEqual(["small-electric-pole", "medium-electric-pole", "big-electric-pole", "substation"]);
    expect(entities.every((entity) => Object.keys(entity).join() === "entity_number,name,position")).toBe(true);
  });
});

/** The control behaviour of a constant combinator as the game places it. */
const EMPTY_SECTION = { sections: { sections: [{ index: 1 }] } };

describe("export: constant combinator", () => {
  it("writes one without sections as the game places it: with one empty section", () => {
    expect(settingsOf("constant-combinator c { }")).toEqual({ direction: 4, control_behavior: EMPTY_SECTION });
    expect(settingsOf("constant-combinator c { section { } }")).toEqual({ direction: 4, control_behavior: EMPTY_SECTION });
  });

  it("writes filters with slot numbers, the signal kind unless it is an item, and quality and comparator always", () => {
    const body = "constant-combinator c { item:iron-plate = 5  fluid:water = -3  virtual:signal-A@rare = 2147483647  space-location:nauvis = -2147483648  recipe:iron-gear-wheel = 2  entity:small-biter = 3  asteroid-chunk:oxide-asteroid-chunk = 1  quality:epic = 0 }";
    expect(settingsOf(body).control_behavior).toEqual({
      sections: {
        sections: [
          {
            index: 1,
            filters: [
              filter(1, IRON, 5),
              filter(2, { type: "fluid", name: "water" }, -3),
              filter(3, A, 2147483647, "rare"),
              filter(4, { type: "space-location", name: "nauvis" }, -2147483648),
              filter(5, { type: "recipe", name: "iron-gear-wheel" }, 2),
              filter(6, { type: "entity", name: "small-biter" }, 3),
              filter(7, { type: "asteroid-chunk", name: "oxide-asteroid-chunk" }, 1),
              filter(8, { type: "quality", name: "epic" }, 0),
            ],
          },
        ],
      },
    });
  });

  it("writes the switch when it is off, and per section the group, a multiplier other than 1 and that it is inactive", () => {
    const body = 'constant-combinator c { enabled = false  section "Ore" { active = false  multiplier = -0.5  item:iron-plate = 1 }  section { virtual:signal-A = 2 }  section "Empty" { }  section "" { multiplier = 3 } }';
    expect(settingsOf(body).control_behavior).toEqual({
      is_on: false,
      sections: {
        sections: [
          { index: 1, filters: [filter(1, IRON, 1)], group: "Ore", multiplier: -0.5, active: false },
          { index: 2, filters: [filter(1, A, 2)] },
          { index: 3, group: "Empty" },
          { index: 4, multiplier: 3 },
        ],
      },
    });
    expect(JSON.stringify(settingsOf("constant-combinator c { enabled = false }").control_behavior)).toBe('{"sections":{"sections":[{"index":1}]},"is_on":false}');
  });

  it("writes the description of a combinator", () => {
    expect(settingsOf('constant-combinator c { description = "two\\nlines" }')).toEqual({ direction: 4, control_behavior: EMPTY_SECTION, player_description: "two\nlines" });
    expect(settingsOf('decider-combinator c { description = "d" }')).toMatchObject({ direction: 4, player_description: "d" });
    expect(settingsOf('constant-combinator c { description = "" }')).toEqual({ direction: 4, control_behavior: EMPTY_SECTION });
  });
});

describe("export: arithmetic combinator", () => {
  const conditions = (body: string) => (settingsOf(body).control_behavior as { arithmetic_conditions: unknown }).arithmetic_conditions;

  it("writes one that is not configured as 0 * 0 without an output", () => {
    expect(settingsOf("arithmetic-combinator a { }")).toEqual({ direction: 4, control_behavior: { arithmetic_conditions: { first_constant: 0, second_constant: 0, operation: "*" } } });
  });

  it("writes the network selections after everything else, as the game does", () => {
    expect(JSON.stringify(conditions("arithmetic-combinator a { item:iron-plate = virtual:signal-A[red] - virtual:signal-B[green] }"))).toBe(
      '{"first_signal":{"type":"virtual","name":"signal-A"},"second_signal":{"type":"virtual","name":"signal-B"},"operation":"-","output_signal":{"name":"iron-plate"},"first_signal_networks":{"red":true,"green":false},"second_signal_networks":{"red":false,"green":true}}',
    );
  });

  it("writes signals and constants on either side, and the operation always", () => {
    expect(conditions("arithmetic-combinator a { virtual:signal-A = virtual:signal-B * 2 }")).toEqual({ first_signal: B, second_constant: 2, operation: "*", output_signal: A });
    expect(conditions("arithmetic-combinator a { item:iron-plate@rare = -5 - virtual:signal-B }")).toEqual({ first_constant: -5, second_signal: B, operation: "-", output_signal: { name: "iron-plate", quality: "rare" } });
    expect(conditions("arithmetic-combinator a { virtual:signal-A = 0 + 0 }")).toEqual({ first_constant: 0, second_constant: 0, operation: "+", output_signal: A });
    expect(conditions("arithmetic-combinator a { each = each * each }")).toEqual({ first_signal: { type: "virtual", name: "signal-each" }, second_signal: { type: "virtual", name: "signal-each" }, operation: "*", output_signal: { type: "virtual", name: "signal-each" } });
  });

  it("writes each of the eleven operations as the game spells it", () => {
    for (const operation of ["*", "/", "+", "-", "%", "^", "<<", ">>", "AND", "OR", "XOR"]) {
      expect(conditions(`arithmetic-combinator a { virtual:signal-A = virtual:signal-B ${operation} 1 }`)).toMatchObject({ operation });
    }
  });

  it("writes a network selection that is not both", () => {
    expect(conditions("arithmetic-combinator a { virtual:signal-A = virtual:signal-B[red] + virtual:signal-C[green] }")).toEqual({
      first_signal: B, first_signal_networks: { red: true, green: false }, second_signal: C, second_signal_networks: { red: false, green: true }, operation: "+", output_signal: A,
    });
    expect(conditions("arithmetic-combinator a { virtual:signal-A = virtual:signal-B[none] + 1 }")).toMatchObject({ first_signal_networks: { red: false, green: false } });
  });
});

describe("export: decider combinator", () => {
  const conditions = (body: string) => (settingsOf(body).control_behavior as { decider_conditions: unknown }).decider_conditions;

  it("writes one without conditions and outputs as the game places it: with a blank condition and a blank output", () => {
    expect(settingsOf("decider-combinator d { }")).toEqual({ direction: 4, control_behavior: { decider_conditions: { conditions: [{}], outputs: [{}], else_outputs: [] } } });
  });

  it("writes all three lists, also the empty ones", () => {
    expect(conditions("decider-combinator d { when virtual:signal-A > 1 }")).toEqual({ conditions: [{ first_signal: A, constant: 1, comparator: ">" }], outputs: [], else_outputs: [] });
    expect(conditions("decider-combinator d { output virtual:signal-A = 1 }")).toEqual({ conditions: [], outputs: [{ signal: A, copy_count_from_input: false }], else_outputs: [] });
  });

  it("leaves out a constant of 0 and the comparator '<', which the game leaves out in a decider combinator only", () => {
    expect(conditions("decider-combinator d { when virtual:signal-A < 0 or virtual:signal-B < virtual:signal-C }")).toMatchObject({ conditions: [{ first_signal: A }, { first_signal: B, second_signal: C }] });
    expect(JSON.stringify(conditions("decider-combinator d { when virtual:signal-B[red] != virtual:signal-C[green] and virtual:signal-A > 5 }"))).toContain(
      '"comparator":"≠","first_signal_networks":{"red":true,"green":false},"second_signal_networks":{"red":false,"green":true}},{"first_signal":{"type":"virtual","name":"signal-A"},"constant":5,"comparator":">","compare_type":"and"}',
    );
  });

  it("writes conditions with the comparator in the game's spelling, how each joins the ones before it, and networks", () => {
    expect(conditions("decider-combinator d { when virtual:signal-A > 5 and virtual:signal-B[red] != virtual:signal-C[green] or item:iron-plate <= -1 or each >= 0 and anything = 0 and everything < 1 }")).toEqual({
      conditions: [
        { first_signal: A, constant: 5, comparator: ">" },
        { first_signal: B, first_signal_networks: { red: true, green: false }, second_signal: C, second_signal_networks: { red: false, green: true }, comparator: "≠", compare_type: "and" },
        { first_signal: IRON, constant: -1, comparator: "≤" },
        { first_signal: { type: "virtual", name: "signal-each" }, comparator: "≥" },
        { first_signal: { type: "virtual", name: "signal-anything" }, comparator: "=", compare_type: "and" },
        { first_signal: { type: "virtual", name: "signal-everything" }, constant: 1, compare_type: "and" },
      ],
      outputs: [],
      else_outputs: [],
    });
  });

  it("writes outputs that copy the input, with the networks to copy from, and outputs of a constant, 1 by leaving it out", () => {
    expect(conditions("decider-combinator d { when virtual:signal-A > 0  output virtual:signal-A = input  output virtual:signal-B = input[red]  output virtual:signal-C = 7  output item:iron-plate = 1  else output virtual:signal-B = input[none]  else output virtual:signal-C = -1 }")).toEqual({
      conditions: [{ first_signal: A, comparator: ">" }],
      outputs: [{ signal: A }, { signal: B, networks: { red: true, green: false } }, { signal: C, copy_count_from_input: false, constant: 7 }, { signal: IRON, copy_count_from_input: false }],
      else_outputs: [{ signal: B, networks: { red: false, green: false } }, { signal: C, copy_count_from_input: false, constant: -1 }],
    });
  });
});

describe("export: selector combinator", () => {
  const behavior = (body: string) => settingsOf(`selector-combinator s { ${body} }`).control_behavior;

  it("writes the parameters without a wrapper, also for one as it is placed", () => {
    expect(settingsOf("selector-combinator s { }")).toEqual({ direction: 4, control_behavior: { operation: "select", select_max: true, index_constant: 0 } });
    expect(behavior("operation = select  order = min")).toEqual({ operation: "select", select_max: false, index_constant: 0 });
    expect(behavior("operation = select  index = 3  index-comparator = <=")).toEqual({ operation: "select", select_max: true, index_constant: 3, index_comparator: "≤" });
    expect(behavior("operation = select  index = virtual:signal-A")).toEqual({ operation: "select", select_max: true, index_signal: A });
  });

  it("writes every other mode with the fields it has", () => {
    expect(behavior("operation = count  output = virtual:signal-A")).toEqual({ operation: "count", count_signal: A });
    expect(behavior("operation = count")).toEqual({ operation: "count" });
    expect(behavior("operation = random  interval = 60")).toEqual({ operation: "random", random_update_interval: 60 });
    expect(behavior("operation = random")).toEqual({ operation: "random" });
    expect(behavior("operation = stack-size")).toEqual({ operation: "stack-size" });
    expect(behavior("operation = rocket-capacity")).toEqual({ operation: "rocket-capacity" });
    expect(behavior("operation = quality-filter  quality = rare  comparator = >=")).toEqual({ operation: "quality-filter", quality_filter: { quality: "rare", comparator: "≥" } });
    expect(behavior("operation = quality-filter")).toEqual({ operation: "quality-filter" });
    expect(behavior("operation = quality-filter  comparator = >")).toEqual({ operation: "quality-filter", quality_filter: { comparator: ">" } });
    expect(behavior("operation = quality-select")).toEqual({ operation: "quality-select", select_highest_quality: true });
    expect(behavior("operation = quality-select  order = lowest")).toEqual({ operation: "quality-select", select_highest_quality: false });
    expect(behavior("operation = quality-transfer  source = legendary  destination = each")).toEqual({ operation: "quality-transfer", quality_source_static: { name: "legendary" }, quality_destination_signal: { type: "virtual", name: "signal-each" } });
    expect(behavior("operation = quality-transfer")).toEqual({ operation: "quality-transfer" });
    expect(behavior("operation = quality-transfer  source = signal  source-signal = item:iron-plate@rare  destination = virtual:signal-A")).toEqual({
      operation: "quality-transfer", select_quality_from_signal: true, quality_source_signal: IRON, quality_destination_signal: A,
    });
    expect(behavior("operation = quality-transfer  source = signal")).toEqual({ operation: "quality-transfer", select_quality_from_signal: true });
    expect(JSON.stringify(behavior("operation = time  day-length = virtual:signal-A  day-tick = virtual:signal-B  game-tick = item:iron-plate"))).toBe(JSON.stringify({ operation: "time", game_tick_signal: IRON, day_tick_signal: B, day_length_signal: A }));
    expect(behavior("operation = time")).toEqual({ operation: "time" });
  });
});

describe("export: lamp", () => {
  it("writes nothing for a lamp without settings", () => {
    expect(settingsOf("small-lamp l { }")).toEqual({});
  });

  it("writes the condition with the switch that puts it to use", () => {
    expect(settingsOf("small-lamp l { when virtual:signal-A > 0 }")).toEqual({ control_behavior: { circuit_enabled: true, circuit_condition: { first_signal: A, constant: 0, comparator: ">" } } });
    expect(settingsOf("small-lamp l { when anything != virtual:signal-B }").control_behavior).toEqual({ circuit_enabled: true, circuit_condition: { first_signal: { type: "virtual", name: "signal-anything" }, second_signal: B, comparator: "≠" } });
  });

  it("writes the networks, always on, the colors with their mode and signals, and the color from 0 to 1", () => {
    expect(settingsOf("small-lamp l { networks = green  always-on = true  colors = components  red = virtual:signal-A  green = virtual:signal-B  blue = item:iron-plate  rgb = virtual:signal-C  color = #ff8000 }")).toEqual({
      control_behavior: { input_networks: { red: false, green: true }, use_colors: true, color_mode: 1, red_signal: A, green_signal: B, blue_signal: IRON, rgb_signal: C },
      always_on: true,
      color: { r: 1, g: 128 / 255, b: 0, a: 1 },
    });
    expect(settingsOf("small-lamp l { colors = mapping }").control_behavior).toEqual({ use_colors: true });
    expect(settingsOf("small-lamp l { colors = packed-rgb  networks = none }").control_behavior).toEqual({ input_networks: { red: false, green: false }, use_colors: true, color_mode: 2 });
    expect(settingsOf("small-lamp l { networks = red }").control_behavior).toEqual({ input_networks: { red: true, green: false } });
  });
});

describe("export: programmable speaker", () => {
  const fresh = {
    parameters: { playback_volume: 1, playback_mode: "local", allow_polyphony: false, volume_controlled_by_signal: false },
    alert_parameters: { show_alert: false, show_on_map: true, alert_message: "" },
  };
  const idle = { signal_value_is_pitch: false, stop_playing_sounds: false, instrument_id: 0, note_id: 0 };

  it("writes its parameters in full, and no control behaviour for a speaker the circuit does not concern", () => {
    expect(settingsOf("programmable-speaker s { }")).toEqual(fresh);
    expect(settingsOf("programmable-speaker s { volume = 50  show-alert = true }")).not.toHaveProperty("control_behavior");
  });

  it("writes the control behaviour first, with its parameters in full and the condition only where there is one", () => {
    expect(settingsOf("programmable-speaker s { stop-playing-sounds = true }")).toEqual({ control_behavior: { circuit_parameters: { ...idle, stop_playing_sounds: true } }, ...fresh });
    expect(settingsOf("programmable-speaker s { when virtual:signal-A < 0 }")).toEqual({ control_behavior: { circuit_condition: { first_signal: A, constant: 0, comparator: "<" }, circuit_parameters: idle }, ...fresh });
    expect(Object.keys(settingsOf("programmable-speaker s { note = siren }"))).toEqual(["control_behavior", "parameters", "alert_parameters"]);
  });

  it("writes every setting", () => {
    const body = 'programmable-speaker s { when virtual:signal-A >= 3  instrument = piano  note = "F#3"  volume = 62.5  volume-signal = virtual:signal-B  playback = global  polyphony = true  stop-playing-sounds = true  show-alert = true  show-on-map = false  alert-icon = item:iron-plate  alert-message = "Out of \\"plates\\"" }';
    expect(settingsOf(body)).toEqual({
      parameters: { playback_volume: 0.625, playback_mode: "global", allow_polyphony: true, volume_controlled_by_signal: true, volume_signal_id: B },
      alert_parameters: { show_alert: true, show_on_map: false, icon_signal_id: IRON, alert_message: 'Out of "plates"' },
      control_behavior: { circuit_condition: { first_signal: A, constant: 3, comparator: "≥" }, circuit_parameters: { signal_value_is_pitch: false, stop_playing_sounds: true, instrument_id: 3, note_id: 1 } },
    });
    expect(settingsOf("programmable-speaker s { when everything < virtual:signal-B  playback = surface  volume = 0 }")).toMatchObject({
      parameters: { playback_volume: 0, playback_mode: "surface" },
      control_behavior: { circuit_condition: { first_signal: { type: "virtual", name: "signal-everything" }, second_signal: B, comparator: "<" } },
    });
  });

  it("writes the pitch signal as the left side of the condition", () => {
    expect(settingsOf("programmable-speaker s { pitch = virtual:signal-A  instrument = drum-kit }").control_behavior).toEqual({
      circuit_condition: { first_signal: A, constant: 0, comparator: "<" },
      circuit_parameters: { signal_value_is_pitch: true, stop_playing_sounds: false, instrument_id: 2, note_id: 0 },
    });
  });

  it("writes instrument and note as their places in the lists of the game; a name left out is the first", () => {
    const sound = (body: string) => (settingsOf(`programmable-speaker s { ${body} }`).control_behavior as { circuit_parameters: { instrument_id: number; note_id: number } }).circuit_parameters;
    expect(sound("instrument = alarms  note = alarm-1  stop-playing-sounds = true")).toMatchObject({ instrument_id: 0, note_id: 0 });
    expect(sound("note = siren")).toMatchObject({ instrument_id: 0, note_id: 6 });
    expect(sound("instrument = steel-drum")).toMatchObject({ instrument_id: 11, note_id: 0 });
    expect(sound('instrument = steel-drum  note = "E6"')).toMatchObject({ instrument_id: 11, note_id: 35 });
  });

  it("fails for an instrument or a note the game does not have, and for a named one without the lists", () => {
    const problems = (body: string, options = { instruments: INSTRUMENTS }) => {
      const result = exportBlueprint(circuitOf(body), options);
      return result.ok ? [] : result.problems.map((problem) => `${problem.code} ${problem.entities.join()}`);
    };
    expect(problems("programmable-speaker a { instrument = kazoo }  programmable-speaker b { instrument = piano  note = siren }  programmable-speaker c { note = hat-1 }")).toEqual(["unknown-instrument a", "unknown-note b", "unknown-note c"]);
    expect(problems("programmable-speaker a { instrument = piano }", {} as never)).toEqual(["unknown-instrument a"]);
    expect(problems("programmable-speaker a { when virtual:signal-A > 0 }", {} as never)).toEqual([]);
  });
});

describe("export: wires", () => {
  const SIDES: readonly (readonly [EntityKind, TerminalSide])[] = ENTITY_KINDS.flatMap((kind) => TERMINALS[kind].map((side) => [kind, side] as const));
  const entity = (kind: EntityKind, name: string): Entity => parse(`${kind === "entity" ? "steel-chest" : prototypesOf(kind)[0]} ${name} { }`).entities[0]!;

  it("has the connector ids of the game: 1 and 2 for an input or an only connection point, 3 and 4 for the output of a combinator with both", () => {
    const ids = SIDES.map(([kind, side]) => `${kind}.${side} ${connectorId({ kind }, { side }, "red")} ${connectorId({ kind }, { side }, "green")}`);
    expect(ids).toEqual(["constant.out 1 2", "arithmetic.in 1 2", "arithmetic.out 3 4", "decider.in 1 2", "decider.out 3 4", "selector.in 1 2", "selector.out 3 4", "lamp.in 1 2", "pole.io 1 2", "speaker.in 1 2", "entity.io 1 2"]);
  });

  it("writes a wire between every two kinds of connection point, in both colors, the lower entity number first", () => {
    for (const [aKind, aSide] of SIDES) {
      for (const [bKind, bSide] of SIDES) {
        for (const color of ["red", "green"] as const) {
          for (const reversed of [false, true]) {
            const [a, b] = [{ ...entity(aKind, "a"), id: "a" }, { ...entity(bKind, "b"), id: "b" }];
            const ends = [{ entity: "a", side: aSide }, { entity: "b", side: bSide }];
            const circuit: Circuit = placed({ name: "", entities: [a, b], wires: [{ color, a: ends[reversed ? 1 : 0]!, b: ends[reversed ? 0 : 1]! }] });
            expect(exported(circuit).blueprint.wires, `${color} ${aKind}.${aSide} ${bKind}.${bSide}`).toEqual([[1, connectorId(a, { side: aSide }, color), 2, connectorId(b, { side: bSide }, color)]]);
          }
        }
      }
    }
  });

  it("writes a wire from a combinator to itself with the input first, and every wire once, in order", () => {
    const { blueprint } = exported(circuitOf("decider-combinator d { }  constant-combinator c { }  small-lamp l { }  wire green d.out <-> d.in  wire red d.out <-> d.in  wire red l.in <-> c.out  wire red c.out <-> d.in  wire green l.in <-> d.out  wire red d.in <-> c.out"));
    expect(blueprint.wires).toEqual([[1, 1, 1, 3], [1, 1, 2, 1], [1, 2, 1, 4], [1, 4, 3, 2], [2, 1, 3, 1]]);
  });

  it("warns about a wire that is longer than the game lets it be", () => {
    const circuit = parse("constant-combinator c tile (0.5, 0.5) { }  small-lamp near tile (9.5, 0.5) { }  small-lamp far tile (11.5, 0.5) { }  small-electric-pole p tile (0.5, 8.5) { }  wire red c.out <-> near.in  wire red c.out <-> far.in  wire green c.out <-> p");
    const result = exportBlueprint(circuit);
    expect(result.ok && result.warnings.map((warning) => `${warning.code} ${warning.entities.join()}`)).toEqual(["wire-too-long c,far"]);
    expect(result.ok && result.warnings[0]!.message).toContain("spans 10 tiles; in the game it reaches 9");
    expect(result.ok && result.data.blueprint.wires).toHaveLength(3);
  });
});

describe("export: what the game does not take as it is", () => {
  it("writes a circuit with the hub of a space platform around the hub, which is at (0, 0) of every platform", () => {
    const circuit = parse("constant-combinator c tile (0.5, 0.5) { }  space-platform-hub hub tile (12, 4) { }  small-lamp l tile (20.5, -3.5) { }  wire red c.out <-> hub");
    const result = exportBlueprint(circuit);
    expect(result.ok && result.data.blueprint.entities.map((entity) => [entity.name, entity.position])).toEqual([["constant-combinator", { x: -11.5, y: -3.5 }], ["space-platform-hub", { x: 0, y: 0 }], ["small-lamp", { x: 8.5, y: -7.5 }]]);
    expect(result.ok && result.warnings).toEqual([]);
  });

  it("warns about an entity no item builds, which the game leaves out of a blueprint it reads", () => {
    const result = exportBlueprint(circuitOf("constant-combinator c { }  blue-chest blue { }  crash-site-chest-1 crash { }  steel-chest steel { }  wire red c.out <-> blue"));
    expect(result.ok && result.warnings).toEqual([{ code: "no-item", entities: ["blue", "crash"], message: "No item builds 'blue', 'crash'; the game leaves them and their wires out when it reads the blueprint" }]);
    expect(result.ok && result.data.blueprint.entities).toHaveLength(4);
  });
});

describe("export: what cannot become a blueprint", () => {
  const problems = (circuit: Circuit) => {
    const result = exportBlueprint(circuit, { instruments: INSTRUMENTS });
    return result.ok ? [] : result.problems;
  };

  it("fails for entities without a tile and names all of them", () => {
    const circuit = parse("constant-combinator a { }  small-lamp b tile (2.5, 0.5) { }  decider-combinator c { }  small-electric-pole d { }  wire red a.out <-> b.in");
    const result = exportBlueprint(circuit);
    expect(result.ok).toBe(false);
    expect(problems(circuit)).toEqual([{ code: "no-tile", entities: ["a", "c", "d"], message: "3 entities have no place in the game (no 'tile'): 'a', 'c', 'd'. Place every entity on the blueprint board first" }]);
    expect(problems(parse("small-lamp only { }"))[0]!.message).toBe("1 entity has no place in the game (no 'tile'): 'only'. Place every entity on the blueprint board first");
  });

  it("names the first few in the message and all of them in the list", () => {
    const circuit = parse(Array.from({ length: 8 }, (_, i) => `small-lamp l${i} { }`).join("\n"));
    const [problem] = problems(circuit);
    expect(problem!.entities).toHaveLength(8);
    expect(problem!.message).toContain("8 entities have no place in the game (no 'tile'): 'l0', 'l1', 'l2', 'l3', 'l4' and 3 more.");
  });

  it("fails for an empty circuit", () => {
    expect(problems(parse("")).map((problem) => problem.code)).toEqual(["empty"]);
  });

  it("fails for a tile that is off the grid and for entities on the same tile", () => {
    const circuit = parse("small-lamp a tile (0, 0.5) { }  decider-combinator b tile (4.5, 1) { }  decider-combinator c facing north tile (8.5, 1) { }  small-lamp d tile (8.5, 0.5) { }  small-lamp e tile (20.5, 0.5) { }");
    expect(problems(circuit).map((problem) => `${problem.code} ${problem.entities.join()}`)).toEqual(["off-grid a,b", "overlap c,d"]);
  });

  it("fails for a custom signal, which the game does not have, wherever it stands", () => {
    const circuit = circuitOf("constant-combinator a { custom:mine = 1  custom:other = 2 }  arithmetic-combinator b { custom:mine = custom:mine + 1 }  small-lamp c { when virtual:signal-A > custom:limit }  small-lamp d { }");
    expect(problems(circuit)).toEqual([
      { code: "custom-signal", entities: ["a"], message: "'a' uses the custom signals custom:mine, custom:other, which the game does not have" },
      { code: "custom-signal", entities: ["b"], message: "'b' uses the custom signal custom:mine, which the game does not have" },
      { code: "custom-signal", entities: ["c"], message: "'c' uses the custom signal custom:limit, which the game does not have" },
    ]);
  });

  it("reports everything that is in the way at once", () => {
    const circuit = parse("constant-combinator a { custom:mine = 1 }  programmable-speaker b tile (0.5, 0.5) { instrument = kazoo }");
    expect(problems(circuit).map((problem) => problem.code)).toEqual(["no-tile", "unknown-instrument", "custom-signal"]);
  });

  it("warns that the description of a lamp, a pole or a speaker is not in the blueprint", () => {
    const result = exportBlueprint(circuitOf('small-lamp a { description = "x" }  small-electric-pole b { description = "y" }  programmable-speaker c { description = "z" }  constant-combinator d { description = "kept" }  small-lamp e { }'));
    expect(result.ok && result.warnings).toEqual([{ code: "description-lost", entities: ["a", "b", "c"], message: "The game has a description on combinators only; the descriptions of 'a', 'b', 'c' are not in the blueprint" }]);
    expect(result.ok && result.data.blueprint.entities.map((entity) => entity.player_description)).toEqual([undefined, undefined, undefined, "kept", undefined]);
  });

  it("does not change the circuit and gives the same blueprint for the same circuit", () => {
    const circuit = circuitOf("constant-combinator a { virtual:signal-A = 1 }  decider-combinator b { when virtual:signal-A > 0  output virtual:signal-A = input }  wire red a.out <-> b.in");
    const before = JSON.stringify(circuit);
    const first = exportBlueprint(circuit);
    expect(JSON.stringify(circuit)).toBe(before);
    expect(exportBlueprint(circuit)).toEqual(first);
    // The edit position is not part of a blueprint.
    const moved = { ...circuit, entities: circuit.entities.map((entity) => ({ ...entity, position: { x: entity.position.x + 500, y: 7 } })) };
    expect(exportBlueprint(moved)).toEqual(first);
    expect(tileCenter(circuit.entities[1]!, "east", { x: 2, y: 0 })).toEqual(circuit.entities[1]!.placement!.tile);
  });
});

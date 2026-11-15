// Circuits that between them have every setting of every entity kind and every kind of wire, in the circuit language. The unit
// tests export and import them; the game probe (tools/game-probe/blueprints.mjs) sends their blueprint strings through the game.
// Every signal, quality, instrument and note is one of Factorio 2.1.24 with all standard modules, so that the game takes them.

import { loadStandardCatalog, speakerInstrumentNames } from "@face/catalog";
import { analyze, printFragment } from "@face/language";
import {
  ENTITY_SETTINGS, entityNameBase, entityTable, facingOf, normalizedSettings, settingDefault, settingSpecsOf, signal, tileCenter, tileSize,
  type Circuit, type Condition, type Entity, type EntityPrototype, type EntitySettings, type SettingSpec, type SettingValue, type SpeakerInstrument, type Wire,
} from "@face/model";
import { exportBlueprint } from "../src/export.ts";
import type { BlueprintFile } from "../src/schema.ts";

export interface Sample {
  readonly label: string;
  /** Member declarations of a circuit, without `tile`: `placed` gives every entity its place. */
  readonly source: string;
}

// The generic entities (kind `entity`): one prototype per control behaviour of the settings table, each with every setting of its
// row away from its default, so that every field is written and the game is asked about every one of them.

const CONDITIONS: readonly Condition[] = [
  { first: signal("virtual", "signal-A"), comparator: ">", second: { type: "constant", value: 5 } },
  { first: signal("item", "iron-plate"), comparator: "<=", second: { type: "signal", signal: signal("virtual", "signal-B") } },
  { first: signal("virtual", "signal-anything"), comparator: "!=", second: { type: "constant", value: -3 } },
  { first: signal("virtual", "signal-everything"), comparator: "<", second: { type: "constant", value: 100 } },
  { first: signal("fluid", "water"), comparator: ">=", second: { type: "constant", value: 2147483647 } },
];

/** A value of a setting that is not its default; `index` is the position of the setting among those of its type in the row. */
export function sampleValue(spec: SettingSpec, prototype: Pick<EntityPrototype, "signals">, index: number): SettingValue {
  const fallback = settingDefault(spec, prototype);
  switch (spec.type) {
    case "boolean": return !spec.default;
    // The digits: no prototype has one of them as a default.
    case "signal": return signal("virtual", `signal-${index % 10}`);
    case "networks": return spec.field === "input_networks" ? { red: true, green: false } : { red: false, green: true };
    case "condition": return CONDITIONS[index % CONDITIONS.length]!;
    case "enum": return spec.values.findLast((entry) => entry.word !== fallback)!.word;
  }
}

/** The settings of a prototype with every one of them away from its default. */
export function configuredSettings(prototype: string): EntitySettings {
  const game = entityTable().byName.get(prototype)!;
  const counts = new Map<string, number>();
  const values = settingSpecsOf(prototype).map((spec): [string, SettingValue] => {
    const index = counts.get(spec.type) ?? 0;
    counts.set(spec.type, index + 1);
    return [spec.key, sampleValue(spec, game, index)];
  });
  return normalizedSettings(prototype, Object.fromEntries(values));
}

/** Settings the game takes and does not keep, because the prototype has nothing for them: no lab of the game burns fuel. */
export const NOT_HELD: Readonly<Record<string, readonly string[]>> = { lab: ["read-fuel"] };

/** The settings a prototype has in its sample: every one away from its default, but for the ones the game does not keep on it. */
export function sampledSettings(prototype: string): EntitySettings {
  return Object.fromEntries(Object.entries(configuredSettings(prototype)).filter(([key]) => !NOT_HELD[prototype]?.includes(key)));
}

/** Per sample the prototypes that stand in it, in rows of four behind a constant combinator. Those of one sample are about the same size. */
export const GENERIC_SAMPLES: readonly (readonly [label: string, prototypes: readonly string[]])[] = [
  ["generic entities: chests", ["steel-chest", "requester-chest", "linked-chest", "proxy-container"]],
  ["generic entities: belts and inserters", ["fast-inserter", "transport-belt", "splitter", "loader"]],
  ["generic entities: pipes, pumps and switches", ["pipe", "infinity-pipe", "pump", "offshore-pump", "power-switch", "heat-pipe", "accumulator"]],
  ["generic entities: walls, turrets and rails", ["stone-wall", "land-mine", "gun-turret", "display-panel", "rail-signal", "rail-chain-signal", "train-stop"]],
  // Machines that burn fuel, for 'read-fuel': the game does not keep it on an electric one.
  ["generic entities: machines", ["biochamber", "stone-furnace", "lab", "electric-mining-drill", "boiler"]],
  ["generic entities: towers and tanks", ["agricultural-tower", "artillery-turret", "asteroid-collector", "storage-tank", "radar"]],
  ["generic entities: reactor and roboport", ["nuclear-reactor", "roboport"]],
  ["generic entities: rocket silo", ["rocket-silo"]],
  ["generic entities: cargo landing pad", ["cargo-landing-pad"]],
  ["generic entities: space platform hub", ["space-platform-hub"]],
];

/** Entities per row of the layout. */
const COLUMNS = 4;
const CRAFTING_TYPES: ReadonlySet<string> = new Set(["assembling-machine", "furnace"]);

/**
 * The source of a sample of generic entities: a constant combinator and the prototypes, configured, each wired to the one before
 * it (the first of a row to the one above it), so that every one is on a circuit network and no wire is longer than it reaches.
 */
function genericSource(prototypes: readonly string[]): string {
  const base = { position: { x: 0, y: 0 } };
  const source: Entity = { ...base, id: "e0", name: "source", kind: "constant", prototype: "constant-combinator", enabled: true, sections: [{ active: true, multiplier: 1, filters: [{ signal: signal("virtual", "signal-A"), count: 1 }] }] };
  const counters = new Map<string, number>();
  const entities = prototypes.map((prototype, index): Entity => {
    const name = entityNameBase({ prototype });
    const count = (counters.get(name) ?? 0) + 1;
    counters.set(name, count);
    // A crafting machine has a direction only while its recipe uses its fluid boxes; the samples have no recipe.
    const placement = CRAFTING_TYPES.has(entityTable().byName.get(prototype)!.type) ? { placement: { direction: "north" as const } } : {};
    return { ...base, ...placement, id: `e${index + 1}`, name: `${name}${count}`, kind: "entity", prototype, settings: sampledSettings(prototype) };
  });
  const all = [source, ...entities];
  const side = (entity: Entity) => (entity.kind === "constant" ? "out" : "io") as "out" | "io";
  const wires = all.slice(1).map((entity, index): Wire => {
    const other = all[(index + 1) % COLUMNS === 0 ? index + 1 - COLUMNS : index]!;
    // One green wire per sample, for the second connector.
    return { color: index === 1 ? "green" : "red", a: { entity: other.id, side: side(other) }, b: { entity: entity.id, side: side(entity) } };
  });
  return printFragment({ entities: all, wires });
}

export const SAMPLES: readonly Sample[] = [
  {
    label: "constant combinators",
    source: `
      constant-combinator plain {
        item:iron-plate = 5  fluid:water = -3  virtual:signal-A@rare = 2147483647  space-location:nauvis = -2147483648
        recipe:iron-gear-wheel = 2  entity:small-biter = 3  asteroid-chunk:metallic-asteroid-chunk = 1  quality:legendary = 7  item:iron-ore@legendary = 9
      }
      constant-combinator off facing north { description = "line one\\nline two"  enabled = false  virtual:signal-B = 1 }
      constant-combinator grouped facing south {
        section "face probe ore" { active = false  multiplier = -0.5  item:iron-ore = 1  item:copper-ore = 2 }
        section { virtual:signal-C = 3 }
        section "face probe empty" { }
      }
      constant-combinator scaled facing west { section { multiplier = 2.5  virtual:signal-D = 4 } }
      constant-combinator blank { }
      constant-combinator zero { virtual:signal-Z = 0 }
      wire red plain.out <-> off.out
      wire green grouped.out <-> scaled.out
    `,
  },
  {
    label: "arithmetic combinators, first half of the operations",
    source: `
      arithmetic-combinator mul { virtual:signal-A = virtual:signal-B * 2 }
      arithmetic-combinator div facing north { virtual:signal-A = virtual:signal-B[red] / -3 }
      arithmetic-combinator add facing south { virtual:signal-A = 2147483647 + virtual:signal-B[green] }
      arithmetic-combinator sub facing west { item:iron-plate@rare = virtual:signal-A[red] - virtual:signal-B[green] }
      arithmetic-combinator mod { description = "remainder"  fluid:water = item:iron-plate % item:copper-plate }
      arithmetic-combinator pow { virtual:signal-A = -2147483648 ^ 2 }
      arithmetic-combinator zero_first { virtual:signal-A = 0 + virtual:signal-B }
      arithmetic-combinator zeros { virtual:signal-A = 0 * 0 }
      arithmetic-combinator blank { }
      wire red mul.out <-> div.in
      wire green add.out <-> add.in
    `,
  },
  {
    label: "arithmetic combinators, second half of the operations",
    source: `
      arithmetic-combinator shl { virtual:signal-A = 1 << virtual:signal-B }
      arithmetic-combinator shr { virtual:signal-A = virtual:signal-B >> 1 }
      arithmetic-combinator band { virtual:signal-A = virtual:signal-B AND 255 }
      arithmetic-combinator bor { virtual:signal-A = virtual:signal-B OR virtual:signal-C }
      arithmetic-combinator bxor { virtual:signal-A = virtual:signal-B XOR -1 }
      arithmetic-combinator every { each = each[red] * virtual:signal-A[green] }
      arithmetic-combinator both { each = each + each }
      arithmetic-combinator sum { virtual:signal-S = each[none] + 0 }
    `,
  },
  {
    label: "decider combinators",
    source: `
      decider-combinator gate {
        description = "a gate"
        when virtual:signal-A > 5 and virtual:signal-B[red] != virtual:signal-C[green] or item:iron-plate <= -1 or fluid:water = 0
        output virtual:signal-A = input
        output virtual:signal-C = 7
        output item:iron-plate@rare = input[red]
        else output virtual:signal-D = input[green]
        else output virtual:signal-E = 1
      }
      decider-combinator each_gate facing north { when each >= 10 and each < 20  output each = input  output virtual:signal-N = 1 }
      decider-combinator any facing south { when anything > virtual:signal-A[none]  output anything = input  else output virtual:signal-Z = -5 }
      decider-combinator all facing west { when everything < 100  output everything = input[green] }
      decider-combinator one { when virtual:signal-A = 1  output virtual:signal-A = 1 }
      decider-combinator zero { when virtual:signal-A < 0  output virtual:signal-F = 0 }
      decider-combinator undecided { when virtual:signal-A > 1 }
      decider-combinator otherwise { when virtual:signal-A > 1  else output virtual:signal-B = 2 }
      decider-combinator unconditional { output virtual:signal-A = 3 }
      decider-combinator blank { }
      wire red gate.out <-> gate.in
      wire green gate.out <-> each_gate.in
    `,
  },
  {
    label: "selector combinators, select count random",
    source: `
      selector-combinator fresh { }
      selector-combinator lowest { operation = select  order = min  index = 2 }
      selector-combinator indexed facing north { description = "by index"  operation = select  index = virtual:signal-I  index-comparator = >= }
      selector-combinator upto facing south { operation = select  index = 3  index-comparator = < }
      selector-combinator counter facing west { operation = count  output = virtual:signal-C }
      selector-combinator uncounted { operation = count }
      selector-combinator rnd { operation = random  interval = 60 }
      selector-combinator rnd0 { operation = random }
    `,
  },
  {
    label: "selector combinators, the other modes",
    source: `
      selector-combinator stack { operation = stack-size }
      selector-combinator rocket { operation = rocket-capacity }
      selector-combinator qf { operation = quality-filter  quality = rare  comparator = > }
      selector-combinator qany { operation = quality-filter }
      selector-combinator qs { operation = quality-select  order = lowest }
      selector-combinator qt1 { operation = quality-transfer  source = legendary  destination = each }
      selector-combinator qt2 { operation = quality-transfer  source = signal  source-signal = item:iron-plate  destination = virtual:signal-Q }
      selector-combinator clock { operation = time  day-length = virtual:signal-L  day-tick = virtual:signal-D  game-tick = virtual:signal-T }
    `,
  },
  {
    label: "selector combinators, defaults of the modes",
    source: `
      selector-combinator qhigh { operation = quality-select }
      selector-combinator qnormal { operation = quality-transfer }
      selector-combinator qsignal { operation = quality-transfer  source = signal }
      selector-combinator idle_clock { operation = time }
      selector-combinator qequal { operation = quality-filter  quality = normal }
    `,
  },
  {
    label: "lamps",
    source: `
      small-lamp plain { }
      small-lamp lit { always-on = true  color = #ff8000 }
      small-lamp enabled { when virtual:signal-A > 0 }
      small-lamp compared { when anything >= virtual:signal-B  networks = green }
      small-lamp mapped { when everything != 5  networks = red  colors = mapping }
      small-lamp parts { colors = components  red = virtual:signal-1  green = virtual:signal-2  blue = virtual:signal-3 }
      small-lamp packed { networks = none  colors = packed-rgb  rgb = item:iron-plate@rare }
      constant-combinator source { virtual:signal-A = 1 }
      wire red source.out <-> enabled.in
      wire green source.out <-> compared.in
    `,
  },
  {
    label: "electric poles",
    source: `
      small-electric-pole small { }
      medium-electric-pole medium { }
      big-electric-pole big { }
      substation sub { }
      constant-combinator source { virtual:signal-A = 1 }
      small-lamp light { when virtual:signal-A > 0 }
      wire red source.out <-> small
      wire red small <-> medium
      wire red medium <-> big
      wire red big <-> sub
      wire red sub <-> light.in
      wire green small <-> sub
    `,
  },
  {
    label: "programmable speakers",
    source: `
      programmable-speaker quiet { }
      programmable-speaker alarm {
        when virtual:signal-A > 0
        instrument = alarms  note = siren  volume = 62.5  volume-signal = virtual:signal-V  playback = global
        polyphony = true  stop-playing-sounds = true  show-alert = true  show-on-map = false
        alert-icon = item:iron-plate  alert-message = "Out of \\"plates\\"\\nagain"
      }
      programmable-speaker tune { pitch = virtual:signal-P  instrument = piano  playback = surface  volume = 0 }
      programmable-speaker chime { when everything < virtual:signal-B  instrument = drum-kit  note = hat-1  volume = 80 }
      programmable-speaker first_note { when item:iron-plate = 0  instrument = bass }
      programmable-speaker other_note { when anything != 1  note = alarm-2  show-alert = true }
      programmable-speaker plain_condition { when virtual:signal-A < 0 }
      programmable-speaker stopping { stop-playing-sounds = true }
      constant-combinator source { virtual:signal-A = 1 }
      wire red source.out <-> alarm.in
      wire green source.out <-> tune.in
    `,
  },
  {
    label: "wires between every kind of connection point",
    source: `
      constant-combinator c1 { virtual:signal-A = 1 }
      constant-combinator c2 facing south { virtual:signal-B = 1 }
      decider-combinator d1 { when virtual:signal-A > 0  output virtual:signal-A = input }
      arithmetic-combinator a1 facing north { virtual:signal-A = virtual:signal-A + 1 }
      small-lamp l1 { }
      small-lamp l2 { }
      small-electric-pole p1 { }
      medium-electric-pole p2 { }
      wire red c1.out <-> c2.out
      wire green c1.out <-> d1.in
      wire red c1.out <-> d1.out
      wire green c1.out <-> l1.in
      wire red c1.out <-> p1
      wire red d1.in <-> a1.in
      wire green d1.in <-> a1.out
      wire red d1.in <-> d1.out
      wire green d1.out <-> d1.in
      wire red d1.out <-> a1.out
      wire green d1.out <-> l1.in
      wire red d1.in <-> l2.in
      wire green d1.in <-> p1
      wire green d1.out <-> p2
      wire red l1.in <-> l2.in
      wire green l1.in <-> p1
      wire red p1 <-> p2
      wire green p1 <-> p2
    `,
  },
  {
    label: "a counter with a speaker",
    source: `
      constant-combinator one { virtual:signal-A = 1 }
      decider-combinator counter facing west { when virtual:signal-A < 600  output virtual:signal-A = input }
      selector-combinator seconds facing south { operation = time  game-tick = virtual:signal-T }
      programmable-speaker bell { when virtual:signal-A = 599  instrument = miscellaneous }
      wire red one.out <-> counter.in
      wire green counter.out <-> counter.in
      wire green counter.out <-> bell.in
      wire red seconds.out <-> bell.in
    `,
  },
  ...GENERIC_SAMPLES.map(([label, prototypes]): Sample => ({ label, source: genericSource(prototypes) })),
  {
    // Where a new entity of the game does not have what the editor calls nothing: the open-gate flag of a wall is on, the
    // conditions of a splitter are set.
    label: "generic entities: defaults of the game that are not blank",
    source: `
      constant-combinator source { virtual:signal-A = 1 }
      stone-wall sensor { read-sensor = true }
      splitter sides { input-left when virtual:signal-I < 0  input-right when virtual:signal-I > 0  output-left when virtual:signal-O < 0  output-right when virtual:signal-O > 0 }
      splitter left_only { input-left when virtual:signal-A > 5 }
      splitter right_out { output-right when virtual:signal-B > 6 }
      blue-chest chest_blue { }
      red-chest chest_red { }
      crash-site-chest-1 crash1 { }
      crash-site-chest-2 crash2 { }
      wire red source.out <-> sensor
      wire red source.out <-> sides
      wire red sides <-> left_only
      wire red left_only <-> right_out
      wire red source.out <-> chest_blue
      wire red chest_blue <-> chest_red
      wire red chest_red <-> crash1
      wire red crash1 <-> crash2
    `,
  },
];

/** The prototype types of the settings table that no sample has; every control behaviour should be in one. */
export function unsampledBehaviors(): string[] {
  const types = new Set(GENERIC_SAMPLES.flatMap(([, prototypes]) => prototypes.map((prototype) => entityTable().byName.get(prototype)!.type)));
  const sampled = new Set([...types].map((type) => ENTITY_SETTINGS[type]!.behavior));
  // A row whose behaviour is assumed is asked about by itself.
  return Object.entries(ENTITY_SETTINGS).filter(([type, row]) => (row.assumed ? !types.has(type) : !sampled.has(row.behavior))).map(([type]) => type);
}

export const INSTRUMENTS: readonly SpeakerInstrument[] = speakerInstrumentNames(loadStandardCatalog());

/**
 * Every entity on a square cell of its own, four to a row: room for each footprint in any direction. A cell is two tiles wide, with
 * which nothing in a sample of up to twelve small entities is further apart than a wire reaches, and as wide as the largest
 * footprint where a circuit has larger entities.
 */
export function placed(circuit: Circuit): Circuit {
  const cell = Math.max(2, ...circuit.entities.map((entity) => Math.max(tileSize(entity).width, tileSize(entity).height)));
  return {
    ...circuit,
    entities: circuit.entities.map((entity, index) => {
      const origin = { x: (index % COLUMNS) * cell, y: Math.floor(index / COLUMNS) * cell };
      return { ...entity, placement: { ...entity.placement, tile: tileCenter(entity, facingOf(entity), origin) } };
    }),
  };
}

/** The circuit of a sample, placed. Throws when its source has an error. */
export function sampleCircuit(sample: Sample): Circuit {
  const parsed = analyze(`circuit ${JSON.stringify(sample.label)} {\n${sample.source}\n}\n`, undefined, { instruments: INSTRUMENTS });
  const problems = parsed.diagnostics.filter((diagnostic) => diagnostic.severity === "error" || diagnostic.code.startsWith("unknown-"));
  if (!parsed.circuit || problems.length) throw new Error(`Sample '${sample.label}': ${problems.map((problem) => problem.message).join("; ")}`);
  return placed(parsed.circuit);
}

export interface ExportedSample {
  readonly label: string;
  readonly string: string;
  readonly data: BlueprintFile;
}

/** The blueprint of every sample as this package exports it. */
export function exportedSamples(): ExportedSample[] {
  return SAMPLES.map((sample) => {
    const result = exportBlueprint(sampleCircuit(sample), { instruments: INSTRUMENTS });
    if (!result.ok) throw new Error(`Sample '${sample.label}': ${result.problems.map((problem) => problem.message).join("; ")}`);
    return { label: sample.label, string: result.string, data: result.data };
  });
}

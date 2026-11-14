// The entity table: every prototype a circuit wire can connect to, with what the editor needs to place and wire it.
// Pure, like build.mjs. Rules and their provenance: packages/catalog/README.md "Entity table", docs/factorio-audit.md 13.
import { collapseAll, moduleAlgebra } from "./build.mjs";

/** `default_circuit_wire_max_distance` of the game (core/lualib/circuit-connector-sprites.lua). */
export const STANDARD_WIRE_REACH = 9;
/** What a record of the table has when it does not say. `placedBy` defaults to the item of the entity's own name. */
export const ENTITY_DEFAULTS = { width: 1, height: 1, directions: 1, wireReach: STANDARD_WIRE_REACH, modules: ["base"] };
const FIELDS = ["name", "type", "displayName", "width", "height", "directions", "wireReach", "hidden", "offGrid", "collisionBox", "placedBy", "signals", "modules", "removedBy"];
const NORMAL_QUALITY = "normal";

const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// The game serialises an empty Lua table as {}.
const asArray = (value) => (Array.isArray(value) ? value : []);
const count = (value) => (value && typeof value === "object" ? Object.keys(value).length : 0);

/**
 * PROVISIONAL: whether a prototype can be turned, by prototype type. `data.raw` does not say; the game does at run time
 * (`LuaEntityPrototype.supports_direction`), which the runtime dump records since this table exists. A dump that has it is the
 * source, and the build fails where it disagrees with an entry here. Until the generator has run against the game once
 * (`make catalog`), `--from-dumps` builds from these entries: the editor's ten prototypes as the model had them by hand, the
 * rest from the game's changelog and from the directions in the blueprint strings the game ships (docs/factorio-audit.md 13.4).
 */
// Changelog 2.0.25: "Fixed that assemblers without fluid boxes were incorrectly considered rotatable"; one that is not square has to turn.
const craftingMachine = (proto, size) => count(proto.fluid_boxes) > 0 || size.width !== size.height;
export const PROVISIONAL_ROTATION = {
  accumulator: false,
  "agricultural-tower": false,
  "ammo-turret": true,
  "arithmetic-combinator": true,
  "artillery-turret": false,
  "assembling-machine": craftingMachine,
  "asteroid-collector": true,
  boiler: true,
  "cargo-landing-pad": false,
  "constant-combinator": true,
  container: false,
  "decider-combinator": true,
  "display-panel": false,
  "electric-pole": false,
  "electric-turret": true,
  "fluid-turret": true,
  furnace: craftingMachine,
  "heat-pipe": false,
  "infinity-container": false,
  "infinity-pipe": false,
  inserter: true,
  lab: false,
  lamp: false,
  "land-mine": false,
  "linked-container": false,
  loader: true,
  "logistic-container": false,
  "mining-drill": true,
  "offshore-pump": true,
  pipe: false,
  "pipe-to-ground": true,
  "power-switch": false,
  "programmable-speaker": false,
  "proxy-container": false,
  pump: true,
  radar: false,
  "rail-chain-signal": true,
  "rail-signal": true,
  reactor: false,
  roboport: false,
  "rocket-silo": false,
  "selector-combinator": true,
  "space-platform-hub": false,
  splitter: true,
  "storage-tank": true,
  "train-stop": true,
  "transport-belt": true,
  wall: false,
};

/**
 * The selection rule: how far a circuit wire of the prototype reaches, in tiles; 0 for one that takes none. An electric pole
 * and a power switch have one distance for copper and circuit wires, under a field of their own.
 */
export function wireReachOf(type, proto) {
  const reach = proto.circuit_wire_max_distance > 0 ? proto.circuit_wire_max_distance : type === "electric-pole" ? proto.maximum_wire_distance : type === "power-switch" ? proto.wire_max_distance : 0;
  return reach > 0 ? reach : 0;
}

/** Every prototype of `data.raw` a circuit wire connects to, as [{ type, proto }]. */
export function circuitEntities(raw) {
  return Object.entries(raw).flatMap(([type, protos]) => Object.values(protos).filter((proto) => wireReachOf(type, proto) > 0).map((proto) => ({ type, proto })));
}

/** [left, top, right, bottom] of a collision box, which the dump has as [[x, y], [x, y]] or as { left_top, right_bottom }. */
function collisionBox(proto) {
  const box = proto.collision_box;
  const [from, to] = Array.isArray(box) ? box : [box?.left_top, box?.right_bottom];
  const point = (value) => (Array.isArray(value) ? value : [value?.x, value?.y]);
  const out = [...point(from), ...point(to)];
  if (!out.every(Number.isFinite)) throw new Error(`${proto.name}: no collision box`);
  return out;
}

/** The tiles of a prototype facing north: `tile_width` and `tile_height` where it has them, else the size of the collision box rounded up. */
function footprint(proto) {
  const box = collisionBox(proto);
  const ofBox = { width: Math.ceil(box[2] - box[0]), height: Math.ceil(box[3] - box[1]) };
  const size = { width: proto.tile_width ?? ofBox.width, height: proto.tile_height ?? ofBox.height };
  return { ...size, ...(sameJson(size, ofBox) ? {} : { collisionBox: box }) };
}

const signalOf = (value) => `${value.type ?? "item"}:${value.name}`;
/** `default_<key>_signal` fields of a prototype as { key: "kind:name" }. */
const defaultSignals = (proto) => Object.fromEntries(Object.entries(proto).flatMap(([field, value]) => {
  const key = /^default_(.+)_signal$/.exec(field)?.[1];
  return key && value?.name ? [[key, signalOf(value)]] : [];
}).sort(([a], [b]) => compare(a, b)));

function directionsOf(proto, rotates) {
  const flags = asArray(proto.flags);
  if (!rotates) return 1;
  return flags.includes("building-direction-16-way") ? 16 : flags.includes("building-direction-8-way") ? 8 : proto.two_direction_only ? 2 : 4;
}

/** The reach of circuit wires by the runtime dump, as tools/game-probe/wire-reach.lua takes it: a pole, and whatever has no circuit distance, has its wire distance. */
function reachAt(fact, quality) {
  const circuit = fact.circuit_wire_distance?.[quality];
  return fact.type === "electric-pole" || !(circuit > 0) ? fact.wire_distance?.[quality] : circuit;
}

/** What the runtime dump says against the record derived from `data.raw`, as sentences; none when they agree. */
function runtimeProblems(record, type, proto, fact) {
  const problems = [];
  const differs = (what, game, derived) => game !== derived && problems.push(`${record.name}: ${what} is ${game} at run time, ${derived} as derived from data.raw`);
  differs("type", fact.type, type);
  differs("tile size", `${fact.tile_width} x ${fact.tile_height}`, `${record.width} x ${record.height}`);
  differs("wire reach", reachAt(fact, NORMAL_QUALITY), record.wireReach);
  const rule = PROVISIONAL_ROTATION[type];
  const provisional = typeof rule === "function" ? rule(proto, record) : rule;
  if (provisional !== undefined && provisional !== fact.supports_direction) {
    problems.push(`${record.name}: supports_direction is ${fact.supports_direction} at run time, the provisional rotation table says ${provisional} for type ${type}`);
  }
  const flags = asArray(fact.flags);
  for (const flag of ["placeable-off-grid", "building-direction-8-way", "building-direction-16-way"]) differs(`flag ${flag}`, flags.includes(flag), asArray(proto.flags).includes(flag));
  const ways = asArray(proto.flags).find((flag) => flag.startsWith("building-direction-"));
  if (ways && !fact.supports_direction) problems.push(`${record.name}: has the flag ${ways}, but supports_direction is false at run time`);
  // Fields the scenario could not read are absent; one the prototype does not have is false.
  if (fact.optional?.two_direction_only !== undefined) differs("two_direction_only", fact.optional.two_direction_only === true, proto.two_direction_only === true);
  // The scenario has the default signals the game answered with: one that data.raw lacks is a default of the engine's own.
  const signals = defaultSignals(proto);
  for (const [field, value] of Object.entries(fact.default_signals ?? {})) {
    const key = /^default_(.+)_signal$/.exec(field)?.[1];
    if (key) differs(field, signalOf(value), signals[key] ?? "absent");
  }
  return problems;
}

/**
 * The full records of one module set by name, and what its runtime dump says against them. `lenient` is for a game with
 * mods, where nothing proves the derivation: a prototype that cannot be derived, or that the game contradicts, is left out
 * and named in `leftOut` instead of failing the build.
 */
function entitiesOfSet({ id, raw, runtime, locale }, lenient) {
  if (runtime.circuit_entities_error) throw new Error(`${id}: the runtime scenario (tools/catalog/runtime-dump/control.lua) could not read the wired entities: ${runtime.circuit_entities_error}`);
  const placing = new Map(runtime.entity.map((entry) => [entry.name, entry]));
  const facts = runtime.circuit_entities === undefined ? undefined : new Map(asArray(runtime.circuit_entities).map((fact) => [fact.name, fact]));
  const derive = ({ type, proto }) => {
    const { name } = proto;
    const entry = placing.get(name);
    if (!entry) throw new Error(`${name} (${type}) takes a circuit wire in data.raw of ${id}, but the game has no entity of that name`);
    const fact = facts?.get(name);
    const size = footprint(proto);
    const rule = PROVISIONAL_ROTATION[type];
    const rotates = fact?.supports_direction ?? (typeof rule === "function" ? rule(proto, size) : rule);
    if (rotates === undefined) throw new Error(`${name}: no rotation rule for prototype type ${type}; add it to PROVISIONAL_ROTATION in tools/catalog/lib/entities.mjs or dump from the game`);
    const record = {
      name,
      type,
      displayName: locale.entity?.[name] ?? name,
      width: size.width,
      height: size.height,
      directions: directionsOf(proto, rotates),
      wireReach: wireReachOf(type, proto),
      hidden: entry.hidden === true,
      offGrid: asArray(proto.flags).includes("placeable-off-grid"),
      ...(size.collisionBox && { collisionBox: size.collisionBox }),
      placedBy: asArray(entry.items_to_place_this),
      signals: defaultSignals(proto),
    };
    const problems = [];
    if ((proto.hidden === true) !== record.hidden) problems.push(`${name}: hidden is ${record.hidden} at run time, ${proto.hidden === true} in data.raw`);
    if (facts && !fact) problems.push(`${name}: takes a circuit wire by data.raw (reach ${record.wireReach}), but has no wire reach at run time`);
    if (fact) problems.push(...runtimeProblems(record, type, proto, fact));
    return { record, problems };
  };
  const records = new Map();
  const problems = [];
  const leftOut = [];
  const selected = new Set();
  for (const candidate of circuitEntities(raw)) {
    selected.add(candidate.proto.name);
    let derived;
    try {
      derived = derive(candidate);
    } catch (error) {
      if (!lenient) throw error;
      derived = { problems: [error.message] };
    }
    if (lenient && derived.problems.length) leftOut.push(...derived.problems);
    else {
      problems.push(...derived.problems);
      records.set(derived.record.name, derived.record);
    }
  }
  for (const name of facts?.keys() ?? []) if (!selected.has(name)) (lenient ? leftOut : problems).push(`${name}: has a wire reach at run time, but the selection rule on data.raw does not find it`);
  return { records, problems, leftOut, checked: facts !== undefined };
}

/** How the reach changes with quality, per prototype whose reach does: for the generator's log, not part of the table. */
function qualityReach(sets) {
  const out = new Map();
  for (const { runtime } of sets) {
    for (const fact of asArray(runtime.circuit_entities)) {
      const distances = Object.fromEntries(Object.keys(fact.wire_distance ?? {}).map((quality) => [quality, reachAt(fact, quality)]));
      if (new Set(Object.values(distances)).size > 1) out.set(fact.name, distances);
    }
  }
  return out;
}

/** A record as the file has it: fields in one order, defaults left out. */
function compact(record) {
  const out = {};
  for (const field of FIELDS) {
    const value = record[field];
    const atDefault = field in ENTITY_DEFAULTS ? sameJson(value, ENTITY_DEFAULTS[field]) : field === "placedBy" ? sameJson(value, [record.name]) : field === "signals" && count(value) === 0;
    if (value !== undefined && value !== false && !atDefault) out[field] = value;
  }
  const unknown = Object.keys(record).filter((field) => !FIELDS.includes(field));
  if (unknown.length) throw new Error(`Unordered entity field(s): ${unknown.join(", ")}`);
  return out;
}

/**
 * @param sets  as for `buildCatalog`: [{ id, mods, raw, runtime, locale }] for every valid module set
 * @param options  `lenient`: leave out what cannot be derived or what the game contradicts and say so in the notes (see
 *   `entitiesOfSet`); `generator`: what the head of the table names as its origin
 * @returns { table, notes }: the table as the file has it, and remarks for the log. Throws when a module set has another
 *   record for a prototype than the others, and when a runtime dump with `circuit_entities` contradicts the derivation.
 */
export function buildEntityTable({ sets, modules, game }, { lenient = false, generator = "tools/catalog/generate.mjs" } = {}) {
  sets = [...sets].sort((a, b) => a.mods.length - b.mods.length || compare(a.id, b.id));
  const perSet = sets.map((set) => entitiesOfSet(set, lenient));
  const checked = perSet.map((set) => set.checked);
  if (new Set(checked).size > 1) {
    throw new Error(`Only some runtime dumps have circuit_entities (${sets.filter((_, index) => checked[index]).map((set) => set.id).join(", ")}); dump all module sets again`);
  }

  const disagreements = new Map();
  perSet.forEach(({ problems }, index) => problems.forEach((problem) => disagreements.set(problem, [...(disagreements.get(problem) ?? []), sets[index].id])));
  if (disagreements.size) {
    const lines = [...disagreements].sort(([a], [b]) => compare(a, b)).map(([problem, ids]) => `  ${problem}${ids.length === sets.length ? "" : ` (${ids.join(", ")})`}`);
    throw new Error(`The game contradicts the entity table (tools/catalog/lib/entities.mjs) in ${lines.length} point(s):\n${lines.join("\n")}`);
  }

  // The table has one record per prototype and no variants: every module set that has the prototype must say the same.
  const first = new Map();
  perSet.forEach(({ records }, index) => {
    for (const [name, record] of records) {
      if (!first.has(name)) first.set(name, [sets[index].id, record]);
      const [id, reference] = first.get(name);
      const differing = Object.keys({ ...reference, ...record }).filter((field) => !sameJson(reference[field], record[field]));
      const both = (field) => `${field} is ${JSON.stringify(reference[field])} in ${id} and ${JSON.stringify(record[field])} in ${sets[index].id}`;
      if (differing.length) throw new Error(`entity ${name}: ${differing.map(both).join("; ")}`);
    }
  });

  const entities = collapseAll("entity", perSet.map((set) => set.records), sets, moduleAlgebra(modules)).map(compact);
  const byQuality = qualityReach(sets);
  const notes = [];
  if (!checked[0]) notes.push("the runtime dumps predate circuit_entities: rotation is from the provisional table in tools/catalog/lib/entities.mjs; run `make catalog` to check it against the game");
  if (byQuality.size) {
    const [name, distances] = [...byQuality][0];
    const example = Object.entries(distances).map(([quality, reach]) => `${quality} ${reach}`).join(", ");
    notes.push(`the wire reach of ${byQuality.size} prototypes grows with quality (${name}: ${example}); the entity table has the reach at normal quality`);
  }
  for (const { leftOut } of perSet) notes.push(...leftOut.map((reason) => `left out: ${reason}`));
  return { table: { schema: 1, game, generator, runtimeChecked: checked[0] === true, defaults: ENTITY_DEFAULTS, entities }, notes };
}

/** One record per line, the head pretty-printed: line-diffable, and the same text for the same table. */
export function entityTableText({ entities, ...head }) {
  const fields = Object.entries(head).map(([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)}`);
  return `{\n${fields.join(",\n")},\n  "entities": [\n${entities.map((record) => `    ${JSON.stringify(record)}`).join(",\n")}\n  ]\n}\n`;
}

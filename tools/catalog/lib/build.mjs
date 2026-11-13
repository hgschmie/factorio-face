// Pure transformation: per-module-set dumps -> catalog data. No file or process access, so it can be unit tested.
import { iconLayers, normaliseColor } from "./icons.mjs";

/** Signal kinds in catalog order, with the runtime dump section, the locale/prototype name and the default prototype type. */
export const KINDS = [
  { kind: "item", section: "item", locale: "item", prototype: "item" },
  { kind: "fluid", section: "fluid", locale: "fluid", prototype: "fluid" },
  { kind: "virtual", section: "virtual_signal", locale: "virtual-signal", prototype: "virtual-signal" },
  { kind: "entity", section: "entity", locale: "entity", prototype: undefined },
  { kind: "recipe", section: "recipe", locale: "recipe", prototype: "recipe" },
  { kind: "space-location", section: "space_location", locale: "space-location", prototype: "space-location" },
  { kind: "asteroid-chunk", section: "asteroid_chunk", locale: "asteroid-chunk", prototype: "asteroid-chunk" },
  { kind: "quality", section: "quality", locale: "quality", prototype: "quality" },
];
export const LOCALE_SECTIONS = [...KINDS.map((k) => k.locale), "item-group"];
/** Names the game shows for the instruments and notes of a speaker; they are not prototypes, so the generator reads them from the modules' locale files. */
export const SPEAKER_LOCALE_SECTIONS = ["programmable-speaker-instrument", "programmable-speaker-note"];

const WILDCARDS = { "signal-everything": "everything", "signal-anything": "anything", "signal-each": "each" };
const UNKNOWN_ICON = [{ icon: "__core__/graphics/icons/unknown.png", size: 64 }];
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const canonical = (value) => JSON.stringify(value, (_, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([x], [y]) => compare(x, y))) : v));
const sameJson = (a, b) => canonical(a) === canonical(b);
const asArray = (value) => (Array.isArray(value) ? value : []); // the game serialises an empty Lua table as {}
const isEmpty = (value) => value === undefined || value === null || value === false || (Array.isArray(value) && value.length === 0);

/**
 * Which signals the game offers in its signal selection GUI. The engine does not export this decision, so it is
 * derived from the finalised prototype flags; see packages/catalog/README.md for the reasoning behind each rule.
 */
export function visibilityOf(signal) {
  if (signal.wildcard) return "wildcard";
  if (signal.parameter || (signal.special && !signal.hidden)) return "parameter";
  if (signal.hidden || signal.hideFromSignalGui || signal.placedBy?.length) return "hidden";
  return "normal";
}

function hexColor(color) {
  const [r, g, b] = normaliseColor(color);
  return `#${[r, g, b].map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * The speaker prototypes of one set with their instruments and notes in the prototype's order: a blueprint names a sound by
 * its position in these lists (`instrument_id`, `note_id`, from 0). `noteNames` has the display names that differ from the name.
 */
function speakersOfSet({ raw, locale }) {
  const instrumentNames = locale["programmable-speaker-instrument"] ?? {};
  const noteNames = locale["programmable-speaker-note"] ?? {};
  return new Map(Object.values(raw["programmable-speaker"] ?? {}).map((proto) => {
    const instruments = asArray(proto.instruments).map((instrument) => {
      const notes = asArray(instrument.notes).map((note) => note.name);
      const named = Object.fromEntries(notes.filter((note) => noteNames[note] !== undefined && noteNames[note] !== note).map((note) => [note, noteNames[note]]));
      return { name: instrument.name, displayName: instrumentNames[instrument.name] ?? instrument.name, notes, ...(Object.keys(named).length ? { noteNames: named } : {}) };
    });
    return [proto.name, { name: proto.name, maximumPolyphony: proto.maximum_polyphony, instruments }];
  }));
}

/** The records of one module set: signals per kind keyed by name, plus groups, subgroups, constants and rocket silos. */
function recordsOfSet(set, fallbackNames) {
  const { raw, runtime, locale } = set;
  const itemProto = (name) => {
    const entry = runtime.item.find((item) => item.name === name);
    return entry && raw[entry.type]?.[name];
  };
  const signals = {};
  for (const { kind, section, locale: localeSection, prototype } of KINDS) {
    signals[kind] = new Map();
    for (const entry of runtime[section]) {
      const proto = raw[entry.type]?.[entry.name];
      if (!proto) throw new Error(`${kind}:${entry.name} (${entry.type}) is missing from data.raw of ${set.id}`);
      const displayName = locale[localeSection]?.[entry.name] ?? fallbackNames.get(`${kind}:${entry.name}`) ?? entry.name;
      const record = { name: entry.name, displayName, order: entry.order, subgroup: entry.subgroup };
      if (entry.type !== prototype) record.prototype = entry.type;
      if (entry.hidden) record.hidden = true;
      if (entry.parameter) record.parameter = true;
      let layers = iconLayers(proto);
      if (kind === "item") {
        record.stackSize = entry.stack_size;
        record.weight = entry.weight;
      } else if (kind === "virtual") {
        if (entry.special) record.special = true;
        if (WILDCARDS[entry.name]) record.wildcard = WILDCARDS[entry.name];
      } else if (kind === "entity") {
        const placedBy = asArray(entry.items_to_place_this);
        if (placedBy.length) record.placedBy = placedBy;
        layers ??= placedBy.map((item) => iconLayers(itemProto(item) ?? {})).find(Boolean);
      } else if (kind === "recipe") {
        if (entry.hide_from_signal_gui) record.hideFromSignalGui = true;
        const products = asArray(entry.products);
        const product = entry.main_product ?? (products.length === 1 ? products[0] : undefined);
        if (!layers && product) layers = iconLayers((product.type === "fluid" ? raw.fluid[product.name] : itemProto(product.name)) ?? {});
      } else if (kind === "asteroid-chunk") {
        if (entry.hide_from_signal_gui) record.hideFromSignalGui = true;
        if (entry.item_signal_alias) record.itemAlias = entry.item_signal_alias;
      } else if (kind === "quality") {
        record.level = entry.level;
        if (entry.next) record.next = entry.next;
        record.color = hexColor(entry.color);
      }
      const visibility = visibilityOf(record);
      if (visibility !== "normal") record.visibility = visibility;
      record.icon = JSON.stringify(layers ?? UNKNOWN_ICON);
      signals[kind].set(entry.name, record);
    }
  }
  const groups = new Map(runtime.item_group.map((group) => {
    const layers = iconLayers(raw["item-group"][group.name]) ?? UNKNOWN_ICON;
    return [group.name, { name: group.name, displayName: locale["item-group"]?.[group.name] ?? group.name, order: group.order, icon: JSON.stringify(layers) }];
  }));
  const subgroups = new Map(runtime.item_subgroup.map((subgroup) => [subgroup.name, { name: subgroup.name, group: subgroup.group, order: subgroup.order }]));
  const utility = raw["utility-constants"].default;
  const constants = { name: "constants", defaultItemWeight: utility.default_item_weight, rocketLiftWeight: utility.default_rocket_lift_weight };
  if (runtime.utility_constants.default_item_weight !== utility.default_item_weight) throw new Error(`default_item_weight differs between data.raw and the runtime in ${set.id}`);
  const silos = new Map(asArray(runtime.rocket_silos).map((silo) => [silo.name, { name: silo.name, liftWeight: silo.lift_weight, rocketPartsRequired: silo.rocket_parts_required }]));
  return { signals, groups, subgroups, constants: new Map([["constants", constants]]), silos, speakers: speakersOfSet(set) };
}

/** Module helpers bound to the dependency graph read from the info.json files. */
function moduleAlgebra(modules) {
  const byName = new Map(modules.map((m) => [m.name, m]));
  const closure = (names) => {
    const out = new Set();
    const visit = (name) => {
      if (out.has(name)) return;
      out.add(name);
      byName.get(name).requires.forEach(visit);
    };
    names.forEach(visit);
    return out;
  };
  /** Drops modules implied by the required dependencies of another listed module, and `implied` ones. */
  const reduce = (names, implied = new Set()) => {
    const kept = names.filter((name) => !implied.has(name) && !names.some((other) => other !== name && closure([other]).has(name)));
    return modules.map((m) => m.name).filter((name) => kept.includes(name));
  };
  return { names: modules.map((m) => m.name), closure, reduce };
}

function applyVariants(base, variants, enabled) {
  const out = { ...base };
  for (const variant of variants) {
    if (!variant.when.every((name) => enabled.includes(name))) continue;
    for (const [field, value] of Object.entries(variant)) {
      if (field === "when") continue;
      if (value === null) delete out[field];
      else out[field] = value;
    }
  }
  return out;
}

/**
 * Collapses the per-set versions of one record into { ...baseRecord, modules, removedBy?, variants? } and proves that
 * the collapsed form reproduces every dumped set exactly.
 */
function collapse(label, versions, sets, algebra) {
  const present = sets.filter((set) => versions.has(set.id));
  const minimal = present.filter((set) => !present.some((other) => other !== set && other.mods.every((name) => set.mods.includes(name))));
  if (minimal.length !== 1) throw new Error(`${label}: no unique minimal module set (${minimal.map((s) => s.id).join(", ")})`);
  const required = minimal[0].mods;
  const modules = algebra.reduce(required);
  const implied = algebra.closure(required);
  const expected = sets.filter((set) => required.every((name) => set.mods.includes(name)));
  const absent = expected.filter((set) => !versions.has(set.id));
  let removedBy;
  if (absent.length) {
    // A module explains the absence when the record is missing from exactly the sets that contain the module.
    removedBy = algebra.names.filter((name) => !implied.has(name) && expected.every((set) => set.mods.includes(name) === absent.includes(set)));
    if (!removedBy.length) throw new Error(`${label}: absent in ${absent.map((s) => s.id).join(", ")}, which no single module explains`);
  }
  const base = versions.get(minimal[0].id);
  const variants = [];
  for (const set of present) {
    const actual = versions.get(set.id);
    const predicted = applyVariants(base, variants, set.mods);
    if (sameJson(predicted, actual)) continue;
    const patch = { when: algebra.reduce(set.mods, implied) };
    for (const field of new Set([...Object.keys(predicted), ...Object.keys(actual)])) {
      if (!sameJson(predicted[field], actual[field])) patch[field] = actual[field] ?? null;
    }
    variants.push(patch);
  }
  for (const set of sets) {
    const available = required.every((name) => set.mods.includes(name)) && !(removedBy ?? []).some((name) => set.mods.includes(name));
    if (available !== versions.has(set.id)) throw new Error(`${label}: provenance rule does not reproduce presence in ${set.id}`);
    if (available && !sameJson(applyVariants(base, variants, set.mods), versions.get(set.id))) throw new Error(`${label}: variants do not reproduce ${set.id}`);
  }
  return { ...base, modules, ...(removedBy ? { removedBy } : {}), ...(variants.length ? { variants } : {}) };
}

function collapseAll(label, perSet, sets, algebra) {
  const names = new Set(perSet.flatMap((records) => [...records.keys()]));
  return [...names].sort(compare).map((name) => {
    const versions = new Map();
    perSet.forEach((records, index) => records.has(name) && versions.set(sets[index].id, records.get(name)));
    return collapse(`${label} ${name}`, versions, sets, algebra);
  });
}

/**
 * @param sets  [{ id, mods, raw, runtime, locale: { [section]: { [name]: displayName } } }] for every valid module set
 * @param modules  module infos from info.json (name, title, version, requires, recommends, featureFlags)
 * @returns { catalog, icons } where icons maps an icon id to { layers, expected }
 */
export function buildCatalog({ sets, modules, game }) {
  const algebra = moduleAlgebra(modules);
  sets = [...sets].sort((a, b) => a.mods.length - b.mods.length || compare(a.id, b.id));

  // A prototype may lack a translation in a small module set (quality "normal" without the quality mod); use the name
  // from the largest set that has one before falling back to the prototype name.
  const fallbackNames = new Map();
  for (const set of sets) {
    for (const { kind, locale } of KINDS) for (const [name, text] of Object.entries(set.locale[locale] ?? {})) fallbackNames.set(`${kind}:${name}`, text);
  }

  const perSet = sets.map((set) => recordsOfSet(set, fallbackNames));
  const collapsed = (field, label) => collapseAll(label, perSet.map((records) => records[field]), sets, algebra);
  const signals = Object.fromEntries(KINDS.map(({ kind }) => [kind, collapseAll(kind, perSet.map((records) => records.signals[kind]), sets, algebra)]));
  const groups = collapsed("groups", "group");
  const subgroups = collapsed("subgroups", "subgroup");
  const [constants] = collapsed("constants", "constants");
  const rocketSilos = collapsed("silos", "rocket silo");
  const speakers = collapsed("speakers", "speaker");

  // Icon ids: identical layer stacks share one id. It is owned by the signal a user is most likely to associate with the
  // picture: visible before hidden, then kind order (an entity or recipe reuses the icon of its item), then name.
  const icons = new Map();
  const idBySpec = new Map();
  const assign = (spec, id, expected) => {
    const key = `${expected}|${spec}`;
    if (!idBySpec.has(key)) {
      idBySpec.set(key, id);
      icons.set(id, { layers: JSON.parse(spec), expected });
    }
    return idBySpec.get(key);
  };
  const owners = KINDS.flatMap(({ kind }, kindIndex) => signals[kind].map((record) => ({ record, id: `${kind}/${record.name}`, rank: (record.visibility === "hidden" ? KINDS.length : 0) + kindIndex })));
  owners.sort((a, b) => a.rank - b.rank || compare(a.record.name, b.record.name));
  for (const { record, id } of owners) assign(record.icon, id, 64);
  const assignRecord = (record, id, expected) => {
    record.icon = assign(record.icon, id, expected);
    for (const variant of record.variants ?? []) if (variant.icon) variant.icon = assign(variant.icon, `${id}~${variant.when.join("+")}`, expected);
  };
  for (const { kind } of KINDS) for (const record of signals[kind]) assignRecord(record, `${kind}/${record.name}`, 64);
  for (const group of groups) assignRecord(group, `group/${group.name}`, 128);

  // Strip redundancy: the icon id of a signal defaults to `<kind>/<name>`.
  for (const { kind } of KINDS) for (const record of signals[kind]) if (record.icon === `${kind}/${record.name}`) delete record.icon;
  for (const group of groups) if (group.icon === `group/${group.name}`) delete group.icon;

  // Qualities are listed a second time on their own, reduced to what a quality selector needs and in game order.
  const QUALITY_FIELDS = ["name", "displayName", "level", "order", "color", "next", "hidden", "icon", "modules", "removedBy"];
  const qualityInfo = (record) => {
    const info = Object.fromEntries(QUALITY_FIELDS.filter((field) => !isEmpty(record[field])).map((field) => [field, record[field]]));
    const variants = (record.variants ?? []).map((variant) => Object.fromEntries(Object.entries(variant).filter(([field]) => field === "when" || QUALITY_FIELDS.includes(field)))).filter((variant) => Object.keys(variant).length > 1);
    return variants.length ? { ...info, variants } : info;
  };
  const qualities = signals.quality.map(qualityInfo).sort((a, b) => compare(a.order, b.order) || compare(a.name, b.name));

  const strip = ({ name, ...rest }) => rest;
  const catalog = {
    schema: 1,
    game,
    modules,
    constants: { ...strip(constants), rocketSilos },
    groups,
    subgroups,
    qualities,
    speakers,
    signals,
  };
  delete catalog.constants.modules;
  return { catalog, icons };
}

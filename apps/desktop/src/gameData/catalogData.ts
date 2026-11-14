// Checks catalog data that does not come with the build: read from the user's game, or back from the cache file. The shape is
// the one of `packages/catalog/data/catalog-<version>.json` (`CatalogData`); whatever passes can be handed to the catalog's
// own loader. Pure.
import { createCatalog, type CatalogData } from "@face/catalog";
import { STANDARD_SIGNAL_KINDS } from "@face/model";
import { ValidationError } from "../validation.ts";

export const CATALOG_DATA_LIMITS = { records: 200_000, list: 5000, textLength: 2000 } as const;

type Check = (value: unknown) => boolean;
type Fields = Readonly<Record<string, Check>>;
interface Shape {
  readonly required: Fields;
  readonly optional?: Fields;
  /** Whether records may carry `variants`: overrides of their other fields, or null for the default. */
  readonly variants?: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const text: Check = (value) => typeof value === "string" && value.length <= CATALOG_DATA_LIMITS.textLength;
const name: Check = (value) => text(value) && value !== "" && !/[\u0000-\u001f\u007f]/.test(value as string);
const flag: Check = (value) => typeof value === "boolean";
const number: Check = (value) => typeof value === "number" && Number.isFinite(value);
const listOf = (item: Check): Check => (value) => Array.isArray(value) && value.length <= CATALOG_DATA_LIMITS.list && value.every(item);
const names = listOf(name);
const oneOf = (...values: readonly string[]): Check => (value) => typeof value === "string" && values.includes(value);
const recordOf = (item: Check): Check => (value) => isRecord(value) && Object.keys(value).length <= CATALOG_DATA_LIMITS.list && Object.values(value).every(item);
const shaped = (shape: Shape): Check => (value) => problemOf(value, shape) === undefined;

const SCOPE: Fields = { name, modules: names };
const INSTRUMENT: Shape = { required: { name, displayName: text, notes: names }, optional: { noteNames: recordOf(text) } };
const SHAPES = {
  game: { required: { version: (value) => typeof value === "string" && /^\d+\.\d+\.\d+$/.test(value), build: (value) => Number.isSafeInteger(value) && (value as number) >= 0 } },
  provenance: { required: { generator: text, generatedAt: text, locale: text, commands: listOf(text), modSets: listOf(text), icons: text } },
  module: { required: { name, title: text, version: text, requires: names, recommends: names, featureFlags: names } },
  group: { required: { ...SCOPE, displayName: text, order: text }, optional: { icon: name, removedBy: names }, variants: true },
  subgroup: { required: { ...SCOPE, group: name, order: text }, optional: { removedBy: names }, variants: true },
  quality: { required: { ...SCOPE, displayName: text, level: number, order: text, color: text }, optional: { next: name, hidden: flag, icon: name, removedBy: names }, variants: true },
  silo: { required: { ...SCOPE, liftWeight: number, rocketPartsRequired: number }, optional: { removedBy: names }, variants: true },
  speaker: { required: { ...SCOPE, maximumPolyphony: number, instruments: listOf(shaped(INSTRUMENT)) }, optional: { removedBy: names }, variants: true },
  signal: {
    required: { ...SCOPE, displayName: text, order: text, subgroup: name },
    optional: {
      prototype: name, visibility: oneOf("normal", "wildcard", "parameter", "hidden"), hidden: flag, parameter: flag, special: flag, wildcard: oneOf("everything", "anything", "each"), icon: name,
      hideFromSignalGui: flag, placedBy: names, itemAlias: name, stackSize: number, weight: number, level: number, next: name, color: text, removedBy: names,
    },
    variants: true,
  },
} as const satisfies Readonly<Record<string, Shape>>;

const show = (value: unknown): string => (JSON.stringify(value) ?? "undefined").slice(0, 80);

/** Why a value is not a record of the shape, or undefined when it is one. */
function problemOf(value: unknown, { required, optional = {}, variants = false }: Shape): string | undefined {
  if (!isRecord(value)) return `${show(value)} is not a record`;
  const label = typeof value.name === "string" ? `${value.name.slice(0, 80)}: ` : "";
  for (const [field, valid] of Object.entries(required)) if (!valid(value[field])) return `${label}${field} is ${show(value[field])}`;
  for (const [field, content] of Object.entries(value)) {
    if (Object.hasOwn(required, field)) continue;
    if (field === "variants" && variants) {
      const overridable: Fields = { ...required, ...optional };
      const valid = (variant: unknown): boolean => isRecord(variant) && names(variant.when) && Object.entries(variant).every(([key, override]) => key === "when" || (key !== "name" && Object.hasOwn(overridable, key) && (override === null || overridable[key]!(override))));
      if (!listOf(valid)(content)) return `${label}variants are ${show(content)}`;
    } else if (!Object.hasOwn(optional, field) || !optional[field]!(content)) return `${label}${field} is ${show(content)}`;
  }
  return undefined;
}

/**
 * Reads catalog data of schema 1. Throws ValidationError for anything else, naming the first thing that is wrong: a field of
 * the wrong type, a field the format does not have, a signal whose subgroup or a subgroup whose group is missing, or data the
 * catalog's loader refuses.
 */
export function parseCatalogData(value: unknown): CatalogData {
  const fail = (message: string): never => {
    throw new ValidationError(`Catalog data: ${message}`);
  };
  let budget: number = CATALOG_DATA_LIMITS.records;
  const check = (what: string, content: unknown, shape: Shape): void => {
    const problem = problemOf(content, shape);
    if (problem !== undefined) fail(`${what} ${problem}`);
  };
  const checkAll = (what: string, list: unknown, shape: Shape): Record<string, unknown>[] => {
    if (!Array.isArray(list)) return fail(`${what}s are ${show(list)}`);
    if ((budget -= list.length) < 0) fail(`more than ${CATALOG_DATA_LIMITS.records} records`);
    for (const record of list) check(what, record, shape);
    if (new Set(list.map((record: { name: string }) => record.name)).size !== list.length) fail(`a ${what} occurs twice`);
    return list as Record<string, unknown>[];
  };

  if (!isRecord(value) || value.schema !== 1) return fail("not of schema 1");
  const { game, provenance, modules, constants, groups, subgroups, qualities, speakers, signals } = value;
  check("game", game, SHAPES.game);
  check("provenance", provenance, SHAPES.provenance);
  checkAll("module", modules, SHAPES.module);
  if (!isRecord(constants) || !number(constants.defaultItemWeight) || !number(constants.rocketLiftWeight) || Object.keys(constants).length !== 3) return fail(`constants are ${show(constants)}`);
  checkAll("rocket silo", constants.rocketSilos, SHAPES.silo);
  const groupNames = new Set(checkAll("group", groups, SHAPES.group).map((group) => group.name));
  const subgroupList = checkAll("subgroup", subgroups, SHAPES.subgroup);
  checkAll("quality", qualities, SHAPES.quality);
  if (speakers !== undefined) checkAll("speaker", speakers, SHAPES.speaker);
  if (!isRecord(signals)) return fail(`signals are ${show(signals)}`);
  const subgroupNames = new Set(subgroupList.map((subgroup) => subgroup.name));
  for (const subgroup of subgroupList) if (!groupNames.has(subgroup.group)) fail(`subgroup ${show(subgroup.name)} is in a group that does not exist: ${show(subgroup.group)}`);
  for (const [kind, records] of Object.entries(signals)) {
    if (!(STANDARD_SIGNAL_KINDS as readonly string[]).includes(kind)) fail(`${show(kind)} is not a kind of signal`);
    for (const record of checkAll(`${kind} signal`, records, SHAPES.signal)) if (!subgroupNames.has(record.subgroup)) fail(`${kind} signal ${show(record.name)} is in a subgroup that does not exist: ${show(record.subgroup)}`);
  }
  const unknown = Object.keys(value).find((key) => !["schema", "game", "provenance", "modules", "constants", "groups", "subgroups", "qualities", "speakers", "signals"].includes(key));
  if (unknown !== undefined) fail(`unknown field ${show(unknown)}`);
  const data = value as unknown as CatalogData;
  try {
    createCatalog(data);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
  return data;
}

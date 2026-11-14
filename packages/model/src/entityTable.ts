// The entity table: every prototype of the game that a circuit wire connects to, with its tile size, directions and wire reach.
// The data is the game's own, written by tools/catalog/generate.mjs from its dumps (`data/entities-<version>.json`, one record
// per line, defaults left out); what each field is derived from: docs/factorio-audit.md 13. This file reads such a table and
// holds the one of the standard game. Which table the editor works with: `entityTable` in prototypes.ts.

import standard from "../data/entities-2.1.24.json" with { type: "json" };
import { parseSignalKey, type SignalId } from "./signal.ts";

/** The reach the game gives a circuit wire of every entity that does not say otherwise (`default_circuit_wire_max_distance`). */
export const STANDARD_WIRE_REACH = 9;

/** In how many directions an entity can be built: 1 for one that cannot be turned, 2 for north and east only (the storage tank). */
export const DIRECTION_COUNTS = [1, 2, 4, 8, 16] as const;
export type DirectionCount = (typeof DIRECTION_COUNTS)[number];

/** A prototype of the game that a circuit wire connects to. */
export interface EntityPrototype {
  readonly name: string;
  /** The game's prototype type: "electric-pole", "assembling-machine". */
  readonly type: string;
  /** The game's English name: "Small electric pole". */
  readonly displayName: string;
  /** Tiles it covers when it faces north: width (west to east) x height (north to south). */
  readonly width: number;
  readonly height: number;
  readonly directions: DirectionCount;
  /** How far a circuit wire from it reaches, in tiles, at normal quality. */
  readonly wireReach: number;
  /** Not offered by the game for building: the chests of its editor, the loaders. */
  readonly hidden: boolean;
  /** Stands anywhere, not on the tile grid (the land mine). */
  readonly offGrid: boolean;
  /** [left, top, right, bottom] around its center when it faces north. Only where the tile size is not the size of this box rounded up. */
  readonly collisionBox?: readonly [number, number, number, number];
  /** The items that build it, the first being the one robots use. None: only a script or the game's editor creates it. */
  readonly placedBy: readonly string[];
  /** The signals it uses unless told otherwise, by the game's field without `default_` and `_signal`: `output`, `empty_slots`, `red_output`. */
  readonly signals: Readonly<Record<string, SignalId>>;
  /** The modules that add it, as in the signal catalog: all of them have to be enabled. */
  readonly modules: readonly string[];
  /** Modules that take it away again. */
  readonly removedBy?: readonly string[];
}

export interface EntityTable {
  readonly game: { readonly version: string; readonly build?: number };
  /** False while the directions are from the generator's provisional rules and not yet checked against a running game. */
  readonly runtimeChecked: boolean;
  /** Sorted by name. */
  readonly entities: readonly EntityPrototype[];
  readonly byName: ReadonlyMap<string, EntityPrototype>;
}

/**
 * Whether a prototype has a wire reach of its own or the one the project sets. Its own: every electric pole (the game gives a pole
 * one distance for all its wires, and the project's setting never changes what a pole reaches, the medium one with its 9 tiles
 * included), and every other prototype whose reach is not the standard 9 (the power switch, the agricultural tower).
 */
export function hasOwnWireReach(prototype: EntityPrototype): boolean {
  return prototype.type === "electric-pole" || prototype.wireReach !== STANDARD_WIRE_REACH;
}

type Fields = Readonly<Record<string, unknown>>;

const isObject = (value: unknown): value is Fields => typeof value === "object" && value !== null && !Array.isArray(value);
const isStrings = (value: unknown): value is string[] => Array.isArray(value) && value.every((entry) => typeof entry === "string");
const isTiles = (value: unknown): value is number => Number.isInteger(value) && (value as number) > 0;

/**
 * Reads a table as the generator writes it, `defaults` applied. Throws on anything that is not such a table, so that data from
 * elsewhere (a table made from a user's own game) cannot give the editor an entity without a size or a reach.
 */
export function parseEntityTable(data: unknown): EntityTable {
  const fail = (message: string): never => {
    throw new Error(`Entity table: ${message}`);
  };
  if (!isObject(data) || data.schema !== 1) return fail("not a table of schema 1");
  const { game, defaults, entities: records } = data;
  if (!isObject(game) || typeof game.version !== "string") return fail("no game version");
  if (!isObject(defaults) || !Array.isArray(records)) return fail("no defaults or no entities");

  const entities = records.map((record: unknown, index): EntityPrototype => {
    if (!isObject(record) || typeof record.name !== "string" || record.name === "") return fail(`record ${index} has no name`);
    const { name } = record;
    const field = (key: string): unknown => record[key] ?? defaults[key];
    const checked = <T>(key: string, valid: (value: unknown) => value is T): T => {
      const value = field(key);
      return valid(value) ? value : fail(`${name}: ${key} is ${JSON.stringify(value)}`);
    };
    const signals = field("signals") ?? {};
    if (!isObject(signals)) return fail(`${name}: signals is ${JSON.stringify(signals)}`);
    const signalOf = ([key, value]: [string, unknown]): [string, SignalId] => [key, (typeof value === "string" && parseSignalKey(value)) || fail(`${name}: signal ${key} is ${JSON.stringify(value)}`)];
    const box = record.collisionBox;
    if (box !== undefined && !(Array.isArray(box) && box.length === 4 && box.every(Number.isFinite))) return fail(`${name}: collisionBox is ${JSON.stringify(box)}`);
    return {
      name,
      type: checked("type", (value): value is string => typeof value === "string" && value !== ""),
      displayName: checked("displayName", (value): value is string => typeof value === "string" && value !== ""),
      width: checked("width", isTiles),
      height: checked("height", isTiles),
      directions: checked("directions", (value): value is DirectionCount => (DIRECTION_COUNTS as readonly unknown[]).includes(value)),
      wireReach: checked("wireReach", (value): value is number => Number.isFinite(value) && (value as number) > 0),
      hidden: record.hidden === true,
      offGrid: record.offGrid === true,
      ...(box !== undefined && { collisionBox: box as unknown as readonly [number, number, number, number] }),
      placedBy: record.placedBy === undefined ? [name] : checked("placedBy", isStrings),
      signals: Object.fromEntries(Object.entries(signals).map(signalOf)),
      modules: checked("modules", isStrings),
      ...(record.removedBy !== undefined && { removedBy: checked("removedBy", isStrings) }),
    };
  });
  const byName = new Map(entities.map((entity) => [entity.name, entity]));
  if (byName.size !== entities.length) return fail("a name occurs twice");
  entities.sort((a, b) => (a.name < b.name ? -1 : 1));
  return { game: { version: game.version, ...(typeof game.build === "number" && { build: game.build }) }, runtimeChecked: data.runtimeChecked === true, entities, byName };
}

/** The table of Factorio 2.1.24 with its five standard modules. Shared; treat it as immutable. */
export const STANDARD_ENTITY_TABLE: EntityTable = parseEntityTable(standard);

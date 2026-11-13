// Graphical edits as source patches: pure functions from (parse result, command) to minimal text changes.
// Unrelated text, comments, spacing and declaration order are never touched.

import {
  canRotate, DEFAULT_ENTITY, DEFAULT_FACING, DIRECTIONS, facingOf, hasTerminal, isInt32, isTileCenter, NORMAL_QUALITY, rotateTile, wireKey,
  type Circuit, type Direction, type Entity, type EntityId, type EntityKind, type Point, type TerminalRef, type WireColor,
} from "@face/model";
import { analyze, statementKey, type EntitySource, type ParseResult } from "./analyze.ts";
import type { CstBlock, CstMember, CstSection, CstStatement } from "./cst.ts";
import { uniqueNames, type Fragment } from "./fragment.ts";
import { entityItems, printAt, printCircuit, printEntity, printMembers, printNumber, printWire, type StatementItem } from "./printer.ts";
import { encodeString, isIdentifier, isKeyword, type Range } from "./tokens.ts";

/** Replace `[from, to)` of the source with `insert`. Offsets refer to the source the command was computed from. */
export interface TextChange {
  readonly from: number;
  readonly to: number;
  readonly insert: string;
}

export type EditFailureCode =
  | "invalid-source"
  | "unknown-entity"
  | "unknown-wire"
  | "invalid-name"
  | "reserved-name"
  | "duplicate-name"
  | "invalid-position"
  | "invalid-terminal"
  | "self-wire"
  | "kind-mismatch"
  | "invalid-entity"
  | "unrepresentable";

/** Typed failure of an edit command. */
export class EditError extends Error {
  constructor(readonly code: EditFailureCode, message: string) {
    super(message);
    this.name = "EditError";
  }
}

export interface EntityMove {
  readonly id: EntityId;
  readonly position: Point;
}

export interface EntityFacing {
  readonly id: EntityId;
  readonly direction: Direction;
}

export interface EntityTile {
  readonly id: EntityId;
  /** The game's center position of the entity (`placement.tile`); `undefined` removes the clause. */
  readonly tile: Point | undefined;
}

/** Applies sorted, non-overlapping changes. */
export function applyChanges(source: string, changes: readonly TextChange[]): string {
  let result = "";
  let offset = 0;
  for (const change of changes) {
    if (change.from < offset || change.to < change.from || change.to > source.length) throw new RangeError(`Invalid or overlapping change at ${change.from}..${change.to}`);
    result += source.slice(offset, change.from) + change.insert;
    offset = change.to;
  }
  return result + source.slice(offset);
}

/** Sorts changes (insertions before replacements at the same offset) and merges the ones that touch. */
function normalize(changes: readonly TextChange[]): TextChange[] {
  const sorted = changes.filter((c) => c.from !== c.to || c.insert !== "").map((c, index) => ({ c, index }));
  sorted.sort((x, y) => x.c.from - y.c.from || x.c.to - y.c.to || x.index - y.index);
  const result: TextChange[] = [];
  for (const { c } of sorted) {
    const last = result[result.length - 1];
    if (last && c.from <= last.to) result[result.length - 1] = { from: last.from, to: Math.max(last.to, c.to), insert: last.insert + c.insert };
    else result.push(c);
  }
  return result;
}

const isBlank = (c: string | undefined) => c === " " || c === "\t" || c === "\r";

function indentRest(text: string, prefix: string): string {
  return text.replace(/\n/g, `\n${prefix}`);
}

/** Line-oriented queries on the source text. */
class Text {
  constructor(readonly source: string) {}

  lineStart(offset: number): number {
    return this.source.lastIndexOf("\n", offset - 1) + 1;
  }

  /** Offset of the line break ending the line of `offset`, or the end of the source. */
  lineEnd(offset: number): number {
    const end = this.source.indexOf("\n", offset);
    return end < 0 ? this.source.length : end;
  }

  indentOf(offset: number): string {
    const start = this.lineStart(offset);
    let end = start;
    while (isBlank(this.source[end])) end++;
    return this.source.slice(start, end);
  }

  /** True when only blanks precede `offset` on its line. */
  startsLine(offset: number): boolean {
    return this.skipBack(offset, this.lineStart(offset)) === this.lineStart(offset);
  }

  skipBlanks(offset: number): number {
    while (isBlank(this.source[offset])) offset++;
    return offset;
  }

  skipBack(offset: number, limit = 0): number {
    while (offset > limit && isBlank(this.source[offset - 1])) offset--;
    return offset;
  }

  isBlankLine(lineStart: number): boolean {
    return this.skipBlanks(lineStart) === this.lineEnd(lineStart);
  }

  /**
   * Looks at the rest of the line after `offset`. `eol` tells whether only blanks and comments follow; then `end` is the offset
   * of the line break (or the end of the source) and `next` the start of the following line.
   */
  trailing(offset: number): { end: number; eol: boolean; next: number } {
    const source = this.source;
    let i = offset;
    for (;;) {
      i = this.skipBlanks(i);
      if (source.startsWith("//", i)) i = this.lineEnd(i);
      else if (source.startsWith("/*", i)) {
        const close = source.indexOf("*/", i + 2);
        const end = close < 0 ? source.length : close + 2;
        if (source.slice(i, end).includes("\n")) break;
        i = end;
      } else break;
    }
    const eol = i >= source.length || source[i] === "\n";
    return { end: i, eol, next: eol && i < source.length ? i + 1 : i };
  }

  /** What sits directly above a line: a blank line, a line that opens a block (or the start of the file), or other text. */
  above(lineStart: number): "blank" | "open" | "other" {
    if (lineStart === 0) return "open";
    const previous = this.source.slice(this.lineStart(lineStart - 1), lineStart - 1).trimEnd();
    return previous === "" ? "blank" : previous.endsWith("{") ? "open" : "other";
  }

  /** True when the line starting at `lineStart` closes a block, or the source ends there. */
  closes(lineStart: number): boolean {
    return lineStart >= this.source.length || this.source[this.skipBlanks(lineStart)] === "}";
  }
}

interface Region {
  from: number;
  to: number;
  /** Whole lines, including their line breaks. */
  lines: boolean;
}

/**
 * The text to delete for a removed declaration or statement. A node that has its lines to itself goes with its indentation,
 * its trailing comment and its line break; a node sharing a line only takes adjacent blanks.
 */
function removal(text: Text, node: Range): Region {
  const lineStart = text.lineStart(node.from);
  const ownsStart = text.startsLine(node.from);
  const after = text.trailing(node.to);
  if (ownsStart && after.eol) return { from: lineStart, to: after.next, lines: true };
  if (ownsStart) return { from: node.from, to: text.skipBlanks(node.to), lines: false };
  return { from: text.skipBack(node.from, lineStart), to: node.to, lines: false };
}

function mergeRegions(regions: readonly Region[]): Region[] {
  const result: Region[] = [];
  for (const region of [...regions].sort((a, b) => a.from - b.from || a.to - b.to)) {
    const last = result[result.length - 1];
    if (last && region.from <= last.to) {
      last.to = Math.max(last.to, region.to);
      last.lines = last.lines && region.lines;
    } else result.push({ ...region });
  }
  return result;
}

/** Merges removal regions and extends them over blank lines that would otherwise be left doubled or dangling. */
function collapse(text: Text, regions: readonly Region[]): Region[] {
  let list = mergeRegions(regions);
  for (;;) {
    let changed = false;
    for (const region of list) {
      if (!region.lines) continue;
      const above = text.above(region.from);
      let end = region.to;
      while (text.isBlankLine(end) && text.lineEnd(end) < text.source.length) end = text.lineEnd(end) + 1;
      if (end > region.to && above !== "other") {
        region.to = end;
        changed = true;
      } else if (above === "blank" && text.closes(region.to)) {
        while (region.from > 0 && text.isBlankLine(text.lineStart(region.from - 1))) region.from = text.lineStart(region.from - 1);
        changed = true;
      }
    }
    if (!changed) return list;
    list = mergeRegions(list);
  }
}

type ValidParse = ParseResult & { readonly circuit: Circuit };

/** Shared state of one command: the validated parse, collected changes and removal regions. */
class Edit {
  readonly text: Text;
  readonly circuit: Circuit;
  readonly members: readonly CstMember[];
  private readonly changes: TextChange[] = [];
  private readonly removals: Region[] = [];
  private cachedStyle?: { member: string; unit: string };

  constructor(readonly parse: ParseResult) {
    if (parse.hasErrors || !parse.circuit) throw new EditError("invalid-source", "Fix the source errors before editing this circuit");
    this.circuit = (parse as ValidParse).circuit;
    this.text = new Text(parse.source);
    this.members = parse.cst.circuit?.members ?? [];
  }

  entity(id: EntityId): EntitySource {
    const source = this.parse.sourceMap.entities.get(id);
    if (!source) throw new EditError("unknown-entity", `Unknown entity id '${id}'`);
    return source;
  }

  model(id: EntityId): Entity {
    return this.circuit.entities.find((e) => e.id === id)!;
  }

  change(from: number, to: number, insert: string): void {
    this.changes.push({ from, to, insert });
  }

  remove(node: Range): void {
    this.removals.push(removal(this.text, node));
  }

  finish(): TextChange[] {
    return normalize([...this.changes, ...collapse(this.text, this.removals).map((r) => ({ from: r.from, to: r.to, insert: "" }))]);
  }

  /** Indentation of members and of one nesting level, taken from the file where possible. */
  get style(): { member: string; unit: string } {
    if (this.cachedStyle) return this.cachedStyle;
    const { text } = this;
    const circuitIndent = this.parse.cst.circuit ? text.indentOf(this.parse.cst.circuit.from) : "";
    const first = this.members.find((m) => text.startsLine(m.from));
    let unit: string | undefined;
    for (const member of this.members) {
      if (member.type !== "entity" || !text.startsLine(member.from)) continue;
      const own = text.indentOf(member.from);
      const statement = member.body?.statements.find((s) => text.lineStart(s.from) !== text.lineStart(member.from) && text.startsLine(s.from));
      const inner = statement && text.indentOf(statement.from);
      if (inner && inner.length > own.length && inner.startsWith(own)) {
        unit = inner.slice(own.length);
        break;
      }
    }
    const memberIndent = first && text.indentOf(first.from);
    if (!unit && memberIndent && memberIndent.length > circuitIndent.length && memberIndent.startsWith(circuitIndent)) unit = memberIndent.slice(circuitIndent.length);
    unit ??= "    ";
    return (this.cachedStyle = { member: memberIndent ?? circuitIndent + unit, unit });
  }

  /** True when `member` is set apart from its predecessor by a blank line (or, as the first member, spans several lines). */
  spaced(member: CstMember): boolean {
    const index = this.members.indexOf(member);
    const source = this.text.source;
    return index > 0 ? /\n[ \t\r]*\n/.test(source.slice(this.members[index - 1]!.to, member.from)) : source.slice(member.from, member.to).includes("\n");
  }

  /** Inserts `block` (already indented) on its own lines after the line on which `end` lies. */
  insertLines(end: number, block: string, blankBefore: boolean): void {
    const after = this.text.trailing(end);
    const lead = blankBefore ? "\n" : "";
    if (!after.eol) this.change(end, this.text.skipBlanks(end), `\n${lead}${block}\n`);
    else if (after.next > after.end) this.change(after.next, after.next, `${lead}${block}\n`);
    else this.change(after.end, after.end, `\n${lead}${block}`);
  }

  /** Inserts a member after `after`, or as the first thing in the circuit body. */
  insertMember(after: CstMember | undefined, block: string, blankBefore: boolean): void {
    const open = this.parse.cst.circuit!.open!;
    this.insertLines(after ? after.to : open.to, block, blankBefore);
  }
}

function checkName(name: string, taken: ReadonlySet<string>): void {
  if (!isIdentifier(name)) throw new EditError("invalid-name", `'${name}' is not a valid entity name; use letters, digits and underscores, not starting with a digit`);
  if (isKeyword(name)) throw new EditError("reserved-name", `'${name}' is a reserved keyword`);
  if (taken.has(name)) throw new EditError("duplicate-name", `The name '${name}' is already in use`);
}

function checkPosition(position: Point): Point {
  const rounded = { x: Math.round(position.x) || 0, y: Math.round(position.y) || 0 };
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y) || !isInt32(rounded.x) || !isInt32(rounded.y)) throw new EditError("invalid-position", "A position needs two signed 32-bit integer coordinates");
  return rounded;
}

/**
 * Appends a declaration with default configuration after the last entity. Generates `constant1`, `lamp2`, ... when no name is given.
 * With `facing` other than east the declaration gets a `facing` clause, unless the kind cannot rotate (a lamp). With `tile` (the
 * game's center position, on the grid for the kind in that direction) it gets a `tile` clause.
 */
export function addEntity(parse: ParseResult, kind: EntityKind, position: Point, name?: string, tile?: Point, facing?: Direction): { changes: TextChange[]; name: string } {
  const edit = new Edit(parse);
  const taken = new Set(edit.circuit.entities.map((e) => e.name));
  if (name === undefined) {
    let n = 1;
    while (taken.has(`${kind}${n}`)) n++;
    name = `${kind}${n}`;
  } else checkName(name, taken);
  const direction = facing !== undefined && canRotate(kind) && facing !== DEFAULT_FACING ? facing : undefined;
  if (tile && !isTileCenter(kind, direction ?? DEFAULT_FACING, tile)) {
    throw new EditError("invalid-position", `tile (${tile.x}, ${tile.y}) is not on the tile grid for a new ${kind}${direction ? ` facing ${direction}` : ""}`);
  }
  const placement = tile || direction ? { placement: { ...(tile && { tile }), ...(direction && { direction }) } } : {};
  const entity = { ...DEFAULT_ENTITY[kind], id: "", name, position: checkPosition(position), ...placement } as Entity;
  const { member, unit } = edit.style;
  const block = member + indentRest(printEntity(entity, { unit }), member);
  const last = edit.members.findLast((m) => m.type === "entity");
  if (last) edit.insertMember(last, block, edit.spaced(last));
  else edit.insertMember(undefined, edit.members.length ? `${block}\n` : block, false);
  return { changes: edit.finish(), name };
}

/** Patches the numbers inside `at (...)`, or inserts the clause when the entity has none. */
export function moveEntities(parse: ParseResult, moves: readonly EntityMove[]): TextChange[] {
  const edit = new Edit(parse);
  for (const [id, target] of new Map(moves.map((m) => [m.id, m.position]))) {
    const source = edit.entity(id);
    const position = checkPosition(target);
    const current = edit.model(id).position;
    if (!source.at) {
      if (position.x !== current.x || position.y !== current.y) edit.change(source.atInsert, source.atInsert, printAt(position));
      continue;
    }
    if (position.x !== current.x) edit.change(source.at.x.from, source.at.x.to, String(position.x));
    if (position.y !== current.y) edit.change(source.at.y.from, source.at.y.to, String(position.y));
  }
  return edit.finish();
}

export function moveEntity(parse: ParseResult, id: EntityId, position: Point): TextChange[] {
  return moveEntities(parse, [{ id, position }]);
}

/** Patches the numbers inside `tile (...)`, inserts the clause behind `at` or the name, or removes it with the blanks before it. */
function writeTile(edit: Edit, id: EntityId, tile: Point | undefined): void {
  const { node, atInsert } = edit.entity(id);
  const current = edit.model(id).placement?.tile;
  const clause = node.tile;
  if (!tile) {
    if (clause) edit.change(edit.text.skipBack(clause.from), clause.to, "");
  } else if (clause?.x && clause.y && current) {
    if (tile.x !== current.x) edit.change(clause.x.from, clause.x.to, printNumber(tile.x));
    if (tile.y !== current.y) edit.change(clause.y.from, clause.y.to, printNumber(tile.y));
  } else {
    const behind = node.at?.to ?? atInsert;
    edit.change(behind, behind, ` tile (${printNumber(tile.x)}, ${printNumber(tile.y)})`);
  }
}

/**
 * Sets, moves or removes the `tile` clause of each entity, as one change set. A tile has to be on the game's grid for the kind and
 * the direction of its entity (`isTileCenter`); whether two entities then share a tile is not checked here, the analysis warns.
 */
export function setTiles(parse: ParseResult, tiles: readonly EntityTile[]): TextChange[] {
  const edit = new Edit(parse);
  for (const [id, tile] of new Map(tiles.map((t) => [t.id, t.tile]))) {
    const { name, kind } = edit.entity(id);
    if (tile && !isTileCenter(kind, facingOf(edit.model(id)), tile)) throw new EditError("invalid-position", `tile (${tile.x}, ${tile.y}) is not on the tile grid for '${name}'`);
    writeTile(edit, id, tile);
  }
  return edit.finish();
}

/**
 * Patches the direction word of the `facing` clause, or inserts the clause behind `tile`, `at` or the name when the entity has
 * none. An entity that faces the wanted direction already (east without a clause) is left alone, and so is one that cannot
 * rotate (a lamp); a clause is never removed. An entity with a `tile` gets the tile that `rotateTile` gives for the turn.
 */
export function faceEntities(parse: ParseResult, facings: readonly EntityFacing[]): TextChange[] {
  const edit = new Edit(parse);
  for (const [id, direction] of new Map(facings.map((f) => [f.id, f.direction]))) {
    const { node, atInsert } = edit.entity(id);
    if (!DIRECTIONS.includes(direction)) throw new EditError("invalid-entity", `'${String(direction)}' is not a direction; use ${DIRECTIONS.join(", ")}`);
    const entity = edit.model(id);
    const facing = facingOf(entity);
    if (!canRotate(entity.kind) || facing === direction) continue;
    const word = node.facing?.direction;
    const behind = Math.max(atInsert, node.at?.to ?? 0, node.tile?.to ?? 0);
    if (word) edit.change(word.from, word.to, direction);
    else edit.change(behind, behind, ` facing ${direction}`);
    const tile = entity.placement?.tile;
    if (tile) writeTile(edit, id, rotateTile(entity.kind, tile, facing, direction));
  }
  return edit.finish();
}

function rename(edit: Edit, id: EntityId, newName: string): void {
  const source = edit.entity(id);
  if (newName === source.name) return;
  checkName(newName, new Set(edit.circuit.entities.map((e) => e.name)));
  edit.change(source.nameRange.from, source.nameRange.to, newName);
  for (const wire of edit.parse.sourceMap.wires.values()) {
    if (wire.wire.a.entity !== id && wire.wire.b.entity !== id) continue;
    for (const declaration of wire.declarations) {
      for (const terminal of [declaration.a, declaration.b]) if (terminal.entity === id) edit.change(terminal.nameRange.from, terminal.nameRange.to, newName);
    }
  }
}

/** Rewrites the declaration name and every wire reference. */
export function renameEntity(parse: ParseResult, id: EntityId, newName: string): TextChange[] {
  const edit = new Edit(parse);
  rename(edit, id, newName);
  return edit.finish();
}

/** Removes the declarations of the entities, every declaration of every incident wire and of the connections in `wires` (`wireKey`s). */
export function deleteEntities(parse: ParseResult, ids: readonly EntityId[], wires: readonly string[] = []): TextChange[] {
  const edit = new Edit(parse);
  const doomed = new Set(ids);
  const doomedWires = new Set(wires);
  for (const id of doomed) edit.remove(edit.entity(id).range);
  for (const key of doomedWires) if (!parse.sourceMap.wires.has(key)) throw new EditError("unknown-wire", `Unknown wire '${key}'`);
  for (const [key, wire] of parse.sourceMap.wires) {
    if (doomedWires.has(key) || doomed.has(wire.wire.a.entity) || doomed.has(wire.wire.b.entity)) for (const declaration of wire.declarations) edit.remove(declaration.range);
  }
  return edit.finish();
}

/** Appends a wire declaration. Returns no changes when the connection already exists in either direction. */
export function addWire(parse: ParseResult, color: WireColor, a: TerminalRef, b: TerminalRef): TextChange[] {
  const edit = new Edit(parse);
  const end = (terminal: TerminalRef) => {
    const source = edit.entity(terminal.entity);
    if (!hasTerminal(source.kind, terminal.side)) throw new EditError("invalid-terminal", `'${source.name}' (${source.kind}) has no '${terminal.side}' terminal`);
    return { name: source.name, side: terminal.side };
  };
  const first = end(a);
  const second = end(b);
  if (a.entity === b.entity && a.side === b.side) throw new EditError("self-wire", "A wire cannot connect a terminal to itself");
  if (parse.sourceMap.wires.has(wireKey({ color, a, b }))) return [];
  const last = edit.members[edit.members.length - 1];
  edit.insertMember(last, edit.style.member + printWire(color, first, second), last?.type === "entity" && edit.spaced(last));
  return edit.finish();
}

/** Removes every declaration of the connection identified by `key` (a `wireKey`). */
export function removeWire(parse: ParseResult, key: string): TextChange[] {
  const edit = new Edit(parse);
  const wire = parse.sourceMap.wires.get(key);
  if (!wire) throw new EditError("unknown-wire", `Unknown wire '${key}'`);
  for (const declaration of wire.declarations) edit.remove(declaration.range);
  return edit.finish();
}

/**
 * Inserts copies of the entities and wires of `fragment`: the entities after the last entity, the wires at the end, where `addEntity`
 * and `addWire` put theirs. Every position is moved by `shift`. A name that is taken is replaced (see `uniqueNames`) and the wires
 * follow; `tile` is dropped, because two entities cannot stand on one tile of the game; everything else is copied.
 */
export function pasteFragment(parse: ParseResult, fragment: Fragment, shift: Point = { x: 0, y: 0 }): { changes: TextChange[]; names: string[] } {
  const edit = new Edit(parse);
  const taken = new Set(edit.circuit.entities.map((e) => e.name));
  const names = uniqueNames(fragment.entities.map((e) => e.name), taken);
  if (names.length === 0) return { changes: [], names };
  const kinds = new Map<EntityId, EntityKind>();
  const entities = fragment.entities.map((entity, i): Entity => {
    checkName(names[i]!, taken);
    taken.add(names[i]!);
    if (kinds.has(entity.id)) throw new EditError("invalid-entity", `The fragment has two entities with the id '${entity.id}'`);
    kinds.set(entity.id, entity.kind);
    const direction = entity.placement?.direction;
    return { ...entity, name: names[i]!, position: checkPosition({ x: entity.position.x + shift.x, y: entity.position.y + shift.y }), placement: direction && { direction } };
  });
  for (const wire of fragment.wires) {
    for (const end of [wire.a, wire.b]) {
      const kind = kinds.get(end.entity);
      if (!kind || !hasTerminal(kind, end.side)) throw new EditError("invalid-terminal", `A wire of the fragment ends at '${end.entity}.${end.side}', which the fragment does not have`);
    }
    if (wire.a.entity === wire.b.entity && wire.a.side === wire.b.side) throw new EditError("self-wire", "A wire cannot connect a terminal to itself");
  }

  const { member, unit } = edit.style;
  const printed = printMembers({ entities, wires: fragment.wires }, { unit });
  const indented = (text: string) => member + indentRest(text, member);
  const lastEntity = edit.members.findLast((m) => m.type === "entity");
  const last = edit.members[edit.members.length - 1];
  // Blank lines between the new declarations where the file, or failing that the canonical form, has them.
  const spaced = lastEntity ? edit.spaced(lastEntity) : true;
  const blocks = [printed.entities.map(indented).join(spaced ? "\n\n" : "\n")];
  const wires = printed.wires.map(indented).join("\n");
  // Without wires after the last entity both groups go to the same place and are one insertion.
  if (wires && last === lastEntity) blocks.push(wires);
  edit.insertMember(lastEntity, blocks.join(spaced ? "\n\n" : "\n"), lastEntity !== undefined && spaced);
  if (wires && last !== lastEntity) edit.insertMember(last, wires, false);
  return { changes: edit.finish(), names };
}

// updateEntity

/** Canonical JSON of an entity without its id; absent, undefined and "normal" quality compare equal. */
function canonical(value: unknown, top = true): unknown {
  if (Array.isArray(value)) return value.map((v) => canonical(v, false));
  if (value === null || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    const member = record[key];
    if (member === undefined || (top && key === "id") || (key === "quality" && member === NORMAL_QUALITY)) continue;
    result[key] = canonical(member, false);
  }
  return result;
}

function firstDifference(a: unknown, b: unknown, path: string): string | undefined {
  if (a === b) return undefined;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null || Array.isArray(a) !== Array.isArray(b)) return path || "entity";
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  for (const key of new Set([...Object.keys(x), ...Object.keys(y)])) {
    const difference = firstDifference(x[key], y[key], path ? `${path}.${key}` : key);
    if (difference) return difference;
  }
  return undefined;
}

export type EntityCheck = { readonly ok: true } | { readonly ok: false; readonly code: "invalid-entity" | "unrepresentable"; readonly message: string };

/**
 * Checks that the language can express `entity` exactly: it is printed, parsed back and compared.
 * `invalid-entity`: the printed form has errors (bad name, illegal wildcard, integer out of range, ...).
 * `unrepresentable`: it parses, but to a different configuration (for example operands without an output signal).
 */
export function checkEntity(entity: Entity): EntityCheck {
  if (!isIdentifier(entity.name) || isKeyword(entity.name)) return { ok: false, code: "invalid-entity", message: `'${entity.name}' is not a valid entity name` };
  const result = analyze(printCircuit({ name: "", entities: [entity], wires: [] }));
  const error = result.diagnostics.find((d) => d.severity === "error");
  if (error || !result.circuit) return { ok: false, code: "invalid-entity", message: error?.message ?? "The entity is not valid" };
  const difference = firstDifference(canonical(result.circuit.entities[0]), canonical(entity), "");
  return difference ? { ok: false, code: "unrepresentable", message: `The circuit language cannot express this configuration ('${difference}' would not survive)` } : { ok: true };
}

const SEQUENCE_KEYS: ReadonlySet<string> = new Set(["filter", "output", "else", "section"]);

/**
 * Pairs the elements of two sequences: equal elements along a longest common subsequence, then the leftovers between them
 * positionally. A pair with one side undefined is a pure deletion or insertion.
 */
function pairSequences(a: readonly string[], b: readonly string[]): [number | undefined, number | undefined][] {
  const width = b.length + 1;
  const lengths = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lengths[i * width + j] = a[i] === b[j] ? lengths[(i + 1) * width + j + 1]! + 1 : Math.max(lengths[(i + 1) * width + j]!, lengths[i * width + j + 1]!);
    }
  }
  const pairs: [number | undefined, number | undefined][] = [];
  let i = 0;
  let j = 0;
  const gap = (toI: number, toJ: number) => {
    while (i < toI || j < toJ) pairs.push([i < toI ? i++ : undefined, j < toJ ? j++ : undefined]);
  };
  let x = 0;
  let y = 0;
  while (x < a.length && y < b.length) {
    if (a[x] === b[y]) {
      gap(x, y);
      pairs.push([i++, j++]);
      x++;
      y++;
    } else if (lengths[(x + 1) * width + y]! >= lengths[x * width + y + 1]!) x++;
    else y++;
  }
  gap(a.length, b.length);
  return pairs;
}

type Anchor = { readonly where: "after" | "before"; readonly statement: CstStatement } | { readonly where: "start" };

/** Statement-level rewrite of one block: keep what is unchanged, replace what differs, delete and insert the rest. */
function diffBlock(edit: Edit, block: CstBlock, kind: EntityKind, current: readonly StatementItem[], next: readonly StatementItem[], ownerIndent: string): void {
  const { text } = edit;
  const inner = ownerIndent + edit.style.unit;
  const indentAt = (statement: Range) => (text.startsLine(statement.from) ? text.indentOf(statement.from) : inner);

  const unused = new Set(current);
  const aligned = block.statements.map((statement) => {
    const key = statementKey(statement, kind);
    const item = current.find((candidate) => candidate.key === key && unused.has(candidate));
    if (!item) throw new Error(`Internal error: no canonical form for statement '${key}'`);
    unused.delete(item);
    return { statement, item };
  });

  /** Desired items that an existing statement carries (kept or rewritten in place). */
  const carried = new Map<StatementItem, CstStatement>();
  const replace = (statement: CstStatement, replacement: string) => edit.change(statement.from, statement.to, indentRest(replacement, indentAt(statement)));

  for (const { statement, item } of aligned) {
    if (SEQUENCE_KEYS.has(item.key)) continue;
    const target = next.find((candidate) => candidate.key === item.key);
    if (!target) edit.remove(statement);
    else {
      if (target.text !== item.text) replace(statement, target.text);
      carried.set(target, statement);
    }
  }
  for (const key of SEQUENCE_KEYS) {
    const before = aligned.filter((entry) => entry.item.key === key);
    const after = next.filter((item) => item.key === key);
    if (!before.length) continue;
    for (const [i, j] of pairSequences(before.map((entry) => entry.item.text), after.map((item) => item.text))) {
      if (i === undefined) continue;
      const { statement, item } = before[i]!;
      const target = j === undefined ? undefined : after[j]!;
      if (!target) edit.remove(statement);
      else {
        if (target.text !== item.text) {
          if (statement.type === "section" && statement.body && item.section && target.section) diffSection(edit, statement, kind, item, target, indentAt(statement));
          else replace(statement, target.text);
        }
        carried.set(target, statement);
      }
    }
  }

  const anchorFor = (index: number): Anchor => {
    const item = next[index]!;
    const find = (from: number, step: number, sameKey: boolean): CstStatement | undefined => {
      for (let k = from; k >= 0 && k < next.length; k += step) {
        const statement = carried.get(next[k]!);
        if (statement && (!sameKey || next[k]!.key === item.key)) return statement;
      }
      return undefined;
    };
    // Order matters within filters, sections and outputs, so those anchor on their own kind first.
    const sequence = SEQUENCE_KEYS.has(item.key);
    for (const sameKey of sequence ? [true, false] : [false]) {
      const previous = find(index - 1, -1, sameKey);
      if (previous) return { where: "after", statement: previous };
      const following = sequence ? find(index + 1, 1, sameKey) : undefined;
      if (following) return { where: "before", statement: following };
    }
    // Nothing that canonically precedes it exists: it goes to the top of the block.
    const first = block.statements[0];
    return first ? { where: "before", statement: first } : { where: "start" };
  };

  const atStart: string[] = [];
  next.forEach((item, index) => {
    if (item.implicit || carried.has(item)) return;
    const anchor = anchorFor(index);
    if (anchor.where === "start") atStart.push(item.text);
    else if (anchor.where === "after") {
      const { statement } = anchor;
      const rest = text.trailing(statement.to);
      if (rest.eol) edit.change(rest.next, rest.next, `${indentAt(statement)}${indentRest(item.text, indentAt(statement))}\n`);
      else edit.change(statement.to, statement.to, ` ${indentRest(item.text, inner)}`);
    } else {
      const { statement } = anchor;
      const lineStart = text.lineStart(statement.from);
      if (text.startsLine(statement.from)) edit.change(lineStart, lineStart, `${indentAt(statement)}${indentRest(item.text, indentAt(statement))}\n`);
      else {
        // Shares its line: goes in front of the statement, after the blanks that separate it from what precedes.
        const gap = text.skipBack(statement.from, lineStart);
        if (gap < statement.from) edit.change(gap, gap, ` ${indentRest(item.text, inner)}`);
        else edit.change(statement.from, statement.from, `${indentRest(item.text, inner)} `);
      }
    }
  });
  if (!atStart.length) return;
  const lines = atStart.map((line) => inner + indentRest(line, inner)).join("\n");
  const rest = text.trailing(block.open.to);
  const close = block.close!;
  // Only reached for a block without statements: either `{` ends its line, or the braces share one.
  if (rest.eol) edit.change(rest.next, rest.next, `${lines}\n`);
  else edit.change(text.skipBack(close.from, block.open.to), close.from, `\n${lines}\n${ownerIndent}`);
}

function diffSection(edit: Edit, statement: CstSection, kind: EntityKind, current: StatementItem, next: StatementItem, ownerIndent: string): void {
  const group = next.section!.group;
  if (group !== current.section!.group) {
    if (statement.name && group !== undefined) edit.change(statement.name.from, statement.name.to, encodeString(group));
    else if (statement.name) edit.change(statement.keyword.to, statement.name.to, "");
    else edit.change(statement.keyword.to, statement.keyword.to, ` ${encodeString(group!)}`);
  }
  diffBlock(edit, statement.body!, kind, current.section!.items, next.section!.items, ownerIndent);
}

/**
 * Rewrites entity `id` so that it equals `next` (same kind): name, position, placement and configuration. Statements whose meaning
 * is unchanged keep their text and trivia byte for byte; changed ones are replaced by canonical text, new ones are inserted in
 * canonical order and dropped ones are deleted. An empty description removes the property.
 */
export function updateEntity(parse: ParseResult, id: EntityId, next: Entity): TextChange[] {
  const edit = new Edit(parse);
  const source = edit.entity(id);
  const current = edit.model(id);
  if (next.kind !== current.kind) throw new EditError("kind-mismatch", `Entity '${current.name}' is a ${current.kind}, not a ${next.kind}`);
  rename(edit, id, next.name);
  // An empty description is no description: the property is removed, not written as "". Where the source says "" already, it stays.
  if (next.description === "" && current.description !== "") next = { ...next, description: undefined };
  const check = checkEntity(next);
  if (!check.ok) throw new EditError(check.code, check.message);

  const node = source.node;
  if (next.position.x !== current.position.x || next.position.y !== current.position.y) {
    if (!source.at) edit.change(source.atInsert, source.atInsert, printAt(next.position));
    else {
      if (next.position.x !== current.position.x) edit.change(source.at.x.from, source.at.x.to, String(next.position.x));
      if (next.position.y !== current.position.y) edit.change(source.at.y.from, source.at.y.to, String(next.position.y));
    }
  }
  writeTile(edit, id, next.placement?.tile);
  const direction = next.placement?.direction;
  if (direction !== current.placement?.direction) {
    const behind = Math.max(node.at?.to ?? source.atInsert, node.tile?.to ?? 0);
    if (node.facing && direction) edit.change(node.facing.from, node.facing.to, `facing ${direction}`);
    else if (node.facing) edit.change(edit.text.skipBack(node.facing.from), node.facing.to, "");
    else if (direction) edit.change(behind, behind, ` facing ${direction}`);
  }

  const options = { unit: edit.style.unit, sections: node.body!.statements.some((s) => s.type === "section") };
  const ownerIndent = edit.text.indentOf(node.from);
  diffBlock(edit, node.body!, current.kind, entityItems(current, options), entityItems(next, options), ownerIndent);
  return edit.finish();
}

// Command objects

export type EditCommand =
  | {
      readonly type: "addEntity";
      readonly kind: EntityKind;
      readonly position: Point;
      readonly name?: string;
      /** The center for a `tile` clause. */
      readonly tile?: Point;
      /** East when absent. */
      readonly facing?: Direction;
    }
  | { readonly type: "moveEntities"; readonly moves: readonly EntityMove[] }
  | { readonly type: "faceEntities"; readonly facings: readonly EntityFacing[] }
  | { readonly type: "setTiles"; readonly tiles: readonly EntityTile[] }
  | { readonly type: "renameEntity"; readonly id: EntityId; readonly name: string }
  | { readonly type: "deleteEntities"; readonly ids: readonly EntityId[]; /** Connections to remove in the same edit, as `wireKey`s. */ readonly wires?: readonly string[] }
  | { readonly type: "addWire"; readonly color: WireColor; readonly a: TerminalRef; readonly b: TerminalRef }
  | { readonly type: "removeWire"; readonly key: string }
  | { readonly type: "updateEntity"; readonly id: EntityId; readonly entity: Entity }
  | { readonly type: "pasteFragment"; readonly fragment: Fragment; readonly shift?: Point };

export type EditResult =
  | {
      readonly ok: true;
      readonly changes: readonly TextChange[];
      /** Name chosen by `addEntity`. */
      readonly name?: string;
      /** Names given by `pasteFragment`, in fragment order. */
      readonly names?: readonly string[];
    }
  | { readonly ok: false; readonly code: EditFailureCode; readonly message: string };

/** Runs a command object and returns failures as values instead of throwing `EditError`. */
export function executeCommand(parse: ParseResult, command: EditCommand): EditResult {
  try {
    switch (command.type) {
      case "addEntity": return { ok: true, ...addEntity(parse, command.kind, command.position, command.name, command.tile, command.facing) };
      case "moveEntities": return { ok: true, changes: moveEntities(parse, command.moves) };
      case "faceEntities": return { ok: true, changes: faceEntities(parse, command.facings) };
      case "setTiles": return { ok: true, changes: setTiles(parse, command.tiles) };
      case "renameEntity": return { ok: true, changes: renameEntity(parse, command.id, command.name) };
      case "deleteEntities": return { ok: true, changes: deleteEntities(parse, command.ids, command.wires) };
      case "addWire": return { ok: true, changes: addWire(parse, command.color, command.a, command.b) };
      case "removeWire": return { ok: true, changes: removeWire(parse, command.key) };
      case "updateEntity": return { ok: true, changes: updateEntity(parse, command.id, command.entity) };
      case "pasteFragment": return { ok: true, ...pasteFragment(parse, command.fragment, command.shift) };
    }
  } catch (error) {
    if (error instanceof EditError) return { ok: false, code: error.code, message: error.message };
    throw error;
  }
}

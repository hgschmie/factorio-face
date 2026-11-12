// Canonical printer: 4-space indent, one statement per line, defaults omitted. `analyze(printCircuit(c))` reproduces `c` modulo ids
// for every circuit the language can express (see `checkEntity` in commands.ts for the exceptions).

import {
  isValidSignalName, NORMAL_QUALITY, wildcardOf,
  type Circuit, type ConstantSection, type DeciderOutput, type Entity, type NetworkSelection, type Operand, type SelectorMode, type SignalId, type TerminalRef, type WireColor,
} from "@face/model";
import { NO_NETWORK } from "./schema.ts";
import { encodeString, isKeyword } from "./tokens.ts";

export interface PrintOptions {
  /** One indentation level; default four spaces. */
  readonly unit?: string;
}

/** One statement in canonical order. Implicit items carry a default value: not printed, but comparable with an explicit statement. */
export interface StatementItem {
  /** Same vocabulary as `statementKey`: a property name, or `filter`, `expression`, `when`, `output`, `else`, `section`. */
  readonly key: string;
  readonly text: string;
  readonly implicit: boolean;
  readonly section?: { readonly group?: string; readonly items: readonly StatementItem[] };
}

const BARE_WORD = /^[A-Za-z_][A-Za-z0-9_]*(-[A-Za-z0-9_]+)*$/;

export function printSignal(id: SignalId): string {
  const quality = id.quality && id.quality !== NORMAL_QUALITY ? id.quality : undefined;
  const wildcard = wildcardOf(id);
  if (wildcard && !quality) return wildcard;
  const part = (text: string) => (isValidSignalName(text) ? text : encodeString(text));
  return `${id.kind}:${part(id.name)}${quality ? `@${part(quality)}` : ""}`;
}

export function printInteger(value: number): string {
  return Number.isFinite(value) ? String(Math.trunc(value) || 0) : "0";
}

/** Integers print without a decimal point; never uses exponent notation, which the language does not have. */
export function printNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const text = String(value || 0);
  return text.includes("e") ? value.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 20 }) : text;
}

function printQuality(name: string): string {
  return BARE_WORD.test(name) && !isKeyword(name) && name !== "signal" ? name : encodeString(name);
}

/** The word for a selection other than the default of both networks. */
function networkWord(networks: NetworkSelection): string | undefined {
  if (networks.red && networks.green) return undefined;
  return networks.red ? "red" : networks.green ? "green" : NO_NETWORK;
}

function printNetworks(networks: NetworkSelection): string {
  const word = networkWord(networks);
  return word === undefined ? "" : `[${word}]`;
}

function printOperand(operand: Operand): string {
  return operand.type === "constant" ? printInteger(operand.value) : printSignal(operand.signal) + printNetworks(operand.networks);
}

const hex = (channel: number) => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, "0");

function property(key: string, value: string, implicit = false): StatementItem {
  return { key, text: `${key} = ${value}`, implicit };
}

function indent(text: string, prefix: string): string {
  return text.split("\n").map((line) => prefix + line).join("\n");
}

function isPlainSection(section: ConstantSection): boolean {
  return section.group === undefined && section.active && section.multiplier === 1;
}

function sectionItem(section: ConstantSection, unit: string): StatementItem {
  const items: StatementItem[] = [
    property("active", String(section.active), section.active),
    property("multiplier", printNumber(section.multiplier), section.multiplier === 1),
    ...section.filters.map((f) => ({ key: "filter", text: `${printSignal(f.signal)} = ${printInteger(f.count)}`, implicit: false })),
  ];
  const header = `section${section.group === undefined ? "" : ` ${encodeString(section.group)}`} {`;
  const text = [header, ...items.filter((i) => !i.implicit).map((i) => indent(i.text, unit)), "}"].join("\n");
  return { key: "section", text, implicit: false, section: { group: section.group, items } };
}

function outputItem(output: DeciderOutput, key: "output" | "else"): StatementItem {
  const value = output.copyCountFromInput ? `input${printNetworks(output.networks)}` : printInteger(output.constant);
  return { key, text: `${key === "else" ? "else " : ""}output ${printSignal(output.signal)} = ${value}`, implicit: false };
}

function selectorItems(mode: SelectorMode): StatementItem[] {
  const items = [property("operation", mode.operation)];
  const signal = (key: string, id: SignalId | undefined) => {
    if (id) items.push(property(key, printSignal(id)));
  };
  switch (mode.operation) {
    case "select":
      items.push(property("order", mode.max ? "max" : "min", mode.max));
      items.push(property("index", mode.index.type === "constant" ? printInteger(mode.index.value) : printSignal(mode.index.signal), mode.index.type === "constant" && mode.index.value === 0));
      items.push(property("index-comparator", mode.indexComparator, mode.indexComparator === "="));
      break;
    case "count":
      signal("output", mode.output);
      break;
    case "random":
      items.push(property("interval", printInteger(mode.interval), mode.interval === 0));
      break;
    case "quality-filter":
      if (mode.quality !== undefined) items.push(property("quality", printQuality(mode.quality)));
      items.push(property("comparator", mode.comparator ?? "=", (mode.comparator ?? "=") === "="));
      break;
    case "quality-select":
      items.push(property("order", mode.highest ? "highest" : "lowest", mode.highest));
      break;
    case "quality-transfer":
      if (mode.source.type === "quality") items.push(property("source", printQuality(mode.source.quality), mode.source.quality === NORMAL_QUALITY));
      else {
        items.push(property("source", "signal"));
        signal("source-signal", mode.source.signal);
      }
      signal("destination", mode.destination);
      break;
    case "time":
      signal("day-length", mode.dayLength);
      signal("day-tick", mode.dayTick);
      signal("game-tick", mode.gameTick);
      break;
    case "stack-size":
    case "rocket-capacity":
      break;
  }
  return items;
}

/**
 * The statements of `entity` in canonical order. `sections` forces `section` blocks even where bare filters would do
 * (used when the existing source already has section blocks).
 */
export function entityItems(entity: Entity, options: PrintOptions & { readonly sections?: boolean } = {}): StatementItem[] {
  const unit = options.unit ?? "    ";
  const items: StatementItem[] = [];
  if (entity.description !== undefined) items.push(property("description", encodeString(entity.description)));
  const signal = (key: string, id: SignalId | undefined) => {
    if (id) items.push(property(key, printSignal(id)));
  };
  switch (entity.kind) {
    case "constant": {
      items.push(property("enabled", String(entity.enabled), entity.enabled));
      const [only] = entity.sections;
      if (!options.sections && entity.sections.length === 1 && only && isPlainSection(only) && only.filters.length > 0) {
        for (const f of only.filters) items.push({ key: "filter", text: `${printSignal(f.signal)} = ${printInteger(f.count)}`, implicit: false });
      } else for (const section of entity.sections) items.push(sectionItem(section, unit));
      break;
    }
    case "arithmetic":
      if (entity.output) items.push({ key: "expression", text: `${printSignal(entity.output)} = ${printOperand(entity.first)} ${entity.operation} ${printOperand(entity.second)}`, implicit: false });
      break;
    case "decider": {
      const conditions = entity.conditions.filter((c) => c.first);
      if (conditions.length) {
        const text = conditions.map((c, i) => `${i === 0 ? "when" : c.join} ${printSignal(c.first!)}${printNetworks(c.firstNetworks)} ${c.comparator} ${printOperand(c.second)}`).join(" ");
        items.push({ key: "when", text, implicit: false });
      }
      for (const output of entity.outputs) items.push(outputItem(output, "output"));
      for (const output of entity.elseOutputs) items.push(outputItem(output, "else"));
      break;
    }
    case "selector":
      items.push(...selectorItems(entity.mode));
      break;
    case "lamp": {
      const condition = entity.condition;
      if (condition?.first) {
        const second = condition.second.type === "constant" ? printInteger(condition.second.value) : printSignal(condition.second.signal);
        items.push({ key: "when", text: `when ${printSignal(condition.first)} ${condition.comparator} ${second}`, implicit: false });
      }
      const networks = networkWord(entity.inputNetworks);
      if (networks !== undefined) items.push(property("networks", networks));
      items.push(property("always-on", String(entity.alwaysOn), !entity.alwaysOn));
      if (entity.useColors) items.push(property("colors", entity.colorMode));
      signal("red", entity.redSignal);
      signal("green", entity.greenSignal);
      signal("blue", entity.blueSignal);
      signal("rgb", entity.rgbSignal);
      if (entity.color) items.push(property("color", `#${hex(entity.color.r)}${hex(entity.color.g)}${hex(entity.color.b)}`));
      break;
    }
  }
  return items;
}

/** The header clauses after the name, each with a leading space: ` at (x, y) tile (x, y) facing north`. */
export function printClauses(entity: Pick<Entity, "position" | "placement">): string {
  const tile = entity.placement?.tile;
  return `${printAt(entity.position)}${tile ? ` tile (${printNumber(tile.x)}, ${printNumber(tile.y)})` : ""}${entity.placement?.direction ? ` facing ${entity.placement.direction}` : ""}`;
}

export function printAt(position: { readonly x: number; readonly y: number }): string {
  return ` at (${printInteger(Math.round(position.x))}, ${printInteger(Math.round(position.y))})`;
}

/** Canonical declaration of one entity, starting in column 0. */
export function printEntity(entity: Entity, options: PrintOptions = {}): string {
  const unit = options.unit ?? "    ";
  const statements = entityItems(entity, { unit }).filter((item) => !item.implicit).map((item) => indent(item.text, unit));
  return [`${entity.kind} ${entity.name}${printClauses(entity)} {`, ...statements, "}"].join("\n");
}

export function printWire(color: WireColor, a: { readonly name: string; readonly side: string }, b: { readonly name: string; readonly side: string }): string {
  return `wire ${color} ${a.name}.${a.side} <-> ${b.name}.${b.side}`;
}

/**
 * Canonical declarations of entities and wires, each starting in column 0. Wire ends are written output first, then in declaration
 * order of their entities.
 */
export function printMembers(members: Pick<Circuit, "entities" | "wires">, options: PrintOptions = {}): { entities: string[]; wires: string[] } {
  const { entities } = members;
  const names = new Map(entities.map((e) => [e.id, e.name]));
  const order = new Map(entities.map((e, index) => [e.id, index]));
  const end = (t: TerminalRef) => ({ name: names.get(t.entity) ?? t.entity, side: t.side });
  const rank = (t: TerminalRef) => (t.side === "out" ? 0 : 1) * entities.length + (order.get(t.entity) ?? 0);
  const wires = members.wires.map((w) => {
    const [a, b] = rank(w.b) < rank(w.a) ? [w.b, w.a] : [w.a, w.b];
    return printWire(w.color, end(a), end(b));
  });
  return { entities: entities.map((e) => printEntity(e, options)), wires };
}

/** Canonical source of a whole circuit. */
export function printCircuit(circuit: Circuit, options: PrintOptions = {}): string {
  const unit = options.unit ?? "    ";
  const { entities, wires } = printMembers(circuit, options);
  const blocks = [...entities.map((e) => indent(e, unit)), ...(wires.length ? [indent(wires.join("\n"), unit)] : [])];
  return `circuit ${encodeString(circuit.name)} {\n${blocks.length ? `${blocks.join("\n\n")}\n` : ""}}\n`;
}

// Semantic analysis: CST -> Circuit, diagnostics, source map and stable entity identity.

import {
  BOTH_NETWORKS, canRotate, COMPARATORS, DEFAULT_ENTITY, facingOf, findTileOverlaps, hasTerminal, isInt32, isTileCenter, normalizeWire, signalKey, tileCenter, tileOrigin, tileSize, wildcardOf, wildcardSignal,
  WILDCARDS, wireKey,
  type ArithmeticOperation, type Circuit, type Comparator, type Condition, type ConstantFilter, type ConstantSection, type DeciderCondition, type DeciderOutput, type Direction,
  type Entity, type EntityId, type EntityKind, type LampColorMode, type NetworkSelection, type Operand, type Placement, type Point, type RgbColor, type SelectorMode,
  type SelectorOperation, type SignalId, type TerminalSide, type Wildcard, type Wire, type WireColor,
} from "@face/model";
import type { CstAssign, CstBlock, CstCondition, CstEntity, CstFile, CstMember, CstNetworks, CstOperand, CstOutput, CstProperty, CstSection, CstSigRef, CstStatement, CstWhen, CstWire } from "./cst.ts";
import { diagnostic, type Diagnostic, type DiagnosticCode } from "./diagnostics.ts";
import type { Fragment } from "./fragment.ts";
import { parse, parseFragment } from "./parser.ts";
import { lookupProperty, NO_NETWORK, propertyNames, SIGNAL_SLOTS, STATEMENT_FORMS, type PropertySpec, type SignalSlot, type StatementForm } from "./schema.ts";
import { decodeSignal, decodeString, type Range, type Token } from "./tokens.ts";

/** Catalog awareness is injected; the language itself knows no signal names. */
export interface SignalResolver {
  status(id: SignalId): "known" | "unknown" | "disabled";
}

export interface AnalyzeOptions {
  readonly signals?: SignalResolver;
  /** Opaque document version, copied to the result. */
  readonly version?: number;
}

export interface StatementSource extends Range {
  /** Property name, or `filter`, `expression`, `when`, `output`, `else`, `section`. */
  readonly key: string;
}

export interface EntitySource {
  readonly id: EntityId;
  readonly name: string;
  readonly kind: EntityKind;
  /** The whole declaration, from the kind keyword to the closing brace. */
  readonly range: Range;
  /** Empty range directly after the kind keyword while the name is missing. */
  readonly nameRange: Range;
  /** The `at (x, y)` clause with the ranges of both numbers; absent when the entity is auto-placed. */
  readonly at?: { readonly range: Range; readonly x: Range; readonly y: Range };
  /** Offset where an `at` clause is inserted when absent. */
  readonly atInsert: number;
  /** Both braces inclusive; absent only in a broken declaration. */
  readonly bodyRange?: Range;
  readonly statements: readonly StatementSource[];
  readonly node: CstEntity;
}

export interface TerminalSource {
  readonly range: Range;
  readonly nameRange: Range;
  readonly entity: EntityId;
  readonly side: TerminalSide;
}

export interface WireDeclaration {
  readonly range: Range;
  /** Terminals in source order. */
  readonly a: TerminalSource;
  readonly b: TerminalSource;
}

export interface WireSource {
  readonly key: string;
  readonly wire: Wire;
  /** Every declaration of this connection, including duplicates and reversed forms, in source order. */
  readonly declarations: readonly WireDeclaration[];
}

export interface SourceMap {
  readonly entities: ReadonlyMap<EntityId, EntitySource>;
  readonly wires: ReadonlyMap<string, WireSource>;
  /** Entity whose declaration contains `offset` (both ends inclusive). */
  entityAt(offset: number): EntityId | undefined;
  /** wireKey of the wire declaration containing `offset` (both ends inclusive). */
  wireAt(offset: number): string | undefined;
}

export interface IdentityEntry {
  readonly id: EntityId;
  readonly name: string;
  readonly kind: EntityKind;
}

/** Carried from one parse to the next so that entity ids survive edits. */
export interface IdentityState {
  readonly nextId: number;
  /** Declarations in source order. */
  readonly entries: readonly IdentityEntry[];
  /** Entities that disappeared while the document had errors; they get their id back if they reappear by name. */
  readonly lost: readonly IdentityEntry[];
}

export interface ParseResult {
  readonly source: string;
  readonly version?: number;
  readonly cst: CstFile;
  /** Sorted by position. */
  readonly diagnostics: readonly Diagnostic[];
  readonly hasErrors: boolean;
  /** Present only when there are no errors. */
  readonly circuit?: Circuit;
  readonly sourceMap: SourceMap;
  readonly identity: IdentityState;
}

const KIND_LABEL: Readonly<Record<EntityKind, string>> = { constant: "constant combinator", arithmetic: "arithmetic combinator", decider: "decider combinator", selector: "selector combinator", lamp: "lamp" };
const FORM_LABEL: Readonly<Record<StatementForm, string>> = { property: "properties", assign: "signal assignments", when: "a 'when' statement", output: "'output' statements", section: "'section' blocks" };
const MAX_LOST = 256;

export function statementKey(statement: CstStatement, kind: EntityKind): string {
  switch (statement.type) {
    case "property": return statement.name.text;
    case "assign": return kind === "arithmetic" ? "expression" : "filter";
    case "when": return "when";
    case "output": return statement.else ? "else" : "output";
    case "section": return "section";
  }
}

type PropertyValue =
  | { readonly type: "bool"; readonly value: boolean }
  | { readonly type: "int"; readonly value: number }
  | { readonly type: "number"; readonly value: number }
  | { readonly type: "string"; readonly value: string }
  | { readonly type: "color"; readonly value: RgbColor }
  | { readonly type: "comparator"; readonly value: Comparator }
  | { readonly type: "quality"; readonly value: string }
  | { readonly type: "signal"; readonly value: SignalId }
  | { readonly type: "enum"; readonly value: string };

interface Sorted {
  readonly values: Map<string, PropertyValue>;
  readonly properties: Map<string, CstProperty>;
  readonly assigns: CstAssign[];
  readonly whens: CstWhen[];
  readonly outputs: CstOutput[];
  readonly sections: CstSection[];
}

/** Drops undefined members so that absent optional fields are really absent. */
/** What a network selection word stands for; without a word both networks are read. */
function networkSelection(word: string | undefined): NetworkSelection {
  if (word === "red") return { red: true, green: false };
  if (word === "green") return { red: false, green: true };
  return word === NO_NETWORK ? { red: false, green: false } : BOTH_NETWORKS;
}

function compact<T extends object>(value: T): T {
  for (const key of Object.keys(value) as (keyof T)[]) if (value[key] === undefined) delete value[key];
  return value;
}

function parseNumber(text: string): number {
  const negative = text.startsWith("-");
  const magnitude = Number(negative ? text.slice(1) : text);
  return negative && magnitude !== 0 ? -magnitude : magnitude;
}

function describeValues(spec: PropertySpec): string {
  return spec.values
    .map((v) => {
      switch (v.type) {
        case "bool": return "true or false";
        case "int": return "an integer";
        case "number": return "a number";
        case "string": return "a quoted string";
        case "color": return "a color (#rrggbb)";
        case "comparator": return `a comparator (${COMPARATORS.join(", ")})`;
        case "quality": return "a quality name";
        case "signal": return "a signal";
        case "enum": return v.values.length === 1 ? `'${v.values[0]}'` : `one of ${v.values.join(", ")}`;
      }
    })
    .join(" or ");
}

class Analyzer {
  readonly diagnostics: Diagnostic[] = [];

  constructor(private readonly resolver: SignalResolver | undefined) {}

  report(range: Range, code: DiagnosticCode, message: string): void {
    this.diagnostics.push(diagnostic(range, code, message));
  }

  int(token: Token | undefined): number | undefined {
    if (!token) return undefined;
    if (token.kind !== "int") {
      this.report(token, "invalid-value", `Expected an integer but found '${token.text}'`);
      return undefined;
    }
    const value = parseNumber(token.text);
    if (!isInt32(value)) {
      this.report(token, "integer-range", `Integer ${token.text} is outside the signed 32-bit range`);
      return undefined;
    }
    return value;
  }

  signal(token: Token | undefined, wildcards: readonly Wildcard[], where: string): SignalId | undefined {
    if (!token) return undefined;
    let id: SignalId;
    if (token.kind === "keyword") id = wildcardSignal(token.text as Wildcard);
    else {
      const decoded = decodeSignal(token.text);
      if ("error" in decoded) {
        this.report(token, "invalid-signal", decoded.error);
        return undefined;
      }
      id = decoded.signal;
    }
    const wildcard = wildcardOf(id);
    if (wildcard) {
      if (!wildcards.includes(wildcard)) this.report(token, "illegal-wildcard", `The wildcard '${wildcard}' is not allowed ${where}`);
    } else this.resolve(token, id, `signal '${signalKey(id)}'`);
    return id;
  }

  private resolve(range: Range, id: SignalId, label: string): void {
    const status = this.resolver?.status(id) ?? "known";
    if (status === "unknown") this.report(range, "unknown-signal", `Unknown ${label}`);
    else if (status === "disabled") this.report(range, "disabled-signal", `The ${label} belongs to a disabled module or group`);
  }

  slot(token: Token | undefined, slot: SignalSlot): SignalId | undefined {
    const kind = slot.slice(0, slot.indexOf(".")) as EntityKind;
    return this.signal(token, SIGNAL_SLOTS[slot], `here in a ${KIND_LABEL[kind]}`);
  }

  networks(networks: CstNetworks | undefined): NetworkSelection {
    return networkSelection(networks?.selection?.text);
  }

  noNetworks(ref: CstSigRef | undefined, what: string): void {
    if (ref?.networks) this.report(ref.networks, "syntax-error", `${what} takes no network selection`);
  }

  operand(operand: CstOperand | undefined, slot: SignalSlot): Operand | undefined {
    if (!operand) return undefined;
    if (operand.type === "int") {
      const value = this.int(operand.token);
      return value === undefined ? undefined : { type: "constant", value };
    }
    const signal = this.slot(operand.ref.signal, slot);
    return signal && { type: "signal", signal, networks: this.networks(operand.ref.networks) };
  }

  /** Reads a property value against its spec. Reports and returns undefined when it does not fit. */
  value(spec: PropertySpec, token: Token): PropertyValue | undefined {
    const wordLike = token.kind === "ident" || token.kind === "word" || token.kind === "keyword";
    for (const alternative of spec.values) {
      switch (alternative.type) {
        case "bool":
          if (token.kind === "keyword" && (token.text === "true" || token.text === "false")) return { type: "bool", value: token.text === "true" };
          break;
        case "int":
          if (token.kind === "int") {
            const value = this.int(token);
            return value === undefined ? undefined : { type: "int", value };
          }
          break;
        case "number":
          if (token.kind === "int" || token.kind === "decimal") return { type: "number", value: parseNumber(token.text) };
          break;
        case "string":
          if (token.kind === "string") return { type: "string", value: decodeString(token.text) };
          break;
        case "color":
          if (token.kind === "color") {
            const match = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(token.text);
            if (match) return { type: "color", value: { r: parseInt(match[1]!, 16), g: parseInt(match[2]!, 16), b: parseInt(match[3]!, 16) } };
            this.report(token, "invalid-value", `Invalid color '${token.text}'; expected #rrggbb`);
            return undefined;
          }
          break;
        case "comparator":
          if (token.kind === "op" && (COMPARATORS as readonly string[]).includes(token.text)) return { type: "comparator", value: token.text as Comparator };
          break;
        case "quality": {
          const name = token.kind === "ident" || token.kind === "word" ? token.text : token.kind === "string" ? decodeString(token.text) : "";
          if (name) {
            this.resolve(token, { kind: "quality", name }, `quality '${name}'`);
            return { type: "quality", value: name };
          }
          break;
        }
        case "signal":
          if (token.kind === "signal" || (token.kind === "keyword" && (WILDCARDS as readonly string[]).includes(token.text))) {
            const value = this.signal(token, alternative.wildcards, `in '${spec.name}'`);
            return value && { type: "signal", value };
          }
          break;
        case "enum":
          if (wordLike && alternative.values.includes(token.text)) return { type: "enum", value: token.text };
          break;
      }
    }
    this.report(token, "invalid-value", `Invalid value '${token.text}' for '${spec.name}'; expected ${describeValues(spec)}`);
    return undefined;
  }

  /** Validates statement forms and properties of one block and groups the statements by form. */
  sort(kind: EntityKind, statements: readonly CstStatement[], inSection: boolean, operation?: SelectorOperation): Sorted {
    const sorted: Sorted = { values: new Map(), properties: new Map(), assigns: [], whens: [], outputs: [], sections: [] };
    const forms: readonly StatementForm[] = inSection ? ["property", "assign"] : STATEMENT_FORMS[kind];
    for (const statement of statements) {
      if (!forms.includes(statement.type)) {
        this.report(statement, "invalid-statement", `A ${inSection ? "section" : KIND_LABEL[kind]} does not take ${FORM_LABEL[statement.type]}`);
        continue;
      }
      switch (statement.type) {
        case "property": {
          const name = statement.name.text;
          const lookup = lookupProperty(kind, name, operation, inSection);
          if (lookup.status === "unknown") {
            this.report(statement.name, "unknown-property", `Unknown property '${name}' in a ${inSection ? "section" : KIND_LABEL[kind]}; expected one of ${propertyNames(kind, undefined, inSection).join(", ")}`);
          } else if (lookup.status === "inapplicable") {
            this.report(statement.name, "contradictory-statement", `Property '${name}' does not apply to operation '${operation}'; it belongs to ${lookup.operations.join(", ")}`);
          } else if (sorted.properties.has(name)) {
            this.report(statement, "duplicate-statement", `Duplicate property '${name}'`);
          } else {
            sorted.properties.set(name, statement);
            const value = statement.value && this.value(lookup.spec, statement.value);
            if (value) sorted.values.set(name, value);
          }
          break;
        }
        case "assign":
          if (kind === "arithmetic" && sorted.assigns.length) this.report(statement, "duplicate-statement", "An arithmetic combinator has exactly one expression");
          else sorted.assigns.push(statement);
          break;
        case "when":
          if (sorted.whens.length) this.report(statement, "duplicate-statement", "Only one 'when' statement is allowed; combine conditions with 'and' / 'or'");
          else sorted.whens.push(statement);
          break;
        case "output":
          sorted.outputs.push(statement);
          break;
        case "section":
          sorted.sections.push(statement);
          break;
      }
    }
    return sorted;
  }

  point(clause: { readonly x?: Token; readonly y?: Token } | undefined, integers: boolean): Point | undefined {
    if (!clause) return undefined;
    const read = (token: Token | undefined) => (!token ? undefined : integers ? this.int(token) : parseNumber(token.text));
    const x = read(clause.x);
    const y = read(clause.y);
    return x === undefined || y === undefined ? undefined : { x, y };
  }

  entity(node: CstEntity, id: EntityId, name: string, position: Point): Entity {
    const statements = node.body?.statements ?? [];
    const operation = node.kind === "selector" ? this.selectorOperation(statements) : undefined;
    const sorted = this.sort(node.kind, statements, false, operation);
    const tile = this.point(node.tile, false);
    const direction = node.facing?.direction?.text as Direction | undefined;
    const placement: Placement | undefined = tile || direction ? compact({ tile, direction }) : undefined;
    const description = sorted.values.get("description")?.value as string | undefined;
    const base = compact({ id, name, position, placement, description });
    const label = node.name ?? node.keyword;
    switch (node.kind) {
      case "constant": return { ...base, ...this.constant(sorted, label) };
      case "arithmetic": return { ...base, ...this.arithmetic(sorted, label) };
      case "decider": return { ...base, ...this.decider(sorted, label) };
      case "selector": return { ...base, kind: "selector", mode: this.selector(sorted, operation ?? "select") };
      case "lamp": return { ...base, ...this.lamp(sorted) };
    }
  }

  private selectorOperation(statements: readonly CstStatement[]): SelectorOperation {
    for (const statement of statements) {
      if (statement.type !== "property" || statement.name.text !== "operation" || !statement.value) continue;
      const lookup = lookupProperty("selector", "operation", undefined);
      const values = lookup.status === "ok" && lookup.spec.values[0]?.type === "enum" ? lookup.spec.values[0].values : [];
      if (values.includes(statement.value.text)) return statement.value.text as SelectorOperation;
    }
    return "select";
  }

  /** Filters of one section; a signal may appear only once in it. */
  private filters(assigns: readonly CstAssign[]): ConstantFilter[] {
    const seen = new Set<string>();
    const filters: ConstantFilter[] = [];
    for (const assign of assigns) {
      const filter = this.filter(assign);
      if (!filter) continue;
      const key = signalKey(filter.signal);
      if (seen.has(key)) this.report(assign.target.signal, "duplicate-signal", `Signal '${key}' appears more than once in this section`);
      else {
        seen.add(key);
        filters.push(filter);
      }
    }
    return filters;
  }

  private filter(assign: CstAssign): ConstantFilter | undefined {
    const signal = this.slot(assign.target.signal, "constant.filter");
    this.noNetworks(assign.target, "A filter signal");
    if (!assign.first) return undefined;
    if (assign.operator || assign.first.type !== "int") {
      this.report({ from: assign.first.from, to: assign.to }, "invalid-value", "A filter count is a single integer");
      return undefined;
    }
    const count = this.int(assign.first.token);
    return signal && count !== undefined ? { signal, count } : undefined;
  }

  private constant(sorted: Sorted, label: Range): Omit<Extract<Entity, { kind: "constant" }>, "id" | "name" | "position"> {
    const enabled = (sorted.values.get("enabled")?.value as boolean | undefined) ?? true;
    let sections: ConstantSection[];
    if (sorted.sections.length) {
      for (const assign of sorted.assigns) this.report(assign, "contradictory-statement", "Bare filters cannot be combined with section blocks; move the filter into a section");
      sections = sorted.sections.map((section) => {
        const inner = this.sort("constant", section.body?.statements ?? [], true);
        return compact({
          group: section.name ? decodeString(section.name.text) : undefined,
          active: (inner.values.get("active")?.value as boolean | undefined) ?? true,
          multiplier: (inner.values.get("multiplier")?.value as number | undefined) ?? 1,
          filters: this.filters(inner.assigns),
        });
      });
    } else {
      sections = sorted.assigns.length ? [{ active: true, multiplier: 1, filters: this.filters(sorted.assigns) }] : [];
      if (!sorted.assigns.length) this.report(label, "unconfigured", "This constant combinator has no signals");
    }
    return { kind: "constant", enabled, sections };
  }

  private arithmetic(sorted: Sorted, label: Range): Omit<Extract<Entity, { kind: "arithmetic" }>, "id" | "name" | "position"> {
    const expression = sorted.assigns[0];
    if (!expression) {
      this.report(label, "unconfigured", "This arithmetic combinator has no expression");
      return DEFAULT_ENTITY.arithmetic;
    }
    const output = this.slot(expression.target.signal, "arithmetic.output");
    this.noNetworks(expression.target, "The output signal");
    const first = this.operand(expression.first, "arithmetic.operand");
    const second = this.operand(expression.second, "arithmetic.operand");
    const isEach = (operand: Operand | undefined) => operand?.type === "signal" && wildcardOf(operand.signal) === "each";
    if (output && wildcardOf(output) === "each" && first && second && !isEach(first) && !isEach(second)) {
      this.report(expression.target.signal, "illegal-wildcard", "'each' as output requires 'each' as an input operand");
    }
    const fallback = DEFAULT_ENTITY.arithmetic;
    return compact({ kind: "arithmetic" as const, first: first ?? fallback.first, operation: (expression.operator?.text as ArithmeticOperation | undefined) ?? fallback.operation, second: second ?? fallback.second, output });
  }

  private decider(sorted: Sorted, label: Range): Omit<Extract<Entity, { kind: "decider" }>, "id" | "name" | "position"> {
    const when = sorted.whens[0];
    const conditions: DeciderCondition[] = [];
    let hasEach = false;
    for (const condition of when?.conditions ?? []) {
      const first = this.slot(condition.first?.signal, "decider.condition");
      const second = this.operand(condition.second, "decider.operand");
      if ((first && wildcardOf(first) === "each") || (second?.type === "signal" && wildcardOf(second.signal) === "each")) hasEach = true;
      if (!first || !second || !condition.comparator) continue;
      conditions.push({ join: condition.join?.text === "and" ? "and" : "or", first, firstNetworks: this.networks(condition.first?.networks), comparator: condition.comparator.text as Comparator, second });
    }
    const outputs: DeciderOutput[] = [];
    const elseOutputs: DeciderOutput[] = [];
    for (const node of sorted.outputs) {
      if (node.else && !when) this.report(node, "unused-else-output", "This 'else output' is never used because the combinator has no 'when' condition");
      const signal = this.slot(node.signal?.signal, "decider.output");
      this.noNetworks(node.signal, "An output signal");
      if (signal && wildcardOf(signal) === "each" && when && !hasEach) this.report(node.signal!.signal, "illegal-wildcard", "'each' as output requires 'each' in a condition");
      if (!signal || !node.value) continue;
      const copy = node.value.kind === "keyword";
      const constant = copy ? 1 : this.int(node.value);
      if (constant === undefined) continue;
      (node.else ? elseOutputs : outputs).push({ signal, copyCountFromInput: copy, constant, networks: copy ? this.networks(node.networks) : BOTH_NETWORKS });
    }
    if (!when) this.report(label, "unconfigured", "This decider combinator has no 'when' condition");
    else if (!sorted.outputs.length) this.report(label, "unconfigured", "This decider combinator has no outputs");
    return { kind: "decider", conditions, outputs, elseOutputs };
  }

  private selector(sorted: Sorted, operation: SelectorOperation): SelectorMode {
    const get = <T extends PropertyValue["type"]>(name: string, type: T) => {
      const value = sorted.values.get(name);
      return value?.type === type ? (value.value as Extract<PropertyValue, { type: T }>["value"]) : undefined;
    };
    switch (operation) {
      case "select": {
        const index = sorted.values.get("index");
        return {
          operation,
          max: get("order", "enum") !== "min",
          index: index?.type === "signal" ? { type: "signal", signal: index.value, networks: BOTH_NETWORKS } : { type: "constant", value: index?.type === "int" ? index.value : 0 },
          indexComparator: get("index-comparator", "comparator") ?? "=",
        };
      }
      case "count": return compact({ operation, output: get("output", "signal") });
      case "random": return { operation, interval: get("interval", "int") ?? 0 };
      case "stack-size": return { operation };
      case "rocket-capacity": return { operation };
      case "quality-filter": return compact({ operation, comparator: get("comparator", "comparator") ?? "=", quality: get("quality", "quality") });
      case "quality-select": return { operation, highest: get("order", "enum") !== "lowest" };
      case "quality-transfer": {
        const fromSignal = get("source", "enum") === "signal";
        const sourceSignal = sorted.properties.get("source-signal");
        if (sourceSignal && !fromSignal) this.report(sourceSignal, "contradictory-statement", "'source-signal' requires 'source = signal'");
        const source = fromSignal ? compact({ type: "signal" as const, signal: get("source-signal", "signal") }) : { type: "quality" as const, quality: get("source", "quality") ?? "normal" };
        return compact({ operation, source, destination: get("destination", "signal") });
      }
      case "time": return compact({ operation, dayLength: get("day-length", "signal"), dayTick: get("day-tick", "signal"), gameTick: get("game-tick", "signal") });
    }
  }

  private lampCondition(when: CstWhen): Condition | undefined {
    const [condition, ...extra] = when.conditions as readonly [CstCondition | undefined, ...CstCondition[]];
    for (const other of extra) this.report(other, "syntax-error", "A lamp condition is a single comparison");
    if (!condition) return undefined;
    const first = this.slot(condition.first?.signal, "lamp.condition");
    this.noNetworks(condition.first, "A lamp condition signal (use the lamp's 'networks' property)");
    let second: Condition["second"] | undefined;
    if (condition.second?.type === "int") {
      const value = this.int(condition.second.token);
      if (value !== undefined) second = { type: "constant", value };
    } else if (condition.second) {
      const signal = this.slot(condition.second.ref.signal, "lamp.operand");
      this.noNetworks(condition.second.ref, "A lamp condition signal");
      if (signal) second = { type: "signal", signal };
    }
    return first && second && condition.comparator ? { first, comparator: condition.comparator.text as Comparator, second } : undefined;
  }

  private lamp(sorted: Sorted): Omit<Extract<Entity, { kind: "lamp" }>, "id" | "name" | "position"> {
    const when = sorted.whens[0];
    const value = <T>(name: string) => sorted.values.get(name)?.value as T | undefined;
    const networks = value<WireColor | typeof NO_NETWORK>("networks");
    const colors = value<LampColorMode>("colors");
    return compact({
      kind: "lamp" as const,
      condition: when && this.lampCondition(when),
      inputNetworks: networkSelection(networks),
      alwaysOn: value<boolean>("always-on") ?? false,
      useColors: colors !== undefined,
      colorMode: colors ?? "mapping",
      redSignal: value<SignalId>("red"),
      greenSignal: value<SignalId>("green"),
      blueSignal: value<SignalId>("blue"),
      rgbSignal: value<SignalId>("rgb"),
      color: value<RgbColor>("color"),
    });
  }
}

// Identity

interface Declaration {
  readonly name: string;
  readonly kind: EntityKind;
}

interface IdentityMatch {
  readonly ids: readonly EntityId[];
  readonly nextId: number;
  /** Previous entities that no declaration claimed. */
  readonly unclaimed: readonly IdentityEntry[];
}

/**
 * Carries ids from the previous parse: first by name, then (rename by typing) to the unmatched declaration of the same kind
 * that sits between the same name-matched neighbours. Everything else gets a fresh id.
 */
function matchIdentity(declarations: readonly Declaration[], previous: IdentityState | undefined): IdentityMatch {
  const old = previous?.entries ?? [];
  const lost = [...(previous?.lost ?? [])];
  const ids: (EntityId | undefined)[] = new Array(declarations.length).fill(undefined);
  const matched: number[] = new Array(declarations.length).fill(-1);
  const taken: boolean[] = new Array(old.length).fill(false);

  const byName = new Map<string, number[]>();
  for (let j = old.length - 1; j >= 0; j--) {
    const name = old[j]!.name;
    if (!name) continue;
    const queue = byName.get(name);
    if (queue) queue.push(j);
    else byName.set(name, [j]);
  }
  declarations.forEach((declaration, i) => {
    const j = declaration.name ? byName.get(declaration.name)?.pop() : undefined;
    if (j !== undefined) {
      ids[i] = old[j]!.id;
      matched[i] = j;
      taken[j] = true;
    }
  });
  declarations.forEach((declaration, i) => {
    if (ids[i] !== undefined || !declaration.name) return;
    const k = lost.findIndex((entry) => entry.name === declaration.name);
    if (k >= 0) ids[i] = lost.splice(k, 1)[0]!.id;
  });

  const upper: number[] = new Array(declarations.length);
  for (let i = declarations.length - 1, bound = old.length; i >= 0; i--) {
    upper[i] = bound;
    if (matched[i]! >= 0) bound = matched[i]!;
  }
  let lower = 0;
  let nextId = previous?.nextId ?? 1;
  declarations.forEach((declaration, i) => {
    if (matched[i]! >= 0) lower = matched[i]! + 1;
    if (ids[i] !== undefined) return;
    for (let j = lower; j < upper[i]!; j++) {
      if (taken[j] || old[j]!.kind !== declaration.kind) continue;
      ids[i] = old[j]!.id;
      taken[j] = true;
      lower = j + 1;
      return;
    }
    ids[i] = `e${nextId++}`;
  });
  return { ids: ids as EntityId[], nextId, unclaimed: [...old.filter((_, j) => !taken[j]), ...lost] };
}

// Auto-placement

const CARD = { width: 200, height: 120 };
const SLOT = { x: 240, y: 160, columns: 8, origin: 40 };

/** Fills in positions for entities without an `at` clause: the first free slots of a coarse grid, never overlapping a card. */
function autoPlace(positions: readonly (Point | undefined)[]): Point[] {
  const buckets = new Map<string, Point[]>();
  const cells = (p: Point): string[] => {
    const keys: string[] = [];
    for (let cx = Math.floor(p.x / CARD.width); cx <= Math.floor((p.x + CARD.width - 1) / CARD.width); cx++) {
      for (let cy = Math.floor(p.y / CARD.height); cy <= Math.floor((p.y + CARD.height - 1) / CARD.height); cy++) keys.push(`${cx},${cy}`);
    }
    return keys;
  };
  const occupy = (p: Point) => {
    for (const key of cells(p)) {
      const bucket = buckets.get(key);
      if (bucket) bucket.push(p);
      else buckets.set(key, [p]);
    }
  };
  const isFree = (p: Point) => cells(p).every((key) => !buckets.get(key)?.some((q) => Math.abs(p.x - q.x) < CARD.width && Math.abs(p.y - q.y) < CARD.height));
  for (const position of positions) if (position && Number.isFinite(position.x) && Number.isFinite(position.y)) occupy(position);
  let slot = 0;
  return positions.map((position) => {
    if (position) return position;
    for (;;) {
      const candidate = { x: SLOT.origin + (slot % SLOT.columns) * SLOT.x, y: SLOT.origin + Math.floor(slot / SLOT.columns) * SLOT.y };
      slot++;
      if (isFree(candidate)) {
        occupy(candidate);
        return candidate;
      }
    }
  });
}

// Source map

interface Span extends Range {
  readonly key: string;
}

function spanAt(spans: readonly Span[], offset: number): string | undefined {
  let low = 0;
  let high = spans.length - 1;
  let found: Span | undefined;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (spans[mid]!.from <= offset) {
      found = spans[mid];
      low = mid + 1;
    } else high = mid - 1;
  }
  return found && offset <= found.to ? found.key : undefined;
}

class Sources implements SourceMap {
  readonly entities = new Map<EntityId, EntitySource>();
  readonly wires = new Map<string, WireSource>();
  readonly entitySpans: Span[] = [];
  readonly wireSpans: Span[] = [];

  entityAt(offset: number): EntityId | undefined {
    return spanAt(this.entitySpans, offset);
  }

  wireAt(offset: number): string | undefined {
    return spanAt(this.wireSpans, offset);
  }
}

function range(node: Range): Range {
  return { from: node.from, to: node.to };
}

function entitySource(node: CstEntity, id: EntityId, name: string): EntitySource {
  const at = node.at?.x && node.at.y ? { range: range(node.at), x: range(node.at.x), y: range(node.at.y) } : undefined;
  const anchor = node.name ?? node.keyword;
  return compact({
    id,
    name,
    kind: node.kind,
    range: range(node),
    nameRange: node.name ? range(node.name) : { from: node.keyword.to, to: node.keyword.to },
    at,
    atInsert: anchor.to,
    bodyRange: node.body && range(node.body),
    statements: statementSources(node.body, node.kind),
    node,
  });
}

function statementSources(block: CstBlock | undefined, kind: EntityKind): StatementSource[] {
  return (block?.statements ?? []).map((statement) => ({ from: statement.from, to: statement.to, key: statementKey(statement, kind) }));
}

interface MemberAnalysis {
  readonly entityNodes: readonly CstEntity[];
  readonly entities: readonly Entity[];
  readonly wires: readonly Wire[];
  readonly sources: Sources;
  readonly match: IdentityMatch;
}

/** Entities, wires and their source map from the member declarations of a circuit or a fragment. */
function analyzeMembers(members: readonly CstMember[], analyzer: Analyzer, previous: IdentityState | undefined): MemberAnalysis {
  const entityNodes = members.filter((member): member is CstEntity => member.type === "entity");
  const wireNodes = members.filter((member): member is CstWire => member.type === "wire");

  const match = matchIdentity(entityNodes.map((node) => ({ name: node.name?.text ?? "", kind: node.kind })), previous);
  const positions = autoPlace(entityNodes.map((node) => analyzer.point(node.at, true)));

  const sources = new Sources();
  const byName = new Map<string, Entity>();
  const entities = entityNodes.map((node, i) => {
    const id = match.ids[i]!;
    const name = node.name?.text ?? "";
    const entity = analyzer.entity(node, id, name, positions[i]!);
    if (name) {
      if (byName.has(name)) analyzer.report(node.name!, "duplicate-entity", `Duplicate entity name '${name}'`);
      else byName.set(name, entity);
    }
    sources.entities.set(id, entitySource(node, id, name));
    sources.entitySpans.push({ from: node.from, to: node.to, key: id });
    return entity;
  });

  const wires = new Map<string, { wire: Wire; declarations: WireDeclaration[] }>();
  for (const node of wireNodes) {
    const terminal = (cst: CstWire["a"]): TerminalSource | undefined => {
      if (!cst) return undefined;
      const entity = byName.get(cst.name.text);
      if (!entity) {
        analyzer.report(cst.name, "unknown-entity", `Unknown entity '${cst.name.text}'`);
        return undefined;
      }
      if (!cst.side) return undefined;
      if (cst.side.text !== "in" && cst.side.text !== "out") {
        analyzer.report(cst.side, "unknown-terminal", `Unknown terminal '${cst.side.text}'; expected 'in' or 'out'`);
        return undefined;
      }
      const side = cst.side.text;
      if (!hasTerminal(entity.kind, side)) {
        analyzer.report(cst, "invalid-terminal", `A ${KIND_LABEL[entity.kind]} has no '${side}' terminal`);
        return undefined;
      }
      return { range: range(cst), nameRange: range(cst.name), entity: entity.id, side };
    };
    const a = terminal(node.a);
    const b = terminal(node.b);
    const color = node.color?.text as WireColor | undefined;
    if (!a || !b || !color) continue;
    if (a.entity === b.entity && a.side === b.side) {
      analyzer.report(node, "self-wire", "A wire cannot connect a terminal to itself");
      continue;
    }
    const wire = normalizeWire({ color, a: { entity: a.entity, side: a.side }, b: { entity: b.entity, side: b.side } });
    const key = wireKey(wire);
    const declaration: WireDeclaration = { range: range(node), a, b };
    const existing = wires.get(key);
    if (existing) {
      const first = existing.declarations[0]!;
      const reversed = first.a.entity !== a.entity || first.a.side !== a.side;
      analyzer.report(node, "duplicate-wire", `${reversed ? "Reversed duplicate" : "Duplicate"} of an earlier wire declaration; the connection exists once`);
      existing.declarations.push(declaration);
    } else wires.set(key, { wire, declarations: [declaration] });
    sources.wireSpans.push({ from: node.from, to: node.to, key });
  }
  for (const [key, { wire, declarations }] of wires) sources.wires.set(key, { key, wire, declarations });
  return { entityNodes, entities, wires: [...wires.values()].map((w) => w.wire), sources, match };
}

/** Entities named in one overlap warning; the rest is counted. */
const MAX_OVERLAP_NAMES = 3;

/**
 * Warnings about the in-game placement, none of which touches the simulation: a `tile` that is not on the grid for the kind and
 * direction of its entity, entities standing on the same tile, and `facing` on an entity that cannot rotate. For a circuit only:
 * a fragment loses its tiles when it is pasted.
 */
function checkPlacement(nodes: readonly CstEntity[], entities: readonly Entity[], analyzer: Analyzer): void {
  const nodeOf = new Map(entities.map((entity, i) => [entity.id, nodes[i]!]));
  for (const entity of entities) {
    const node = nodeOf.get(entity.id)!;
    if (node.facing?.direction && !canRotate(entity.kind)) analyzer.report(node.facing, "unused-facing", `A ${KIND_LABEL[entity.kind]} cannot be rotated; 'facing' is ignored`);
    const tile = entity.placement?.tile;
    const facing = facingOf(entity);
    if (!node.tile || !tile || isTileCenter(entity.kind, facing, tile)) continue;
    const { width, height } = tileSize(entity.kind, facing);
    const nearest = tileCenter(entity.kind, facing, tileOrigin(entity.kind, facing, tile));
    const rule = width > 1 ? "a whole x and a y ending in .5" : height > 1 ? "an x ending in .5 and a whole y" : "x and y ending in .5";
    const turned = width + height > 2 ? `facing ${facing}, ` : "";
    analyzer.report(node.tile, "tile-off-grid", `Not on the tile grid: ${turned}the center of this ${KIND_LABEL[entity.kind]} needs ${rule}; the nearest is (${nearest.x}, ${nearest.y})`);
  }

  const others = new Map<EntityId, Set<EntityId>>();
  const crowded = new Set<EntityId>();
  for (const { entities: sharing } of findTileOverlaps(entities)) {
    // Only the first few of a tile are named, so that a pile of entities on one tile stays linear.
    const named = sharing.slice(0, MAX_OVERLAP_NAMES + 1);
    for (const id of sharing) {
      const set = others.get(id) ?? new Set<EntityId>();
      others.set(id, set);
      for (const other of named) if (other !== id && set.size < MAX_OVERLAP_NAMES) set.add(other);
      if (sharing.length > MAX_OVERLAP_NAMES + 1) crowded.add(id);
    }
  }
  for (const [id, set] of others) {
    const names = [...set].map((other) => `'${nodeOf.get(other)!.name?.text ?? ""}'`);
    const list = crowded.has(id) ? `${names.join(", ")} and others` : names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0];
    analyzer.report(nodeOf.get(id)!.tile!, "tile-overlap", `Stands on a tile that ${list} ${names.length > 1 || crowded.has(id) ? "stand" : "stands"} on as well; in the game two entities cannot share a tile`);
  }
}

function sortDiagnostics(...lists: readonly (readonly Diagnostic[])[]): Diagnostic[] {
  return lists.flat().sort((x, y) => x.from - y.from || x.to - y.to);
}

/**
 * Parses and analyzes `source`. Pass the previous result of the same document so that entity ids stay stable while it evolves.
 * Never throws; `circuit` is present exactly when there are no error diagnostics.
 */
export function analyze(source: string, previous?: ParseResult, options: AnalyzeOptions = {}): ParseResult {
  const syntax = parse(source);
  const analyzer = new Analyzer(options.signals);
  const { entityNodes, entities, wires, sources, match } = analyzeMembers(syntax.cst.circuit?.members ?? [], analyzer, previous?.identity);
  checkPlacement(entityNodes, entities, analyzer);

  const diagnostics = sortDiagnostics(syntax.diagnostics, analyzer.diagnostics);
  const hasErrors = diagnostics.some((d) => d.severity === "error");
  const circuitNode = syntax.cst.circuit;
  const circuit: Circuit | undefined = hasErrors || !circuitNode ? undefined : { name: circuitNode.name ? decodeString(circuitNode.name.text) : "", entities, wires };
  const identity: IdentityState = {
    nextId: match.nextId,
    entries: entityNodes.map((node, i) => ({ id: match.ids[i]!, name: node.name?.text ?? "", kind: node.kind })),
    lost: hasErrors ? match.unclaimed.slice(0, MAX_LOST) : [],
  };
  return compact({ source, version: options.version, cst: syntax.cst, diagnostics, hasErrors, circuit, sourceMap: sources, identity });
}

export interface FragmentResult {
  /** Sorted by position; offsets refer to the fragment text. */
  readonly diagnostics: readonly Diagnostic[];
  readonly hasErrors: boolean;
  /** Present only when there are no errors. Entity ids are local to the fragment. */
  readonly fragment?: Fragment;
}

/**
 * Parses and analyzes the text of a circuit fragment (see `parseFragment`). Never throws. Every wire has to connect two entities
 * of the fragment; entities without an `at` clause are placed like in a circuit.
 */
export function analyzeFragment(source: string): FragmentResult {
  const syntax = parseFragment(source);
  const analyzer = new Analyzer(undefined);
  const { entities, wires } = analyzeMembers(syntax.members, analyzer, undefined);
  const diagnostics = sortDiagnostics(syntax.diagnostics, analyzer.diagnostics);
  const hasErrors = diagnostics.some((d) => d.severity === "error");
  return compact({ diagnostics, hasErrors, fragment: hasErrors ? undefined : { entities, wires } });
}

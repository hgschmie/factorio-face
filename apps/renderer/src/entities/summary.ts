// One-line configuration summaries shown on entity cards. Pure.
import { prototypeData, type ArithmeticCombinator, type ConstantCombinator, type DeciderCombinator, type Entity, type Lamp, type Operand, type SelectorCombinator, type SignalId, type Speaker } from "@face/model";
import { shortSignal } from "./signalText.ts";

const OPERATOR_SYMBOLS: Readonly<Record<string, string>> = { "*": "×", "/": "÷", "-": "−", "!=": "≠", "<=": "≤", ">=": "≥" };

function symbol(operator: string): string {
  return OPERATOR_SYMBOLS[operator] ?? operator;
}

function signalOrBlank(signal: SignalId | undefined): string {
  return signal ? shortSignal(signal) : "?";
}

function operandText(operand: Operand | { readonly type: "signal"; readonly signal: SignalId }): string {
  return operand.type === "constant" ? String(operand.value) : shortSignal(operand.signal);
}

function more(count: number): string {
  return count > 0 ? ` +${count}` : "";
}

function constantSummary(entity: ConstantCombinator): string {
  const filters = entity.sections.filter((section) => section.active).flatMap((section) => section.filters.map((filter) => ({ ...filter, count: filter.count * section.multiplier })));
  if (!entity.enabled) return "switched off";
  const first = filters[0];
  if (!first) return "no signals";
  return `${shortSignal(first.signal)} = ${first.count}${more(filters.length - 1)}`;
}

function arithmeticSummary(entity: ArithmeticCombinator): string {
  return `${operandText(entity.first)} ${symbol(entity.operation)} ${operandText(entity.second)} → ${signalOrBlank(entity.output)}`;
}

function deciderSummary(entity: DeciderCombinator): string {
  const condition = entity.conditions[0];
  const output = entity.outputs[0];
  if (!condition) return "no condition";
  const test = `${signalOrBlank(condition.first)} ${symbol(condition.comparator)} ${operandText(condition.second)}${more(entity.conditions.length - 1)}`;
  return `${test} → ${output ? shortSignal(output.signal) : "?"}${more(entity.outputs.length - 1)}`;
}

function selectorSummary(entity: SelectorCombinator): string {
  const mode = entity.mode;
  switch (mode.operation) {
    case "select":
      return `${mode.max ? "max" : "min"} #${operandText(mode.index)}`;
    case "count":
      return `count → ${signalOrBlank(mode.output)}`;
    case "random":
      return `random / ${mode.interval} ticks`;
    case "quality-filter":
      return `quality ${symbol(mode.comparator ?? "=")} ${mode.quality ?? "?"}`;
    case "quality-select":
      return mode.highest ? "highest quality" : "lowest quality";
    case "quality-transfer":
      return `quality → ${signalOrBlank(mode.destination)}`;
    case "time":
      return "time signals";
    case "stack-size":
      return "stack size";
    case "rocket-capacity":
      return "rocket capacity";
  }
}

// "Always on" is about the time of day; a lamp controlled by the circuit network follows its condition either way, so the card shows that.
function lampSummary(entity: Lamp): string {
  const condition = entity.condition;
  if (!condition) return entity.alwaysOn ? "always on" : "no condition";
  return `${signalOrBlank(condition.first)} ${symbol(condition.comparator)} ${operandText(condition.second)}`;
}

// Minimal until package H lays out the speaker card: when it plays, or which signal picks the note.
function speakerSummary(entity: Speaker): string {
  if (entity.pitchSignal) return `pitch ${shortSignal(entity.pitchSignal)}`;
  const condition = entity.condition;
  return condition ? `${signalOrBlank(condition.first)} ${symbol(condition.comparator)} ${operandText(condition.second)}` : "no condition";
}

export function entitySummary(entity: Entity): string {
  switch (entity.kind) {
    case "constant":
      return constantSummary(entity);
    case "arithmetic":
      return arithmeticSummary(entity);
    case "decider":
      return deciderSummary(entity);
    case "selector":
      return selectorSummary(entity);
    case "lamp":
      return lampSummary(entity);
    case "pole":
      return prototypeData(entity).label;
    case "speaker":
      return speakerSummary(entity);
  }
}

/** Shortens text to at most `maxLength` characters, ending in an ellipsis when cut. */
export function truncate(text: string, maxLength: number): string {
  return text.length <= maxLength ? text : text.slice(0, Math.max(0, maxLength - 1)) + "…";
}

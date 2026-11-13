// Configuration summaries shown on entity cards: one line, two for an entity that needs them (a speaker). Pure.
import { prototypeData, type ArithmeticCombinator, type Condition, type ConstantCombinator, type DeciderCombinator, type Entity, type Lamp, type Operand, type Pole, type SelectorCombinator, type SignalId, type Speaker } from "@face/model";
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

function conditionText(condition: Condition): string {
  return `${signalOrBlank(condition.first)} ${symbol(condition.comparator)} ${operandText(condition.second)}`;
}

// "Always on" is about the time of day; a lamp controlled by the circuit network follows its condition either way, so the card shows that.
function lampSummary(entity: Lamp): string {
  const condition = entity.condition;
  if (!condition) return entity.alwaysOn ? "always on" : "no condition";
  return conditionText(condition);
}

/** Which pole it is says the heading of its card; what the choice decides is how far its wires reach and the tiles it covers. */
function poleSummary(entity: Pole): string {
  const { wireReach, width, height } = prototypeData(entity);
  return `${wireReach === undefined ? "" : `reach ${wireReach} · `}${width}x${height}`;
}

/** The instruments of the game with their notes, by name and in the game's order, as far as a summary needs them. */
export type InstrumentNames = readonly { readonly name: string; readonly notes: readonly { readonly name: string }[] }[];

/**
 * The instrument and the note of a speaker by their names in the game data. Where the speaker does not say, it is the first
 * of the game's list, which only `instruments` knows.
 */
export function speakerSound(entity: Pick<Speaker, "instrument" | "note">, instruments?: InstrumentNames): { readonly instrument?: string; readonly note?: string } {
  const instrument = entity.instrument ?? instruments?.[0]?.name;
  return { instrument, note: entity.note ?? instruments?.find((candidate) => candidate.name === instrument)?.notes[0]?.name };
}

/** A sound in words, as far as its names are known: "piano F#3", "piano", "". */
export function soundText(sound: { readonly instrument?: string; readonly note?: string }): string {
  return [sound.instrument, sound.note].filter((part) => part !== undefined).join(" ");
}

/** What a speaker plays and when: the sound and its condition, or the signal that picks the note and the instrument it picks it from. */
function speakerSummary(entity: Speaker, instruments?: InstrumentNames): readonly string[] {
  const sound = speakerSound(entity, instruments);
  if (entity.pitchSignal) return [`pitch from ${shortSignal(entity.pitchSignal)}`, sound.instrument ?? "first instrument"];
  return [soundText(sound) || "first sound", entity.condition ? `when ${conditionText(entity.condition)}` : "no condition"];
}

/** The lines under the name on a card. `instruments` names the sound of a speaker that leaves it to the game's default. */
export function summaryLines(entity: Entity, instruments?: InstrumentNames): readonly string[] {
  switch (entity.kind) {
    case "constant":
      return [constantSummary(entity)];
    case "arithmetic":
      return [arithmeticSummary(entity)];
    case "decider":
      return [deciderSummary(entity)];
    case "selector":
      return [selectorSummary(entity)];
    case "lamp":
      return [lampSummary(entity)];
    case "pole":
      return [poleSummary(entity)];
    case "speaker":
      return speakerSummary(entity, instruments);
  }
}

/** The summary as one text. */
export function entitySummary(entity: Entity, instruments?: InstrumentNames): string {
  return summaryLines(entity, instruments).join(", ");
}

/** Shortens text to at most `maxLength` characters, ending in an ellipsis when cut. */
export function truncate(text: string, maxLength: number): string {
  return text.length <= maxLength ? text : text.slice(0, Math.max(0, maxLength - 1)) + "…";
}

// Configuration summaries shown on entity cards: one line, two for an entity that needs them (a speaker). Pure.
import {
  conditionRole, gamePrototype, prototypeData, settingDefault, settingShown, settingSpecsOf,
  type ArithmeticCombinator, type Condition, type ConstantCombinator, type DeciderCombinator, type Entity, type GenericEntity, type Lamp, type Operand, type Pole, type SelectorCombinator, type SignalId, type Speaker,
} from "@face/model";
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

/** Characters of a line of the summary of a card: of the one line, and of each of two, which are set smaller. */
export const SUMMARY_CHARS = { one: 15, two: 18 } as const;

/**
 * As many of the items as fit `maxChars` in a row, with room for how many more there are: "read-contents +2". The first one is
 * always there. Returns the text and the number of items in it.
 */
function fitItems(items: readonly string[], maxChars: number, last: boolean): readonly [text: string, shown: number] {
  let text = items[0] ?? "";
  let shown = Math.min(items.length, 1);
  const tail = (left: number): string => (last ? more(left) : left > 0 ? "," : "");
  while (shown < items.length && `${text}, ${items[shown]}${tail(items.length - shown - 1)}`.length <= maxChars) text += `, ${items[shown++]}`;
  return [text + tail(items.length - shown), shown];
}

/** The items on one line of at most `maxChars`, the ones that do not fit counted: "read-contents +2". */
export function fitList(items: readonly string[], maxChars: number): string {
  return fitItems(items, maxChars, true)[0];
}

/** The items on one line where they fit the one line of a card, else over two lines, the second with the count of what is left. */
export function fitLines(items: readonly string[]): readonly string[] {
  if (items.join(", ").length <= SUMMARY_CHARS.one) return [items.join(", ")];
  const [first, shown] = fitItems(items, SUMMARY_CHARS.two, false);
  return shown === items.length ? [first] : [first, fitList(items.slice(shown), SUMMARY_CHARS.two)];
}

/** The circuit conditions a generic entity holds, in the order of its settings: the one that enables it as it is, every other one behind what it decides (`harvest A > 5`). */
export function conditionLines(entity: GenericEntity): string[] {
  return settingSpecsOf(entity.prototype).flatMap((spec) => {
    const condition = spec.type === "condition" ? (entity.settings[spec.key] as Condition | undefined) : undefined;
    const role = conditionRole(spec.key);
    return condition ? [`${role === undefined ? "" : `${role} `}${conditionText(condition)}`] : [];
  });
}

/**
 * What a generic entity reads, sends and takes from the network, in the words of the language: its switches that are on
 * (`read-contents`) and its modes (`read-hand: pulse`, `mode: surface`; none for a mode that is `none`), set or by default. A switch that belongs
 * to one that is off does not count (`include-in-crafting` without `read-contents`): the game does not show it either.
 */
export function activeSettings(entity: GenericEntity): string[] {
  const game = gamePrototype(entity);
  const specs = settingSpecsOf(entity.prototype);
  return specs.flatMap((spec) => {
    if (!settingShown(spec, specs, game, entity.settings)) return [];
    const value = entity.settings[spec.key] ?? settingDefault(spec, game);
    if (spec.type === "boolean") return value === true ? [spec.key] : [];
    if (spec.type !== "enum" || value === "none") return [];
    // A mode that can be off is a switch with a choice behind it: at the mode of a new entity it goes by its word alone.
    const switched = spec.values.some((entry) => entry.word === "none");
    return [switched && value === spec.default ? spec.key : `${spec.key}: ${String(value)}`];
  });
}

/**
 * What the entity is says the heading of its card. The summary is its circuit conditions ("no condition" where its type has one
 * and none is set) and under them what it reads and sets; an entity whose type has no condition has both lines for that.
 */
function genericSummary(entity: GenericEntity): readonly string[] {
  const conditions = conditionLines(entity);
  const active = activeSettings(entity);
  const conditional = settingSpecsOf(entity.prototype).some((spec) => spec.type === "condition" && !spec.logistic);
  // Of several conditions the first one is there, cut where the count of the others needs its room.
  const others = more(conditions.length - 1);
  const first = conditions.length > 0 ? `${truncate(conditions[0]!, SUMMARY_CHARS.two - others.length)}${others}` : conditional ? "no condition" : undefined;
  if (first === undefined) return active.length > 0 ? fitLines(active) : ["no settings"];
  return active.length > 0 ? [first, fitList(active, SUMMARY_CHARS.two)] : [first];
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
    case "entity":
      return genericSummary(entity);
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

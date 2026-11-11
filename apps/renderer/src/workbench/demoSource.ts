// DEMO ONLY. Prints a circuit in the face language (docs/dsl.md) so the Source view and saved projects have content
// before packages/language exists. The language package's source patches replace this; nothing else may depend on it.
import { signalKey, wildcardOf, type Circuit, type Condition, type ConstantSection, type DeciderOutput, type Entity, type NetworkSelection, type Operand, type SelectorMode, type SignalId } from "@face/model";

const INDENT = "    ";

function sig(id: SignalId): string {
  return wildcardOf(id) ?? signalKey(id);
}

function networks(selection: NetworkSelection): string {
  if (selection.red && selection.green) return "";
  return selection.red ? "[red]" : "[green]";
}

function operand(value: Operand): string {
  return value.type === "constant" ? String(value.value) : sig(value.signal) + networks(value.networks);
}

function conditionOperand(value: Condition["second"]): string {
  return value.type === "constant" ? String(value.value) : sig(value.signal);
}

function constantLines(sections: readonly ConstantSection[]): string[] {
  const only = sections[0];
  if (sections.length === 1 && only && only.group === undefined && only.active && only.multiplier === 1) return only.filters.map((filter) => `${sig(filter.signal)} = ${filter.count}`);
  return sections.flatMap((section) => [
    `section${section.group === undefined ? "" : " " + JSON.stringify(section.group)} {`,
    ...section.filters.map((filter) => `${INDENT}${sig(filter.signal)} = ${filter.count}`),
    ...(section.active ? [] : [`${INDENT}active = false`]),
    ...(section.multiplier === 1 ? [] : [`${INDENT}multiplier = ${section.multiplier}`]),
    "}",
  ]);
}

function deciderOutput(output: DeciderOutput): string {
  return `output ${sig(output.signal)} = ${output.copyCountFromInput ? "input" + networks(output.networks) : output.constant}`;
}

function selectorLines(mode: SelectorMode): string[] {
  const lines = [`operation = ${mode.operation}`];
  switch (mode.operation) {
    case "select":
      lines.push(`order = ${mode.max ? "max" : "min"}`, `index = ${operand(mode.index)}`);
      if (mode.indexComparator !== "=") lines.push(`index-comparator = ${mode.indexComparator}`);
      break;
    case "count":
      if (mode.output) lines.push(`output = ${sig(mode.output)}`);
      break;
    case "random":
      lines.push(`interval = ${mode.interval}`);
      break;
    case "quality-filter":
      if (mode.quality) lines.push(`quality = ${mode.quality}`);
      if (mode.comparator) lines.push(`comparator = ${mode.comparator}`);
      break;
    case "quality-select":
      lines.push(`order = ${mode.highest ? "highest" : "lowest"}`);
      break;
    case "quality-transfer":
      if (mode.source.type === "quality") lines.push(`source = ${mode.source.quality}`);
      else lines.push("source = signal", ...(mode.source.signal ? [`source-signal = ${sig(mode.source.signal)}`] : []));
      if (mode.destination) lines.push(`destination = ${sig(mode.destination)}`);
      break;
    case "time":
      if (mode.dayLength) lines.push(`day-length = ${sig(mode.dayLength)}`);
      if (mode.dayTick) lines.push(`day-tick = ${sig(mode.dayTick)}`);
      if (mode.gameTick) lines.push(`game-tick = ${sig(mode.gameTick)}`);
      break;
    case "stack-size":
    case "rocket-capacity":
      break;
  }
  return lines;
}

function hex(value: number): string {
  return Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");
}

function bodyLines(entity: Entity): string[] {
  switch (entity.kind) {
    case "constant":
      return [...(entity.enabled ? [] : ["enabled = false"]), ...constantLines(entity.sections)];
    case "arithmetic":
      return entity.output ? [`${sig(entity.output)} = ${operand(entity.first)} ${entity.operation} ${operand(entity.second)}`] : [];
    case "decider": {
      const conditions = entity.conditions.filter((condition) => condition.first !== undefined);
      const when = conditions.map((condition, index) => `${index === 0 ? "" : condition.join + " "}${sig(condition.first!)}${networks(condition.firstNetworks)} ${condition.comparator} ${operand(condition.second)}`);
      return [...(when.length > 0 ? [`when ${when.join(" ")}`] : []), ...entity.outputs.map(deciderOutput), ...entity.elseOutputs.map((output) => `else ${deciderOutput(output)}`)];
    }
    case "selector":
      return selectorLines(entity.mode);
    case "lamp": {
      const lines: string[] = [];
      const condition = entity.condition;
      if (condition?.first) lines.push(`when ${sig(condition.first)} ${condition.comparator} ${conditionOperand(condition.second)}`);
      if (!entity.inputNetworks.red || !entity.inputNetworks.green) lines.push(`networks = ${entity.inputNetworks.red ? "red" : "green"}`);
      if (entity.alwaysOn) lines.push("always-on = true");
      if (entity.useColors) lines.push(`colors = ${entity.colorMode}`);
      if (entity.redSignal) lines.push(`red = ${sig(entity.redSignal)}`);
      if (entity.greenSignal) lines.push(`green = ${sig(entity.greenSignal)}`);
      if (entity.blueSignal) lines.push(`blue = ${sig(entity.blueSignal)}`);
      if (entity.rgbSignal) lines.push(`rgb = ${sig(entity.rgbSignal)}`);
      if (entity.color) lines.push(`color = #${hex(entity.color.r)}${hex(entity.color.g)}${hex(entity.color.b)}`);
      return lines;
    }
  }
}

export function printDemoSource(circuit: Circuit): string {
  const names = new Map(circuit.entities.map((entity) => [entity.id, entity.name]));
  const lines = [`circuit ${JSON.stringify(circuit.name)} {`];
  for (const entity of circuit.entities) {
    const body = [...(entity.description ? [`description = ${JSON.stringify(entity.description)}`] : []), ...bodyLines(entity)];
    lines.push(`${INDENT}${entity.kind} ${entity.name} at (${entity.position.x}, ${entity.position.y}) {`, ...body.map((line) => INDENT + INDENT + line), `${INDENT}}`, "");
  }
  for (const wire of circuit.wires) {
    // Reads best from output to input; the direction has no meaning in the language.
    const [from, to] = wire.a.side === "in" && wire.b.side === "out" ? [wire.b, wire.a] : [wire.a, wire.b];
    lines.push(`${INDENT}wire ${wire.color} ${names.get(from.entity)}.${from.side} <-> ${names.get(to.entity)}.${to.side}`);
  }
  if (lines.at(-1) === "") lines.pop();
  lines.push("}", "");
  return lines.join("\n");
}

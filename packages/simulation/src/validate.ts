// Static checks per entity. A note with severity "error" silences the entity; the evaluators rely on that and do not re-check.

import { signalKey, wildcardOf, type ArithmeticCombinator, type ConstantCombinator, type DeciderCombinator, type Entity, type Lamp, type SelectorCombinator, type SignalId } from "@face/model";
import type { SimulationEnvironment } from "./environment.ts";
import type { NoteCode, NoteSeverity, SimulationNote } from "./types.ts";

type Report = (severity: NoteSeverity, code: NoteCode, message: string, signal?: SignalId) => void;

const isWildcard = (id: SignalId | undefined): boolean => !!id && wildcardOf(id) !== undefined;
const isEach = (id: SignalId | undefined): boolean => !!id && wildcardOf(id) === "each";
const isGroupWildcard = (id: SignalId | undefined): boolean => isWildcard(id) && !isEach(id);

function checkConstant(entity: ConstantCombinator, report: Report): void {
  for (const section of entity.sections) {
    for (const filter of section.filters) {
      if (isWildcard(filter.signal)) report("warning", "invalid-filter", "Wildcard signals cannot be transmitted; the filter is ignored.", filter.signal);
    }
  }
}

function checkArithmetic(entity: ArithmeticCombinator, report: Report): void {
  const operands = [entity.first, entity.second].map((o) => (o.type === "signal" ? o.signal : undefined));
  for (const id of [...operands, entity.output]) {
    if (isGroupWildcard(id)) report("error", "invalid-wildcard", "An arithmetic combinator accepts no everything or anything signal.", id);
  }
  if (!entity.output) report("info", "unconfigured", "No output signal; the combinator emits nothing.");
  else if (isEach(entity.output) && !operands.some(isEach)) report("error", "invalid-wildcard", "An each output needs each as an operand.", entity.output);
}

function checkDecider(entity: DeciderCombinator, report: Report): void {
  let each = false;
  for (const condition of entity.conditions) {
    const second = condition.second.type === "signal" ? condition.second.signal : undefined;
    if (isGroupWildcard(second)) report("error", "invalid-wildcard", "Everything and anything are not supported on the right-hand side of a condition.", second);
    if (!condition.first) report("info", "unconfigured", "A condition without a first signal is false (assumed).");
    each ||= isEach(condition.first) || isEach(second);
  }
  if (entity.conditions.length === 0) report("info", "unconfigured", "No conditions; the expression is false (assumed).");
  if (entity.outputs.length === 0 && entity.elseOutputs.length === 0) report("info", "unconfigured", "No outputs; the combinator emits nothing.");
  for (const output of [...entity.outputs, ...entity.elseOutputs]) {
    const wildcard = wildcardOf(output.signal);
    if (wildcard === "each" && !each) report("error", "invalid-wildcard", "An each output needs each in the conditions.", output.signal);
    if (wildcard === "everything" && each) report("error", "invalid-wildcard", "An everything output cannot be combined with each in the conditions.", output.signal);
  }
}

function checkSelector(entity: SelectorCombinator, env: SimulationEnvironment, report: Report): void {
  const mode = entity.mode;
  const noWildcard = (id: SignalId | undefined, slot: string): void => {
    if (isWildcard(id)) report("error", "invalid-wildcard", `The ${slot} of a selector combinator accepts no wildcard signal.`, id);
  };
  switch (mode.operation) {
    case "select":
      if (mode.index.type === "signal") noWildcard(mode.index.signal, "index signal");
      break;
    case "count":
      if (!mode.output) report("info", "unconfigured", "No count signal; the combinator emits nothing.");
      noWildcard(mode.output, "count signal");
      break;
    case "random":
      report("info", "random-not-reproducible", "Random selection uses a seeded generator; the sequence differs from the game.");
      break;
    case "stack-size":
    case "rocket-capacity":
      break;
    case "quality-filter":
      if (mode.quality !== undefined && !env.qualities.some((q) => q.name === mode.quality)) {
        report("error", "unknown-quality", `Unknown quality "${mode.quality}"; the combinator emits nothing.`);
      }
      break;
    case "quality-select":
      break;
    case "quality-transfer":
      if (!mode.destination) report("info", "unconfigured", "No target signal; the combinator emits nothing.");
      else if (isGroupWildcard(mode.destination)) report("error", "invalid-wildcard", "The target signal accepts each but not everything or anything.", mode.destination);
      if (mode.source.type === "signal") {
        if (!mode.source.signal) report("info", "unconfigured", "No quality source signal; the combinator emits nothing.");
        noWildcard(mode.source.signal, "quality source signal");
      } else {
        const quality = mode.source.quality;
        if (!env.qualities.some((q) => q.name === quality)) report("warning", "unknown-quality", `Unknown quality "${quality}"; it is used as an opaque name.`);
      }
      break;
    case "time":
      if (!mode.gameTick && !mode.dayTick && !mode.dayLength) report("info", "unconfigured", "No time signal set; the combinator emits nothing.");
      noWildcard(mode.gameTick, "game tick signal");
      noWildcard(mode.dayTick, "day tick signal");
      noWildcard(mode.dayLength, "day length signal");
      break;
  }
}

function checkLamp(entity: Lamp, report: Report): void {
  const condition = entity.condition;
  if (condition) {
    if (isEach(condition.first)) report("error", "invalid-wildcard", "A lamp condition accepts no each signal.", condition.first);
    if (condition.second.type === "signal" && isWildcard(condition.second.signal)) {
      report("error", "invalid-wildcard", "Wildcards are not supported on the right-hand side of a condition.", condition.second.signal);
    }
    if (!condition.first) report("info", "unconfigured", "A condition without a first signal is false (assumed).");
  }
  for (const id of [entity.redSignal, entity.greenSignal, entity.blueSignal, entity.rgbSignal]) {
    if (isWildcard(id)) report("error", "invalid-wildcard", "A lamp color signal cannot be a wildcard.", id);
  }
}

export function validateEntity(entity: Entity, env: SimulationEnvironment): SimulationNote[] {
  const notes: SimulationNote[] = [];
  const report: Report = (severity, code, message, signal) => {
    notes.push({ severity, code, message, entity: entity.id, ...(signal && { signal: signalKey(signal) }) });
  };
  switch (entity.kind) {
    case "constant":
      checkConstant(entity, report);
      break;
    case "arithmetic":
      checkArithmetic(entity, report);
      break;
    case "decider":
      checkDecider(entity, report);
      break;
    case "selector":
      checkSelector(entity, env, report);
      break;
    case "lamp":
      checkLamp(entity, report);
      break;
  }
  return notes;
}

// Inspector edits on their way to the source. The settings forms emit complete entities; some of them are states the circuit
// language cannot write down. Two cases are told apart here:
// - fields that carry no meaning in the chosen configuration (an output constant while the input count is copied, ...) are
//   set to the value the language implies, so that the edit can be written;
// - configurations that are incomplete (a condition without a signal, an expression without an output) are kept as a draft
//   with a hint, and written as soon as they become complete.
import { checkEntity, type EditFailureCode } from "@face/language";
import { BOTH_NETWORKS, type DeciderOutput, type Entity } from "@face/model";

function normalizeOutput(output: DeciderOutput): DeciderOutput {
  if (output.copyCountFromInput) return output.constant === 1 ? output : { ...output, constant: 1 };
  return output.networks.red && output.networks.green ? output : { ...output, networks: BOTH_NETWORKS };
}

function mapUnchanged<T>(list: readonly T[], map: (item: T, index: number) => T): readonly T[] {
  const mapped = list.map(map);
  return mapped.every((item, index) => item === list[index]) ? list : mapped;
}

/** Sets fields without meaning in the entity's configuration to the value the language implies. Returns the same object when nothing changes. */
export function normalizeEntity(entity: Entity): Entity {
  switch (entity.kind) {
    case "decider": {
      // The join of the first condition is ignored by the game; the language reads it as "or".
      const conditions = mapUnchanged(entity.conditions, (condition, index) => (index === 0 && condition.join !== "or" ? { ...condition, join: "or" as const } : condition));
      const outputs = mapUnchanged(entity.outputs, normalizeOutput);
      const elseOutputs = mapUnchanged(entity.elseOutputs, normalizeOutput);
      return conditions === entity.conditions && outputs === entity.outputs && elseOutputs === entity.elseOutputs ? entity : { ...entity, conditions, outputs, elseOutputs };
    }
    case "selector": {
      const mode = entity.mode;
      if (mode.operation === "select" && mode.index.type === "signal" && !(mode.index.networks.red && mode.index.networks.green)) return { ...entity, mode: { ...mode, index: { ...mode.index, networks: BOTH_NETWORKS } } };
      if (mode.operation === "quality-filter" && mode.comparator === undefined) return { ...entity, mode: { ...mode, comparator: "=" } };
      return entity;
    }
    case "lamp":
      return !entity.useColors && entity.colorMode !== "mapping" ? { ...entity, colorMode: "mapping" } : entity;
    default:
      return entity;
  }
}

export type DraftCheck = { readonly ok: true } | { readonly ok: false; readonly code: EditFailureCode; readonly message: string };

const ORDINALS = ["first", "second", "third", "fourth", "fifth"];

function ordinal(index: number): string {
  return ORDINALS[index] ?? `${index + 1}th`;
}

/** What is missing, in the inspector's words. Falls back to the language's own message. */
function hint(entity: Entity, fallback: string): string {
  switch (entity.kind) {
    case "arithmetic":
      if (!entity.output) return "Choose an output signal to complete the expression.";
      break;
    case "decider": {
      const blank = entity.conditions.findIndex((condition) => !condition.first);
      if (blank >= 0) return entity.conditions.length === 1 ? "The condition needs a signal." : `The ${ordinal(blank)} condition needs a signal.`;
      break;
    }
    case "lamp":
      if (entity.condition && !entity.condition.first) return "The light condition needs a signal.";
      break;
    default:
      break;
  }
  return fallback;
}

/** Whether the language can write `entity` (already normalized) exactly, and if not, a hint for the inspector. */
export function checkDraft(entity: Entity): DraftCheck {
  const check = checkEntity(entity);
  if (check.ok) return check;
  return { ok: false, code: check.code, message: check.code === "unrepresentable" ? hint(entity, "This configuration is incomplete.") : check.message };
}

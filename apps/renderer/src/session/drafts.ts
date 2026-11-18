// Inspector edits on their way to the source. The settings forms emit complete entities; some of them are states the circuit
// language cannot write down. Two cases are told apart here:
// - fields that carry no meaning in the chosen configuration (an output constant while the input count is copied, ...) are
//   set to the value the language implies, so that the edit can be written;
// - configurations that are incomplete (a comparison without a signal, an expression without an output) are kept as a draft
//   with a hint, and written as soon as they become complete. A condition of a lamp or a generic entity that is in use without
//   a signal and says nothing else is complete: the unset condition, which the language writes. So is a condition of a decider
//   combinator without a signal: the game reads the empty slot as 0, and the language writes it as `0 < S`.
import { checkEntity, type EditFailureCode } from "@face/language";
import { BOTH_NETWORKS, UNSET_CONDITION, type DeciderCondition, type DeciderOutput, type Entity } from "@face/model";
import { incompleteCondition } from "../entities/genericSettings.ts";

function normalizeOutput(output: DeciderOutput): DeciderOutput {
  if (output.copyCountFromInput) return output.constant === 1 ? output : { ...output, constant: 1 };
  return output.networks.red && output.networks.green ? output : { ...output, networks: BOTH_NETWORKS };
}

/** The join of the first condition is ignored by the game; the language reads it as "or". An empty signal slot reads no network; the language has both for it. */
function normalizeCondition(condition: DeciderCondition, index: number): DeciderCondition {
  const join = index === 0 ? "or" : condition.join;
  const both = condition.firstNetworks.red && condition.firstNetworks.green;
  const firstNetworks = condition.first || both ? condition.firstNetworks : BOTH_NETWORKS;
  return join === condition.join && firstNetworks === condition.firstNetworks ? condition : { ...condition, join, firstNetworks };
}

function mapUnchanged<T>(list: readonly T[], map: (item: T, index: number) => T): readonly T[] {
  const mapped = list.map(map);
  return mapped.every((item, index) => item === list[index]) ? list : mapped;
}

/** Sets fields without meaning in the entity's configuration to the value the language implies. Returns the same object when nothing changes. */
export function normalizeEntity(entity: Entity): Entity {
  switch (entity.kind) {
    case "decider": {
      const conditions = mapUnchanged(entity.conditions, normalizeCondition);
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

/** What is missing, in the inspector's words. Falls back to the language's own message. */
function hint(entity: Entity, fallback: string): string {
  switch (entity.kind) {
    case "arithmetic":
      if (!entity.output) return "Choose an output signal to complete the expression.";
      break;
    case "lamp":
      if (entity.condition && entity.condition !== UNSET_CONDITION && !entity.condition.first) return "The light condition needs a signal.";
      break;
    case "speaker":
      if (entity.condition && !entity.condition.first) return "The condition needs a signal.";
      break;
    case "entity": {
      const blank = incompleteCondition(entity);
      if (blank) return `The condition "${blank.label}" needs a signal.`;
      break;
    }
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

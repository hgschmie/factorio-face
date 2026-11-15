import { BOTH_NETWORKS, gamePrototype, isSettingValue, settingSpecsOf, type ConditionSetting, type ConditionValue, type GenericEntity, type NetworkSelection, type SignalId } from "@face/model";
import { AGGREGATE, UNBOUND, conditionHolds, planCircuitCondition, type ConditionPlan } from "./decider.ts";
import type { InputView, SignalTable } from "./signals.ts";
import type { ConditionStates } from "./types.ts";

export interface EntityPlan {
  /** `wired`: the entity has at least one circuit wire. Undefined: nothing to report. */
  evaluate(input: InputView, wired: boolean): ConditionStates | undefined;
}

export const NO_CONDITIONS: EntityPlan = { evaluate: () => undefined };

/**
 * The conditions of a generic entity that the circuit network decides, with their keys, in the order of the settings table: a
 * comparison, or the unset condition, which is in use and never holds. G-LOGISTIC: not the logistic one.
 */
export function circuitConditions(entity: GenericEntity): (readonly [key: string, condition: ConditionValue])[] {
  return settingSpecsOf(entity.prototype)
    .filter((spec): spec is ConditionSetting => spec.type === "condition" && !spec.logistic)
    .flatMap((spec): (readonly [string, ConditionValue])[] => {
      const value = entity.settings[spec.key];
      return isSettingValue(spec, value) ? [[spec.key, value as ConditionValue]] : [];
    });
}

/** G-NETWORKS: the networks the conditions read: the `networks` setting (`input_networks`) of the entity, both without one. */
export function inputNetworksOf(entity: GenericEntity): NetworkSelection {
  const spec = settingSpecsOf(entity.prototype).find((candidate) => candidate.type === "networks" && candidate.field === "input_networks");
  const value = spec && entity.settings[spec.key];
  return spec && isSettingValue(spec, value) ? (value as NetworkSelection) : BOTH_NETWORKS;
}

/** The radars that share their networks without wires. G-RADAR: all in surface mode; in universe mode those with the same channel. */
export function radarGroup(entity: GenericEntity): string | undefined {
  if (gamePrototype(entity).type !== "radar") return undefined;
  if (entity.settings.mode !== "universe") return "surface";
  const channel = entity.settings.channel as SignalId | undefined;
  // G-RADAR-CHANNEL: without a channel a radar in universe mode is connected to no other.
  return channel && typeof channel === "object" && "name" in channel ? `universe:${channel.kind}:${channel.name}:${channel.quality ?? ""}` : undefined;
}

/**
 * Assumes a statically valid entity (see validate.ts). G-SILENT: a generic entity sends nothing, whatever the game's entity would
 * read out; the plan only says which of its conditions hold. G-CONDITION: each is evaluated like a lamp's, from the content of the
 * current tick.
 */
export function planEntity(entity: GenericEntity, signals: SignalTable): EntityPlan {
  const networks = inputNetworksOf(entity);
  const plans: (readonly [string, ConditionPlan])[] = circuitConditions(entity).map(([key, condition]) => [key, planCircuitCondition(condition, networks, signals)]);
  if (plans.length === 0) return NO_CONDITIONS;

  let last: ConditionStates | undefined;
  return {
    evaluate(input, wired) {
      // G-UNWIRED: without a circuit wire no condition applies.
      if (!wired) return (last = undefined);
      const values = plans.map(([, plan]) => conditionHolds(plan, input, UNBOUND, AGGREGATE));
      if (!last || plans.some(([key], n) => last![key] !== values[n])) last = Object.freeze(Object.fromEntries(plans.map(([key], n) => [key, values[n]!])));
      return last;
    },
  };
}

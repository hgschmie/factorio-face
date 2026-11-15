// The fields of a condition that has a switch (of a lamp, of a generic entity) as data: what they show for the condition the
// entity holds and what an edit of them makes of it. Pure.
import { UNSET_CONDITION, type Condition, type ConditionValue } from "@face/model";

/** A condition nobody has given a signal, as its fields show it: the game's blank condition. */
export const BLANK_CONDITION: Condition = { comparator: "<", second: { type: "constant", value: 0 } };

/** What the fields show: the unset condition is one with an empty signal. */
export function shownCondition(condition: ConditionValue): Condition {
  return condition === UNSET_CONDITION ? BLANK_CONDITION : condition;
}

/**
 * The condition after an edit of its fields. With a signal it is a comparison. One whose signal is taken out is unset, and what
 * stood behind the signal goes with it; a change behind a signal that is still missing waits for the signal as a draft.
 */
export function editedCondition(previous: ConditionValue, next: Condition): ConditionValue {
  if (next.first) return next;
  return shownCondition(previous).first ? UNSET_CONDITION : next;
}

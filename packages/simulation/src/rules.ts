// Structural behavior choices that are not confirmed against the game. Each flag is read in exactly one place.
// Numeric rules live next to their operation (int32.ts, constant.ts, lamp.ts). CONFORMANCE.md lists all of them by rule id.

export interface Rules {
  /** A-EACH-SPECIFIC (F-09): in `each op S`, is the specific signal S removed from the each iteration? */
  readonly eachExcludesSpecificOperand: boolean;
  /** D-RHS-EXCLUDED (F-11): in `everything/anything cmp S`, is the right-hand signal S removed from the checked set? */
  readonly wildcardExcludesRightHandSignal: boolean;
  /** D-EMPTY (F-15): result of an empty condition list. */
  readonly emptyConditionListResult: boolean;
  /** D-BLANK (F-15, F-21): result of a condition without a first signal. */
  readonly blankFirstSignalResult: boolean;
  /** S-INDEX-SORTED (F-16): does the selector's index signal take part in the sort like any other input? */
  readonly selectIndexSignalIsSorted: boolean;
  /** S-SINGLE (F-16): a single input signal passes `select` with comparator `=` regardless of the index. */
  readonly selectSingleInputPassesThrough: boolean;
  /** L-UNWIRED (F-21): an enable condition applies only while the lamp has a circuit wire. */
  readonly lampConditionNeedsWire: boolean;
}

export const RULES: Rules = {
  eachExcludesSpecificOperand: false,
  wildcardExcludesRightHandSignal: true,
  emptyConditionListResult: false,
  blankFirstSignalResult: false,
  selectIndexSignalIsSorted: true,
  selectSingleInputPassesThrough: true,
  lampConditionNeedsWire: true,
};

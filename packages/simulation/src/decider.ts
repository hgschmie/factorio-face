import { wildcardOf, type DeciderCombinator, type DeciderCondition, type DeciderOutput, type SignalId } from "@face/model";
import { COMPARE, toInt32, type Comparison } from "./int32.ts";
import { SILENT, type Evaluator, type PlanContext } from "./plan.ts";
import { RULES } from "./rules.ts";
import { Accumulator, EMPTY, NONE, selectionOf, type InputView, type Selection, type SignalMap, type SignalTable } from "./signals.ts";

const BLANK = 0;
const SIGNAL = 1;
const EACH = 2;
const ANYTHING = 3;
const EVERYTHING = 4;
const CONSTANT = 5;

/** No signal bound to a wildcard. */
export const UNBOUND = -1;
/** `anything` is evaluated on its own ("some signal satisfies this condition") instead of being bound to one signal. */
export const AGGREGATE = -2;

export interface ConditionPlan {
  readonly first: number;
  readonly firstSignal: number;
  readonly firstSelection: Selection;
  readonly compare: Comparison;
  readonly second: number;
  readonly secondSignal: number;
  readonly secondConstant: number;
  readonly secondSelection: Selection;
}

interface Group {
  readonly all: readonly ConditionPlan[];
  readonly anything: readonly ConditionPlan[];
  readonly rest: readonly ConditionPlan[];
}

interface OutputPlan {
  readonly target: number;
  readonly signal: number;
  readonly copy: boolean;
  readonly constant: number;
  readonly selection: Selection;
}

function slot(id: SignalId | undefined): number {
  if (!id) return BLANK;
  const wildcard = wildcardOf(id);
  return wildcard === "each" ? EACH : wildcard === "anything" ? ANYTHING : wildcard === "everything" ? EVERYTHING : SIGNAL;
}

export function planCondition(condition: Omit<DeciderCondition, "join">, signals: SignalTable): ConditionPlan {
  const first = slot(condition.first);
  const second = condition.second.type === "constant" ? CONSTANT : slot(condition.second.signal);
  return {
    first,
    firstSignal: first === SIGNAL ? signals.intern(condition.first!) : -1,
    firstSelection: selectionOf(condition.firstNetworks),
    compare: COMPARE[condition.comparator],
    second,
    secondSignal: condition.second.type === "signal" && second === SIGNAL ? signals.intern(condition.second.signal) : -1,
    secondConstant: condition.second.type === "constant" ? toInt32(condition.second.value) : 0,
    secondSelection: condition.second.type === "signal" ? selectionOf(condition.second.networks) : NONE,
  };
}

/**
 * Truth of one condition. `each` and `anything` are the signals bound to the wildcards (UNBOUND, or AGGREGATE for anything).
 * D-BOUND-ZERO (F-12): a bound signal that is absent on the condition's networks reads as 0 and is compared normally.
 */
export function conditionHolds(c: ConditionPlan, input: InputView, each: number, anything: number): boolean {
  if (c.first === BLANK) return RULES.blankFirstSignalResult;
  const rightSignal = c.second === EACH ? each : c.secondSignal;
  const right = c.second === CONSTANT ? c.secondConstant : rightSignal < 0 ? 0 : (input.select(c.secondSelection).get(rightSignal) ?? 0);
  const left = input.select(c.firstSelection);
  switch (c.first) {
    case SIGNAL:
      return c.compare(left.get(c.firstSignal) ?? 0, right);
    case EACH:
      return each >= 0 && c.compare(left.get(each) ?? 0, right);
    case EVERYTHING: {
      const skip = RULES.wildcardExcludesRightHandSignal ? rightSignal : -1;
      for (const [s, value] of left) if (s !== skip && !c.compare(value, right)) return false;
      return true;
    }
    default: {
      const skip = RULES.wildcardExcludesRightHandSignal ? rightSignal : -1;
      if (anything === AGGREGATE) {
        for (const [s, value] of left) if (s !== skip && c.compare(value, right)) return true;
        return false;
      }
      return anything >= 0 && anything !== skip && c.compare(left.get(anything) ?? 0, right);
    }
  }
}

/** Splits the flat list into AND groups: a new group starts at every condition joined with "or" (the first join is ignored). */
function groupConditions(conditions: readonly DeciderCondition[], signals: SignalTable): Group[] {
  const groups: ConditionPlan[][] = [];
  conditions.forEach((condition, index) => {
    if (index === 0 || condition.join === "or") groups.push([]);
    groups[groups.length - 1]!.push(planCondition(condition, signals));
  });
  return groups.map((all) => ({ all, anything: all.filter((c) => c.first === ANYTHING), rest: all.filter((c) => c.first !== ANYTHING) }));
}

function planOutput(output: DeciderOutput, signals: SignalTable): OutputPlan {
  const target = slot(output.signal);
  return {
    target,
    signal: target === SIGNAL ? signals.intern(output.signal) : -1,
    copy: output.copyCountFromInput,
    constant: toInt32(output.constant),
    selection: selectionOf(output.networks),
  };
}

/** Assumes a statically valid entity (see validate.ts). */
export function planDecider(entity: DeciderCombinator, ctx: PlanContext): Evaluator {
  const { signals } = ctx;
  const groups = groupConditions(entity.conditions, signals);
  const outputs = entity.outputs.map((o) => planOutput(o, signals));
  const elseOutputs = entity.elseOutputs.map((o) => planOutput(o, signals));
  if (outputs.length === 0 && elseOutputs.length === 0) return SILENT;

  const conditions = groups.flatMap((g) => g.all);
  const eachSelections = [
    ...new Set(conditions.flatMap((c) => [...(c.first === EACH ? [c.firstSelection] : []), ...(c.second === EACH ? [c.secondSelection] : [])])),
  ];
  return eachSelections.length > 0 ? planEach(groups, eachSelections, outputs, elseOutputs, signals) : planPlain(groups, outputs, elseOutputs, signals);
}

function planPlain(groups: readonly Group[], outputs: readonly OutputPlan[], elseOutputs: readonly OutputPlan[], signals: SignalTable): Evaluator {
  // The first passing signal is only needed by an anything output; without one a single witness is enough.
  const needPassing = outputs.some((o) => o.target === ANYTHING);
  return {
    evaluate(input) {
      let result = groups.length === 0 && RULES.emptyConditionListResult;
      let passing = -1;
      search: for (const group of groups) {
        if (!group.rest.every((c) => conditionHolds(c, input, UNBOUND, UNBOUND))) continue;
        if (group.anything.length === 0) {
          result = true;
          if (!needPassing) break;
          continue;
        }
        // D-ANY-SAME (F-11): several anything conditions of one AND group must be satisfied by the same signal.
        for (const candidate of group.anything) {
          for (const s of input.select(candidate.firstSelection).keys()) {
            if (!group.anything.every((c) => conditionHolds(c, input, UNBOUND, s))) continue;
            result = true;
            if (!needPassing) break search;
            if (passing < 0 || signals.rank(s) < signals.rank(passing)) passing = s;
          }
        }
      }

      const list = result ? outputs : elseOutputs;
      if (list.length === 0) return EMPTY;
      const out = new Accumulator();
      for (const o of list) {
        const source = input.select(o.selection);
        if (o.target === SIGNAL) out.add(o.signal, o.copy ? (source.get(o.signal) ?? 0) : o.constant);
        else if (o.target === EVERYTHING) for (const [s, value] of source) out.add(s, o.copy ? value : o.constant);
        else if (o.target === ANYTHING) {
          // D-ANY-OUT (F-13): the first signal that passed the conditions, otherwise the first input signal, in signal order.
          const s = result && passing >= 0 ? passing : signals.first(source);
          if (s >= 0) out.add(s, o.copy ? (source.get(s) ?? 0) : o.constant);
        }
      }
      return out.result();
    },
  };
}

function planEach(
  groups: readonly Group[],
  eachSelections: readonly Selection[],
  outputs: readonly OutputPlan[],
  elseOutputs: readonly OutputPlan[],
  signals: SignalTable,
): Evaluator {
  const emit = (out: Accumulator, list: readonly OutputPlan[], active: readonly number[], input: InputView): void => {
    if (active.length === 0) return;
    for (const o of list) {
      const source = input.select(o.selection);
      if (o.target === EACH) for (const s of active) out.add(s, o.copy ? (source.get(s) ?? 0) : o.constant);
      else if (o.target === ANYTHING) {
        let first = active[0]!;
        for (const s of active) if (signals.rank(s) < signals.rank(first)) first = s;
        out.add(first, o.copy ? (source.get(first) ?? 0) : o.constant);
      } else if (o.target === SIGNAL) {
        // D-EACH-SPECIFIC (F-12): sum of the activating signals' input values, or the constant once per activating signal.
        if (o.copy) for (const s of active) out.add(o.signal, source.get(s) ?? 0);
        else out.add(o.signal, Math.imul(o.constant, active.length));
      }
    }
  };
  return {
    evaluate(input) {
      // D-EACH-SET (F-12): each iterates the union of the non-zero signals of every each operand's networks.
      let universe: SignalMap | Set<number> = EMPTY;
      if (eachSelections.length === 1) universe = input.select(eachSelections[0]!);
      else {
        const union = new Set<number>();
        for (const selection of eachSelections) for (const s of input.select(selection).keys()) union.add(s);
        universe = union;
      }
      if (universe.size === 0) return EMPTY;
      const pass: number[] = [];
      const fail: number[] = [];
      // D-EACH-MIXED (F-12): anything/everything next to each are evaluated on their own, not bound to the each signal.
      for (const s of universe.keys()) (groups.some((g) => g.all.every((c) => conditionHolds(c, input, s, AGGREGATE))) ? pass : fail).push(s);
      const out = new Accumulator();
      emit(out, outputs, pass, input);
      emit(out, elseOutputs, fail, input);
      return out.result();
    },
  };
}

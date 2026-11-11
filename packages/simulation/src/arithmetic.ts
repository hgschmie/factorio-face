import { wildcardOf, type ArithmeticCombinator, type Operand } from "@face/model";
import { ARITHMETIC, toInt32 } from "./int32.ts";
import { SILENT, type Evaluator, type PlanContext } from "./plan.ts";
import { RULES } from "./rules.ts";
import { Accumulator, EMPTY, NONE, selectionOf, type InputView, type Selection, type SignalTable } from "./signals.ts";

interface OperandPlan {
  readonly each: boolean;
  /** Interned signal, -1 for a constant or each. */
  readonly signal: number;
  readonly constant: number;
  readonly selection: Selection;
}

function planOperand(operand: Operand, signals: SignalTable): OperandPlan {
  if (operand.type === "constant") return { each: false, signal: -1, constant: toInt32(operand.value), selection: NONE };
  const each = wildcardOf(operand.signal) === "each";
  return { each, signal: each ? -1 : signals.intern(operand.signal), constant: 0, selection: selectionOf(operand.networks) };
}

function read(operand: OperandPlan, input: InputView): number {
  return operand.signal < 0 ? operand.constant : (input.select(operand.selection).get(operand.signal) ?? 0);
}

/** Assumes a statically valid entity (see validate.ts): no everything/anything, each output only with an each operand. */
export function planArithmetic(entity: ArithmeticCombinator, ctx: PlanContext): Evaluator {
  if (!entity.output) return SILENT;
  const operation = ARITHMETIC[entity.operation];
  const first = planOperand(entity.first, ctx.signals);
  const second = planOperand(entity.second, ctx.signals);
  const outputEach = wildcardOf(entity.output) === "each";
  const output = outputEach ? -1 : ctx.signals.intern(entity.output);

  if (!first.each && !second.each) {
    return {
      evaluate(input) {
        const result = operation(read(first, input), read(second, input));
        return result === 0 ? EMPTY : new Map([[output, result]]);
      },
    };
  }

  // A-EACH-SPECIFIC: the other operand's own signal stays in the iteration unless the rule says otherwise.
  const skip = RULES.eachExcludesSpecificOperand ? (first.each ? second.signal : first.signal) : -1;
  return {
    evaluate(input) {
      const result = new Accumulator();
      const emit = (s: number, value: number): void => result.add(outputEach ? s : output, value);
      if (first.each && second.each) {
        // A-EACH-EACH (F-08): union of both operands' signals, a signal missing on one side reads as 0.
        const left = input.select(first.selection);
        const right = input.select(second.selection);
        for (const [s, value] of left) emit(s, operation(value, right.get(s) ?? 0));
        for (const [s, value] of right) if (!left.has(s)) emit(s, operation(0, value));
      } else if (first.each) {
        const right = read(second, input);
        for (const [s, value] of input.select(first.selection)) if (s !== skip) emit(s, operation(value, right));
      } else {
        const left = read(first, input);
        for (const [s, value] of input.select(second.selection)) if (s !== skip) emit(s, operation(left, value));
      }
      return result.result();
    },
  };
}

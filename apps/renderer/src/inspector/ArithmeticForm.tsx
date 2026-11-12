import { SIGNAL_SLOTS } from "@face/language";
import { ARITHMETIC_OPERATIONS, type ArithmeticCombinator, type ArithmeticOperation } from "@face/model";
import { SelectField, type SelectOption } from "./fields.tsx";
import { FormSection, OperandField } from "./formParts.tsx";
import { setOptional } from "./immutable.ts";
import { SignalField } from "./SignalField.tsx";

const OPERATION_LABELS: Readonly<Record<ArithmeticOperation, string>> = {
  "*": "×  Multiply",
  "/": "÷  Divide",
  "+": "+  Add",
  "-": "−  Subtract",
  "%": "%  Modulo",
  "^": "^  Power",
  "<<": "<<  Shift left",
  ">>": ">>  Shift right",
  AND: "AND  Bitwise and",
  OR: "OR  Bitwise or",
  XOR: "XOR  Bitwise xor",
};
const OPERATIONS: readonly SelectOption<ArithmeticOperation>[] = ARITHMETIC_OPERATIONS.map((value) => ({ value, label: OPERATION_LABELS[value] }));

export function ArithmeticForm({ entity, onChange }: { readonly entity: ArithmeticCombinator; onChange(next: ArithmeticCombinator): void }) {
  return (
    <FormSection title="Expression">
      <div className="field-grid">
        <OperandField label="First operand" wildcards={SIGNAL_SLOTS["arithmetic.operand"]} value={entity.first} onChange={(first) => onChange({ ...entity, first })} />
        <SelectField label="Operation" wide value={entity.operation} options={OPERATIONS} onChange={(operation) => onChange({ ...entity, operation })} />
        <OperandField label="Second operand" wildcards={SIGNAL_SLOTS["arithmetic.operand"]} value={entity.second} onChange={(second) => onChange({ ...entity, second })} />
        <SignalField label="Output signal" wide wildcards={SIGNAL_SLOTS["arithmetic.output"]} value={entity.output} onChange={(output) => onChange(setOptional(entity, "output", output))} />
      </div>
    </FormSection>
  );
}

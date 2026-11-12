import { SIGNAL_SLOTS } from "@face/language";
import { BOTH_NETWORKS, type DeciderCombinator, type DeciderCondition, type DeciderOutput } from "@face/model";
import { COMPARATOR_OPTIONS, IntField, NetworkToggle, SelectField, type SelectOption } from "./fields.tsx";
import { AddButton, DEFAULT_SIGNAL, FormSection, ListItem, OperandField } from "./formParts.tsx";
import { removeAt, replaceAt, setOptional } from "./immutable.ts";
import { SignalField } from "./SignalField.tsx";

const NEW_CONDITION: DeciderCondition = { join: "and", first: DEFAULT_SIGNAL, firstNetworks: BOTH_NETWORKS, comparator: ">", second: { type: "constant", value: 0 } };
const NEW_OUTPUT: DeciderOutput = { signal: DEFAULT_SIGNAL, copyCountFromInput: true, constant: 1, networks: BOTH_NETWORKS };

const JOIN_OPTIONS: readonly SelectOption<DeciderCondition["join"]>[] = [
  { value: "and", label: "AND" },
  { value: "or", label: "OR" },
];
const COUNT_OPTIONS: readonly SelectOption<"input" | "constant">[] = [
  { value: "input", label: "Input count" },
  { value: "constant", label: "Constant" },
];

function ConditionEditor({ condition, index, onChange, onRemove }: { readonly condition: DeciderCondition; readonly index: number; onChange(next: DeciderCondition): void; onRemove(): void }) {
  const title = `Condition ${index + 1}`;
  return (
    <ListItem title={title} removeLabel={`Remove ${title.toLowerCase()}`} onRemove={onRemove}>
      {index > 0 && <SelectField label="Combine with previous" wide value={condition.join} options={JOIN_OPTIONS} onChange={(join) => onChange({ ...condition, join })} />}
      <SignalField
        label="Signal"
        ariaLabel={`${title} signal`}
        wide
        wildcards={SIGNAL_SLOTS["decider.condition"]}
        value={condition.first}
        trailing={<NetworkToggle label="Signal networks" value={condition.firstNetworks} onChange={(firstNetworks) => onChange({ ...condition, firstNetworks })} />}
        onChange={(first) => onChange(setOptional(condition, "first", first))}
      />
      <SelectField label="Comparator" wide value={condition.comparator} options={COMPARATOR_OPTIONS} onChange={(comparator) => onChange({ ...condition, comparator })} />
      <OperandField label="Compare to" wildcards={SIGNAL_SLOTS["decider.operand"]} value={condition.second} onChange={(second) => onChange({ ...condition, second })} />
    </ListItem>
  );
}

function OutputList({ title, itemTitle, outputs, onChange }: { readonly title: string; readonly itemTitle: string; readonly outputs: readonly DeciderOutput[]; onChange(next: readonly DeciderOutput[]): void }) {
  return (
    <FormSection title={title}>
      {outputs.map((output, index) => {
        const label = `${itemTitle} ${index + 1}`;
        const set = (next: DeciderOutput): void => onChange(replaceAt(outputs, index, next));
        return (
          <ListItem key={index} title={label} removeLabel={`Remove ${label.toLowerCase()}`} onRemove={() => onChange(removeAt(outputs, index))}>
            <SignalField label="Signal" ariaLabel={`${label} signal`} wide wildcards={SIGNAL_SLOTS["decider.output"]} value={output.signal} required onChange={(next) => next && set({ ...output, signal: next })} />
            <SelectField label="Count" value={output.copyCountFromInput ? "input" : "constant"} options={COUNT_OPTIONS} onChange={(mode) => set({ ...output, copyCountFromInput: mode === "input" })} />
            {output.copyCountFromInput ? (
              <div className="field">
                <span className="field-label">From</span>
                <NetworkToggle label="Input networks" value={output.networks} onChange={(networks) => set({ ...output, networks })} />
              </div>
            ) : (
              <IntField label="Value" value={output.constant} onChange={(constant) => set({ ...output, constant })} />
            )}
          </ListItem>
        );
      })}
      <AddButton label={`Add ${itemTitle.toLowerCase()}`} onClick={() => onChange([...outputs, NEW_OUTPUT])} />
    </FormSection>
  );
}

export function DeciderForm({ entity, onChange }: { readonly entity: DeciderCombinator; onChange(next: DeciderCombinator): void }) {
  return (
    <>
      <FormSection title="Conditions">
        {entity.conditions.map((condition, index) => (
          <ConditionEditor
            key={index}
            condition={condition}
            index={index}
            onChange={(next) => onChange({ ...entity, conditions: replaceAt(entity.conditions, index, next) })}
            onRemove={() => onChange({ ...entity, conditions: removeAt(entity.conditions, index) })}
          />
        ))}
        <AddButton label="Add condition" onClick={() => onChange({ ...entity, conditions: [...entity.conditions, NEW_CONDITION] })} />
      </FormSection>
      <OutputList title="Outputs when true" itemTitle="Output" outputs={entity.outputs} onChange={(outputs) => onChange({ ...entity, outputs })} />
      <OutputList title="Outputs when false" itemTitle="Else output" outputs={entity.elseOutputs} onChange={(elseOutputs) => onChange({ ...entity, elseOutputs })} />
    </>
  );
}

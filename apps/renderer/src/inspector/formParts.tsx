// Building blocks shared by the per-kind settings forms.
import { BOTH_NETWORKS, signal, type Operand, type SignalId, type Wildcard } from "@face/model";
import type { ReactNode } from "react";
import { Icon } from "../icons/Icon.tsx";
import { IntField, NetworkToggle, SelectField, type SelectOption } from "./fields.tsx";
import { SignalField } from "./SignalField.tsx";

/** Signal used when a form has to create a row that requires one. */
export const DEFAULT_SIGNAL: SignalId = signal("virtual", "signal-A");

export function FormSection({ title, children, action }: { readonly title: string; readonly children: ReactNode; readonly action?: ReactNode }) {
  return (
    <section className="form-section">
      <div className="section-label">
        <span>{title}</span>
        {action}
      </div>
      {children}
    </section>
  );
}

export function AddButton({ label, onClick }: { readonly label: string; onClick(): void }) {
  return (
    <button type="button" className="add-button" onClick={onClick}>
      <Icon name="plus" size={13} />
      {label}
    </button>
  );
}

/** A removable group of fields inside a list. */
export function ListItem({ title, removeLabel, onRemove, children }: { readonly title: string; readonly removeLabel: string; readonly children: ReactNode; onRemove(): void }) {
  return (
    <div className="list-item">
      <div className="list-item-header">
        <span>{title}</span>
        <button type="button" className="remove-button" aria-label={removeLabel} title={removeLabel} onClick={onRemove}>
          <Icon name="close" size={13} />
        </button>
      </div>
      <div className="field-grid">{children}</div>
    </div>
  );
}

const OPERAND_TYPES: readonly SelectOption<Operand["type"]>[] = [
  { value: "signal", label: "Signal" },
  { value: "constant", label: "Number" },
];

/**
 * A signal or a constant, for a two-column field grid: the type selector on one row, the value on the next. `label` heads the type
 * selector and names the value control. `wildcards` are the wildcards the slot accepts; a signal carries its input network selection
 * at the end of its row unless `networks` is false (where the language has none).
 */
export function OperandField({ label, value, wildcards, networks = true, onChange }: { readonly label: string; readonly value: Operand; readonly wildcards: readonly Wildcard[]; readonly networks?: boolean; onChange(value: Operand): void }) {
  const setType = (type: Operand["type"]): void => {
    if (type === value.type) return;
    onChange(type === "constant" ? { type: "constant", value: 0 } : { type: "signal", signal: DEFAULT_SIGNAL, networks: BOTH_NETWORKS });
  };
  return (
    <>
      <SelectField label={label} ariaLabel={`${label} type`} wide value={value.type} options={OPERAND_TYPES} onChange={setType} />
      {value.type === "constant" ? (
        <IntField label="Number" ariaLabel={label} wide value={value.value} onChange={(next) => onChange({ type: "constant", value: next })} />
      ) : (
        <SignalField
          label="Signal"
          ariaLabel={label}
          wide
          value={value.signal}
          required
          wildcards={wildcards}
          trailing={networks && <NetworkToggle label={`${label} networks`} value={value.networks} onChange={(selection) => onChange({ ...value, networks: selection })} />}
          onChange={(next) => next && onChange({ ...value, signal: next })}
        />
      )}
    </>
  );
}

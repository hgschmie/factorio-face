// The settings of a generic entity (kind `entity`): one control per setting of its prototype type, in the order and with the
// labels of the settings table of the model. Nothing here knows a prototype or a type: the table decides what there is.
import { SIGNAL_SLOTS } from "@face/language";
import type { Condition, GenericEntity, NetworkSelection, SettingSpec, SettingValue, SignalId } from "@face/model";
import { CheckboxField, NetworkToggle, SelectField } from "./fields.tsx";
import { ConditionFields, FormSection } from "./formParts.tsx";
import { enumOptions, keptFields, newCondition, settingValue, shownSettings, withSetting } from "../entities/genericSettings.ts";
import { SignalField } from "./SignalField.tsx";

interface SettingControlProps {
  readonly spec: SettingSpec;
  /** What the entity holds, or the default. */
  readonly value: SettingValue | undefined;
  onChange(value: SettingValue | undefined): void;
}

/** The control of one setting, by its field type. */
function SettingControl({ spec, value, onChange }: SettingControlProps) {
  switch (spec.type) {
    case "boolean":
      return <CheckboxField label={spec.label} checked={value === true} onChange={onChange} />;
    case "enum":
      return (
        <div className="field-grid">
          <SelectField label={spec.label} wide value={String(value)} options={enumOptions(spec)} onChange={onChange} />
        </div>
      );
    case "signal":
      return (
        <div className="field-grid">
          <SignalField label={spec.label} wide value={value as SignalId | undefined} onChange={onChange} />
        </div>
      );
    case "networks":
      return (
        <div className="inline-field">
          <span className="field-label">{spec.label}</span>
          <NetworkToggle label={spec.label} value={value as NetworkSelection} onChange={onChange} />
        </div>
      );
    case "condition": {
      const condition = value as Condition | undefined;
      return (
        <>
          <CheckboxField label={spec.label} checked={condition !== undefined} onChange={(enabled) => onChange(enabled ? newCondition(spec) : undefined)} />
          {condition && <ConditionFields condition={condition} wildcards={SIGNAL_SLOTS["entity.condition"]} operandWildcards={SIGNAL_SLOTS["entity.operand"]} onChange={onChange} />}
          {condition && spec.logistic && <p className="muted-note">Read from the logistic network, which the simulation does not have: the condition is kept and not evaluated.</p>}
        </>
      );
    }
  }
}

export function GenericForm({ entity, onChange }: { readonly entity: GenericEntity; onChange(next: GenericEntity): void }) {
  const shown = shownSettings(entity);
  const kept = keptFields(entity);
  return (
    <>
      <FormSection title="Circuit connection">
        {shown.length === 0 && <p className="muted-note">This entity has no circuit settings to edit.</p>}
        {shown.map((spec) => (
          <div key={spec.key} className="setting" data-setting={spec.key} data-type={spec.type}>
            <SettingControl spec={spec} value={settingValue(entity, spec)} onChange={(value) => onChange(withSetting(entity, spec, value))} />
          </div>
        ))}
      </FormSection>
      {kept.length > 0 && (
        <p className="muted-note kept-fields" data-kept={kept.join(" ")}>
          Kept from the blueprint: {kept.join(", ")}. The editor does not change these fields and writes them back on export.
        </p>
      )}
    </>
  );
}

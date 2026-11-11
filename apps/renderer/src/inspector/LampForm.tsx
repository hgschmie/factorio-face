import { LAMP_COLOR_MODES, type Condition, type Lamp, type LampColorMode, type RgbColor } from "@face/model";
import { useId } from "react";
import { CheckboxField, COMPARATOR_OPTIONS, IntField, NetworkToggle, SelectField, type SelectOption } from "./fields.tsx";
import { DEFAULT_SIGNAL, FormSection } from "./formParts.tsx";
import { setOptional } from "./immutable.ts";
import { SignalField } from "./SignalField.tsx";

const NEW_CONDITION: Condition = { first: DEFAULT_SIGNAL, comparator: ">", second: { type: "constant", value: 0 } };

const SECOND_TYPES: readonly SelectOption<Condition["second"]["type"]>[] = [
  { value: "constant", label: "Number" },
  { value: "signal", label: "Signal" },
];
const COLOR_MODE_LABELS: Readonly<Record<LampColorMode, string>> = { mapping: "Color signals (mapping)", components: "Red, green, blue signals", "packed-rgb": "Packed RGB signal" };
const COLOR_MODES: readonly SelectOption<LampColorMode>[] = LAMP_COLOR_MODES.map((value) => ({ value, label: COLOR_MODE_LABELS[value] }));

function toHex({ r, g, b }: RgbColor): string {
  return "#" + [r, g, b].map((channel) => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): RgbColor {
  return { r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) };
}

function ConditionFields({ condition, onChange }: { readonly condition: Condition; onChange(next: Condition): void }) {
  const second = condition.second;
  return (
    <div className="field-grid">
      <SignalField label="Signal" wide allowWildcards value={condition.first} onChange={(first) => onChange(setOptional(condition, "first", first))} />
      <SelectField label="Comparator" value={condition.comparator} options={COMPARATOR_OPTIONS} onChange={(comparator) => onChange({ ...condition, comparator })} />
      <SelectField
        label="Compare to"
        value={second.type}
        options={SECOND_TYPES}
        onChange={(type) => type !== second.type && onChange({ ...condition, second: type === "constant" ? { type: "constant", value: 0 } : { type: "signal", signal: DEFAULT_SIGNAL } })}
      />
      {second.type === "constant" ? (
        <IntField label="Number" wide value={second.value} onChange={(value) => onChange({ ...condition, second: { type: "constant", value } })} />
      ) : (
        <SignalField label="Other signal" wide required allowWildcards={false} value={second.signal} onChange={(next) => next && onChange({ ...condition, second: { type: "signal", signal: next } })} />
      )}
    </div>
  );
}

export function LampForm({ entity, onChange }: { readonly entity: Lamp; onChange(next: Lamp): void }) {
  const colorId = useId();
  return (
    <>
      <FormSection title="Light condition">
        <CheckboxField label="Controlled by the circuit network" checked={entity.condition !== undefined} onChange={(enabled) => onChange(setOptional(entity, "condition", enabled ? NEW_CONDITION : undefined))} />
        {entity.condition && <ConditionFields condition={entity.condition} onChange={(condition) => onChange({ ...entity, condition })} />}
        <div className="inline-field">
          <span className="field-label">Input networks</span>
          <NetworkToggle label="Input networks" value={entity.inputNetworks} onChange={(inputNetworks) => onChange({ ...entity, inputNetworks })} />
        </div>
        <CheckboxField label="Always on" checked={entity.alwaysOn} onChange={(alwaysOn) => onChange({ ...entity, alwaysOn })} />
      </FormSection>
      <FormSection title="Color">
        <div className="inline-field">
          <label className="field-label" htmlFor={colorId}>
            Static color
          </label>
          <input id={colorId} type="color" value={toHex(entity.color ?? { r: 255, g: 255, b: 255 })} onChange={(event) => onChange({ ...entity, color: fromHex(event.target.value) })} />
          {entity.color && (
            <button type="button" className="add-button" onClick={() => onChange(setOptional(entity, "color", undefined))}>
              Clear
            </button>
          )}
        </div>
        <CheckboxField label="Use colors from signals" checked={entity.useColors} onChange={(useColors) => onChange({ ...entity, useColors })} />
        {entity.useColors && (
          <div className="field-grid">
            <SelectField label="Color mode" wide value={entity.colorMode} options={COLOR_MODES} onChange={(colorMode) => onChange({ ...entity, colorMode })} />
            {entity.colorMode === "components" && (
              <>
                <SignalField label="Red signal" wide allowWildcards={false} value={entity.redSignal} onChange={(next) => onChange(setOptional(entity, "redSignal", next))} />
                <SignalField label="Green signal" wide allowWildcards={false} value={entity.greenSignal} onChange={(next) => onChange(setOptional(entity, "greenSignal", next))} />
                <SignalField label="Blue signal" wide allowWildcards={false} value={entity.blueSignal} onChange={(next) => onChange(setOptional(entity, "blueSignal", next))} />
              </>
            )}
            {entity.colorMode === "packed-rgb" && <SignalField label="RGB signal" wide allowWildcards={false} value={entity.rgbSignal} onChange={(next) => onChange(setOptional(entity, "rgbSignal", next))} />}
          </div>
        )}
      </FormSection>
    </>
  );
}

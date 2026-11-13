// Dispatches to the settings form of the entity's kind. All forms are controlled: they render `entity` and emit a
// complete replacement through `onChange`.
import { prototypeData, type Entity } from "@face/model";
import { ArithmeticForm } from "./ArithmeticForm.tsx";
import { ConstantForm } from "./ConstantForm.tsx";
import { DeciderForm } from "./DeciderForm.tsx";
import { LampForm } from "./LampForm.tsx";
import { SelectorForm } from "./SelectorForm.tsx";

export interface EntitySettingsFormProps {
  readonly entity: Entity;
  onChange(next: Entity): void;
}

export function EntitySettingsForm({ entity, onChange }: EntitySettingsFormProps) {
  switch (entity.kind) {
    case "constant":
      return <ConstantForm entity={entity} onChange={onChange} />;
    case "arithmetic":
      return <ArithmeticForm entity={entity} onChange={onChange} />;
    case "decider":
      return <DeciderForm entity={entity} onChange={onChange} />;
    case "selector":
      return <SelectorForm entity={entity} onChange={onChange} />;
    case "lamp":
      return <LampForm entity={entity} onChange={onChange} />;
    // Plain notes until package H builds the forms: the settings of the two new kinds are edited in the source.
    case "pole":
      return <p className="field-hint">This is a {prototypeData(entity).label}. It relays the signals of the wires on it and has no settings; its prototype is set in the source.</p>;
    case "speaker":
      return <p className="field-hint">The settings of a programmable speaker (condition or pitch signal, instrument, note, volume, alert) are edited in the source for now.</p>;
  }
}

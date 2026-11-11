// Dispatches to the settings form of the entity's kind. All forms are controlled: they render `entity` and emit a
// complete replacement through `onChange`.
import type { Entity } from "@face/model";
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
  }
}

// Dispatches to the settings form of the entity's kind. All forms are controlled: they render `entity` and emit a
// complete replacement through `onChange`. A kind with several game prototypes first says which one the entity is.
import { prototypesOf, type Entity } from "@face/model";
import type { EntityIconResolver } from "../icons/EntityIcon.tsx";
import { ArithmeticForm } from "./ArithmeticForm.tsx";
import { ConstantForm } from "./ConstantForm.tsx";
import { DeciderForm } from "./DeciderForm.tsx";
import { FormSection } from "./formParts.tsx";
import { LampForm } from "./LampForm.tsx";
import { PrototypeField } from "./PrototypeField.tsx";
import { SelectorForm } from "./SelectorForm.tsx";
import { SpeakerForm } from "./SpeakerForm.tsx";

export interface EntitySettingsFormProps {
  readonly entity: Entity;
  /** Icons for the prototypes a kind offers. */
  readonly resolveEntityIcon?: EntityIconResolver;
  onChange(next: Entity): void;
}

function KindForm({ entity, onChange }: EntitySettingsFormProps) {
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
    case "pole":
      // Which pole it is is all there is to set.
      return null;
    case "speaker":
      return <SpeakerForm entity={entity} onChange={onChange} />;
  }
}

/** What an entity without behaviour of its own does, where a form would otherwise say nothing. */
const NOTES: Readonly<Partial<Record<Entity["kind"], string>>> = {
  pole: "A pole relays signals: all wires of one color on it are one network, red and green stay apart. It has its own wire reach, whatever the project sets, and no other settings.",
};

export function EntitySettingsForm({ entity, resolveEntityIcon, onChange }: EntitySettingsFormProps) {
  const note = NOTES[entity.kind];
  return (
    <>
      {prototypesOf(entity.kind).length > 1 && (
        <FormSection title="Type">
          {/* The prototype is a property of the kinds that have one; the cast names the entity that results. */}
          <PrototypeField entity={entity} resolveIcon={resolveEntityIcon} onChange={(prototype) => onChange({ ...entity, prototype } as Entity)} />
          {note && <p className="muted-note">{note}</p>}
        </FormSection>
      )}
      <KindForm entity={entity} onChange={onChange} />
    </>
  );
}

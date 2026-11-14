// Dispatches to the settings form of the entity's kind. All forms are controlled: they render `entity` and emit a
// complete replacement through `onChange`. A kind with several game prototypes first says which one the entity is.
import { prototypesOf, type Entity, type GenericEntity, type PrototypeName } from "@face/model";
import { prototypeNotes } from "../entities/typeInfo.ts";
import type { EntityIconResolver } from "../icons/EntityIcon.tsx";
import { ArithmeticForm } from "./ArithmeticForm.tsx";
import { ConstantForm } from "./ConstantForm.tsx";
import { DeciderForm } from "./DeciderForm.tsx";
import { FormSection } from "./formParts.tsx";
import { GenericForm } from "./GenericForm.tsx";
import { alternativePrototypes, withPrototype } from "../entities/genericSettings.ts";
import { LampForm } from "./LampForm.tsx";
import { PrototypeField } from "./PrototypeField.tsx";
import { SelectorForm } from "./SelectorForm.tsx";
import { SpeakerForm } from "./SpeakerForm.tsx";

export interface EntitySettingsFormProps {
  readonly entity: Entity;
  /** Icons for the prototypes a kind offers. */
  readonly resolveEntityIcon?: EntityIconResolver;
  /** Which prototypes the project can place, and where each comes in the game's order (`EntityRegistry`); without it every one, by name. */
  readonly prototypes?: { offers(prototype: PrototypeName): boolean; position(prototype: PrototypeName): number };
  onChange(next: Entity): void;
}

function KindForm({ entity, onChange }: Pick<EntitySettingsFormProps, "entity" | "onChange">) {
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
    case "entity":
      return <GenericForm entity={entity} onChange={onChange} />;
  }
}

/** What an entity without behaviour of its own does, where a form would otherwise say nothing. */
const NOTES: Readonly<Partial<Record<Entity["kind"], string>>> = {
  pole: "A pole relays signals: all wires of one color on it are one network, red and green stay apart. It has its own wire reach, whatever the project sets, and no other settings.",
};

/** Which entity of its prototype type a generic entity is, where the type has several, and what the editor has to say about it. */
function GenericType({ entity, resolveEntityIcon, prototypes, onChange }: EntitySettingsFormProps & { readonly entity: GenericEntity }) {
  const choices = alternativePrototypes(entity.prototype, prototypes?.offers, prototypes?.position);
  const notes = prototypeNotes(entity.prototype);
  if (choices.length < 2 && notes.length === 0) return null;
  return (
    <FormSection title="Type">
      {choices.length > 1 && <PrototypeField entity={entity} prototypes={choices} compact resolveIcon={resolveEntityIcon} onChange={(prototype) => onChange(withPrototype(entity, prototype))} />}
      {notes.map((note) => (
        <p key={note} className="muted-note prototype-note">
          {note}
        </p>
      ))}
    </FormSection>
  );
}

export function EntitySettingsForm({ entity, resolveEntityIcon, prototypes, onChange }: EntitySettingsFormProps) {
  const note = NOTES[entity.kind];
  if (entity.kind === "entity") {
    return (
      <>
        <GenericType entity={entity} resolveEntityIcon={resolveEntityIcon} prototypes={prototypes} onChange={onChange} />
        <KindForm entity={entity} onChange={onChange} />
      </>
    );
  }
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

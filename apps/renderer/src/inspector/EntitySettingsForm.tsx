// Dispatches to the settings form of the entity's kind. All forms are controlled: they render `entity` and emit a
// complete replacement through `onChange`. A prototype without a form (`hasSettingsForm`) gets a line that says so, and a
// generic entity the notes of the editor on its type in front of its settings.
import type { Entity } from "@face/model";
import { hasSettingsForm } from "../entities/kindInfo.ts";
import { prototypeNotes } from "../entities/typeInfo.ts";
import { ArithmeticForm } from "./ArithmeticForm.tsx";
import { ConstantForm } from "./ConstantForm.tsx";
import { DeciderForm } from "./DeciderForm.tsx";
import { GenericForm } from "./GenericForm.tsx";
import { LampForm } from "./LampForm.tsx";
import { SelectorForm } from "./SelectorForm.tsx";
import { SpeakerForm } from "./SpeakerForm.tsx";

export interface EntitySettingsFormProps {
  readonly entity: Entity;
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
      // A pole has nothing to set.
      return null;
    case "speaker":
      return <SpeakerForm entity={entity} onChange={onChange} />;
    case "entity":
      return <GenericForm entity={entity} onChange={onChange} />;
  }
}

export function EntitySettingsForm({ entity, onChange }: EntitySettingsFormProps) {
  if (!hasSettingsForm(entity.prototype)) {
    return (
      <div className="settings-notes">
        <p className="muted-note" data-note="settings-not-shown">
          The settings of this entity are not shown here. They stay in the source as they are.
        </p>
      </div>
    );
  }
  const notes = entity.kind === "entity" ? prototypeNotes(entity.prototype) : [];
  return (
    <>
      {notes.length > 0 && (
        <div className="settings-notes">
          {notes.map((note) => (
            <p key={note} className="muted-note prototype-note">
              {note}
            </p>
          ))}
        </div>
      )}
      <KindForm entity={entity} onChange={onChange} />
    </>
  );
}

// Right panel: identity and primary actions of the selection (rename, delete) at the top, then the per-kind settings
// form, then the connections. Presentational: every edit is emitted through a callback.
import { wireKey, type Circuit, type Entity, type EntityId, type Wire } from "@face/model";
import { useId, useState, type ReactNode } from "react";
import { KIND_INFO } from "../entities/kindInfo.ts";
import { EntityIcon, type EntityIconResolver } from "../icons/EntityIcon.tsx";
import { Icon } from "../icons/Icon.tsx";
import { EntitySettingsForm } from "./EntitySettingsForm.tsx";
import { SignalPickerContext, type SignalPickerRenderer } from "./SignalField.tsx";
import { entityNameError } from "./validation.ts";

export interface InspectorProps {
  readonly circuit: Circuit;
  readonly selection: readonly EntityId[];
  /** When false, everything is shown read-only. */
  readonly editable: boolean;
  readonly resolveEntityIcon?: EntityIconResolver;
  /** Catalog-backed signal picker for all signal fields; without it they are validated text inputs. */
  readonly renderSignalPicker?: SignalPickerRenderer;
  /** Slot for the settings form. Defaults to the built-in forms for the five entity kinds. */
  readonly renderSettings?: (entity: Entity, onChange: (next: Entity) => void) => ReactNode;
  onRename(id: EntityId, name: string): void;
  onChange(next: Entity): void;
  onDelete(ids: readonly EntityId[]): void;
  onRemoveWire(wire: Wire): void;
  onSelect(ids: readonly EntityId[]): void;
}

function NameField({ entity, circuit, onRename }: { readonly entity: Entity; readonly circuit: Circuit; onRename(name: string): void }) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? entity.name;
  const error = draft === null ? null : entityNameError(draft, entity.id, circuit);
  // A rename rewrites every reference, so it is committed once (Enter or leaving the field), not per keystroke.
  const commit = (): void => {
    if (draft === null || error) return;
    if (draft !== entity.name) onRename(draft);
    setDraft(null);
  };
  return (
    <div className="field name-field">
      <label className="field-label" htmlFor={id}>
        Name
      </label>
      <input
        id={id}
        type="text"
        spellCheck={false}
        autoComplete="off"
        aria-label="Entity name"
        aria-invalid={error !== null}
        value={text}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
          if (event.key === "Escape") setDraft(null);
        }}
      />
      {error && (
        <small className="field-error" role="alert">
          {error}
        </small>
      )}
    </div>
  );
}

function Connections({ entity, circuit, onRemoveWire, onSelect }: { readonly entity: Entity; readonly circuit: Circuit; onRemoveWire(wire: Wire): void; onSelect(ids: readonly EntityId[]): void }) {
  const names = new Map(circuit.entities.map((other) => [other.id, other.name]));
  const connected = circuit.wires.filter((wire) => wire.a.entity === entity.id || wire.b.entity === entity.id);
  return (
    <section className="connections">
      <div className="section-label">
        <span>Connections</span>
        <span>{connected.length}</span>
      </div>
      {connected.length === 0 && <p className="muted-note">No wires connected yet.</p>}
      <ul>
        {connected.map((wire) => {
          // For a feedback wire both ends are this entity; show it from the output side.
          const mineIsA = wire.a.entity === entity.id && (wire.b.entity !== entity.id || wire.a.side === "out");
          const mine = mineIsA ? wire.a : wire.b;
          const other = mineIsA ? wire.b : wire.a;
          const otherName = names.get(other.entity) ?? other.entity;
          const description = `${wire.color} wire from ${mine.side} to ${otherName}.${other.side}`;
          return (
            <li key={wireKey(wire)} className="connection" data-connection={wireKey(wire)}>
              <span className={`wire-dot ${wire.color}`} />
              <button type="button" className="connection-target" title={`Select ${otherName}`} onClick={() => onSelect([other.entity])}>
                <span>
                  {otherName}.{other.side}
                </span>
                <small>
                  {wire.color}, from {mine.side}
                  {other.entity === entity.id ? " (feedback)" : ""}
                </small>
              </button>
              <button type="button" className="remove-button" aria-label={`Remove ${description}`} title="Remove connection" onClick={() => onRemoveWire(wire)}>
                <Icon name="close" size={14} />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function EntityInspector(props: InspectorProps & { readonly entity: Entity }) {
  const { entity, circuit, editable } = props;
  const info = KIND_INFO[entity.kind];
  return (
    <>
      <header className="inspector-identity">
        <div className="inspector-icon">
          <EntityIcon kind={entity.kind} size={40} resolveIcon={props.resolveEntityIcon} />
        </div>
        <div>
          <span className="eyebrow">{info.category}</span>
          <h2>{info.label}</h2>
          <p>{info.description}</p>
        </div>
      </header>
      <fieldset className="inspector-fieldset" disabled={!editable}>
        <div className="inspector-primary">
          <NameField entity={entity} circuit={circuit} onRename={(name) => props.onRename(entity.id, name)} />
          <button type="button" className="danger-button delete-entity" onClick={() => props.onDelete([entity.id])} aria-label={`Delete ${entity.name}`} title="Delete this entity and its wires">
            <Icon name="trash" size={14} />
            Delete
          </button>
        </div>
        <div className="inspector-settings">{props.renderSettings ? props.renderSettings(entity, props.onChange) : <EntitySettingsForm entity={entity} onChange={props.onChange} />}</div>
        <Connections entity={entity} circuit={circuit} onRemoveWire={props.onRemoveWire} onSelect={props.onSelect} />
      </fieldset>
      <footer className="inspector-footer">
        <span>
          X <b>{entity.position.x}</b> Y <b>{entity.position.y}</b>
        </span>
      </footer>
    </>
  );
}

export function Inspector(props: InspectorProps) {
  const { circuit, selection, editable } = props;
  const selected = circuit.entities.filter((entity) => selection.includes(entity.id));
  const single = selected.length === 1 ? selected[0] : undefined;
  return (
    <aside className="inspector" aria-label="Inspector">
      <div className="palette-heading">
        <span>INSPECTOR</span>
        {selected.length > 0 && <span className="count-badge">{String(selected.length).padStart(2, "0")}</span>}
      </div>
      <SignalPickerContext value={props.renderSignalPicker}>
        {single && <EntityInspector key={single.id} {...props} entity={single} />}
        {selected.length > 1 && (
          <div className="inspector-multi">
            <h2>{selected.length} entities selected</h2>
            <p className="muted-note">{selected.map((entity) => entity.name).join(", ")}</p>
            <button type="button" className="danger-button delete-entity" disabled={!editable} onClick={() => props.onDelete(selected.map((entity) => entity.id))}>
              <Icon name="trash" size={14} />
              Delete {selected.length} entities
            </button>
          </div>
        )}
        {selected.length === 0 && (
          <div className="inspector-empty">
            <Icon name="cursor" size={28} />
            <h3>Every signal starts somewhere.</h3>
            <p>Select a component to adjust its settings and inspect its connections.</p>
            <div className="mini-fact">
              <b>{circuit.entities.length}</b>
              <span>components in this circuit</span>
            </div>
          </div>
        )}
      </SignalPickerContext>
    </aside>
  );
}

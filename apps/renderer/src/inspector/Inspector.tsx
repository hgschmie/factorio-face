// Right panel: identity and primary actions of the selection (rename, delete) at the top, then the description, the per-kind
// settings form and the connections. A selected wire shows its color, its two ends and, between two entities with a tile, its
// length against the wire reach; several things selected are summed up.
// Presentational: every edit is emitted through a callback.
import {
  canRotate, DIRECTIONS, exceedsWireReach, facingOf, formatWireDistance, formatWireReach, tileUnit, wireDistance, wireKey, type Circuit, type Direction, type Entity, type EntityId, type NetworkSelection, type Wire, type WireColor,
} from "@face/model";
import { useId, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from "react";
import { flushSync } from "react-dom";
import { KIND_INFO } from "../entities/kindInfo.ts";
import { EntityIcon, type EntityIconResolver } from "../icons/EntityIcon.tsx";
import { Icon, type IconName } from "../icons/Icon.tsx";
import { EntitySettingsForm } from "./EntitySettingsForm.tsx";
import type { InspectorDraft, UpdateOptions } from "../workbench/controller.ts";
import { countLabel, entityNames, selectedItems, wireEndsLabel, type EntityNames } from "../workbench/selectionText.ts";
import { FieldTextEpochContext, InputWiresContext, useFieldText } from "./fields.tsx";
import { SignalInfoContext, SignalPickerContext, type SignalDescriber, type SignalPickerRenderer } from "./SignalField.tsx";
import { entityNameError } from "./validation.ts";

export type HistoryDirection = "undo" | "redo";

export interface InspectorHandle {
  /**
   * Undo or redo asked for while the focus is inside the inspector. Returns false and does nothing when the focus is elsewhere,
   * or in a popup of the inspector that keeps text of its own (the signal picker).
   */
  history(direction: HistoryDirection): boolean;
}

export interface InspectorProps {
  readonly ref?: Ref<InspectorHandle>;
  readonly circuit: Circuit;
  readonly selection: readonly EntityId[];
  /** The selected wires, as `wireKey`s. */
  readonly wireSelection: readonly string[];
  /** When false, everything is shown read-only. */
  readonly editable: boolean;
  /** The footer says where the entity stands on the blueprint board (its `tile`) instead of where its card is. */
  readonly showTile?: boolean;
  /** The wire reach of the project in tiles; a selected wire between two entities with a tile shows its length against it. */
  readonly wireReach: number;
  readonly resolveEntityIcon?: EntityIconResolver;
  /** Catalog-backed signal picker for all signal fields; without it they are validated text inputs. */
  readonly renderSignalPicker?: SignalPickerRenderer;
  /** Catalog names and icons for the signals shown in the forms. */
  readonly describeSignal?: SignalDescriber;
  /** An edit of the selected entity that is not written to the source yet; the form shows it in place of the entity. */
  readonly draft?: InspectorDraft | null;
  /** Slot for the settings form. Defaults to the built-in forms for the five entity kinds. */
  readonly renderSettings?: (entity: Entity, onChange: (next: Entity) => void) => ReactNode;
  onRename(id: EntityId, name: string): void;
  onChange(next: Entity, options?: UpdateOptions): void;
  /** Makes the entities face a direction; without it, and for an entity that cannot rotate (a lamp), the inspector shows no Facing control. */
  onFace?(ids: readonly EntityId[], direction: Direction): void;
  onDiscardDraft?(): void;
  onDelete(ids: readonly EntityId[]): void;
  /** Deletes everything that is selected, entities and wires, as one step. */
  onDeleteSelection(): void;
  onRemoveWire(wire: Wire): void;
  onSelect(ids: readonly EntityId[]): void;
  /** One step back or forward in the document history. */
  onUndo(): void;
  onRedo(): void;
}

type EntityInspectorProps = Omit<InspectorProps, "ref" | "onUndo" | "onRedo"> & { readonly entity: Entity };

function NameField({ entity, circuit, onRename }: { readonly entity: Entity; readonly circuit: Circuit; onRename(name: string): void }) {
  const id = useId();
  const [draft, setDraft] = useFieldText();
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
        data-unwritten={(draft !== null && draft !== entity.name) || undefined}
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

const FACING: Readonly<Record<Direction, { readonly label: string; readonly icon: IconName; readonly edges: string }>> = {
  north: { label: "North", icon: "arrowUp", edges: "outputs on the top edge, inputs on the bottom edge" },
  east: { label: "East", icon: "arrow", edges: "outputs on the right edge, inputs on the left edge" },
  south: { label: "South", icon: "arrowDown", edges: "outputs on the bottom edge, inputs on the top edge" },
  west: { label: "West", icon: "arrowLeft", edges: "outputs on the left edge, inputs on the right edge" },
};

/** The direction the output of the entity points to, which decides the edges its pins are on. One of four; a click is one step. */
function FacingField({ entity, onFace }: { readonly entity: Entity; onFace(direction: Direction): void }) {
  const facing = facingOf(entity);
  return (
    <div className="facing-field">
      <span className="field-label">Facing</span>
      <span className="facing-toggle" role="group" aria-label="Facing">
        {DIRECTIONS.map((direction) => (
          <button key={direction} type="button" data-direction={direction} aria-pressed={direction === facing} aria-label={FACING[direction].label} title={`${FACING[direction].label}: ${FACING[direction].edges}`} onClick={() => onFace(direction)}>
            <Icon name={FACING[direction].icon} size={15} />
          </button>
        ))}
      </span>
    </div>
  );
}

/** Lamps have no description in the game: theirs is a note of the project. */
const LAMP_DESCRIPTION_NOTE = "Lamps have no description in the game. This text stays in the project.";

/**
 * The free text of an entity, as the game's "Add description". Return is a line break here, so the text is written when the
 * field is left or on Cmd/Ctrl+Return, as one step; Escape drops what is not written. Text of blanks only is no description.
 */
function DescriptionField({ entity, onCommit }: { readonly entity: Entity; onCommit(description: string | undefined): void }) {
  const id = useId();
  const [draft, setDraft] = useFieldText();
  const value = entity.description ?? "";
  const unwritten = draft !== null && draft !== value;
  const commit = (): void => {
    if (unwritten) onCommit(draft.trim() === "" ? undefined : draft);
    setDraft(null);
  };
  return (
    <div className="field description-field">
      <label className="field-label" htmlFor={id}>
        Description
      </label>
      <textarea
        id={id}
        rows={1}
        spellCheck={false}
        placeholder="Add description"
        title={entity.kind === "lamp" ? LAMP_DESCRIPTION_NOTE : undefined}
        data-unwritten={unwritten || undefined}
        value={draft ?? value}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            commit();
          } else if (event.key === "Escape" && draft !== null) {
            event.stopPropagation();
            setDraft(null);
          }
        }}
      />
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

interface WireInspectorProps {
  readonly wire: Wire;
  readonly names: EntityNames;
  /** How far apart the two entities are, in tiles; undefined for a feedback wire and while one of the two entities has no tile. */
  readonly distance: number | undefined;
  readonly wireReach: number;
  readonly editable: boolean;
  onSelect(ids: readonly EntityId[]): void;
  onDelete(): void;
}

/** The distance a wire spans between two different entities of the circuit that both have a tile. */
function distanceOf(wire: Wire, circuit: Circuit): number | undefined {
  const a = circuit.entities.find((entity) => entity.id === wire.a.entity);
  const b = circuit.entities.find((entity) => entity.id === wire.b.entity);
  return a && b && a !== b ? wireDistance(a, b) : undefined;
}

/** One selected wire: its color, its two ends (a click selects the entity), the distance of its entities against the wire reach and Delete. The output end comes first. */
function WireInspector({ wire, names, distance, wireReach, editable, onSelect, onDelete }: WireInspectorProps) {
  const ends = wire.a.side === "in" && wire.b.side === "out" ? [wire.b, wire.a] : [wire.a, wire.b];
  const tooLong = exceedsWireReach(distance, wireReach);
  return (
    <div className="inspector-wire" data-wire={wireKey(wire)} data-color={wire.color}>
      <header className="inspector-identity">
        <div className={`inspector-icon wire-icon ${wire.color}`}>
          <Icon name="wire" size={30} />
        </div>
        <div>
          <span className="eyebrow">Connection</span>
          <h2>{wire.color === "red" ? "Red wire" : "Green wire"}</h2>
          <p>Joins two terminals into one {wire.color} network.</p>
        </div>
      </header>
      <section className="connections">
        <div className="section-label">
          <span>Ends</span>
          {wire.a.entity === wire.b.entity && <span>feedback</span>}
        </div>
        <ul>
          {ends.map((end) => {
            const name = names.get(end.entity) ?? end.entity;
            return (
              <li key={end.side + end.entity} className="connection">
                <span className={`wire-dot ${wire.color}`} />
                <button type="button" className="connection-target wire-end" data-side={end.side} title={`Select ${name}`} onClick={() => onSelect([end.entity])}>
                  <span>{name}</span>
                  <small>{end.side === "out" ? "output" : "input"}</small>
                </button>
              </li>
            );
          })}
        </ul>
      </section>
      {distance !== undefined && (
        <section className="wire-distance" data-too-long={tooLong || undefined}>
          <div className="section-label">
            <span>Distance</span>
            <span>Reach {formatWireReach(wireReach)}</span>
          </div>
          <p>
            The two entities are <b>{formatWireDistance(distance, wireReach)}</b> {tileUnit(distance)} apart
          </p>
          {tooLong && (
            <p className="wire-distance-warning" role="status">
              <b>Further apart than the wire reach.</b> Move the entities closer together or connect them through an entity in between. The reach is a project setting.
            </p>
          )}
        </section>
      )}
      <button type="button" className="danger-button delete-entity" disabled={!editable} onClick={onDelete} aria-label="Delete wire" title="Delete this wire">
        <Icon name="trash" size={14} />
        Delete
      </button>
    </div>
  );
}

/** Controls whose edits arrive as a stream of intermediate values: typing in a text field, dragging in the color dialog. */
function editsContinuously(target: EventTarget): boolean {
  return target instanceof HTMLInputElement && target.type !== "checkbox" && target.type !== "radio";
}

/** Which wire colors are connected to the input terminal of `entity`. */
function inputWires(circuit: Circuit, entity: EntityId): NetworkSelection {
  const connected = (color: WireColor): boolean => circuit.wires.some((wire) => wire.color === color && [wire.a, wire.b].some((end) => end.entity === entity && end.side === "in"));
  return { red: connected("red"), green: connected("green") };
}

function EntityInspector(props: EntityInspectorProps) {
  const { entity, circuit, editable, draft } = props;
  const info = KIND_INFO[entity.kind];
  // One key per stay in such a control: the session merges the edits made during it into a single undo step.
  const focusCount = useRef(0);
  const editKey = useRef<string | undefined>(undefined);
  const change = (next: Entity): void => props.onChange(next, editKey.current === undefined ? undefined : { coalesce: editKey.current });
  const shown = draft?.entity ?? entity;
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
        {props.onFace && canRotate(entity.kind) && <FacingField entity={entity} onFace={(direction) => props.onFace?.([entity.id], direction)} />}
        {/* Not through `change`: the text is written once per stay, and that is a step of its own in the history. */}
        <DescriptionField entity={shown} onCommit={(description) => props.onChange({ ...shown, description })} />
        {draft && (
          <div className="draft-hint" role="status">
            <span>
              <b>Not written to the source yet.</b> {draft.message}
            </span>
            <button type="button" onClick={props.onDiscardDraft} title="Drop this change and show the entity as it is in the source">
              Discard
            </button>
          </div>
        )}
        <div
          className="inspector-settings"
          onFocus={(event) => {
            editKey.current = editsContinuously(event.target) ? `${entity.id}:${++focusCount.current}` : undefined;
          }}
          onBlur={() => {
            editKey.current = undefined;
          }}
        >
          <InputWiresContext value={inputWires(circuit, entity.id)}>
            {props.renderSettings ? props.renderSettings(shown, change) : <EntitySettingsForm entity={shown} onChange={change} />}
          </InputWiresContext>
        </div>
        <Connections entity={entity} circuit={circuit} onRemoveWire={props.onRemoveWire} onSelect={props.onSelect} />
      </fieldset>
      <footer className="inspector-footer">
        {!props.showTile ? (
          <span>
            X <b>{entity.position.x}</b> Y <b>{entity.position.y}</b>
          </span>
        ) : entity.placement?.tile ? (
          <span>
            Tile X <b>{entity.placement.tile.x}</b> Y <b>{entity.placement.tile.y}</b>
          </span>
        ) : (
          <span>Not placed on a tile</span>
        )}
      </footer>
    </>
  );
}

export function Inspector({ ref, onUndo, onRedo, ...props }: InspectorProps) {
  const { circuit, selection, wireSelection, editable } = props;
  const { entities: selected, wires: selectedWires } = selectedItems(circuit, selection, wireSelection);
  const count = selected.length + selectedWires.length;
  const single = count === 1 ? selected[0] : undefined;
  const singleWire = count === 1 ? selectedWires[0] : undefined;
  const names = selectedWires.length > 0 ? entityNames(circuit) : undefined;
  const rootRef = useRef<HTMLElement>(null);
  const [textEpoch, setTextEpoch] = useState(0);
  // The document history is the only undo authority; a field has no undo of its own. What is not written is not in that history:
  // text the focused field could not parse or has not committed, and the pending draft of the entity, whichever field made it.
  // Undo takes that back and goes no further, redo drops it. Either way every field then shows what the document says.
  const history = (direction: HistoryDirection): boolean => {
    const focused = document.activeElement;
    if (!(focused instanceof HTMLElement) || !rootRef.current?.contains(focused) || focused.closest('[role="dialog"]')) return false;
    const pending = props.draft != null || focused.dataset.unwritten !== undefined;
    // Rendered before anything else can happen: as an ordinary update it would wait for a later task, and a key arriving before
    // that would be typed into the text that is about to be dropped, and be dropped with it.
    flushSync(() => setTextEpoch((epoch) => epoch + 1));
    if (props.draft) props.onDiscardDraft?.();
    if (direction === "redo") onRedo();
    else if (!pending) onUndo();
    return true;
  };
  useImperativeHandle(ref, () => ({ history }));
  return (
    <aside ref={rootRef} className="inspector" aria-label="Inspector">
      <div className="palette-heading">
        <span>INSPECTOR</span>
        {count > 0 && <span className="count-badge">{String(count).padStart(2, "0")}</span>}
      </div>
      <FieldTextEpochContext value={textEpoch}>
      <SignalInfoContext value={props.describeSignal}>
      <SignalPickerContext value={props.renderSignalPicker}>
        {single && <EntityInspector key={single.id} {...props} entity={single} />}
        {singleWire && names && (
          <WireInspector
            wire={singleWire}
            names={names}
            distance={distanceOf(singleWire, circuit)}
            wireReach={props.wireReach}
            editable={editable}
            onSelect={props.onSelect}
            onDelete={props.onDeleteSelection}
          />
        )}
        {count > 1 && (
          <div className="inspector-multi">
            <h2>{countLabel(selected.length, selectedWires.length)} selected</h2>
            {selected.length > 0 && <p className="muted-note">{selected.map((entity) => entity.name).join(", ")}</p>}
            {names && (
              <ul className="selected-wires">
                {selectedWires.map((wire) => (
                  <li key={wireKey(wire)} data-wire={wireKey(wire)}>
                    <span className={`wire-dot ${wire.color}`} />
                    {wireEndsLabel(wire, names)}
                  </li>
                ))}
              </ul>
            )}
            <button type="button" className="danger-button delete-entity" disabled={!editable} onClick={props.onDeleteSelection}>
              <Icon name="trash" size={14} />
              Delete {countLabel(selected.length, selectedWires.length)}
            </button>
          </div>
        )}
        {count === 0 && (
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
      </SignalInfoContext>
      </FieldTextEpochContext>
    </aside>
  );
}

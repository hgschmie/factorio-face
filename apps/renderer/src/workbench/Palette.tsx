// Left panel: canvas tools, the five building blocks, and the list of entities in the circuit.
import { ENTITY_KINDS, type Entity, type EntityId } from "@face/model";
import { KIND_INFO } from "../entities/kindInfo.ts";
import { EntityIcon, type EntityIconResolver } from "../icons/EntityIcon.tsx";
import { Icon } from "../icons/Icon.tsx";
import { sameTool, SELECT_TOOL, type Tool } from "./controller.ts";

export interface PaletteProps {
  readonly tool: Tool;
  /** When false, tools that change the circuit are disabled. */
  readonly editable: boolean;
  readonly entities: readonly Entity[];
  readonly selection: readonly EntityId[];
  readonly resolveEntityIcon?: EntityIconResolver;
  onToolChange(tool: Tool): void;
  onSelect(ids: readonly EntityId[]): void;
}

const RED_WIRE: Tool = { type: "wire", color: "red" };
const GREEN_WIRE: Tool = { type: "wire", color: "green" };

export function Palette({ tool, editable, entities, selection, resolveEntityIcon, onToolChange, onSelect }: PaletteProps) {
  // Clicking the active tool again returns to the select tool.
  const toggle = (next: Tool): void => onToolChange(sameTool(tool, next) ? SELECT_TOOL : next);
  return (
    <aside className="palette" aria-label="Components">
      <div className="palette-heading">
        <span>COMPONENTS</span>
        <span className="count-badge">{String(ENTITY_KINDS.length).padStart(2, "0")}</span>
      </div>

      <div className="section-label">Tools</div>
      <div className="tool-row" role="group" aria-label="Canvas tools">
        <button type="button" className="tool-button" aria-pressed={tool.type === "select"} aria-label="Select and move" title="Select and move" onClick={() => onToolChange(SELECT_TOOL)}>
          <Icon name="cursor" size={16} />
        </button>
        <button type="button" className="tool-button wire-red" aria-pressed={sameTool(tool, RED_WIRE)} disabled={!editable} onClick={() => toggle(RED_WIRE)}>
          <Icon name="wire" size={13} />
          Red wire
        </button>
        <button type="button" className="tool-button wire-green" aria-pressed={sameTool(tool, GREEN_WIRE)} disabled={!editable} onClick={() => toggle(GREEN_WIRE)}>
          <Icon name="wire" size={13} />
          Green wire
        </button>
      </div>

      <div className="section-label">Building blocks</div>
      <div className="palette-items">
        {ENTITY_KINDS.map((kind) => {
          const place: Tool = { type: "place", kind };
          return (
            <button key={kind} type="button" className="palette-item" data-kind={kind} aria-pressed={sameTool(tool, place)} disabled={!editable} onClick={() => toggle(place)}>
              <EntityIcon kind={kind} size={34} resolveIcon={resolveEntityIcon} />
              <span className="palette-item-text">
                <strong>{KIND_INFO[kind].label}</strong>
                <small>{KIND_INFO[kind].description}</small>
              </span>
              <Icon name="plus" size={15} />
            </button>
          );
        })}
      </div>

      <div className="palette-divider" />
      <div className="section-label">
        <span>In this circuit</span>
        <span>{entities.length}</span>
      </div>
      <div className="entity-list">
        {entities.map((entity) => (
          <button key={entity.id} type="button" aria-pressed={selection.includes(entity.id)} onClick={() => onSelect([entity.id])}>
            <span className={`kind-dot kind-${entity.kind}`} />
            <span>{entity.name}</span>
          </button>
        ))}
      </div>
    </aside>
  );
}

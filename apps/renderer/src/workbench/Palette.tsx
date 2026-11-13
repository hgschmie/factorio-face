// Left panel: canvas tools, the entity selector (the combinators as full rows, every other entity in a group that can be
// closed), and the list of entities in the circuit. What the selector offers is data: `PALETTE_GROUPS` (entities/registry.ts).
import { prototypeOf, type Entity, type EntityId, type WireColor } from "@face/model";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { KIND_INFO } from "../entities/kindInfo.ts";
import { keyedKindOf, PALETTE_ENTRIES, PALETTE_GROUPS, paletteGroupOf, type PaletteEntry, type PaletteGroup } from "../entities/registry.ts";
import { EntityIcon, type EntityIconResolver } from "../icons/EntityIcon.tsx";
import { Icon } from "../icons/Icon.tsx";
import { shortcutLabel, withShortcut } from "../shortcuts/shortcuts.ts";
import { sameTool, SELECT_TOOL, type Tool } from "./controller.ts";
import { browserStore, readOpenGroups, writeOpenGroups } from "./paletteGroups.ts";

/** Returns the image URL of the game's icon for the wire tool of that color, or undefined to use the line pictogram. */
export type WireIconResolver = (color: WireColor) => string | undefined;

export interface PaletteProps {
  readonly tool: Tool;
  /** When false, the building blocks are disabled: the source has errors, or the display mode does not place entities. */
  readonly canPlace: boolean;
  /** The same for the two wire tools. */
  readonly canWire: boolean;
  readonly entities: readonly Entity[];
  readonly selection: readonly EntityId[];
  readonly resolveEntityIcon?: EntityIconResolver;
  readonly resolveWireIcon?: WireIconResolver;
  onToolChange(tool: Tool): void;
  onSelect(ids: readonly EntityId[]): void;
}

const RED_WIRE: Tool = { type: "wire", color: "red" };
const GREEN_WIRE: Tool = { type: "wire", color: "green" };
const PINNED = PALETTE_GROUPS.filter((group) => group.pinned).flatMap((group) => group.entries);
const COLLAPSIBLE = PALETTE_GROUPS.filter((group) => !group.pinned);

function WireIcon({ color, resolveIcon }: { readonly color: WireColor; readonly resolveIcon?: WireIconResolver }) {
  const url = resolveIcon?.(color);
  return url ? <img className="wire-icon" src={url} width={24} height={24} alt="" draggable={false} /> : <Icon name="wire" size={16} />;
}

interface EntryProps {
  readonly entry: PaletteEntry;
  readonly tool: Tool;
  readonly disabled: boolean;
  readonly resolveIcon?: EntityIconResolver;
  onToggle(tool: Tool): void;
}

/** The tooltip names what the button places and its key, if it has one: "Place: Decider (3)", "Place: Big electric pole (2 x 2 tiles, wire reach 32)". */
function entryTitle(entry: PaletteEntry, what: string): string {
  const keyed = keyedKindOf(entry);
  return keyed ? withShortcut(`Place: ${what}`, `tool.place.${keyed}`) : `Place: ${what}`;
}

/** For the eye only: the tooltip already says the key, and a screen reader takes it from there. */
function KeyHint({ entry }: { readonly entry: PaletteEntry }) {
  const keyed = keyedKindOf(entry);
  return keyed ? (
    <kbd className="key-hint" aria-hidden="true">
      {shortcutLabel(`tool.place.${keyed}`)}
    </kbd>
  ) : null;
}

/** One of the entities that are always on show: icon, the name of its kind, what it is for and its key. */
function PinnedEntry({ entry, tool, disabled, resolveIcon, onToggle }: EntryProps) {
  const place: Tool = { type: "place", kind: entry.kind, prototype: entry.prototype };
  const info = KIND_INFO[entry.kind];
  return (
    <button type="button" className="palette-item" data-kind={entry.kind} data-prototype={entry.prototype} title={entryTitle(entry, info.label)} aria-pressed={sameTool(tool, place)} disabled={disabled} onClick={() => onToggle(place)}>
      <EntityIcon entity={entry} size={34} resolveIcon={resolveIcon} />
      <span className="palette-item-text">
        <span className="palette-item-title">
          <strong>{info.label}</strong>
          <KeyHint entry={entry} />
        </span>
        <small>{info.description}</small>
      </span>
      <Icon name="plus" size={15} />
    </button>
  );
}

/** An entity inside a group: icon and the name of the game on one line, so that many fit; under it the tiles and the reach of an entity that has its own. */
function GroupEntry({ entry, tool, disabled, resolveIcon, onToggle }: EntryProps) {
  const place: Tool = { type: "place", kind: entry.kind, prototype: entry.prototype };
  return (
    <button type="button" className="palette-item compact" data-kind={entry.kind} data-prototype={entry.prototype} title={entryTitle(entry, entry.facts ? `${entry.label} (${entry.facts})` : entry.label)} aria-pressed={sameTool(tool, place)} disabled={disabled} onClick={() => onToggle(place)}>
      <EntityIcon entity={entry} size={22} resolveIcon={resolveIcon} />
      <span className="palette-item-text">
        <strong>{entry.label}</strong>
        {entry.facts && <small>{entry.facts}</small>}
      </span>
      <KeyHint entry={entry} />
    </button>
  );
}

interface GroupProps extends Omit<EntryProps, "entry"> {
  readonly group: PaletteGroup;
  readonly open: boolean;
  onOpenChange(open: boolean): void;
}

function Group({ group, open, onOpenChange, ...entryProps }: GroupProps) {
  const panelId = useId();
  const sectionRef = useRef<HTMLElement>(null);
  // The groups scroll: a group that is opened shows as much of itself as there is room for, from its heading down.
  const wasOpen = useRef(open);
  useLayoutEffect(() => {
    const section = sectionRef.current;
    if (open && !wasOpen.current && section) section.scrollIntoView({ block: section.offsetHeight > (section.parentElement?.clientHeight ?? 0) ? "start" : "nearest" });
    wasOpen.current = open;
  }, [open]);
  return (
    <section ref={sectionRef} className="palette-group" data-group={group.id} data-open={open}>
      <button type="button" className="palette-group-header" aria-expanded={open} aria-controls={panelId} title={open ? `Hide ${group.label.toLowerCase()}` : `Show ${group.label.toLowerCase()}`} onClick={() => onOpenChange(!open)}>
        <Icon name="chevron" size={13} />
        <span className="palette-group-name">{group.label}</span>
        <span className="palette-group-count">{group.entries.length}</span>
      </button>
      <div id={panelId} className="palette-group-entries" role="group" aria-label={group.label} hidden={!open}>
        {open && group.entries.map((entry) => <GroupEntry key={entry.prototype} entry={entry} {...entryProps} />)}
      </div>
    </section>
  );
}

export function Palette({ tool, canPlace, canWire, entities, selection, resolveEntityIcon, resolveWireIcon, onToolChange, onSelect }: PaletteProps) {
  // Clicking the active tool again returns to the select tool.
  const toggle = (next: Tool): void => onToolChange(sameTool(tool, next) ? SELECT_TOOL : next);
  const [openGroups, setOpenGroups] = useState(() => readOpenGroups(browserStore()));
  const setOpen = (id: string, open: boolean): void => {
    const next = { ...openGroups, [id]: open };
    setOpenGroups(next);
    writeOpenGroups(browserStore(), next);
  };
  // A tool whose entry is in a closed group (picked by its key, or armed while the palette was away in Source mode) must be on show: its group opens.
  const armed = tool.type === "place" ? prototypeOf(tool) : undefined;
  const armedGroup = tool.type === "place" ? paletteGroupOf(tool) : undefined;
  useEffect(() => {
    if (armedGroup && !armedGroup.pinned && !openGroups[armedGroup.id]) setOpen(armedGroup.id, true);
    // Only when another tool is picked: a group the user closes afterwards stays closed.
  }, [armed]);
  // The groups scroll; the entry of the tool is brought into view once it is drawn.
  const groupsRef = useRef<HTMLDivElement>(null);
  const armedShown = armedGroup !== undefined && !armedGroup.pinned && openGroups[armedGroup.id] === true;
  useLayoutEffect(() => {
    if (armedShown) groupsRef.current?.querySelector('.palette-item[aria-pressed="true"]')?.scrollIntoView({ block: "nearest" });
  }, [armed, armedShown]);
  const entryProps = { tool, disabled: !canPlace, resolveIcon: resolveEntityIcon, onToggle: toggle };
  return (
    <aside className="palette" aria-label="Components">
      <div className="palette-heading">
        <span>COMPONENTS</span>
        <span className="count-badge">{String(PALETTE_ENTRIES.length).padStart(2, "0")}</span>
      </div>

      <div className="section-label">Tools</div>
      <div className="tool-row" role="group" aria-label="Canvas tools">
        <button type="button" className="tool-button" aria-pressed={tool.type === "select"} aria-label="Select and move" title={withShortcut("Select and move", "tool.select")} onClick={() => onToolChange(SELECT_TOOL)}>
          <Icon name="cursor" size={16} />
        </button>
        <button type="button" className="tool-button wire-red" aria-pressed={sameTool(tool, RED_WIRE)} aria-label="Red wire" title={withShortcut("Red wire", "tool.wireRed")} disabled={!canWire} onClick={() => toggle(RED_WIRE)}>
          <WireIcon color="red" resolveIcon={resolveWireIcon} />
        </button>
        <button type="button" className="tool-button wire-green" aria-pressed={sameTool(tool, GREEN_WIRE)} aria-label="Green wire" title={withShortcut("Green wire", "tool.wireGreen")} disabled={!canWire} onClick={() => toggle(GREEN_WIRE)}>
          <WireIcon color="green" resolveIcon={resolveWireIcon} />
        </button>
      </div>

      <div className="section-label">Building blocks</div>
      <div className="palette-items">
        {PINNED.map((entry) => (
          <PinnedEntry key={entry.prototype} entry={entry} {...entryProps} />
        ))}
      </div>
      <div ref={groupsRef} className="palette-groups">
        {COLLAPSIBLE.map((group) => (
          <Group key={group.id} group={group} open={openGroups[group.id] === true} onOpenChange={(open) => setOpen(group.id, open)} {...entryProps} />
        ))}
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

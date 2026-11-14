// Left panel: the entity selector and the list of entities in the circuit. Every entity is a square tile with its icon; what
// it is, what it is for and its key come in a popup on hover and on focus. The combinators are the first row, "Entities in
// use" has the other entities the circuit contains, and the groups below hold everything else. What the selector offers is
// data: `PALETTE_GROUPS` (entities/registry.ts).
import { prototypeOf, type Entity, type EntityId } from "@face/model";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { placeBubble, type BubblePlacement } from "../canvas/bubble.ts";
import { HoverIntent } from "../canvas/hover.ts";
import { entriesInUse, keyedKindOf, PALETTE_ENTRIES, PALETTE_GROUPS, paletteGroupOf, type PaletteEntry } from "../entities/registry.ts";
import { EntityIcon, type EntityIconResolver } from "../icons/EntityIcon.tsx";
import { Icon } from "../icons/Icon.tsx";
import { shortcutLabel } from "../shortcuts/shortcuts.ts";
import { sameTool, SELECT_TOOL, type Tool } from "./controller.ts";
import { browserStore, IN_USE_KEY, readCircuitListOpen, readOpenGroups, readSectionOpen, writeCircuitListOpen, writeOpenGroups, writeSectionOpen } from "./paletteGroups.ts";

export interface PaletteProps {
  readonly tool: Tool;
  /** When false, the tiles are disabled: the source has errors, or the display mode does not place entities. */
  readonly canPlace: boolean;
  readonly entities: readonly Entity[];
  readonly selection: readonly EntityId[];
  readonly resolveEntityIcon?: EntityIconResolver;
  onToolChange(tool: Tool): void;
  onSelect(ids: readonly EntityId[]): void;
}

const PINNED = PALETTE_GROUPS.filter((group) => group.pinned).flatMap((group) => group.entries);
const COLLAPSIBLE = PALETTE_GROUPS.filter((group) => !group.pinned);
/** The section of the entities the circuit contains. It is no group of the registry: its entries follow the circuit. */
const IN_USE = { id: "in-use", label: "Entities in use" } as const;
const POPUP_WIDTH = 216;

/** A tile on show: the same entry can be one in "Entities in use" and one in its group. */
interface TileRef {
  readonly entry: PaletteEntry;
  /** The tile of "Entities in use": the entry of the palette is the one in its group. */
  readonly inUse: boolean;
  readonly element: HTMLElement;
}

interface TileProps {
  readonly entry: PaletteEntry;
  readonly tool: Tool;
  readonly disabled: boolean;
  readonly inUse?: boolean;
  /** The id of the popup's text while the popup of this tile is on show. */
  readonly describedBy?: string;
  readonly resolveIcon?: EntityIconResolver;
  onToggle(tool: Tool): void;
  /** The pointer is on the tile, or has left it (null). */
  onHover(tile: TileRef | null): void;
  /** The tile has the keyboard focus, or has lost it (null). */
  onFocus(tile: TileRef | null): void;
}

/**
 * One entity to place: a square with its icon. The name is its accessible name; everything else is in the popup, so there is
 * no native tooltip that would say it twice.
 */
function Tile({ entry, tool, disabled, inUse = false, describedBy, resolveIcon, onToggle, onHover, onFocus }: TileProps) {
  const place: Tool = { type: "place", kind: entry.kind, prototype: entry.prototype };
  return (
    <button
      type="button"
      className={inUse ? "palette-tile in-use" : "palette-tile palette-item"}
      data-kind={entry.kind}
      data-prototype={entry.prototype}
      aria-label={entry.label}
      aria-describedby={describedBy}
      aria-pressed={sameTool(tool, place)}
      disabled={disabled}
      onClick={() => onToggle(place)}
      onPointerEnter={(event) => onHover({ entry, inUse, element: event.currentTarget })}
      onPointerLeave={() => onHover(null)}
      // Focus from the keyboard only: a tile that was clicked keeps the focus, and its popup would stay when the pointer leaves.
      onFocus={(event) => event.currentTarget.matches(":focus-visible") && onFocus({ entry, inUse, element: event.currentTarget })}
      onBlur={() => onFocus(null)}
    >
      <EntityIcon entity={entry} size={30} resolveIcon={resolveIcon} />
    </button>
  );
}

interface SectionProps {
  readonly id: string;
  readonly label: string;
  readonly count: number;
  readonly open: boolean;
  readonly children: ReactNode;
  onOpenChange(open: boolean): void;
}

/** A heading that opens and closes the tiles under it. */
function Section({ id, label, count, open, children, onOpenChange }: SectionProps) {
  const panelId = useId();
  const sectionRef = useRef<HTMLElement>(null);
  // The sections scroll: one that is opened shows as much of itself as there is room for, from its heading down.
  const wasOpen = useRef(open);
  useLayoutEffect(() => {
    const section = sectionRef.current;
    if (open && !wasOpen.current && section) section.scrollIntoView({ block: section.offsetHeight > (section.parentElement?.clientHeight ?? 0) ? "start" : "nearest" });
    wasOpen.current = open;
  }, [open]);
  return (
    <section ref={sectionRef} className="palette-group" data-group={id} data-open={open}>
      <button type="button" className="palette-group-header" aria-expanded={open} aria-controls={panelId} title={open ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`} onClick={() => onOpenChange(!open)}>
        <Icon name="chevron" size={13} />
        <span className="palette-group-name">{label}</span>
        <span className="palette-group-count">{count}</span>
      </button>
      <div id={panelId} className="palette-group-entries" role="group" aria-label={label} hidden={!open}>
        {open && children}
      </div>
    </section>
  );
}

interface PopupState extends TileRef {
  readonly placement: BubblePlacement;
}

/**
 * Where the popup of a tile goes: beside the sidebar at the height of the tile, so that it covers no tile, its own included.
 * None for a tile that is scrolled out of sight.
 */
function popupFor(tile: TileRef, panel: HTMLElement, height: number): PopupState | null {
  const [box, side] = [tile.element.getBoundingClientRect(), panel.getBoundingClientRect()];
  const scroller = tile.element.closest(".palette-groups")?.getBoundingClientRect();
  if (scroller && (box.bottom <= scroller.top || box.top >= scroller.bottom)) return null;
  // The anchor is the row of the tile as far as the sidebar reaches, so "beside it" is beside the sidebar.
  const placement = placeBubble({ x: box.left, y: box.top, width: side.right - box.left, height: box.height }, { width: POPUP_WIDTH, height }, { width: window.innerWidth, height: window.innerHeight });
  return placement ? { ...tile, placement } : null;
}

/** What a tile stands for, in the look of the board's bubble: name, purpose, the tiles and reach of a pole, the key. It takes no pointer events. */
function TilePopup({ id, popup, onMeasure }: { readonly id: string; readonly popup: PopupState; onMeasure(height: number): void }) {
  const { entry, placement } = popup;
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    onMeasure(ref.current?.offsetHeight ?? 0);
  });
  const keyed = keyedKindOf(entry);
  const beside = placement.side === "right" || placement.side === "left";
  return (
    <div ref={ref} className={`tile-popup side-${placement.side}`} role="tooltip" style={{ left: placement.x, top: placement.y, width: POPUP_WIDTH }} data-prototype={entry.prototype} data-side={placement.side}>
      <div className={`tile-popup-body kind-${entry.kind}`}>
        <strong className="tile-popup-name">{entry.label}</strong>
        <div id={id} className="tile-popup-text">
          <p>{entry.description}</p>
          {entry.facts && <p className="tile-popup-facts">{entry.facts}</p>}
          {keyed && (
            <p className="tile-popup-key">
              Key <kbd className="key-hint">{shortcutLabel(`tool.place.${keyed}`)}</kbd>
            </p>
          )}
        </div>
      </div>
      <span className="bubble-pointer" style={beside ? { top: placement.pointer } : { left: placement.pointer }} />
    </div>
  );
}

export function Palette({ tool, canPlace, entities, selection, resolveEntityIcon, onToolChange, onSelect }: PaletteProps) {
  // Clicking the active tool again returns to the select tool.
  const toggle = (next: Tool): void => onToolChange(sameTool(tool, next) ? SELECT_TOOL : next);
  const [openGroups, setOpenGroups] = useState(() => readOpenGroups(browserStore()));
  const setOpen = (id: string, open: boolean): void => {
    const next = { ...openGroups, [id]: open };
    setOpenGroups(next);
    writeOpenGroups(browserStore(), next);
  };
  const [inUseOpen, setInUseOpen] = useState(() => readSectionOpen(browserStore(), IN_USE_KEY));
  const inUse = useMemo(() => entriesInUse(entities), [entities]);
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

  // The popup: for the tile the pointer rests on, otherwise for the tile that has the keyboard focus.
  const panelRef = useRef<HTMLElement>(null);
  const popupId = useId();
  const [hovered, setHovered] = useState<TileRef | null>(null);
  const [focused, setFocused] = useState<TileRef | null>(null);
  const [popupHeight, setPopupHeight] = useState(0);
  const hover = useMemo(() => new HoverIntent<TileRef>(setHovered), []);
  useEffect(() => () => hover.reset(), [hover]);
  // The sections scroll: the pointer is then over another tile or none, and the popup of the focused tile moves with its tile
  // (the browser scrolls a tile into view when the keyboard reaches it).
  const followScroll = (): void => {
    hover.reset();
    setFocused((tile) => tile && { ...tile });
  };
  const shown = hovered ?? focused;
  const popup = shown?.element.isConnected && panelRef.current ? popupFor(shown, panelRef.current, popupHeight) : null;

  const tileProps = { tool, disabled: !canPlace, resolveIcon: resolveEntityIcon, onToggle: toggle, onHover: (tile: TileRef | null) => hover.over(tile), onFocus: setFocused };
  const describing = (entry: PaletteEntry, inUseTile: boolean): string | undefined => (popup && popup.entry === entry && popup.inUse === inUseTile ? popupId : undefined);
  // The list of the circuit's entities closes like a group, so the groups can have its room.
  const listId = useId();
  const [listOpen, setListOpen] = useState(() => readCircuitListOpen(browserStore()));
  const toggleList = (): void => {
    setListOpen(!listOpen);
    writeCircuitListOpen(browserStore(), !listOpen);
  };
  return (
    <aside ref={panelRef} className="palette" aria-label="Components">
      <div className="palette-heading">
        <span>COMPONENTS</span>
        <span className="count-badge">{String(PALETTE_ENTRIES.length).padStart(2, "0")}</span>
      </div>

      <div className="palette-items palette-tiles" role="group" aria-label="Combinators">
        {PINNED.map((entry) => (
          <Tile key={entry.prototype} entry={entry} describedBy={describing(entry, false)} {...tileProps} />
        ))}
      </div>
      <div ref={groupsRef} className="palette-groups" onScroll={followScroll}>
        <Section
          id={IN_USE.id}
          label={IN_USE.label}
          count={inUse.length}
          open={inUseOpen}
          onOpenChange={(open) => {
            setInUseOpen(open);
            writeSectionOpen(browserStore(), IN_USE_KEY, open);
          }}
        >
          {inUse.length === 0 ? (
            <p className="palette-empty">None besides the combinators.</p>
          ) : (
            <div className="palette-tiles">
              {inUse.map((entry) => (
                <Tile key={entry.prototype} entry={entry} inUse describedBy={describing(entry, true)} {...tileProps} />
              ))}
            </div>
          )}
        </Section>
        {COLLAPSIBLE.map((group) => (
          <Section key={group.id} id={group.id} label={group.label} count={group.entries.length} open={openGroups[group.id] === true} onOpenChange={(open) => setOpen(group.id, open)}>
            <div className="palette-tiles">
              {group.entries.map((entry) => (
                <Tile key={entry.prototype} entry={entry} describedBy={describing(entry, false)} {...tileProps} />
              ))}
            </div>
          </Section>
        ))}
      </div>

      <div className="palette-divider" />
      <button type="button" className="palette-list-header" aria-expanded={listOpen} aria-controls={listId} title={listOpen ? "Hide the entities of this circuit" : "Show the entities of this circuit"} onClick={toggleList}>
        <Icon name="chevron" size={13} />
        <span className="palette-list-name">In this circuit</span>
        <span className="palette-list-count">{entities.length}</span>
      </button>
      <div id={listId} className="entity-list" role="group" aria-label="In this circuit" hidden={!listOpen}>
        {listOpen &&
          entities.map((entity) => (
            <button key={entity.id} type="button" aria-pressed={selection.includes(entity.id)} onClick={() => onSelect([entity.id])}>
              <span className={`kind-dot kind-${entity.kind}`} />
              <span>{entity.name}</span>
            </button>
          ))}
      </div>

      {popup && <TilePopup id={popupId} popup={popup} onMeasure={setPopupHeight} />}
    </aside>
  );
}

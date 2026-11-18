// Left panel: the entity selector and the list of entities in the circuit. Every entity is a square tile with its icon; what
// it is, its tiles and its key come in a popup on hover and on focus. The combinators are the first row, "Entities in
// use" has the other entities the circuit contains, and below them every entity the project's modules have is where the game
// has the item that builds it: a tab per item group, its subgroups as rows, and a search through all of them. What the selector
// offers is data: the `EntityRegistry` of the catalog (entities/registry.ts).
import type { Entity, EntityId } from "@face/model";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { placeBubble, type BubblePlacement } from "../canvas/bubble.ts";
import { HoverIntent } from "../canvas/hover.ts";
import { entriesInUse, keyedKindOf, searchEntries, type EntityRegistry, type PaletteEntry, type PaletteGroup } from "../entities/registry.ts";
import { EntityIcon, type EntityIconResolver } from "../icons/EntityIcon.tsx";
import { Icon } from "../icons/Icon.tsx";
import { IconImage } from "../icons/IconImage.tsx";
import { shortcutLabel } from "../shortcuts/shortcuts.ts";
import { sameTool, SELECT_TOOL, type Tool } from "./controller.ts";
import { browserStore, IN_USE_KEY, readCircuitListOpen, readSearch, readSectionOpen, readTab, windowStore, writeCircuitListOpen, writeSearch, writeSectionOpen, writeTab } from "./paletteGroups.ts";

export interface PaletteProps {
  /** What can be placed with the project's modules, in the game's groups. */
  readonly registry: EntityRegistry;
  readonly tool: Tool;
  /** When false, the tiles are disabled: the source has errors, or the display mode does not place entities. */
  readonly canPlace: boolean;
  readonly entities: readonly Entity[];
  readonly selection: readonly EntityId[];
  readonly resolveEntityIcon?: EntityIconResolver;
  /** URL of a catalog icon id, for the icons of the tabs; without it a tab shows the name of its group. */
  readonly iconUrl?: (icon: string) => string | undefined;
  onToolChange(tool: Tool): void;
  onSelect(ids: readonly EntityId[]): void;
}

/** The section of the entities the circuit contains. It is no group of the registry: its entries follow the circuit. */
const IN_USE = { id: "in-use", label: "Entities in use" } as const;
const POPUP_WIDTH = 216;
const TAB_ICON = 24;

/**
 * Where a tile is. An entry has one tile that is "the entry of the palette" (class `palette-item`): in the first row for a
 * pinned entry, in its group for every other one. A pinned entry also has a tile in its group (`pinned-copy`), and an entry the
 * circuit contains one in "Entities in use" (`in-use`).
 */
type TilePlace = "pinned" | "group" | "pinned-copy" | "in-use";

const TILE_CLASS: Readonly<Record<TilePlace, string>> = { pinned: "palette-tile palette-item", group: "palette-tile palette-item", "pinned-copy": "palette-tile pinned-copy", "in-use": "palette-tile in-use" };

/** A tile on show. */
interface TileRef {
  readonly entry: PaletteEntry;
  readonly place: TilePlace;
  readonly element: HTMLElement;
}

interface TileProps {
  readonly entry: PaletteEntry;
  readonly tool: Tool;
  readonly disabled: boolean;
  readonly place: TilePlace;
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
function Tile({ entry, tool, disabled, place: where, describedBy, resolveIcon, onToggle, onHover, onFocus }: TileProps) {
  const place: Tool = { type: "place", prototype: entry.prototype };
  return (
    <button
      type="button"
      className={TILE_CLASS[where]}
      data-kind={entry.kind}
      data-prototype={entry.prototype}
      data-place={where}
      aria-label={entry.label}
      aria-describedby={describedBy}
      aria-pressed={sameTool(tool, place)}
      disabled={disabled}
      onClick={() => onToggle(place)}
      onPointerEnter={(event) => onHover({ entry, place: where, element: event.currentTarget })}
      onPointerLeave={() => onHover(null)}
      // Focus from the keyboard only: a tile that was clicked keeps the focus, and its popup would stay when the pointer leaves.
      onFocus={(event) => event.currentTarget.matches(":focus-visible") && onFocus({ entry, place: where, element: event.currentTarget })}
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

/** What a tile stands for, in the look of the board's bubble: the game's name, its tiles and its reach where it has its own, the key. It takes no pointer events. */
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
          <p className="tile-popup-facts">{entry.facts}</p>
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

/** The tiles of the groups on show: every subgroup starts a row of its own, as in the game. With `titled`, each group under its name (the result of a search). */
function GroupTiles({ groups, titled, pinned, renderTile }: { readonly groups: readonly PaletteGroup[]; readonly titled: boolean; readonly pinned: readonly PaletteEntry[]; renderTile(entry: PaletteEntry, place: TilePlace): ReactNode }) {
  return groups.map((group) => (
    <section key={group.name} className="palette-catalog-group" data-group={group.name} aria-label={group.label}>
      {titled && <h3>{group.label}</h3>}
      {group.subgroups.map((subgroup) => (
        <div key={subgroup.name} className="palette-tiles compact palette-subgroup" data-subgroup={subgroup.name}>
          {subgroup.entries.map((entry) => renderTile(entry, pinned.includes(entry) ? "pinned-copy" : "group"))}
        </div>
      ))}
    </section>
  ));
}

export function Palette({ registry, tool, canPlace, entities, selection, resolveEntityIcon, iconUrl, onToolChange, onSelect }: PaletteProps) {
  // Clicking the active tool again returns to the select tool.
  const toggle = (next: Tool): void => onToolChange(sameTool(tool, next) ? SELECT_TOOL : next);
  const { groups, pinned } = registry;
  const [inUseOpen, setInUseOpen] = useState(() => readSectionOpen(browserStore(), IN_USE_KEY));
  const inUse = useMemo(() => entriesInUse(registry, entities), [registry, entities]);

  // The tab on show and the search are remembered like the open sections. A tab the modules no longer have gives way to the first.
  const [storedTab, setStoredTab] = useState(() => readTab(browserStore(), groups.map((group) => group.name)));
  const tab = groups.some((group) => group.name === storedTab) ? storedTab : groups[0]?.name;
  const showTab = (name: string): void => {
    setStoredTab(name);
    writeTab(browserStore(), name);
  };
  const [search, setSearch] = useState(() => readSearch(windowStore()));
  const changeSearch = (text: string): void => {
    setSearch(text);
    writeSearch(windowStore(), text);
  };
  const searching = search.trim() !== "";
  const found = useMemo(() => searchEntries(groups, search), [groups, search]);
  // A search looks through every group; without one, the active tab is shown.
  const listed = searching ? found : groups.filter((group) => group.name === tab);
  const firstFound = searching ? found[0]?.subgroups[0]?.entries[0] : undefined;

  // A tool whose tile is not on show (picked by its key, or armed while the palette was away in Source mode) must be: its tab
  // comes to the front, and a search that does not find it goes. The pinned entries are on show whatever the tab.
  const armed = tool.type === "place" ? tool.prototype : undefined;
  const armedGroup = armed !== undefined && !pinned.some((entry) => entry.prototype === armed) ? registry.groupOf(armed) : undefined;
  useEffect(() => {
    if (armedGroup === undefined) return;
    if (searching && !found.some((group) => group.subgroups.some((subgroup) => subgroup.entries.some((entry) => entry.prototype === armed)))) changeSearch("");
    if (armedGroup !== tab) showTab(armedGroup);
    // Only when another tool is picked: a tab the user shows afterwards stays.
  }, [armed]);
  // The sections scroll; the entry of the tool is brought into view once it is drawn.
  const groupsRef = useRef<HTMLDivElement>(null);
  // The search and the tabs stay at the top of the scrolled sections: a tile that is scrolled into view stops below them
  // (`scroll-margin-top` of the tiles), however high they are (the tabs wrap where they are names instead of icons).
  const headRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    groupsRef.current?.style.setProperty("--palette-head", `${headRef.current?.offsetHeight ?? 0}px`);
  });
  useLayoutEffect(() => {
    if (armedGroup !== undefined) groupsRef.current?.querySelector('.palette-item[aria-pressed="true"]')?.scrollIntoView({ block: "nearest" });
  }, [armed, armedGroup, tab, searching]);

  // The popup: for the tile the pointer rests on, otherwise for the tile that has the keyboard focus.
  const panelRef = useRef<HTMLElement>(null);
  const popupId = useId();
  const [hovered, setHovered] = useState<TileRef | null>(null);
  const [focused, setFocused] = useState<TileRef | null>(null);
  const [popupHeight, setPopupHeight] = useState(0);
  const hover = useMemo(() => new HoverIntent<TileRef>(setHovered), []);
  useEffect(() => () => hover.reset(), [hover]);
  // The sections scroll: the pointer is then over another tile or none, and the popup of the focused tile moves with its tile
  // (the browser scrolls a tile into view when the keyboard reaches it). The tile that has come under the resting pointer is
  // looked up, since the browser reports it only once the pointer moves; its popup comes after the usual wait.
  const pointer = useRef<{ readonly x: number; readonly y: number } | null>(null);
  const followScroll = (): void => {
    hover.reset();
    setFocused((tile) => tile && { ...tile });
    const under = pointer.current && document.elementFromPoint(pointer.current.x, pointer.current.y)?.closest<HTMLElement>(".palette-tile");
    const entry = under ? registry.entry(under.dataset.prototype ?? "") : undefined;
    if (under && entry && groupsRef.current?.contains(under)) hover.over({ entry, place: under.dataset.place as TilePlace, element: under });
  };
  const shown = hovered ?? focused;
  const popup = shown?.element.isConnected && panelRef.current ? popupFor(shown, panelRef.current, popupHeight) : null;

  const tileProps = { tool, disabled: !canPlace, resolveIcon: resolveEntityIcon, onToggle: toggle, onHover: (tile: TileRef | null) => hover.over(tile), onFocus: setFocused };
  const renderTile = (entry: PaletteEntry, place: TilePlace): ReactNode => (
    <Tile key={entry.prototype} entry={entry} place={place} describedBy={popup && popup.entry === entry && popup.place === place ? popupId : undefined} {...tileProps} />
  );
  const tabPanelId = useId();
  // The list of the circuit's entities closes like a section, so the groups can have its room.
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
        <span className="count-badge">{String(registry.entries.length).padStart(2, "0")}</span>
      </div>

      <div className="palette-items palette-tiles" role="group" aria-label="Combinators">
        {pinned.map((entry) => renderTile(entry, "pinned"))}
      </div>
      <div
        ref={groupsRef}
        className="palette-groups"
        onScroll={followScroll}
        onPointerMove={(event) => {
          pointer.current = { x: event.clientX, y: event.clientY };
        }}
        onPointerLeave={() => {
          pointer.current = null;
        }}
      >
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
          {inUse.length === 0 ? <p className="palette-empty">None besides the combinators.</p> : <div className="palette-tiles compact">{inUse.map((entry) => renderTile(entry, "in-use"))}</div>}
        </Section>

        {/* The search and the tabs stay in view while the tiles under them scroll. */}
        <div ref={headRef} className="palette-catalog-head">
          <div className="palette-search">
            <input
              type="search"
              spellCheck={false}
              autoComplete="off"
              placeholder="Search entities"
              aria-label="Search entities"
              value={search}
              onChange={(event) => changeSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && firstFound && canPlace) onToolChange({ type: "place", prototype: firstFound.prototype });
                if (event.key === "Escape" && search !== "") {
                  event.stopPropagation();
                  changeSearch("");
                }
              }}
            />
          </div>
          <div className="palette-tabs" role="tablist" aria-label="Entity groups">
            {groups.map((group) => {
              const url = iconUrl?.(group.icon);
              const count = group.subgroups.reduce((sum, subgroup) => sum + subgroup.entries.length, 0);
              return (
                <button
                  key={group.name}
                  type="button"
                  role="tab"
                  data-group={group.name}
                  aria-selected={!searching && tab === group.name}
                  aria-controls={tabPanelId}
                  aria-label={group.label}
                  title={`${group.label}: ${count} ${count === 1 ? "entity" : "entities"}`}
                  onClick={() => {
                    showTab(group.name);
                    changeSearch("");
                  }}
                >
                  {url ? <IconImage src={url} size={TAB_ICON} fallback={group.label} /> : <span>{group.label}</span>}
                </button>
              );
            })}
          </div>
        </div>
        <div id={tabPanelId} className="palette-catalog" role="tabpanel" aria-label={searching ? "Search results" : groups.find((group) => group.name === tab)?.label}>
          {groups.length === 0 && <p className="palette-empty">No entity groups for the modules of this project.</p>}
          {searching && found.length === 0 && <p className="palette-empty">No entity matches "{search.trim()}".</p>}
          <GroupTiles groups={listed} titled={searching} pinned={pinned} renderTile={renderTile} />
        </div>
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

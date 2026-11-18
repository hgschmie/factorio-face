// Signal picker, organised like the one in the game: one tab per item group, one row block per subgroup, signals in game
// order. Presentational: the tree, the qualities and the icon URLs arrive as props.
import type { CatalogSignal, PickerGroup } from "@face/catalog";
import { NORMAL_QUALITY, signal, signalKey, type SignalId, type Wildcard } from "@face/model";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useFocusReturn } from "../dialog/focusReturn.ts";
import { shortSignal } from "../entities/signalText.ts";
import { Icon } from "../icons/Icon.tsx";
import { IconImage } from "../icons/IconImage.tsx";
import type { QualityOption } from "../workbench/controller.ts";

export interface SignalPickerPanelProps {
  readonly groups: readonly PickerGroup[];
  /** Selectable qualities, lowest first; empty when the project has no quality module. */
  readonly qualities: readonly QualityOption[];
  readonly value: SignalId | undefined;
  /** Wildcards the slot accepts; all others are left out. */
  readonly wildcards: readonly Wildcard[];
  /** URL of a catalog icon id, or undefined when icons are not available (names are shown instead). */
  iconUrl(icon: string): string | undefined;
  onSelect(signal: SignalId): void;
  close(): void;
}

/** Kept free between the panel and the ends of the area it stays in. */
const MARGIN = 8;
const MAX_HEIGHT = 520;
/** The signal list is rows of tiles, and in a search headings as high as one: the height of a row and the gap to the next (picker.css). */
const ROW = { height: 36, gap: 3 } as const;
const MIN_ROWS = 3;

export interface PickerPlacement {
  /** Top of the panel in the window. */
  readonly top: number;
  /** The most the signal list gets: a whole number of rows. */
  readonly listHeight: number;
}

/**
 * Where the picker opens and how high its signal list gets at most. The panel is level with its field (`fieldTop`) and stays in
 * the area that ends at `bottom`, the top of the status line, a margin from both ends; it is at most `MAX_HEIGHT` high.
 * `chrome` is the height of everything in it but the list. The list gets a whole number of rows of what is left, so that its
 * lower edge cuts no row, and the panel is placed for the highest list: another tab or a search changes the height of the
 * panel, and neither moves it nor takes it out of the area.
 */
export function pickerPlacement(fieldTop: number, chrome: number, bottom: number): PickerPlacement {
  const room = Math.min(MAX_HEIGHT, bottom - 2 * MARGIN) - chrome;
  const rows = Math.max(MIN_ROWS, Math.floor((room + ROW.gap) / (ROW.height + ROW.gap)));
  const listHeight = rows * (ROW.height + ROW.gap) - ROW.gap;
  return { top: Math.max(MARGIN, Math.min(fieldTop, bottom - MARGIN - chrome - listHeight)), listHeight };
}

function matches(entry: CatalogSignal, query: string): boolean {
  return entry.displayName.toLowerCase().includes(query) || entry.name.toLowerCase().includes(query);
}

/** The tree without the wildcards this slot does not accept and, with a query, without everything that does not match. */
function visibleGroups(groups: readonly PickerGroup[], wildcards: readonly Wildcard[], query: string): PickerGroup[] {
  const result: PickerGroup[] = [];
  for (const group of groups) {
    const subgroups = group.subgroups
      .map((subgroup) => ({ ...subgroup, signals: subgroup.signals.filter((entry) => (entry.wildcard === undefined || wildcards.includes(entry.wildcard)) && (query === "" || matches(entry, query))) }))
      .filter((subgroup) => subgroup.signals.length > 0);
    if (subgroups.length > 0) result.push({ group: group.group, subgroups });
  }
  return result;
}

export function SignalPicker({ groups, qualities, value, wildcards, iconUrl, onSelect, close }: SignalPickerPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const giveFocusBack = useFocusReturn();
  const [query, setQuery] = useState("");
  const [quality, setQuality] = useState(value?.quality ?? NORMAL_QUALITY);
  const [position, setPosition] = useState<(PickerPlacement & { readonly right: number }) | null>(null);
  const valueKey = value ? signalKey({ kind: value.kind, name: value.name }) : undefined;
  const needle = query.trim().toLowerCase();
  const shown = useMemo(() => visibleGroups(groups, wildcards, needle), [groups, wildcards, needle]);
  const [tab, setTab] = useState(() => groups.find((group) => group.subgroups.some((subgroup) => subgroup.signals.some((entry) => entry.key === valueKey)))?.group.name ?? groups[0]?.group.name);
  // A search looks through every group; without one, the active tab is shown.
  const listed = needle === "" ? shown.filter((group) => group.group.name === tab) : shown;
  const first = listed[0]?.subgroups[0]?.signals[0];

  // Closed by a choice, by a key or by its close button, the picker gives the focus back to the button of its field.
  const pick = (entry: CatalogSignal): void => {
    onSelect(entry.wildcard === undefined && quality !== NORMAL_QUALITY ? signal(entry.kind, entry.name, quality) : entry.id);
    giveFocusBack();
  };
  const dismiss = (): void => {
    close();
    giveFocusBack();
  };

  // The panel opens beside the inspector, level with its field, and stays above the status line (`pickerPlacement`).
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const list = listRef.current;
    if (!panel || !list) return;
    const field = panel.parentElement?.getBoundingClientRect();
    const inspector = panel.closest(".inspector")?.getBoundingClientRect();
    const bottom = document.querySelector(".statusbar")?.getBoundingClientRect().top ?? window.innerHeight;
    setPosition({ ...pickerPlacement(field?.top ?? MARGIN, panel.offsetHeight - list.offsetHeight, bottom), right: inspector ? window.innerWidth - inspector.left + MARGIN : MARGIN });
  }, []);

  // Another tab or another search is another list: it starts at its top.
  useLayoutEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [tab, needle]);

  // The panel is invisible until it is positioned, and an invisible input cannot take the focus.
  const placed = position !== null;
  useEffect(() => {
    if (placed) searchRef.current?.focus();
  }, [placed]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      // A press inside the picker or on its own field (which holds the button that toggles it) is not "outside".
      if (event.target instanceof Node && !panelRef.current?.parentElement?.contains(event.target)) close();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [close]);

  return (
    <div
      ref={panelRef}
      className="signal-picker"
      role="dialog"
      aria-label="Choose a signal"
      style={position ? { top: position.top, right: position.right } : { visibility: "hidden" }}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        dismiss();
      }}
    >
      <div className="picker-search">
        <input
          ref={searchRef}
          type="search"
          spellCheck={false}
          autoComplete="off"
          placeholder="Search by name"
          aria-label="Search signals"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && first) pick(first);
          }}
        />
        <button type="button" className="icon-button" aria-label="Close signal picker" onClick={dismiss}>
          <Icon name="close" size={14} />
        </button>
      </div>

      <div className="picker-tabs" role="tablist" aria-label="Signal groups">
        {groups.map(({ group }) => {
          const url = iconUrl(group.icon);
          const available = shown.some((candidate) => candidate.group.name === group.name);
          return (
            <button key={group.name} type="button" role="tab" aria-selected={needle === "" && tab === group.name} aria-label={group.displayName} title={group.displayName} disabled={!available} onClick={() => (setTab(group.name), setQuery(""))}>
              {url ? <IconImage src={url} size={28} fallback={group.displayName} /> : <span>{group.displayName}</span>}
            </button>
          );
        })}
      </div>

      <div ref={listRef} className="picker-signals" role="tabpanel" style={position ? { maxHeight: position.listHeight } : undefined}>
        {listed.length === 0 && <p className="muted-note">No signal matches "{query.trim()}".</p>}
        {listed.map(({ group, subgroups }) => (
          <section key={group.name} aria-label={group.displayName}>
            {needle !== "" && <h3>{group.displayName}</h3>}
            {subgroups.map(({ subgroup, signals }) => (
              <div key={subgroup.name} className="picker-row">
                {signals.map((entry) => {
                  const url = iconUrl(entry.icon);
                  return (
                    <button
                      key={entry.key}
                      type="button"
                      className={`picker-signal${url ? "" : " text"}${entry.key === valueKey ? " current" : ""}`}
                      data-signal={entry.key}
                      aria-label={entry.displayName}
                      title={`${entry.displayName}\n${entry.wildcard ?? entry.key}`}
                      onClick={() => pick(entry)}
                    >
                      {url ? <IconImage src={url} size={28} lazy fallback={shortSignal(entry.id)} /> : shortSignal(entry.id)}
                    </button>
                  );
                })}
              </div>
            ))}
          </section>
        ))}
      </div>

      {qualities.length > 0 && (
        <div className="picker-qualities" role="radiogroup" aria-label="Quality">
          <span className="field-label">Quality</span>
          {qualities.map((option) => {
            const url = iconUrl(option.icon);
            return (
              <button key={option.name} type="button" role="radio" aria-checked={quality === option.name} aria-label={option.displayName} title={option.displayName} style={{ borderBottomColor: option.color }} onClick={() => setQuality(option.name)}>
                {url ? <IconImage src={url} size={20} fallback={option.displayName} /> : option.displayName}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

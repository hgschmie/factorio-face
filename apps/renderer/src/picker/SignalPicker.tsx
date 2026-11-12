// Signal picker, organised like the one in the game: one tab per item group, one row block per subgroup, signals in game
// order. Presentational: the tree, the qualities and the icon URLs arrive as props.
import type { CatalogSignal, PickerGroup } from "@face/catalog";
import { NORMAL_QUALITY, signal, signalKey, type SignalId, type Wildcard } from "@face/model";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { shortSignal } from "../entities/signalText.ts";
import { Icon } from "../icons/Icon.tsx";
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

const MARGIN = 8;

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
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [quality, setQuality] = useState(value?.quality ?? NORMAL_QUALITY);
  const [position, setPosition] = useState<{ readonly top: number; readonly right: number } | null>(null);
  const valueKey = value ? signalKey({ kind: value.kind, name: value.name }) : undefined;
  const needle = query.trim().toLowerCase();
  const shown = useMemo(() => visibleGroups(groups, wildcards, needle), [groups, wildcards, needle]);
  const [tab, setTab] = useState(() => groups.find((group) => group.subgroups.some((subgroup) => subgroup.signals.some((entry) => entry.key === valueKey)))?.group.name ?? groups[0]?.group.name);
  // A search looks through every group; without one, the active tab is shown.
  const listed = needle === "" ? shown.filter((group) => group.group.name === tab) : shown;
  const first = listed[0]?.subgroups[0]?.signals[0];

  const pick = (entry: CatalogSignal): void => onSelect(entry.wildcard === undefined && quality !== NORMAL_QUALITY ? signal(entry.kind, entry.name, quality) : entry.id);

  // The panel opens beside the inspector, level with its field, and stays inside the window.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const field = panel.parentElement?.getBoundingClientRect();
    const inspector = panel.closest(".inspector")?.getBoundingClientRect();
    const top = Math.max(MARGIN, Math.min(field?.top ?? MARGIN, window.innerHeight - panel.offsetHeight - MARGIN));
    setPosition({ top, right: inspector ? window.innerWidth - inspector.left + MARGIN : MARGIN });
  }, []);

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
        close();
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
        <button type="button" className="icon-button" aria-label="Close signal picker" onClick={close}>
          <Icon name="close" size={14} />
        </button>
      </div>

      <div className="picker-tabs" role="tablist" aria-label="Signal groups">
        {groups.map(({ group }) => {
          const url = iconUrl(group.icon);
          const available = shown.some((candidate) => candidate.group.name === group.name);
          return (
            <button key={group.name} type="button" role="tab" aria-selected={needle === "" && tab === group.name} aria-label={group.displayName} title={group.displayName} disabled={!available} onClick={() => (setTab(group.name), setQuery(""))}>
              {url ? <img src={url} width={28} height={28} alt="" draggable={false} /> : <span>{group.displayName}</span>}
            </button>
          );
        })}
      </div>

      <div className="picker-signals" role="tabpanel">
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
                      {url ? <img src={url} width={28} height={28} alt="" loading="lazy" draggable={false} /> : shortSignal(entry.id)}
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
                {url ? <img src={url} width={20} height={20} alt="" draggable={false} /> : option.displayName}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

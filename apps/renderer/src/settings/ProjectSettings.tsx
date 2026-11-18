// Project settings panel: the project name, the wire reach and the modules the project switches (the game's own and, with data
// read from a game, its mods), shown as the signal groups they contribute. Presentational; enabling and disabling (with
// dependencies) is decided by the session.
import { DEFAULT_WIRE_REACH, UNLIMITED_WIRE_REACH, WIRE_REACH_RANGE } from "@face/model";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useFocusReturn } from "../dialog/focusReturn.ts";
import { Icon } from "../icons/Icon.tsx";
import type { CatalogView, ProjectView } from "../workbench/controller.ts";
import { consequence, FILTER_FROM, filterModules, listedRows, listOrder, moduleCounts, MODS_HINT, modulesOffNotice, otherModsNote, rowHint } from "./moduleList.ts";
import { parseWireReach, WIRE_REACH_DETAILS_LABEL, WIRE_REACH_ERROR, WIRE_REACH_NOTE } from "./wireReach.ts";

export interface ProjectSettingsProps {
  readonly project: ProjectView;
  readonly catalog: CatalogView;
  onRename(name: string): void;
  onWireReachChange(wireReach: number): void;
  onModuleChange(name: string, enabled: boolean): void;
  /** Switches on the modules the project uses although they are off. */
  onEnableUsedModules(): void;
  close(): void;
}

function NameField({ name, onRename }: { readonly name: string; onRename(name: string): void }) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (): void => {
    if (draft !== null && draft.trim() !== "") onRename(draft);
    setDraft(null);
  };
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        Project name
      </label>
      <input
        id={id}
        type="text"
        maxLength={200}
        spellCheck={false}
        autoComplete="off"
        value={draft ?? name}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
          if (event.key === "Escape" && draft !== null) {
            event.stopPropagation();
            setDraft(null);
          }
        }}
      />
    </div>
  );
}

/**
 * The wire reach in tiles. Like the name it is written when the field is left or with Enter; a text that is not a reach in
 * range says so while it is typed and is dropped when the field is left. The rules of the measuring are a long text and the
 * list below needs the room: they are behind a disclosure that starts closed with every opening of the panel.
 */
function WireReachField({ wireReach, onChange }: { readonly wireReach: number; onChange(wireReach: number): void }) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const parsed = draft === null ? wireReach : parseWireReach(draft);
  const commit = (): void => {
    if (draft !== null && parsed !== undefined) onChange(parsed);
    setDraft(null);
  };
  return (
    <div className="field wire-reach-field">
      <label className="field-label" htmlFor={id}>
        Wire reach
      </label>
      <div className="wire-reach-row">
        <input
          ref={inputRef}
          id={id}
          type="text"
          inputMode="decimal"
          maxLength={12}
          spellCheck={false}
          autoComplete="off"
          aria-invalid={parsed === undefined}
          aria-describedby={`${id}-note`}
          value={draft ?? String(wireReach)}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit();
            if (event.key === "Escape" && draft !== null) {
              event.stopPropagation();
              setDraft(null);
            }
          }}
        />
        <span className="unit">tiles</span>
        <button
          type="button"
          className="reset-wire-reach"
          disabled={draft === null && wireReach === DEFAULT_WIRE_REACH}
          title={`Back to the reach of the game, ${DEFAULT_WIRE_REACH} tiles`}
          onClick={() => {
            setDraft(null);
            onChange(DEFAULT_WIRE_REACH);
            // The button is disabled now: the focus goes to the field it reset, and stays in the panel.
            inputRef.current?.focus();
          }}
        >
          Reset to {DEFAULT_WIRE_REACH}
        </button>
      </div>
      {parsed === undefined && (
        <small className="field-error" role="alert">
          {WIRE_REACH_ERROR}
        </small>
      )}
      <p className="muted-note" id={`${id}-note`}>
        {WIRE_REACH_NOTE}
      </p>
      <button type="button" className="disclosure" aria-expanded={detailsOpen} aria-controls={`${id}-details`} onClick={() => setDetailsOpen((open) => !open)}>
        <Icon name="chevron" size={11} />
        {WIRE_REACH_DETAILS_LABEL}
      </button>
      <p className="muted-note" id={`${id}-details`} data-note="wire-reach-details" hidden={!detailsOpen}>
        How far apart two entities may be in the blueprint for a circuit wire between them, from {WIRE_REACH_RANGE.min} to {WIRE_REACH_RANGE.max}. As in the game, the distance is measured between
        the nearest points of the two entities, by the box the game highlights around each, which for most is the tiles it stands on. A wire that spans more is flagged, on the board and in the
        problems list; nothing is refused. {UNLIMITED_WIRE_REACH} means unlimited. In the game the reach is {DEFAULT_WIRE_REACH} tiles. An electric pole has its own reach, as in the game,
        whatever is set here (a small one 7.5 tiles, a big one 32): a wire spans the smaller reach of its two ends, so a wire to a pole can be flagged also with {UNLIMITED_WIRE_REACH}. A wire
        between two poles is measured from center to center.
      </p>
    </div>
  );
}

export function ProjectSettings({ project, catalog, onRename, onWireReachChange, onModuleChange, onEnableUsedModules, close }: ProjectSettingsProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const giveFocusBack = useFocusReturn();
  const [filter, setFilter] = useState("");
  /** The height of the list when the filter began to narrow it. The list keeps it while the filter does, so that the panel does not shrink and grow under the typing. */
  const [fullHeight, setFullHeight] = useState<number>();
  const listed = listedRows(catalog.modules, project.modulesOff);
  const filtered = listed.length >= FILTER_FROM;
  const rows = listOrder(filtered ? filterModules(listed, filter) : listed);
  const offNotice = modulesOffNotice(project.modulesOff, catalog.modules);
  const otherMods = otherModsNote(catalog.otherMods + catalog.modules.length - listed.length);
  const changeFilter = (text: string): void => {
    if (filter === "") setFullHeight(listRef.current?.getBoundingClientRect().height);
    setFilter(text);
  };
  // Closed by a key or by its close button, the panel gives the focus back to the button that opened it.
  const dismiss = useCallback((): void => {
    close();
    giveFocusBack();
  }, [close, giveFocusBack]);

  // The focus goes into the panel as it opens, so that the keys are the panel's from the start and Escape closes it. It goes to
  // the panel itself and to none of its fields: a key typed then must not rename the project.
  useEffect(() => panelRef.current?.focus(), []);

  // A control that goes away under the focus (the button of the notice, the row of a mod with hidden signals only that is switched
  // off) leaves the focus with the page. The next key brings it back to the panel, and Escape closes the panel all the same,
  // before the key means anything to the circuit behind it.
  useEffect(() => {
    const onStrayKey = (event: KeyboardEvent): void => {
      if (document.activeElement !== document.body) return;
      panelRef.current?.focus();
      if (event.key !== "Escape") return;
      event.stopPropagation();
      dismiss();
    };
    document.addEventListener("keydown", onStrayKey, true);
    return () => document.removeEventListener("keydown", onStrayKey, true);
  }, [dismiss]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Element) || panelRef.current?.contains(target) || target.closest("[data-settings-toggle]")) return;
      // A name that is still being typed is committed by leaving its field, as it would be by clicking elsewhere in the panel.
      if (document.activeElement instanceof HTMLElement && panelRef.current?.contains(document.activeElement)) document.activeElement.blur();
      close();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [close]);

  return (
    <div
      ref={panelRef}
      className="project-settings"
      role="dialog"
      aria-label="Project settings"
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        dismiss();
      }}
    >
      <header>
        <span className="eyebrow">Project settings</span>
        <button type="button" className="icon-button" aria-label="Close project settings" onClick={dismiss}>
          <Icon name="close" size={14} />
        </button>
      </header>

      <NameField name={project.name} onRename={onRename} />
      <WireReachField wireReach={project.wireReach} onChange={onWireReachChange} />

      <div className="section-label">
        <span>Signal groups</span>
        <span>Factorio {catalog.gameVersion}</span>
      </div>
      <p className="muted-note">Signals and entities of a group that is switched off stay in the source and are marked with a warning.</p>
      {offNotice !== null && (
        <div className="modules-off" role="status" data-note="modules-off">
          <p>{offNotice}</p>
          <button type="button" className="settings-button" onClick={onEnableUsedModules}>
            Switch {project.modulesOff.length === 1 ? "it" : "them"} on
          </button>
        </div>
      )}
      {filtered && (
        <input
          type="search"
          className="module-filter"
          aria-label="Filter signal groups"
          placeholder={`Filter ${listed.length} groups`}
          maxLength={100}
          spellCheck={false}
          autoComplete="off"
          value={filter}
          onChange={(event) => changeFilter(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Escape" || filter === "") return;
            event.stopPropagation();
            changeFilter("");
          }}
        />
      )}
      <ul ref={listRef} className={filtered ? "module-list scrolling" : "module-list"} aria-label="Signal groups" style={filtered && filter !== "" ? { flexBasis: fullHeight } : undefined}>
        {/* Said in the room of the list, which keeps its height. */}
        {rows.length === 0 && (
          <li className="no-match" data-note="no-match">
            No signal group matches the filter.
          </li>
        )}
        {rows.map((module) => {
          const note = consequence(module, catalog.modules);
          return (
            <li key={module.name} className={module.missing.length > 0 ? "invalid" : undefined} data-module={module.name} data-game={module.game ? "" : undefined}>
              <label>
                <input type="checkbox" checked={module.enabled} disabled={!module.canDisable} onChange={(event) => onModuleChange(module.name, event.target.checked)} />
                <span className="module-title" title={rowHint(module)}>
                  {module.title}
                </span>
                <span className="module-count">{moduleCounts(module)}</span>
              </label>
              {note && <small>{note}</small>}
            </li>
          );
        })}
      </ul>
      {otherMods !== null && (
        <p className="muted-note" data-note="other-mods">
          {otherMods}
        </p>
      )}
      {!project.gameData && (
        <p className="muted-note" data-note="mods-hint">
          {MODS_HINT}
        </p>
      )}
      {catalog.unknownModules.length > 0 && <p className="muted-note">Not part of this catalog, kept in the project file: {catalog.unknownModules.join(", ")}.</p>}
      {project.madeWith !== null && (
        <p className="muted-note" data-note="made-with">
          Made with {project.madeWith}.
        </p>
      )}
      {project.modsNotice !== null && (
        <p className="muted-note warning" data-note="mods-notice">
          {project.modsNotice}
        </p>
      )}
    </div>
  );
}

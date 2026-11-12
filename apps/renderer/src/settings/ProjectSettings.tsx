// Project settings panel: the project name and the standard modules, shown as the signal groups they contribute.
// Presentational; enabling and disabling (with dependencies) is decided by the session.
import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "../icons/Icon.tsx";
import type { CatalogView, ModuleView, ProjectView } from "../workbench/controller.ts";

export interface ProjectSettingsProps {
  readonly project: ProjectView;
  readonly catalog: CatalogView;
  onRename(name: string): void;
  onModuleChange(name: string, enabled: boolean): void;
  close(): void;
}

function titles(names: readonly string[], modules: readonly ModuleView[]): string {
  return names.map((name) => modules.find((module) => module.name === name)?.title ?? name).join(", ");
}

/** What switching this module does to others, or why it cannot be switched. */
function consequence(module: ModuleView, modules: readonly ModuleView[]): string | null {
  if (module.missing.length > 0) return `Needs ${titles(module.missing, modules)}, which is switched off`;
  if (!module.canDisable) return "Always enabled";
  if (module.enabled && module.disables.length > 0) return `Switching off also switches off ${titles(module.disables, modules)}`;
  if (!module.enabled && module.enables.length > 0) return `Switching on also switches on ${titles(module.enables, modules)}`;
  return null;
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

export function ProjectSettings({ project, catalog, onRename, onModuleChange, close }: ProjectSettingsProps) {
  const panelRef = useRef<HTMLDivElement>(null);

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
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        close();
      }}
    >
      <header>
        <span className="eyebrow">Project settings</span>
        <button type="button" className="icon-button" aria-label="Close project settings" onClick={close}>
          <Icon name="close" size={14} />
        </button>
      </header>

      <NameField name={project.name} onRename={onRename} />

      <div className="section-label">
        <span>Signal groups</span>
        <span>Factorio {catalog.gameVersion}</span>
      </div>
      <p className="muted-note">Signals of a group that is switched off stay in the source and are marked with a warning.</p>
      <ul className="module-list">
        {catalog.modules.map((module) => {
          const note = consequence(module, catalog.modules);
          return (
            <li key={module.name} className={module.missing.length > 0 ? "invalid" : undefined} data-module={module.name}>
              <label>
                <input type="checkbox" checked={module.enabled} disabled={!module.canDisable} onChange={(event) => onModuleChange(module.name, event.target.checked)} />
                <span className="module-title">{module.title}</span>
                <span className="module-count">{module.signalCount} signals</span>
              </label>
              {note && <small>{note}</small>}
            </li>
          );
        })}
      </ul>
      {catalog.unknownModules.length > 0 && <p className="muted-note">Not part of this catalog, kept in the project file: {catalog.unknownModules.join(", ")}.</p>}
    </div>
  );
}

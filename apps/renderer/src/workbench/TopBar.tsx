// Title bar (brand, mode switch) and project bar (project name, save state, document actions).
import { Icon, type IconName } from "../icons/Icon.tsx";
import { withShortcut } from "../shortcuts/shortcuts.ts";
import { WORKBENCH_MODES, type ProjectView, type WorkbenchMode } from "./controller.ts";

export interface TopBarProps {
  readonly project: ProjectView;
  readonly mode: WorkbenchMode;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /** False when no canvas is shown, so there is nothing to fit. */
  readonly canFit: boolean;
  readonly settingsOpen: boolean;
  onModeChange(mode: WorkbenchMode): void;
  onUndo(): void;
  onRedo(): void;
  onFit(): void;
  onToggleSettings(): void;
  onSave(): void;
}

const MODES: Readonly<Record<WorkbenchMode, { readonly label: string; readonly icon: IconName }>> = {
  circuit: { label: "Circuit", icon: "grid" },
  source: { label: "Source", icon: "code" },
  split: { label: "Split", icon: "split" },
};

export function TopBar({ project, mode, canUndo, canRedo, canFit, settingsOpen, onModeChange, onUndo, onRedo, onFit, onToggleSettings, onSave }: TopBarProps) {
  return (
    <>
      <header className="titlebar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <strong className="brand-name">
            face<span>.</span>
          </strong>
          <span className="brand-divider" />
          <span className="brand-caption">FACTORIO CIRCUIT EDITOR</span>
        </div>
        <nav className="mode-switch" aria-label="Workbench mode">
          {WORKBENCH_MODES.map((candidate) => (
            <button key={candidate} type="button" aria-pressed={mode === candidate} onClick={() => onModeChange(candidate)}>
              <Icon name={MODES[candidate].icon} size={16} />
              {MODES[candidate].label}
            </button>
          ))}
        </nav>
        <span className="titlebar-aside" />
      </header>

      <div className="projectbar">
        <div className="project-title">
          <span className="project-symbol">
            <Icon name="bolt" size={20} />
          </span>
          <div style={{ minWidth: 0 }}>
            <h1 data-testid="project-name">{project.name}</h1>
            <div className="project-meta">
              <span className="path" title={project.path ?? undefined}>
                {project.path ?? "Not saved yet"}
              </span>
              <span className="meta-dot" />
              <span className={`save-state${project.dirty ? " unsaved" : ""}`} data-testid="save-state" role="status">
                {project.dirty ? "Unsaved changes" : project.path ? "All changes saved" : "No changes"}
              </span>
            </div>
          </div>
        </div>
        <div className="project-actions">
          <button type="button" className="icon-button" title={withShortcut("Undo", "edit.undo")} aria-label="Undo" disabled={!canUndo} onClick={onUndo}>
            <Icon name="undo" />
          </button>
          <button type="button" className="icon-button" title={withShortcut("Redo", "edit.redo")} aria-label="Redo" disabled={!canRedo} onClick={onRedo}>
            <Icon name="redo" />
          </button>
          <span className="action-divider" />
          <button type="button" className="labelled-button" title={withShortcut("Fit the circuit into view", "view.fit")} disabled={!canFit} onClick={onFit}>
            <Icon name="fit" size={16} />
            Fit
          </button>
          <button type="button" className="labelled-button" data-settings-toggle title="Project name and signal groups" aria-expanded={settingsOpen} onClick={onToggleSettings}>
            <Icon name="settings" size={16} />
            Settings
          </button>
          <span className="action-divider" />
          <button type="button" className={`save-button${project.dirty ? " unsaved" : ""}`} title={withShortcut("Save", "file.save")} onClick={onSave}>
            <Icon name="save" size={16} />
            Save
          </button>
        </div>
      </div>
    </>
  );
}

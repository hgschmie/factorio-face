// The settings of the application on this machine, as opposed to those of a project: where the game is installed, whose icon
// images the app reads. A modal dialog. Presentational: the folder is chosen in a native dialog of the main process.
import { Modal } from "../dialog/Modal.tsx";
import { appSettingsView } from "./appSettings.ts";
import type { AppSettingsController } from "./useAppSettings.ts";

export interface AppSettingsProps {
  readonly settings: AppSettingsController;
  close(): void;
}

export function AppSettings({ settings, close }: AppSettingsProps) {
  const { state, busy, error } = settings;
  const view = state && appSettingsView(state);
  return (
    <Modal title="Application settings" closeLabel="Close application settings" className="app-settings" close={close}>
      <section className="game-folder" aria-label="Factorio installation">
        <h3 className="section-label">Factorio installation</h3>
        {view ? (
          <>
            <div className={`game-folder-path${view.found ? "" : " none"}`} data-source={state.source}>
              <span className="path">{view.folder}</span>
              <small>{view.origin}</small>
            </div>
            {view.problem !== null && (
              <p className="settings-message warning" role="alert" data-message="problem">
                {view.problem}. The folder stays chosen; choose another one or reset to auto-detect.
              </p>
            )}
            {(view.version !== null || view.dataDirectory !== null) && (
              <dl className="game-facts">
                {view.version !== null && (
                  <div data-fact="version" data-level={view.version.level}>
                    <dt>Version</dt>
                    <dd>
                      {view.version.text}
                      {view.version.note !== null && <small className={view.version.level === "warning" ? "warning" : undefined}>{view.version.note}</small>}
                    </dd>
                  </div>
                )}
                {view.dataDirectory !== null && (
                  <div data-fact="data">
                    <dt>Icons from</dt>
                    <dd className="path">{view.dataDirectory}</dd>
                  </div>
                )}
                <div data-fact="modules">
                  <dt>Modules</dt>
                  <dd>
                    {view.modulesFound.join(", ")}
                    {view.modulesMissing.length > 0 && <small data-missing>Not installed: {view.modulesMissing.join(", ")}. Their icons are shown as placeholders.</small>}
                  </dd>
                </div>
              </dl>
            )}
          </>
        ) : (
          <p className="muted-note">Looking for the game...</p>
        )}
        {error !== null && (
          <p className="settings-message error" role="alert" data-message="error">
            {error}
          </p>
        )}
        <div className="settings-actions">
          <button type="button" className="settings-button" disabled={busy} onClick={settings.chooseGameFolder}>
            Choose...
          </button>
          <button type="button" className="settings-button" disabled={busy || !view?.canReset} onClick={settings.resetGameFolder}>
            Reset to auto-detect
          </button>
        </div>
        <p className="muted-note">The app only reads icon images from this folder. It does not start the game and writes nothing there.</p>
      </section>
    </Modal>
  );
}

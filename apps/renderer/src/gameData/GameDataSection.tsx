// The "Game data" section of the application settings: where the entity and signal data comes from, and the action that reads
// it from the user's installed game. Presentational: the game is run by the main process, which asks the user itself first.
// Everything the game or a mod wrote (its log, a failure, names) is rendered as text.
import { useEffect, useRef, useState } from "react";
import { CONFIRMING_NOTICE, formatElapsed, gameDataView } from "./gameDataView.ts";
import type { GameDataController } from "./useGameData.ts";

export interface GameDataSectionProps {
  readonly gameData: GameDataController;
}

/** The time since `startedAt`, counted here once a second. */
function Elapsed({ startedAt }: { readonly startedAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, []);
  return <span className="elapsed">{formatElapsed(now - startedAt)}</span>;
}

export function GameDataSection({ gameData }: GameDataSectionProps) {
  const { status, requesting, error } = gameData;
  const view = status && gameDataView(status, requesting);
  const sectionRef = useRef<HTMLElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const readRef = useRef<HTMLButtonElement>(null);
  const phase = view?.phase;

  // Whether the game changed since the data was read is looked at whenever the section comes on show.
  const refreshRef = useRef(gameData.refresh);
  refreshRef.current = gameData.refresh;
  useEffect(() => refreshRef.current(), []);

  // A button that is disabled or goes away under the focus leaves the keys with nothing: the button that takes its place gets the focus.
  useEffect(() => {
    const active = document.activeElement;
    const lost = active === null || active === document.body || (active instanceof HTMLButtonElement && active.disabled && sectionRef.current?.contains(active));
    if (!lost || !sectionRef.current?.closest(".modal")) return;
    if (phase === "running") cancelRef.current?.focus();
    else if (phase === "done" || phase === "failed" || phase === "cancelled") readRef.current?.focus();
  }, [phase]);

  return (
    <section ref={sectionRef} className="game-data" aria-label="Game data">
      <h3 className="section-label">Game data</h3>
      {view ? (
        <>
          <div className="game-data-source" data-source={view.kind}>
            <span>{view.source}</span>
            <small>{view.detail}</small>
          </div>
          {view.stale !== null && (
            <p className="settings-message" data-message="stale">
              {view.stale}
            </p>
          )}
          {view.problem !== null && (
            <p className="settings-message warning" role="alert" data-message="data-problem">
              {view.problem}
            </p>
          )}
          {view.pending !== null && (
            <p className="settings-message" data-message="pending">
              Not in use yet: {view.pending}
            </p>
          )}
          {view.phase === "confirming" && (
            <p className="game-data-progress" role="status" data-message="confirming">
              {CONFIRMING_NOTICE}
            </p>
          )}
          {view.progress !== null && (
            <div className="game-data-progress" role="status" data-message="progress" data-step={view.progress.index}>
              <progress max={view.progress.count} value={view.progress.index - 1} aria-label="Reading the game" />
              <span className="step">{view.progress.text}</span>
              <Elapsed startedAt={view.progress.startedAt} />
            </div>
          )}
          {view.failure !== null && (
            <>
              <p className="settings-message error" role="alert" data-message="read-failed">
                {view.failure.message}
              </p>
              {view.failure.log !== "" && (
                <pre className="game-log" tabIndex={0} aria-label="The end of the game's log">
                  {view.failure.log}
                </pre>
              )}
            </>
          )}
          {view.outcome !== null && (
            <p className="muted-note" role="status" data-message="outcome">
              {view.outcome}
            </p>
          )}
          {view.warnings.length > 0 && (
            <ul className="settings-message game-data-warnings" data-message="warnings">
              {view.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <p className="muted-note">Looking at the game data...</p>
      )}
      {error !== null && (
        <p className="settings-message error" role="alert" data-message="data-error">
          {error}
        </p>
      )}
      <div className="settings-actions">
        {view?.phase === "running" ? (
          <button ref={cancelRef} type="button" className="settings-button" onClick={gameData.cancel}>
            Cancel
          </button>
        ) : (
          <button ref={readRef} type="button" className="settings-button" disabled={!view?.canRead} onClick={gameData.read}>
            {view?.kind === "game" ? "Read the game again..." : "Read from the game..."}
          </button>
        )}
        <button type="button" className="settings-button" disabled={!view?.canDiscard} onClick={gameData.discard}>
          Use built-in data
        </button>
        {view?.pending != null && (
          <button type="button" className="settings-button" disabled={!view.canReload} onClick={gameData.reload}>
            Reload the window
          </button>
        )}
      </div>
      {view != null && view.unavailable !== null && (
        <p className="muted-note" data-message="unavailable">
          The game cannot be read: {view.unavailable}
        </p>
      )}
      <p className="muted-note">
        Reading runs your installed game without a window, to list the entities and signals it has with your mods. The app asks before it starts the game and never starts it by itself. Icons
        of mods are not shown yet: their entities and signals appear with their names.
      </p>
    </section>
  );
}

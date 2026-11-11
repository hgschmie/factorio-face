// Bottom dock: playback controls, signal traces, tick counter. Presentational; all data arrives as plain props.
import { Icon } from "../icons/Icon.tsx";
import type { SignalTrace, SimulationView } from "../workbench/controller.ts";
import { sparkline } from "./sparkline.ts";

export interface SimulationDockProps {
  readonly simulation: SimulationView;
  onRun(): void;
  onPause(): void;
  onStep(): void;
  onReset(): void;
  onSpeedChange(ticksPerSecond: number): void;
}

const TRACE_WIDTH = 500;
const TRACE_HEIGHT = 26;

function TraceRow({ trace, index, capacity }: { readonly trace: SignalTrace; readonly index: number; readonly capacity: number }) {
  const geometry = sparkline(trace.values, capacity, TRACE_WIDTH, TRACE_HEIGHT);
  return (
    <tr className={`trace trace-${index % 3}`}>
      <th scope="row">
        <span className="trace-dot" />
        {trace.label}
      </th>
      <td className="trace-plot">
        <svg viewBox={`0 0 ${TRACE_WIDTH} ${TRACE_HEIGHT}`} preserveAspectRatio="none" role="img" aria-label={`${trace.label} history`}>
          <path className="trace-baseline" d={`M 0 ${geometry.baseline} H ${TRACE_WIDTH}`} />
          <path className="trace-path" d={geometry.path} />
        </svg>
      </td>
      <td className="trace-value">{trace.current}</td>
    </tr>
  );
}

export function SimulationDock({ simulation, onRun, onPause, onStep, onReset, onSpeedChange }: SimulationDockProps) {
  const { running, available, tick, traces } = simulation;
  return (
    <section className="simulation" aria-label="Simulation">
      <div className="simulation-controls">
        <div className="simulation-title">
          <Icon name="bolt" size={17} />
          <span>SIMULATION</span>
          <span className={`live-indicator${running ? " running" : ""}`}>{running ? "RUNNING" : "PAUSED"}</span>
        </div>
        <div className="playback">
          <button type="button" className="run-button" disabled={!available} onClick={running ? onPause : onRun}>
            <Icon name={running ? "pause" : "play"} size={15} />
            {running ? "Pause" : "Run"}
          </button>
          <button type="button" disabled={!available || running} onClick={onStep} title="Advance one tick">
            <Icon name="step" size={16} />
            Step
          </button>
          <button type="button" className="icon-button" disabled={!available} onClick={onReset} title="Reset simulation" aria-label="Reset simulation">
            <Icon name="reset" size={16} />
          </button>
        </div>
        <div className="speed">
          <label htmlFor="simulation-speed">SPEED</label>
          <select id="simulation-speed" value={simulation.speed} onChange={(event) => onSpeedChange(Number(event.target.value))}>
            {simulation.speedOptions.map((speed) => (
              <option key={speed} value={speed}>
                {speed} {speed === 1 ? "tick" : "ticks"} / sec
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="signal-history">
        <div className="history-title">
          <span>
            SIGNAL HISTORY
            {simulation.notice && <small>{simulation.notice}</small>}
          </span>
          <span>LAST {simulation.historyLength} TICKS</span>
        </div>
        {traces.length === 0 ? (
          <p className="muted-note">Nothing to trace yet. Add a component to start watching signals.</p>
        ) : (
          <table className="traces">
            <tbody>
              {traces.map((trace, index) => (
                <TraceRow key={trace.id} trace={trace} index={index} capacity={simulation.historyLength} />
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="tick-display">
        <span>CURRENT TICK</span>
        <strong data-testid="tick-counter">{String(tick).padStart(4, "0")}</strong>
        <small>{tick === 0 ? "Ready when you are" : running ? "Following the signals" : "One step at a time"}</small>
      </div>
    </section>
  );
}

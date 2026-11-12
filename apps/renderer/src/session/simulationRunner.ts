// Runs the simulation engine for the session: compiles valid circuits, keeps the running state across edits that do not
// change behaviour, steps on a timer and publishes a view for the dock and the cards. It knows nothing about the document.
import type { Circuit, EntityId } from "@face/model";
import { compile, createSimulation, History, semanticFingerprint, type Simulation, type SimulationEnvironment, type TickSnapshot } from "@face/simulation";
import type { EntityStatus, SignalTrace, SimulationView } from "../workbench/controller.ts";
import { buildTraces, StatusCache, tracedEntities } from "./simulationView.ts";

export const SPEED_OPTIONS: readonly number[] = [1, 2, 5, 10, 30, 60];
export const DEFAULT_SPEED = 2;
/** Retained ticks: the bound of the history memory and the width of the dock's traces. */
export const HISTORY_TICKS = 120;

export interface Scheduler {
  /** Calls `callback` every `milliseconds`; returns the function that stops it. */
  every(milliseconds: number, callback: () => void): () => void;
}

const TIMER_SCHEDULER: Scheduler = {
  every: (milliseconds, callback) => {
    const timer = setInterval(callback, milliseconds);
    return () => clearInterval(timer);
  },
};

const NO_STATUS: ReadonlyMap<EntityId, EntityStatus> = new Map();
const NO_TRACES: readonly SignalTrace[] = [];

export class SimulationRunner {
  private environment: SimulationEnvironment;
  private circuit: Circuit | undefined;
  private simulation: Simulation | undefined;
  private readonly history = new History({ capacity: HISTORY_TICKS });
  private readonly statuses = new StatusCache();
  private selection: readonly EntityId[] = [];
  /** What the user asked for; the timer only runs while the circuit is not blocked. */
  private wantsRun = false;
  private speedValue = DEFAULT_SPEED;
  private blockedReason: string | undefined = "No circuit yet";
  private stopTimer: (() => void) | undefined;
  private cachedView: SimulationView | undefined;

  constructor(environment: SimulationEnvironment, private readonly changed: () => void, private readonly scheduler: Scheduler = TIMER_SCHEDULER) {
    this.environment = environment;
  }

  get tick(): number {
    return this.simulation?.tick ?? 0;
  }

  get running(): boolean {
    return this.stopTimer !== undefined;
  }

  /** The state at the current tick, for tests and probes. */
  snapshot(): TickSnapshot | undefined {
    return this.simulation?.snapshot();
  }

  /**
   * A new valid circuit. The running state (tick, combinator outputs, history) is kept when the simulation-relevant content
   * is unchanged: moves, renames, comments. Any other change compiles again and starts at tick 0.
   */
  setCircuit(circuit: Circuit): void {
    const wasBlocked = this.blockedReason !== undefined;
    this.blockedReason = undefined;
    if (circuit !== this.circuit || !this.simulation) {
      this.circuit = circuit;
      if (!this.simulation || semanticFingerprint(circuit) !== this.simulation.compiled.fingerprint) this.rebuild();
    } else if (!wasBlocked) return;
    this.syncTimer();
    this.invalidate();
  }

  /** The environment changed (other modules): results may differ, so the simulation starts over. */
  setEnvironment(environment: SimulationEnvironment): void {
    this.environment = environment;
    if (this.circuit && this.simulation) this.rebuild();
    this.invalidate();
  }

  /** The source has errors: nothing advances until a valid circuit arrives. The last state stays visible. */
  block(reason: string): void {
    if (this.blockedReason === reason) return;
    this.blockedReason = reason;
    this.syncTimer();
    this.invalidate();
  }

  setSelection(selection: readonly EntityId[]): void {
    if (selection === this.selection) return;
    this.selection = selection;
    this.invalidate();
  }

  run(): void {
    if (this.blockedReason !== undefined || this.wantsRun) return;
    this.wantsRun = true;
    this.syncTimer();
    this.invalidate();
  }

  pause(): void {
    if (!this.wantsRun) return;
    this.wantsRun = false;
    this.syncTimer();
    this.invalidate();
  }

  step(count = 1): void {
    if (this.blockedReason !== undefined || !this.simulation) return;
    this.simulation.step(count);
    this.history.record(this.simulation.snapshot());
    this.invalidate();
  }

  reset(): void {
    this.wantsRun = false;
    this.syncTimer();
    if (this.simulation) {
      this.simulation.reset();
      this.history.clear();
      this.history.record(this.simulation.snapshot());
    }
    this.invalidate();
  }

  setSpeed(ticksPerSecond: number): void {
    if (!SPEED_OPTIONS.includes(ticksPerSecond) || ticksPerSecond === this.speedValue) return;
    this.speedValue = ticksPerSecond;
    if (this.stopTimer) {
      this.stopTimer();
      this.stopTimer = undefined;
    }
    this.syncTimer();
    this.invalidate();
  }

  /** Forgets the circuit (a project is being replaced). */
  clear(): void {
    this.wantsRun = false;
    this.circuit = undefined;
    this.simulation = undefined;
    this.history.clear();
    this.blockedReason = "No circuit yet";
    this.syncTimer();
    this.invalidate();
  }

  dispose(): void {
    this.stopTimer?.();
    this.stopTimer = undefined;
  }

  view(): SimulationView {
    this.cachedView ??= this.buildView();
    return this.cachedView;
  }

  private rebuild(): void {
    this.simulation = createSimulation(compile(this.circuit!, this.environment), { environment: this.environment });
    this.history.clear();
    this.history.record(this.simulation.snapshot());
  }

  private syncTimer(): void {
    const shouldRun = this.wantsRun && this.blockedReason === undefined && this.simulation !== undefined;
    if (shouldRun && !this.stopTimer) this.stopTimer = this.scheduler.every(1000 / this.speedValue, () => this.step());
    else if (!shouldRun && this.stopTimer) {
      this.stopTimer();
      this.stopTimer = undefined;
    }
  }

  private invalidate(): void {
    this.cachedView = undefined;
    this.changed();
  }

  private notice(): string | undefined {
    if (this.blockedReason !== undefined) return this.blockedReason;
    if (!this.simulation) return undefined;
    const notes = [...this.simulation.compiled.notes, ...this.simulation.runtimeNotes()].filter((note) => note.severity !== "info");
    const first = notes[0];
    return first ? (notes.length > 1 ? `${first.message} (+${notes.length - 1} more)` : first.message) : undefined;
  }

  private buildView(): SimulationView {
    const latest = this.history.latest;
    return {
      available: this.blockedReason === undefined && this.simulation !== undefined,
      running: this.running,
      tick: this.tick,
      speed: this.speedValue,
      speedOptions: SPEED_OPTIONS,
      historyLength: HISTORY_TICKS,
      traces: this.circuit && latest ? buildTraces(this.history, tracedEntities(this.circuit, this.selection)) : NO_TRACES,
      entityStatus: latest ? this.statuses.of(latest) : NO_STATUS,
      notice: this.notice(),
    };
  }
}

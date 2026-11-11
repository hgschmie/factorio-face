// Public data types. Everything here is plain data (structured-cloneable), so compiled circuits and snapshots can cross a worker boundary.

import type { Entity, EntityId, EntityKind, RgbColor, SignalId, TerminalRef, TerminalSide, WireColor } from "@face/model";

export type NoteSeverity = "info" | "warning" | "error";

export type NoteCode =
  | "duplicate-entity"
  | "invalid-wire"
  | "unconfigured"
  | "invalid-wildcard"
  | "invalid-filter"
  | "unknown-quality"
  | "random-not-reproducible"
  | "missing-stack-size"
  | "missing-rocket-capacity";

/**
 * A finding about a circuit. Static notes come from `compile`, runtime notes from a running simulation.
 * Severity "error" on an entity means the entity is invalid and emits nothing (a lamp stays dark); "warning" means a part
 * of the configuration is ignored; "info" marks unconfigured entities and behavior that cannot match the game exactly.
 */
export interface SimulationNote {
  readonly severity: NoteSeverity;
  readonly code: NoteCode;
  readonly message: string;
  readonly entity?: EntityId;
  /** Signal key the note is about, if any. */
  readonly signal?: string;
}

/** `<color>:<smallest terminal key of the network>`, e.g. "red:e1.out". Independent of entity order and of layout. */
export type NetworkId = string;

export interface CompiledNetwork {
  readonly id: NetworkId;
  readonly color: WireColor;
  /** Member terminals, sorted by terminal key. */
  readonly terminals: readonly TerminalRef[];
  /** Entities whose output terminal is a member, sorted by id. */
  readonly emitters: readonly EntityId[];
  /** Entities whose input terminal is a member, sorted by id. */
  readonly readers: readonly EntityId[];
}

export interface TerminalNetworks {
  readonly red?: NetworkId;
  readonly green?: NetworkId;
}

export interface CompiledCircuit {
  /** `semanticFingerprint` of the source circuit. */
  readonly fingerprint: string;
  /** Entities with unique ids, sorted by id. */
  readonly entities: readonly Entity[];
  /** Sorted by id. */
  readonly networks: readonly CompiledNetwork[];
  /** Terminal key -> network per color. Terminals without wires are absent. */
  readonly terminals: Readonly<Record<string, TerminalNetworks>>;
  readonly notes: readonly SimulationNote[];
}

export interface SignalValue {
  readonly signal: SignalId;
  /** `signalKey(signal)`. */
  readonly key: string;
  /** Non-zero int32. */
  readonly value: number;
}

/** Sorted by the environment's signal order. Never contains zero values. */
export type SignalList = readonly SignalValue[];

export interface NetworkSnapshot {
  readonly id: NetworkId;
  readonly color: WireColor;
  readonly terminals: readonly TerminalRef[];
  readonly signals: SignalList;
}

export interface LampState {
  readonly lit: boolean;
  /** Color shown while lit, 0..255 per channel; absent means the default white light. */
  readonly color?: RgbColor;
}

export interface EntityInput {
  readonly red: SignalList;
  readonly green: SignalList;
  /** Wrapping sum of red and green. */
  readonly combined: SignalList;
}

export interface EntitySnapshot {
  readonly kind: EntityKind;
  /** Content of the networks on the input terminal. Absent for constant combinators. */
  readonly input?: EntityInput;
  /** Signals the entity emits on its output terminal at this tick. Absent for lamps. */
  readonly output?: SignalList;
  /** Lamps only. */
  readonly lamp?: LampState;
}

export interface SnapshotTotals {
  readonly entities: number;
  readonly networks: number;
  /** Signal entries summed over all networks. */
  readonly signals: number;
  /** Entities with a non-empty output. */
  readonly emitting: number;
  readonly lampsLit: number;
}

/** Immutable (frozen) state at one tick. Parts that did not change since the previous snapshot are shared by reference. */
export interface TickSnapshot {
  readonly tick: number;
  /** Same order as `CompiledCircuit.networks`. */
  readonly networks: readonly NetworkSnapshot[];
  readonly entities: Readonly<Record<EntityId, EntitySnapshot>>;
  readonly totals: SnapshotTotals;
}

/**
 * Addresses a signal source for probes and traces. A network is addressed by id. An input terminal yields what the entity reads
 * (one color, or the red + green sum without `color`); an output terminal yields what the entity emits (`color` is ignored).
 */
export type SignalTarget =
  | { readonly type: "network"; readonly id: NetworkId }
  | { readonly type: "terminal"; readonly entity: EntityId; readonly side: TerminalSide; readonly color?: WireColor };

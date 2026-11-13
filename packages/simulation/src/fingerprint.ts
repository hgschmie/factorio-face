// Identity of the simulation-relevant content of a circuit. Fields are listed explicitly per entity kind: a new model field
// takes part only once it is added here, which is the point where its effect on the simulation has to be decided.

import { signalKey, wireKey, type Circuit, type DeciderOutput, type Entity, type Operand, type SignalId } from "@face/model";

type Json = string | number | boolean | null | readonly Json[];

const key = (id: SignalId | undefined): Json => (id ? signalKey(id) : null);
const networks = (n: { readonly red: boolean; readonly green: boolean }): Json => (n.red ? 1 : 0) + (n.green ? 2 : 0);
const operand = (o: Operand): Json => (o.type === "constant" ? [o.value] : [key(o.signal), networks(o.networks)]);
const output = (o: DeciderOutput): Json => [key(o.signal), o.copyCountFromInput, o.constant, networks(o.networks)];

function canonicalEntity(e: Entity): Json {
  switch (e.kind) {
    case "constant":
      // Section group names have no effect on the emitted signals.
      return [e.id, e.kind, e.enabled, e.sections.map((s) => [s.active, s.multiplier, s.filters.map((f) => [key(f.signal), f.count])])];
    case "arithmetic":
      return [e.id, e.kind, operand(e.first), e.operation, operand(e.second), key(e.output)];
    case "decider":
      return [
        e.id,
        e.kind,
        // The join of the first condition is ignored by the game.
        e.conditions.map((c, i) => [i === 0 ? "or" : c.join, key(c.first), networks(c.firstNetworks), c.comparator, operand(c.second)]),
        e.outputs.map(output),
        e.elseOutputs.map(output),
      ];
    case "selector":
      return [e.id, e.kind, selectorMode(e.mode)];
    case "lamp": {
      const c = e.condition;
      return [
        e.id,
        e.kind,
        c ? [key(c.first), c.comparator, c.second.type === "constant" ? [c.second.value] : [key(c.second.signal)]] : null,
        networks(e.inputNetworks),
        e.alwaysOn,
        e.useColors,
        e.colorMode,
        key(e.redSignal),
        key(e.greenSignal),
        key(e.blueSignal),
        key(e.rgbSignal),
        e.color ? [e.color.r, e.color.g, e.color.b] : null,
      ];
    }
    case "pole":
      // The prototype decides the size and the wire reach, neither of which the simulation knows.
      return [e.id, e.kind];
    case "speaker": {
      const c = e.condition;
      // Playback mode, polyphony, stop-playing-sounds and the look of the alert do not change what a snapshot reports.
      return [
        e.id,
        e.kind,
        c ? [key(c.first), c.comparator, c.second.type === "constant" ? [c.second.value] : [key(c.second.signal)]] : null,
        key(e.pitchSignal),
        e.instrument ?? null,
        e.note ?? null,
        e.volume,
        key(e.volumeSignal),
        e.showAlert,
      ];
    }
  }
}

function selectorMode(m: Extract<Entity, { kind: "selector" }>["mode"]): Json {
  switch (m.operation) {
    case "select":
      return [m.operation, m.max, operand(m.index), m.indexComparator];
    case "count":
      return [m.operation, key(m.output)];
    case "random":
      return [m.operation, m.interval];
    case "stack-size":
    case "rocket-capacity":
      return [m.operation];
    case "quality-filter":
      return [m.operation, m.comparator ?? null, m.quality ?? null];
    case "quality-select":
      return [m.operation, m.highest];
    case "quality-transfer":
      return [m.operation, m.source.type === "quality" ? [m.source.quality] : [key(m.source.signal), 0], key(m.destination)];
    case "time":
      return [m.operation, key(m.dayLength), key(m.dayTick), key(m.gameTick)];
  }
}

/** Exact canonical text of the simulation-relevant content: entities by id (no name, position, placement, description), wires by key. */
export function semanticCanonicalForm(circuit: Circuit): string {
  const entities = [...circuit.entities].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map(canonicalEntity);
  const wires = [...new Set(circuit.wires.map(wireKey))].sort();
  return JSON.stringify([entities, wires]);
}

/** cyrb128 (public domain): four 32-bit lanes over UTF-16 code units. */
function hash128(text: string): string {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < text.length; i++) {
    const k = text.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [h1 ^ h2 ^ h3 ^ h4, h2 ^ h1, h3 ^ h1, h4 ^ h1].map((h) => (h >>> 0).toString(16).padStart(8, "0")).join("");
}

/**
 * Stable string that changes only when simulation-relevant content changes: a 128-bit hash of `semanticCanonicalForm`,
 * prefixed with a format version. Layout-only edits, renames and descriptions keep it.
 */
export function semanticFingerprint(circuit: Circuit): string {
  return `s1-${hash128(semanticCanonicalForm(circuit))}`;
}

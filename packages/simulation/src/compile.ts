// Topology: one network per connected set of same-colored terminals, found with union-find. Red and green never mix.

import { WIRE_COLORS, hasTerminal, terminalKey, type Circuit, type Entity, type TerminalRef, type WireColor } from "@face/model";
import { defaultEnvironment, type SimulationEnvironment } from "./environment.ts";
import { semanticFingerprint } from "./fingerprint.ts";
import type { CompiledCircuit, CompiledNetwork, SimulationNote, TerminalNetworks } from "./types.ts";
import { validateEntity } from "./validate.ts";

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function find(parent: Int32Array, i: number): number {
  let root = i;
  while (parent[root] !== root) root = parent[root]!;
  while (parent[i] !== root) {
    const next = parent[i]!;
    parent[i] = root;
    i = next;
  }
  return root;
}

/**
 * Compiles a circuit into indexed networks and static notes. Never throws: invalid wires are dropped and invalid entities are
 * silenced, each with a note. The result is plain data; pass the same environment to `createSimulation`.
 */
export function compile(circuit: Circuit, env: SimulationEnvironment = defaultEnvironment): CompiledCircuit {
  const notes: SimulationNote[] = [];
  const byId = new Map<string, Entity>();
  for (const entity of circuit.entities) {
    if (byId.has(entity.id)) notes.push({ severity: "error", code: "duplicate-entity", message: `Duplicate entity id "${entity.id}"; the later entity is ignored.`, entity: entity.id });
    else byId.set(entity.id, entity);
  }
  const entities = [...byId.values()].sort((a, b) => compareText(a.id, b.id));
  const index = new Map(entities.map((entity, i) => [entity.id, i]));
  for (const entity of entities) notes.push(...validateEntity(entity, env));

  // Terminal index: entity index * 2, plus 1 for the output side.
  const slot = (t: TerminalRef): number | undefined => {
    const i = index.get(t.entity);
    return i === undefined || !hasTerminal(entities[i]!.kind, t.side) ? undefined : i * 2 + (t.side === "out" ? 1 : 0);
  };
  const terminalAt = (n: number): TerminalRef => ({ entity: entities[n >> 1]!.id, side: n & 1 ? "out" : "in" });

  const parents = {} as Record<WireColor, Int32Array>;
  const wired = {} as Record<WireColor, Uint8Array>;
  for (const color of WIRE_COLORS) {
    parents[color] = Int32Array.from({ length: entities.length * 2 }, (_, i) => i);
    wired[color] = new Uint8Array(entities.length * 2);
  }
  for (const wire of circuit.wires) {
    const a = slot(wire.a);
    const b = slot(wire.b);
    const parent = parents[wire.color];
    if (a === undefined || b === undefined || a === b || !parent) {
      const reason = !parent ? "unknown color" : a === b && a !== undefined ? "both ends are the same terminal" : "unknown entity or terminal";
      notes.push({ severity: "warning", code: "invalid-wire", message: `Wire ${wire.color} ${terminalKey(wire.a)} - ${terminalKey(wire.b)} is ignored: ${reason}.` });
      continue;
    }
    parent[find(parent, a)] = find(parent, b);
    wired[wire.color][a] = wired[wire.color][b] = 1;
  }

  const networks: CompiledNetwork[] = [];
  for (const color of WIRE_COLORS) {
    const members = new Map<number, TerminalRef[]>();
    for (let n = 0; n < entities.length * 2; n++) {
      if (!wired[color][n]) continue;
      const root = find(parents[color], n);
      const list = members.get(root);
      if (list) list.push(terminalAt(n));
      else members.set(root, [terminalAt(n)]);
    }
    for (const list of members.values()) {
      const terminals = list.sort((a, b) => compareText(terminalKey(a), terminalKey(b)));
      const side = (s: TerminalRef["side"]): string[] => terminals.filter((t) => t.side === s).map((t) => t.entity);
      networks.push({ id: `${color}:${terminalKey(terminals[0]!)}`, color, terminals, emitters: side("out"), readers: side("in") });
    }
  }
  networks.sort((a, b) => compareText(a.id, b.id));

  const terminals: Record<string, TerminalNetworks> = {};
  for (const network of networks) {
    for (const terminal of network.terminals) {
      const key = terminalKey(terminal);
      terminals[key] = { ...terminals[key], [network.color]: network.id };
    }
  }
  return { fingerprint: semanticFingerprint(circuit), entities, networks, terminals, notes };
}

/** Network on a terminal for one color, if the terminal has a wire of that color. */
export function networkOf(compiled: CompiledCircuit, terminal: TerminalRef, color: WireColor): CompiledNetwork | undefined {
  const id = compiled.terminals[terminalKey(terminal)]?.[color];
  return id === undefined ? undefined : compiled.networks.find((n) => n.id === id);
}

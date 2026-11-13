// Topology: one network per connected set of same-colored connection points, found with union-find. Red and green never mix.
// Every connection point an entity has (`TERMINALS`) is a member in its own right: the two of a combinator, the one of a lamp,
// and the one of a pole, on which all wires of a color so become one network.

import { TERMINALS, WIRE_COLORS, terminalKey, type Circuit, type Entity, type EntityKind, type TerminalRef, type TerminalSide, type WireColor } from "@face/model";
import { defaultEnvironment, type SimulationEnvironment } from "./environment.ts";
import { semanticFingerprint } from "./fingerprint.ts";
import type { CompiledCircuit, CompiledNetwork, SimulationNote, TerminalNetworks } from "./types.ts";
import { validateEntity } from "./validate.ts";

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * What an entity kind does on its connection points: from which one it reads the networks and to which one it writes what it
 * emits. Nothing here assumes an input and an output: a kind may read and write on the same point or do neither.
 */
export interface PointRoles {
  readonly reads?: TerminalSide;
  readonly writes?: TerminalSide;
}

export const POINT_ROLES: Readonly<Record<EntityKind, PointRoles>> = {
  constant: { writes: "out" },
  arithmetic: { reads: "in", writes: "out" },
  decider: { reads: "in", writes: "out" },
  selector: { reads: "in", writes: "out" },
  lamp: { reads: "in" },
  // P-RELAY: a pole has no behaviour. Its point is read only so that a snapshot can show what is on the two networks it joins.
  pole: { reads: "io" },
  speaker: { reads: "in" },
};

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

  // Every connection point of every entity gets a number; a wire joins two of them.
  const points: TerminalRef[] = [];
  const pointIndex = new Map<string, number>();
  for (const entity of entities) {
    for (const side of TERMINALS[entity.kind]) {
      const point = { entity: entity.id, side };
      pointIndex.set(terminalKey(point), points.length);
      points.push(point);
    }
  }
  const slot = (t: TerminalRef): number | undefined => pointIndex.get(terminalKey(t));

  const parents = {} as Record<WireColor, Int32Array>;
  const wired = {} as Record<WireColor, Uint8Array>;
  for (const color of WIRE_COLORS) {
    parents[color] = Int32Array.from({ length: points.length }, (_, i) => i);
    wired[color] = new Uint8Array(points.length);
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
    for (let n = 0; n < points.length; n++) {
      if (!wired[color][n]) continue;
      const root = find(parents[color], n);
      const list = members.get(root);
      if (list) list.push(points[n]!);
      else members.set(root, [points[n]!]);
    }
    for (const list of members.values()) {
      const terminals = list.sort((a, b) => compareText(terminalKey(a), terminalKey(b)));
      const having = (role: keyof PointRoles): string[] => terminals.filter((t) => POINT_ROLES[entities[index.get(t.entity)!]!.kind][role] === t.side).map((t) => t.entity);
      networks.push({ id: `${color}:${terminalKey(terminals[0]!)}`, color, terminals, emitters: having("writes"), readers: having("reads") });
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

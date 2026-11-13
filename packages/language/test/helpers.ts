import { readFileSync } from "node:fs";
import {
  ARITHMETIC_OPERATIONS, BOTH_NETWORKS, COMPARATORS, DIRECTIONS, ENTITY_KINDS, LAMP_COLOR_MODES, SELECTOR_OPERATIONS, SIGNAL_KINDS, SPEAKER_PLAYBACK_MODES, TERMINALS, prototypesOf, signal, wildcardSignal,
  wireKey,
  type Circuit, type ConstantSection, type DeciderCondition, type DeciderOutput, type Entity, type EntityKind, type NetworkSelection, type Operand, type SelectorMode, type SignalId, type Wire,
} from "@face/model";
import { analyze, type ParseResult } from "../src/index.ts";

export function fixture(name: string): string {
  return readFileSync(new URL(`../../../tests/fixtures/language/${name}`, import.meta.url), "utf8");
}

/** Analyzes source that must be free of errors. */
export function valid(source: string, previous?: ParseResult): ParseResult & { circuit: Circuit } {
  const result = analyze(source, previous);
  if (result.hasErrors || !result.circuit) throw new Error(`Unexpected errors: ${JSON.stringify(result.diagnostics.filter((d) => d.severity === "error"))}\n${source}`);
  return result as ParseResult & { circuit: Circuit };
}

export function codes(source: string): string[] {
  return analyze(source).diagnostics.map((d) => d.code);
}

export function idOf(parse: ParseResult, name: string): string {
  for (const entity of parse.sourceMap.entities.values()) if (entity.name === name) return entity.id;
  throw new Error(`No entity named ${name}`);
}

/** Wraps member declarations in a circuit. */
export function circuit(body: string): string {
  return `circuit "t" {\n${body}\n}\n`;
}

/** Id-free view of a circuit: entities without ids, wires as sorted name-based keys. */
export function portable(c: Circuit): { name: string; entities: unknown[]; wires: string[] } {
  const names = new Map(c.entities.map((e) => [e.id, e.name]));
  const end = (t: Wire["a"]) => `${names.get(t.entity)}.${t.side}`;
  return {
    name: c.name,
    entities: c.entities.map(({ id: _id, ...rest }) => JSON.parse(JSON.stringify(rest)) as unknown),
    wires: c.wires.map((w) => `${w.color} ${[end(w.a), end(w.b)].sort().join(" ")}`).sort(),
  };
}

export function withoutId(entity: Entity): unknown {
  const { id: _id, ...rest } = entity;
  return JSON.parse(JSON.stringify(rest));
}

/** Deterministic PRNG (mulberry32). */
export function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Generator {
  private readonly next: () => number;

  constructor(seed: number) {
    this.next = random(seed);
  }

  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  chance(probability = 0.5): boolean {
    return this.next() < probability;
  }

  pick<T>(values: readonly T[]): T {
    return values[this.int(0, values.length - 1)]!;
  }

  int32(): number {
    return this.pick([0, 1, -1, 2, 10, -17, 255, 2147483647, -2147483648, this.int(-100000, 100000)]);
  }

  signal(): SignalId {
    const name = this.pick(["signal-A", "signal-B", "iron-plate", "copper-ore", "water", "nauvis", "x.y-z", "9lives", "odd name", 'say "hi"', "back\\slash"]);
    const quality = this.chance(0.25) ? this.pick(["rare", "legendary", "normal", "odd quality"]) : undefined;
    return signal(this.pick(SIGNAL_KINDS), name, quality);
  }

  networks(): NetworkSelection {
    return this.pick([BOTH_NETWORKS, { red: true, green: false }, { red: false, green: true }, { red: false, green: false }]);
  }

  operand(each = false): Operand {
    if (this.chance(0.4)) return { type: "constant", value: this.int32() };
    return { type: "signal", signal: each && this.chance(0.3) ? wildcardSignal("each") : this.signal(), networks: this.networks() };
  }

  section(): ConstantSection {
    const filters = new Map<string, { signal: SignalId; count: number }>();
    for (let i = this.int(0, 4); i > 0; i--) {
      const id = this.signal();
      filters.set(JSON.stringify(id), { signal: id, count: this.int32() });
    }
    const section: ConstantSection = { active: this.chance(0.7), multiplier: this.pick([1, 1, 2, -3, 0.5, -0.25, 0]), filters: [...filters.values()] };
    return this.chance() ? { group: this.pick(["Ore", "", 'a "b"', "Line\nbreak"]), ...section } : section;
  }

  output(each: boolean): DeciderOutput {
    const id = this.pick([this.signal(), this.signal(), wildcardSignal("everything"), wildcardSignal("anything"), ...(each ? [wildcardSignal("each")] : [])]);
    return this.chance() ? { signal: id, copyCountFromInput: true, constant: 1, networks: this.networks() } : { signal: id, copyCountFromInput: false, constant: this.int32(), networks: BOTH_NETWORKS };
  }

  mode(): SelectorMode {
    const operation = this.pick(SELECTOR_OPERATIONS);
    const optional = () => (this.chance(0.7) ? this.signal() : undefined);
    const clean = <T extends object>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
    switch (operation) {
      case "select": return { operation, max: this.chance(), index: this.chance() ? { type: "constant", value: this.int32() } : { type: "signal", signal: this.signal(), networks: BOTH_NETWORKS }, indexComparator: this.pick(COMPARATORS) };
      case "count": return clean({ operation, output: optional() });
      case "random": return { operation, interval: this.pick([0, 1, 60, 3600]) };
      case "stack-size": return { operation };
      case "rocket-capacity": return { operation };
      case "quality-filter": return clean({ operation, comparator: this.pick(COMPARATORS), quality: this.chance() ? this.pick(["normal", "rare", "odd quality", "signal", "red"]) : undefined });
      case "quality-select": return { operation, highest: this.chance() };
      case "quality-transfer":
        return clean({
          operation,
          source: this.chance() ? { type: "quality" as const, quality: this.pick(["normal", "rare", "signal", "2x", "in"]) } : { type: "signal" as const, signal: optional() },
          destination: this.chance(0.2) ? wildcardSignal("each") : optional(),
        });
      case "time": return clean({ operation, dayLength: optional(), dayTick: optional(), gameTick: optional() });
    }
  }

  /** A random entity that the language can express exactly. */
  entity(kind: EntityKind, name: string): Entity {
    const base = {
      id: `x-${name}`,
      name,
      position: { x: this.int(-50, 50) * 20, y: this.int(-50, 50) * 20 },
      ...(this.chance(0.3) ? { placement: this.pick([{ tile: { x: this.int(-9, 9) + 0.5, y: this.int(-9, 9) } }, { direction: this.pick(DIRECTIONS) }, { tile: { x: 1, y: -2 }, direction: this.pick(DIRECTIONS) }]) } : {}),
      ...(this.chance(0.3) ? { description: this.pick(["", "plain", 'with "quotes" and \\ backslash', "two\nlines", "// not a comment"]) } : {}),
    };
    switch (kind) {
      case "constant": {
        const sections = this.pick([0, 1, 1, 2, 3]);
        return { ...base, kind, enabled: this.chance(0.8), sections: Array.from({ length: sections }, () => this.section()) };
      }
      case "arithmetic": {
        if (this.chance(0.15)) return { ...base, kind, first: { type: "constant", value: 0 }, operation: "*", second: { type: "constant", value: 0 } };
        const first = this.operand(true);
        const second = this.operand(true);
        const hasEach = [first, second].some((o) => o.type === "signal" && o.signal.name === "signal-each");
        return { ...base, kind, first, operation: this.pick(ARITHMETIC_OPERATIONS), second, output: hasEach && this.chance() ? wildcardSignal("each") : this.signal() };
      }
      case "decider": {
        const conditions: DeciderCondition[] = Array.from({ length: this.int(0, 4) }, (_, i) => ({
          join: i === 0 ? "or" : this.pick(["and", "or"] as const),
          first: this.pick([this.signal(), this.signal(), wildcardSignal("each"), wildcardSignal("anything"), wildcardSignal("everything")]),
          firstNetworks: this.networks(),
          comparator: this.pick(COMPARATORS),
          second: this.operand(),
        }));
        const each = conditions.some((c) => c.first?.name === "signal-each");
        return { ...base, kind, conditions, outputs: Array.from({ length: this.int(0, 3) }, () => this.output(each)), elseOutputs: Array.from({ length: this.int(0, 2) }, () => this.output(each)) };
      }
      case "selector":
        return { ...base, kind, mode: this.mode() };
      case "lamp": {
        const useColors = this.chance();
        const optional = () => (this.chance(0.3) ? { s: this.signal() } : {});
        return {
          ...base,
          kind,
          ...(this.chance(0.7)
            ? { condition: { first: this.pick([this.signal(), wildcardSignal("anything"), wildcardSignal("everything")]), comparator: this.pick(COMPARATORS), second: this.chance() ? { type: "constant" as const, value: this.int32() } : { type: "signal" as const, signal: this.signal() } } }
            : {}),
          inputNetworks: this.networks(),
          alwaysOn: this.chance(0.3),
          useColors,
          colorMode: useColors ? this.pick(LAMP_COLOR_MODES) : "mapping",
          ...(optional().s ? { redSignal: this.signal() } : {}),
          ...(optional().s ? { greenSignal: this.signal() } : {}),
          ...(optional().s ? { blueSignal: this.signal() } : {}),
          ...(optional().s ? { rgbSignal: this.signal() } : {}),
          ...(this.chance(0.3) ? { color: { r: this.int(0, 255), g: this.int(0, 255), b: this.int(0, 255) } } : {}),
        };
      }
      case "pole":
        return { ...base, kind, prototype: this.pick(prototypesOf("pole")) };
      case "speaker": {
        const pitch = this.chance(0.3);
        const condition = { first: this.pick([this.signal(), wildcardSignal("anything"), wildcardSignal("everything")]), comparator: this.pick(COMPARATORS), second: this.chance() ? { type: "constant" as const, value: this.int32() } : { type: "signal" as const, signal: this.signal() } };
        return {
          ...base,
          kind,
          ...(pitch ? { pitchSignal: this.signal() } : this.chance(0.8) ? { condition } : {}),
          ...(this.chance() ? { instrument: this.pick(["piano", "drum-kit", "odd name", "wire", "2x"]) } : {}),
          ...(this.chance() ? { note: this.pick(["F#3", "C4", "alarm-1", "gui-click-2", "true", "A b"]) } : {}),
          volume: this.pick([100, 100, 0, 12.5, 80]),
          ...(this.chance(0.3) ? { volumeSignal: this.signal() } : {}),
          playbackMode: this.pick(SPEAKER_PLAYBACK_MODES),
          allowPolyphony: this.chance(),
          stopPlayingSounds: this.chance(0.3),
          showAlert: this.chance(),
          showOnMap: this.chance(0.7),
          ...(this.chance(0.3) ? { alertIcon: this.signal() } : {}),
          alertMessage: this.pick(["", "", "Out of ore", 'with "quotes"\nand a line']),
        };
      }
    }
  }

  circuit(size: number): Circuit {
    const entities = Array.from({ length: size }, (_, i) => this.entity(this.pick(ENTITY_KINDS), `n${i}`));
    const wires = new Map<string, Wire>();
    for (let i = size * 2; i > 0 && size > 0; i--) {
      const a = this.pick(entities);
      const b = this.pick(entities);
      const wire: Wire = { color: this.pick(["red", "green"] as const), a: { entity: a.id, side: this.pick(TERMINALS[a.kind]) }, b: { entity: b.id, side: this.pick(TERMINALS[b.kind]) } };
      if (wire.a.entity !== wire.b.entity || wire.a.side !== wire.b.side) wires.set(wireKey(wire), wire);
    }
    return { name: this.pick(["Random", 'With "quotes"', ""]), entities, wires: [...wires.values()] };
  }
}

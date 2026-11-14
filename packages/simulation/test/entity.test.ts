// Generic entities (kind `entity`): one connection point, conditions evaluated per tick, nothing emitted. Rules G-* of CONFORMANCE.md.
// The radar is the one that changes the networks.
import { describe, expect, it } from "vitest";
import { ENTITY_SETTINGS, prototypesOf, signal, type ConditionSetting, type EntitySettings } from "@face/model";
import { circuitConditions, compile, runFixture, semanticFingerprint, validateFixture, type ConformanceFixture } from "../src/index.ts";
import { ANYTHING, EACH, EVERYTHING, GREEN, NEITHER, RED, arithmetic, circuit, cond, conditionsOf, constant, decider, entity, lamp, networkAt, out, pole, record, selector, simulate, speaker, terminal, v, when, wire } from "./helpers.ts";

const lit = { condition: when("A", ">", 0) };

describe("generic entity: conditions", () => {
  it("F-27 assumption: G-CONDITION: the enable condition follows the content of every tick", () => {
    const c = circuit(
      [constant("one", { A: 1 }), arithmetic("count", "A", "+", 0, "A"), entity("feeder", "fast-inserter", { when: when("A", "<", 3) })],
      [wire("red", "one.out", "count.in"), wire("green", "count.out", "count.in"), wire("green", "count.out", "feeder")],
    );
    const simulation = simulate(c);
    const seen: (boolean | undefined)[] = [];
    const disabled: number[] = [];
    for (let tick = 0; tick <= 5; tick++) {
      if (tick > 0) simulation.step();
      const snapshot = simulation.snapshot();
      seen.push(snapshot.entities.feeder!.conditions?.when);
      disabled.push(snapshot.totals.entitiesDisabled);
    }
    // The counter holds 0, 1, 2, 3, 4, 5 at the ticks 0 to 5: the inserter is enabled while it is below 3.
    expect(seen).toEqual([true, true, true, false, false, false]);
    expect(disabled).toEqual([0, 0, 0, 1, 1, 1]);
  });

  it("F-27 assumption: G-CONDITION: compares with a constant or a signal, like a lamp", () => {
    const belt = (condition: EntitySettings["when"]) => entity("belt", "transport-belt", { when: condition! });
    expect(conditionsOf(belt(when("item:iron-plate", "<", 100)), { red: { "item:iron-plate": 99 } })).toEqual({ when: true });
    expect(conditionsOf(belt(when("item:iron-plate", "<", 100)), { red: { "item:iron-plate": 100 } })).toEqual({ when: false });
    expect(conditionsOf(belt(when("A", ">=", "B")), { red: { A: 4 }, green: { B: 4 } })).toEqual({ when: true });
    expect(conditionsOf(belt(when("A", ">=", "B")), { red: { A: 4 }, green: { B: 5 } })).toEqual({ when: false });
    // An absent signal is 0.
    expect(conditionsOf(belt(when("A", "=", 0)), { red: { B: 1 } })).toEqual({ when: true });
  });

  it("F-27 assumption: G-NETWORKS: reads the sum of red and green, or the networks its setting selects", () => {
    const feed = { red: { A: 3 }, green: { A: 4 } };
    const chest = (networks?: EntitySettings["networks"]) => entity("chest", "requester-chest", { when: when("A", "=", 7), ...(networks && { networks }) });
    expect(conditionsOf(chest(), feed)).toEqual({ when: true });
    expect(conditionsOf(chest(RED), feed)).toEqual({ when: false });
    expect(conditionsOf(entity("chest", "requester-chest", { when: when("A", "=", 3), networks: RED }), feed)).toEqual({ when: true });
    expect(conditionsOf(entity("chest", "requester-chest", { when: when("A", "=", 4), networks: GREEN }), feed)).toEqual({ when: true });
    // N-NONE: neither network selected reads nothing.
    expect(conditionsOf(entity("chest", "requester-chest", { when: when("A", "=", 0), networks: NEITHER }), feed)).toEqual({ when: true });
    // The selection is for both sides of a condition.
    expect(conditionsOf(entity("chest", "requester-chest", { when: when("A", "<", "B"), networks: GREEN }), { red: { B: 9 }, green: { A: 4 } })).toEqual({ when: false });
    // The selection of what the entity would send is not one of what it reads.
    expect(conditionsOf(entity("chest", "requester-chest", { when: when("A", "=", 7), "output-networks": RED }), feed)).toEqual({ when: true });
  });

  it("F-27 assumption: G-WILDCARD: anything and everything work as in a lamp; each or a wildcard on the right silences the entity", () => {
    const pump = (condition: EntitySettings["when"]) => entity("pump", "pump", { when: condition! });
    expect(conditionsOf(pump({ first: ANYTHING, comparator: ">", second: { type: "constant", value: 4 } }), { red: { A: 1, B: 5 } })).toEqual({ when: true });
    expect(conditionsOf(pump({ first: EVERYTHING, comparator: ">", second: { type: "constant", value: 4 } }), { red: { A: 1, B: 5 } })).toEqual({ when: false });
    expect(conditionsOf(pump({ first: EVERYTHING, comparator: ">", second: { type: "constant", value: 0 } }), { red: { A: 1, B: 5 } })).toEqual({ when: true });

    const each = pump({ first: EACH, comparator: ">", second: { type: "constant", value: 0 } });
    const right = pump({ first: signal("virtual", "signal-A"), comparator: ">", second: { type: "signal", signal: ANYTHING } });
    for (const invalid of [each, right]) {
      const c = circuit([constant("c", { A: 1 }), invalid], [wire("red", "c.out", "pump")]);
      expect(compile(c).notes).toMatchObject([{ severity: "error", code: "invalid-wildcard", entity: "pump" }]);
      expect(simulate(c).snapshot().entities.pump!.conditions).toBeUndefined();
    }
  });

  it("reports every circuit condition of a splitter, an agricultural tower and a turret by its key", () => {
    const splitter = entity("s", "splitter", { "input-left-when": when("A", ">", 0), "input-right-when": when("A", ">", 5), "output-left-when": when("B", "=", 0), "output-right-when": when("B", "!=", 0) });
    expect(conditionsOf(splitter, { red: { A: 3 } })).toEqual({ "input-left-when": true, "input-right-when": false, "output-left-when": true, "output-right-when": false });
    expect(conditionsOf(splitter, { red: { A: 9, B: 1 } })).toEqual({ "input-left-when": true, "input-right-when": true, "output-left-when": false, "output-right-when": true });

    const tower = entity("t", "agricultural-tower", { when: when("A", ">", 0), "harvest-when": when("item:wood", "<", 500), "plant-when": when("item:tree-seed", ">", 10) });
    expect(conditionsOf(tower, { green: { "item:wood": 500, "item:tree-seed": 11 } })).toEqual({ when: false, "harvest-when": false, "plant-when": true });

    const turret = entity("g", "gun-turret", { "ignore-unlisted-when": when("A", ">", 0) });
    expect(conditionsOf(turret, { red: { A: 1 } })).toEqual({ "ignore-unlisted-when": true });
    // Without an enable condition a false condition of another kind does not make the entity a disabled one.
    const idle = simulate(circuit([constant("c", { B: 1 }), turret], [wire("red", "c.out", "g")])).snapshot();
    expect(idle.entities.g!.conditions).toEqual({ "ignore-unlisted-when": false });
    expect(idle.totals.entitiesDisabled).toBe(0);

    expect(conditionsOf(entity("r", "rail-signal", { "close-when": when("A", ">", 0) }), { red: { A: 1 } })).toEqual({ "close-when": true });
    expect(conditionsOf(entity("w", "stone-wall", { "open-gate-when": when("A", ">", 0) }), { red: { A: 0 } })).toEqual({ "open-gate-when": false });
  });

  it("F-27 assumption: G-LOGISTIC: the logistic condition is kept and never evaluated", () => {
    const both = entity("i", "inserter", { when: when("A", ">", 0), "logistic-when": when("item:iron-plate", ">", 0) });
    expect(conditionsOf(both, { red: { A: 1 } })).toEqual({ when: true });
    const only = entity("i", "inserter", { "logistic-when": when("item:iron-plate", ">", 0) });
    expect(conditionsOf(only, { red: { A: 1 } })).toBeUndefined();
    expect(circuitConditions(both).map(([key]) => key)).toEqual(["when"]);
  });

  it("covers every condition of the settings table: each is a circuit condition or the logistic one", () => {
    const keys = new Set<string>();
    for (const prototype of prototypesOf("entity")) {
      const conditions = Object.fromEntries(Object.values(ENTITY_SETTINGS).flatMap((row) => row.settings).filter((spec): spec is ConditionSetting => spec.type === "condition").map((spec) => [spec.key, when("A", ">", 0)]));
      for (const [key] of circuitConditions(entity("e", prototype, conditions))) keys.add(key);
    }
    expect([...keys].sort()).toEqual(["close-when", "harvest-when", "ignore-unlisted-when", "input-left-when", "input-right-when", "open-gate-when", "output-left-when", "output-right-when", "plant-when", "when"]);
  });

  it("F-27 assumption: G-UNWIRED: without a circuit wire no condition applies", () => {
    const snapshot = simulate(circuit([entity("i", "inserter", { when: when("A", "=", 0) })])).snapshot();
    expect(snapshot.entities.i).toEqual({ kind: "entity", input: { red: [], green: [], combined: [] } });
    expect(snapshot.totals.entitiesDisabled).toBe(0);
  });

  it("F-27 assumption: G-BLANK: a condition without a left side, or a value that is none, is no condition of the entity", () => {
    const blank = { comparator: "<", second: { type: "constant", value: 0 } } as unknown as EntitySettings["when"];
    expect(conditionsOf(entity("i", "inserter", { when: blank! }), { red: { A: 1 } })).toBeUndefined();
    expect(conditionsOf(entity("i", "inserter", { when: true }), { red: { A: 1 } })).toBeUndefined();
    // A condition of another prototype type means nothing here.
    expect(conditionsOf(entity("c", "steel-chest", { when: when("A", ">", 0), "harvest-when": when("A", ">", 0) }), { red: { A: 1 } })).toBeUndefined();
  });
});

describe("generic entity: networks and snapshot", () => {
  it("F-27 assumption: G-SILENT: reads its one point and sends nothing, whatever its settings say it reads out", () => {
    const chest = entity("chest", "steel-chest", { "read-contents": true, "read-empty-slots": true });
    const c = circuit([constant("c", { A: 2 }), chest, lamp("l", lit)], [wire("red", "c.out", "chest"), wire("red", "chest", "l.in"), wire("green", "chest", "l.in")]);
    const compiled = compile(c);
    expect(compiled.notes).toEqual([]);
    const red = compiled.networks.find((network) => network.color === "red")!;
    expect(red.terminals).toEqual([terminal("c.out"), terminal("chest"), terminal("l.in")]);
    expect([red.emitters, red.readers]).toEqual([["c"], ["chest", "l"]]);
    const simulation = simulate(c, 2);
    const snapshot = simulation.snapshot();
    const state = snapshot.entities.chest!;
    // Like a pole it joins the wires on it: the lamp behind the chest is lit.
    expect(snapshot.entities.l!.lamp).toEqual({ lit: true });
    expect(Object.keys(state).sort()).toEqual(["input", "kind"]);
    expect([record(state.input!.red), record(state.input!.green), record(state.input!.combined)]).toEqual([v({ A: 2 }), {}, v({ A: 2 })]);
    expect(networkAt(simulation, "chest", "green")).toEqual({});
    expect(snapshot.totals).toEqual({ entities: 3, networks: 2, signals: 1, emitting: 1, lampsLit: 1, speakersPlaying: 0, entitiesDisabled: 0 });
    expect(simulation.probe({ type: "terminal", entity: "chest", side: "io" }, "virtual:signal-A")).toBe(2);
    expect(simulation.probe({ type: "terminal", entity: "chest", side: "io", color: "green" }, "virtual:signal-A")).toBe(0);
  });

  it("every generic prototype compiles and runs, with one point each", () => {
    const names = prototypesOf("entity");
    expect(names).toHaveLength(88);
    const entities = names.map((prototype, index) => entity(`e${index}`, prototype));
    const c = circuit([constant("c", { A: 1 }), ...entities], entities.map((each, index) => wire(index % 2 ? "green" : "red", index === 0 ? "c.out" : `e${index - 1}`, each.id)));
    const compiled = compile(c);
    expect(compiled.notes).toEqual([]);
    const snapshot = simulate(c, 1).snapshot();
    expect(snapshot.totals).toMatchObject({ entities: 89, emitting: 1, entitiesDisabled: 0 });
    for (const each of entities) expect(Object.keys(snapshot.entities[each.id]!).sort(), each.prototype).toEqual(["input", "kind"]);
  });

  it("shares the state between ticks while nothing changes, and renews it when a condition turns", () => {
    const c = circuit(
      [constant("one", { A: 1 }), arithmetic("count", "A", "+", 0, "A"), entity("gate", "stone-wall", { "open-gate-when": when("A", ">", 1) }), entity("fixed", "pump", { when: when("B", "=", 0) })],
      [wire("red", "one.out", "count.in"), wire("green", "count.out", "count.in"), wire("green", "count.out", "gate"), wire("red", "one.out", "fixed")],
    );
    const simulation = simulate(c);
    const snapshots = [simulation.snapshot()];
    for (let tick = 1; tick <= 4; tick++) {
      simulation.step();
      snapshots.push(simulation.snapshot());
    }
    const gate = snapshots.map((snapshot) => snapshot.entities.gate!.conditions);
    expect(gate.map((state) => state!["open-gate-when"])).toEqual([false, false, true, true, true]);
    expect(gate[1]).toBe(gate[0]);
    expect(gate[2]).not.toBe(gate[1]);
    expect(gate[4]).toBe(gate[2]);
    expect(Object.isFrozen(gate[0])).toBe(true);
    // The pump sees the same content at every tick: the whole entity snapshot is one object.
    for (const snapshot of snapshots) expect(snapshot.entities.fixed).toBe(snapshots[0]!.entities.fixed);
    expect(snapshots[0]!.entities.fixed!.conditions).toEqual({ when: true });
  });

  it("starts again with reset", () => {
    const c = circuit(
      [constant("one", { A: 1 }), arithmetic("count", "A", "+", 0, "A"), entity("i", "inserter", { when: when("A", "<", 2) })],
      [wire("red", "one.out", "count.in"), wire("green", "count.out", "count.in"), wire("green", "count.out", "i")],
    );
    const simulation = simulate(c, 4);
    expect(simulation.snapshot().entities.i!.conditions).toEqual({ when: false });
    simulation.reset();
    expect(simulation.snapshot().entities.i!.conditions).toEqual({ when: true });
  });
});

describe("radar", () => {
  const sender = constant("c", { A: 1 });

  it("F-28 assumption: G-RADAR: radars in surface mode share one red and one green network without a wire between them", () => {
    const c = circuit(
      [sender, constant("g", { A: 5 }), entity("r1", "radar"), entity("r2", "radar"), entity("r3", "radar"), lamp("far", lit), lamp("five", { condition: when("A", "=", 5) })],
      [wire("red", "c.out", "r1"), wire("red", "r2", "far.in"), wire("green", "g.out", "r3"), wire("green", "r1", "five.in")],
    );
    const compiled = compile(c);
    expect(compiled.notes).toEqual([]);
    expect(compiled.networks.map((network) => network.id)).toEqual(["green:five.in", "red:c.out"]);
    expect(compiled.networks[0]!.terminals).toEqual([terminal("five.in"), terminal("g.out"), terminal("r1"), terminal("r2"), terminal("r3")]);
    expect(compiled.networks[1]!.terminals).toEqual([terminal("c.out"), terminal("far.in"), terminal("r1"), terminal("r2"), terminal("r3")]);
    expect(compiled.terminals["r3.io"]).toEqual({ red: "red:c.out", green: "green:five.in" });
    // No combinator is in the way: no tick passes.
    const snapshot = simulate(c).snapshot();
    expect([snapshot.entities.far!.lamp, snapshot.entities.five!.lamp]).toEqual([{ lit: true }, { lit: true }]);
    // A radar shows what is on the two networks, also the one that has no wire of its own.
    expect([record(snapshot.entities.r3!.input!.red), record(snapshot.entities.r2!.input!.green)]).toEqual([v({ A: 1 }), v({ A: 5 })]);
  });

  it("F-28 assumption: G-RADAR: radars without a wire of a color make no network of that color", () => {
    expect(compile(circuit([entity("r1", "radar"), entity("r2", "radar")])).networks).toEqual([]);
    const c = circuit([sender, entity("r1", "radar"), entity("r2", "radar")], [wire("red", "c.out", "r1")]);
    const compiled = compile(c);
    expect(compiled.networks.map((network) => network.id)).toEqual(["red:c.out"]);
    expect(compiled.terminals["r2.io"]).toEqual({ red: "red:c.out" });
    // A single radar is an entity with one point like any other.
    const alone = compile(circuit([sender, entity("r", "radar"), lamp("l", lit)], [wire("red", "c.out", "r"), wire("red", "r", "l.in")]));
    expect(alone.networks.map((network) => network.terminals.length)).toEqual([3]);
  });

  it("F-28 assumption: G-RADAR: only radars are joined, and a pole between them changes nothing", () => {
    const c = circuit(
      [sender, entity("r1", "radar"), entity("r2", "radar"), entity("chest", "steel-chest"), entity("tower", "agricultural-tower"), pole("p"), lamp("near", lit), lamp("other", lit)],
      [wire("red", "c.out", "r1"), wire("red", "r2", "p"), wire("red", "p", "near.in"), wire("red", "chest", "other.in"), wire("red", "tower", "chest")],
    );
    const snapshot = simulate(c).snapshot();
    expect([snapshot.entities.near!.lamp, snapshot.entities.other!.lamp]).toEqual([{ lit: true }, { lit: false }]);
  });

  it("F-28 assumption: G-RADAR-UNIVERSE: radars in universe mode share their networks per channel, apart from the surface", () => {
    const channel = (name: string): EntitySettings => ({ mode: "universe", channel: signal("virtual", name) });
    const lampOn = (id: string) => lamp(id, lit);
    const c = circuit(
      [
        sender, entity("s1", "radar"), entity("s2", "radar"), entity("a1", "radar", channel("signal-A")), entity("a2", "radar", channel("signal-A")), entity("b1", "radar", channel("signal-B")),
        entity("q1", "radar", { mode: "universe", channel: signal("virtual", "signal-A", "rare") }), entity("n1", "radar", { mode: "universe" }), entity("n2", "radar", { mode: "universe" }),
        lampOn("surface"), lampOn("same"), lampOn("otherChannel"), lampOn("otherQuality"), lampOn("none"),
      ],
      [wire("red", "c.out", "a1"), wire("red", "a2", "same.in"), wire("red", "s1", "surface.in"), wire("red", "b1", "otherChannel.in"), wire("red", "q1", "otherQuality.in"), wire("red", "c.out", "n1"), wire("red", "n2", "none.in")],
    );
    const compiled = compile(c);
    // G-RADAR-CHANNEL: universe mode without a channel connects to no other radar.
    expect(compiled.notes.map((note) => `${note.severity} ${note.code} ${note.entity}`)).toEqual(["info unconfigured n1", "info unconfigured n2"]);
    const lamps = simulate(c).snapshot().entities;
    expect(Object.fromEntries(["same", "surface", "otherChannel", "otherQuality", "none"].map((id) => [id, lamps[id]!.lamp!.lit]))).toEqual({ same: true, surface: false, otherChannel: false, otherQuality: false, none: false });
    // The second surface radar is on the network of the first, which nothing sends to.
    expect(compiled.terminals["s2.io"]).toEqual({ red: "red:s1.io" });
    expect(compiled.terminals["b1.io"]).toEqual({ red: "red:b1.io" });
  });

  it("carries a signal across radars with the latency of the combinators only", () => {
    const c = circuit(
      [sender, arithmetic("a", "A", "+", 1, "A"), entity("r1", "radar"), entity("r2", "radar"), arithmetic("b", "A", "*", 2, "B")],
      [wire("red", "c.out", "a.in"), wire("green", "a.out", "r1"), wire("green", "r2", "b.in")],
    );
    const simulation = simulate(c, 1);
    expect(networkAt(simulation, "r2", "green")).toEqual(v({ A: 2 }));
    simulation.step();
    expect(record(simulation.snapshot().entities.b!.output)).toEqual(v({ B: 4 }));
  });
});

describe("generic entity: fingerprint", () => {
  const withEntity = (target: ReturnType<typeof entity>, ...more: ReturnType<typeof entity>[]) => circuit([constant("c", { A: 1 }), target, ...more], [wire("red", "c.out", target.id)]);
  const base = entity("i", "inserter", { when: when("A", ">", 0), "read-hand": "pulse" });
  const fingerprint = semanticFingerprint(withEntity(base));

  it("leaves the fingerprint of a circuit of the other kinds as it was", () => {
    const c = circuit(
      [
        constant("c", { A: 1, "item:iron-plate": 5 }), arithmetic("a", "A", "+", 1, "B"), decider("d", [cond("B", ">", 0)], [out("B")], [out("C", 2)]), selector("s", { operation: "count", output: { kind: "virtual", name: "signal-N" } }),
        lamp("l", { condition: when("B", ">", 1) }), pole("p"), speaker("k", { condition: when("A", "=", 1) }),
      ],
      [wire("red", "c.out", "a.in"), wire("green", "a.out", "d.in"), wire("red", "d.out", "p"), wire("red", "p", "l.in"), wire("red", "p", "k.in"), wire("green", "c.out", "s.in")],
    );
    // Recorded before the kind `entity` existed.
    expect(semanticFingerprint(c)).toBe("s1-3228addb0cd948d5dc04a70ee2f54200");
  });

  it("is pinned for a circuit with generic entities", () => {
    const c = circuit(
      [
        constant("c", { A: 1 }), entity("i", "fast-inserter", { when: when("A", ">", 0), "logistic-when": when("item:iron-plate", "<", 5), networks: RED, "read-hand": "hold" }),
        entity("s", "splitter", { "input-left-when": when("A", "=", "B") }), entity("r", "radar"), entity("u", "radar", { mode: "universe", channel: signal("virtual", "signal-U") }), entity("chest", "iron-chest"),
      ],
      [wire("red", "c.out", "i"), wire("green", "i", "s"), wire("red", "r", "chest")],
    );
    expect(semanticFingerprint(c)).toBe("s1-212fdf1ba4c1623dc33d2d1346d39035");
  });

  it("keeps what does not reach a snapshot: settings that only the game uses, the logistic condition, the kept blueprint data, the prototype among its type", () => {
    const same = [
      { ...base, settings: { ...base.settings, "read-hand": "hold", "set-filters": true, "output-networks": RED } },
      { ...base, settings: { ...base.settings, "logistic-when": when("item:iron-plate", ">", 1) } },
      { ...base, blueprintData: '{"filters":[{"index":1,"name":"iron-plate"}]}' },
      { ...base, prototype: "bulk-inserter" },
      { ...base, prototype: "assembling-machine-2", settings: { when: when("A", ">", 0), "set-recipe": true } },
      { ...base, name: "other", position: { x: 5, y: 5 }, placement: { tile: { x: 0.5, y: 0.5 }, direction: "north" as const } },
    ];
    for (const variant of same) expect(semanticFingerprint(withEntity(variant)), JSON.stringify(variant)).toBe(fingerprint);
    // A chest has no condition `harvest-when`: the setting means nothing and changes nothing.
    const chest = entity("i", "steel-chest");
    expect(semanticFingerprint(withEntity({ ...chest, settings: { "harvest-when": when("A", ">", 0) } }))).toBe(semanticFingerprint(withEntity(chest)));
  });

  it("changes with a circuit condition, the networks it is read from, and a radar's mode and channel", () => {
    const radar = entity("i", "radar");
    const variants = [
      withEntity({ ...base, settings: { ...base.settings, when: when("A", ">", 1) } }),
      withEntity({ ...base, settings: { ...base.settings, when: when("A", ">=", 0) } }),
      withEntity({ ...base, settings: { ...base.settings, when: when("A", ">", "B") } }),
      withEntity({ ...base, settings: { "read-hand": "pulse" } }),
      withEntity({ ...base, settings: { ...base.settings, networks: RED } }),
      withEntity({ ...base, settings: { ...base.settings, networks: GREEN } }),
      withEntity({ ...base, prototype: "stone-wall", settings: { "open-gate-when": when("A", ">", 0) } }),
      withEntity(radar),
      withEntity({ ...radar, settings: { mode: "universe", channel: signal("virtual", "signal-A") } }),
      withEntity({ ...radar, settings: { mode: "universe", channel: signal("virtual", "signal-B") } }),
    ];
    expect(new Set([fingerprint, ...variants.map(semanticFingerprint)]).size).toBe(variants.length + 1);
    // An inserter without conditions is, for the simulation, the chest it could as well be, and so is a radar that is connected to no other.
    expect(semanticFingerprint(withEntity(entity("i", "inserter")))).toBe(semanticFingerprint(withEntity(entity("i", "wooden-chest"))));
    expect(semanticFingerprint(withEntity({ ...radar, settings: { mode: "universe" } }))).toBe(semanticFingerprint(withEntity(entity("i", "wooden-chest"))));
    expect(compile(withEntity(base)).fingerprint).toBe(fingerprint);
  });
});

describe("fixture runner: conditions", () => {
  const fixture: ConformanceFixture = {
    format: 1,
    id: "inline",
    covers: ["F-27"],
    title: "inline",
    provenance: "assumed",
    circuit: circuit([constant("c", { A: 5 }), entity("i", "inserter", { when: when("A", ">", 3) }), entity("chest", "iron-chest")], [wire("red", "c.out", "i"), wire("red", "i", "chest")]),
    ticks: 1,
    expect: [{ tick: 0, through: 1, conditions: { i: { when: true }, chest: null } }],
  };

  it("passes when the snapshot reports exactly the conditions expected", () => {
    expect(validateFixture(fixture)).toEqual([]);
    expect(runFixture(fixture)).toEqual([]);
  });

  it("reports a wrong value, a missing or surplus condition and an entity that is not generic", () => {
    const failures = runFixture({ ...fixture, ticks: 0, expect: [{ tick: 0, conditions: { i: { when: false }, chest: { when: true }, c: null, ghost: null } }, { tick: 0, conditions: { i: null } }, { tick: 0, conditions: { i: { when: true, "plant-when": true } } }] });
    expect(failures.map((failure) => `${failure.target}: ${failure.message}`)).toEqual([
      'conditions i: expected {"when":false}, got {"when":true}',
      'conditions chest: expected {"when":true}, got null',
      "conditions c: no such generic entity",
      "conditions ghost: no such generic entity",
      'conditions i: expected null, got {"when":true}',
      'conditions i: expected {"when":true,"plant-when":true}, got {"when":true}',
    ]);
  });
});

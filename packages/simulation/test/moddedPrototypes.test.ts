// Prototypes a mod adds: the simulation goes by the kind, so a modded combinator computes as the standard one, a modded lamp
// lights, a modded pole relays, and a loader of one tile has its condition evaluated like a loader.
import { setEntityTable, STANDARD_ENTITY_TABLE, type Circuit, type Entity } from "@face/model";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MODDED_ENTITY_TABLE } from "../../../tests/fixtures/game/moddedEntities.ts";
import { compile, semanticFingerprint } from "../src/index.ts";
import { arithmetic, circuit, cond, constant, decider, entity, lamp, networkAt, out, outputOf, pole, selector, simulate, v, when, wire } from "./helpers.ts";

const lit = { condition: { first: { kind: "virtual" as const, name: "signal-A" }, comparator: ">" as const, second: { type: "constant" as const, value: 0 } } };

/** A constant into an arithmetic, a decider and a selector combinator, over a pole to a lamp and a loader; `modded` gives every entity the prototype of the mod. */
function chain(modded: boolean): Circuit {
  const as = <E extends Entity>(built: E, prototype: string): E => (modded ? { ...built, prototype } : built);
  return circuit(
    [
      as(constant("c", { A: 3, B: 5 }), "mod-constant"),
      as(arithmetic("a", "A", "*", 2, "A"), "mod-arithmetic"),
      as(decider("d", [cond("A", ">", 5)], [out("A"), out("C", 1)]), "mod-decider"),
      as(selector("s", { operation: "count", output: { kind: "virtual", name: "signal-D" } }), "mod-selector"),
      pole("p", modded ? "mod-pole" : "big-electric-pole"),
      as(lamp("l", lit), "mod-lamp"),
      entity("m", modded ? "mod-loader" : "loader", { when: when("C", "=", 1) }),
    ],
    [wire("red", "c.out", "a.in"), wire("red", "a.out", "d.in"), wire("green", "d.out", "p"), wire("green", "p", "l.in"), wire("green", "p", "m"), wire("green", "p", "s.in")],
  );
}

describe("modded prototypes in the simulation", () => {
  beforeAll(() => setEntityTable(MODDED_ENTITY_TABLE));
  afterAll(() => setEntityTable(STANDARD_ENTITY_TABLE));

  it("computes with modded combinators as with the standard ones, tick by tick", () => {
    const [standard, modded] = [chain(false), chain(true)];
    expect(compile(modded).notes).toEqual([]);
    for (const ticks of [0, 1, 2, 3, 4]) expect(simulate(modded, ticks).snapshot(), `tick ${ticks}`).toEqual(simulate(standard, ticks).snapshot());
    const simulation = simulate(modded, 4);
    expect(outputOf(simulation, "a")).toEqual(v({ A: 6 }));
    expect(outputOf(simulation, "d")).toEqual(v({ A: 6, C: 1 }));
    expect(outputOf(simulation, "s")).toEqual(v({ D: 2 }));
    const snapshot = simulation.snapshot();
    expect(snapshot.entities.l!.lamp).toEqual({ lit: true });
    expect(snapshot.entities.m!.conditions).toEqual({ when: true });
  });

  it("relays over a modded pole: every wire of one color on it is one network", () => {
    const simulation = simulate(chain(true), 4);
    expect(networkAt(simulation, "p", "green")).toEqual(v({ A: 6, C: 1 }));
    expect(networkAt(simulation, "p", "red")).toEqual({});
    const compiled = compile(chain(true));
    expect(compiled.terminals["p.io"]).toEqual({ green: "green:d.out" });
    expect(compiled.networks.find((network) => network.id === "green:d.out")!.readers).toEqual(["l", "m", "p", "s"]);
  });

  it("is the same circuit to the simulation whichever prototype of a kind an entity is", () => {
    // The prototype decides the size and the reach, neither of which the simulation knows; a generic entity counts by its conditions.
    expect(semanticFingerprint(chain(true))).toBe(semanticFingerprint(chain(false)));
  });
});

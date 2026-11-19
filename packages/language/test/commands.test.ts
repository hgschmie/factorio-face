import {
  BOTH_NETWORKS, DEFAULT_ENTITY, ENTITY_KINDS, PROTOTYPE_NAMES, PROTOTYPES, wildcardSignal, wireKey,
  type ArithmeticCombinator, type ConstantCombinator, type DeciderCombinator, type Entity, type Lamp, type NetworkSelection, type SelectorCombinator,
} from "@face/model";
import { describe, expect, it } from "vitest";
import {
  addEntity, addWire, analyze, applyChanges, deleteEntities, EditError, executeCommand, moveEntities, moveEntity, printCircuit, printEntity, removeWire, renameEntity, updateEntity,
  type ParseResult, type TextChange,
} from "../src/index.ts";
import { circuit, codes, fixture, Generator, idOf, valid, withoutId } from "./helpers.ts";

const RED: NetworkSelection = { red: true, green: false };
const NONE: NetworkSelection = { red: false, green: false };

const comments = fixture("comments.face");
const parsed = valid(comments);
const id = (name: string) => idOf(parsed, name);

function entityOf<T extends Entity>(parse: ParseResult, name: string): T {
  return parse.circuit!.entities.find((e) => e.name === name) as T;
}

function expectSorted(changes: readonly TextChange[]): void {
  for (let i = 0; i < changes.length; i++) {
    expect(changes[i]!.from).toBeLessThanOrEqual(changes[i]!.to);
    if (i > 0) expect(changes[i]!.from).toBeGreaterThan(changes[i - 1]!.to);
  }
}

function failure(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    if (error instanceof EditError) return error.code;
    throw error;
  }
  return "no failure";
}

describe("applyChanges", () => {
  it("applies sorted changes and rejects overlapping ones", () => {
    expect(applyChanges("abcdef", [{ from: 0, to: 1, insert: "X" }, { from: 3, to: 3, insert: "-" }, { from: 5, to: 6, insert: "" }])).toBe("Xbc-de");
    expect(applyChanges("abc", [])).toBe("abc");
    expect(() => applyChanges("abcdef", [{ from: 2, to: 4, insert: "" }, { from: 3, to: 5, insert: "" }])).toThrow(RangeError);
    expect(() => applyChanges("abc", [{ from: 2, to: 9, insert: "" }])).toThrow(RangeError);
  });
});

describe("comment and spacing fixture: every command changes only the expected bytes", () => {
  it("moveEntity patches only the numbers", () => {
    const changes = moveEntity(parsed, id("twice"), { x: 380, y: 200 });
    expect(changes).toEqual([{ from: comments.indexOf("300"), to: comments.indexOf("300") + 3, insert: "380" }, { from: comments.indexOf("80) {", comments.indexOf("300")), to: comments.indexOf("80) {", comments.indexOf("300")) + 2, insert: "200" }]);
    expect(applyChanges(comments, changes)).toBe(comments.replace("twice at (300, 80)", "twice at (380, 200)"));
    expect(moveEntity(parsed, id("twice"), { x: 300, y: -260 })).toHaveLength(1);
    expect(moveEntity(parsed, id("twice"), { x: 300, y: 80 })).toEqual([]);
    expect(applyChanges(comments, moveEntity(parsed, id("twice"), { x: -259.6, y: 80.4 }))).toBe(comments.replace("twice at (300, 80)", "twice at (-260, 80)"));
  });

  it("moveEntities moves several entities in one change set", () => {
    const changes = moveEntities(parsed, [{ id: id("light"), position: { x: 600, y: 160 } }, { id: id("source"), position: { x: 40, y: 100 } }]);
    expectSorted(changes);
    expect(applyChanges(comments, changes)).toBe(comments.replace("source at (40, 80)", "source at (40, 100)").replace("light at (560, 80)", "light at (600, 160)"));
  });

  it("renameEntity updates the declaration and every reference", () => {
    const changes = renameEntity(parsed, id("twice"), "doubled");
    expect(changes).toHaveLength(3);
    expectSorted(changes);
    const renamed = applyChanges(comments, changes);
    expect(renamed).toBe(comments.replaceAll("twice", "doubled"));
    const after = valid(renamed, parsed);
    expect(after.circuit.wires).toEqual(parsed.circuit.wires);
    expect(idOf(after, "doubled")).toBe(id("twice"));
    expect(renameEntity(parsed, id("twice"), "twice")).toEqual([]);
  });

  it("addEntity appends after the last entity, before trailing wires, in the file's style", () => {
    const { changes, name } = addEntity(parsed, "constant-combinator", { x: 40, y: 260 });
    expect(name).toBe("constant1");
    expect(changes).toHaveLength(1);
    expect(applyChanges(comments, changes)).toBe(
      comments.replace("        always-on = false\n    }\n", "        always-on = false\n    }\n\n    constant-combinator constant1 at (40, 260) {\n    }\n"),
    );
    const after = valid(applyChanges(comments, changes), parsed);
    expect(after.circuit.entities.map((e) => e.id)).toEqual([...parsed.circuit.entities.map((e) => e.id), "e4"]);
    expect(withoutId(entityOf(after, "constant1"))).toEqual({ ...DEFAULT_ENTITY.constant, prototype: "constant-combinator", name: "constant1", position: { x: 40, y: 260 } });
  });

  it("addWire appends after the last member and keeps its trailing comment", () => {
    const changes = addWire(parsed, "green", { entity: id("source"), side: "out" }, { entity: id("light"), side: "in" });
    expect(changes).toEqual([{ from: comments.lastIndexOf("}"), to: comments.lastIndexOf("}"), insert: "    wire green source.out <-> light.in\n" }]);
    expect(applyChanges(comments, changes)).toBe(comments.replace("// keep this end-of-line comment\n", "// keep this end-of-line comment\n    wire green source.out <-> light.in\n"));
    expect(valid(applyChanges(comments, changes)).circuit.wires).toHaveLength(3);
  });

  it("deleteEntities removes the entity, incident wires and their trailing comments, nothing else", () => {
    const changes = deleteEntities(parsed, [id("twice")]);
    expectSorted(changes);
    const result = applyChanges(comments, changes);
    expect(result).toBe(`// Preserve this circuit heading exactly.
circuit "Text / canvas experiment" {

    // The source keeps this leading comment.
    constant-combinator source at (40, 80) {
        virtual:signal-A   =   5  // deliberately irregular spacing
        enabled = true    /* explicit default */
    }

    // A wire between declarations tests ordering in the model.

    small-lamp light at (560, 80) {
        when virtual:signal-B > 8
        always-on = false
    }
}
`);
    const after = valid(result, parsed);
    expect(after.circuit.entities.map((e) => e.name)).toEqual(["source", "light"]);
    expect(after.circuit.wires).toEqual([]);
  });

  it("removeWire removes the declaration line with its trailing comment", () => {
    const key = wireKey({ color: "green", a: { entity: id("twice"), side: "out" }, b: { entity: id("light"), side: "in" } });
    expect(applyChanges(comments, removeWire(parsed, key))).toBe(comments.replace("    wire green twice.out <-> light.in // keep this end-of-line comment\n", ""));
    const red = wireKey({ color: "red", a: { entity: id("source"), side: "out" }, b: { entity: id("twice"), side: "in" } });
    expect(applyChanges(comments, removeWire(parsed, red))).toBe(comments.replace("    wire red source.out <-> twice.in\n", ""));
  });

  it("updateEntity replaces one statement and keeps sibling statements and all comments", () => {
    const source = entityOf<ConstantCombinator>(parsed, "source");
    const next: ConstantCombinator = { ...source, sections: [{ ...source.sections[0]!, filters: [{ signal: { kind: "virtual", name: "signal-A" }, count: -17 }] }] };
    const changes = updateEntity(parsed, source.id, next);
    expect(changes).toEqual([{ from: comments.indexOf("virtual:signal-A   =   5"), to: comments.indexOf("virtual:signal-A   =   5") + 24, insert: "virtual:signal-A = -17" }]);
    expect(applyChanges(comments, changes)).toBe(comments.replace("virtual:signal-A   =   5  //", "virtual:signal-A = -17  //"));
  });

  it("updateEntity with the current configuration is a no-op", () => {
    for (const entity of parsed.circuit.entities) expect(updateEntity(parsed, entity.id, entity)).toEqual([]);
  });
});

describe("wires", () => {
  const source = circuit("    arithmetic-combinator a { }\n    small-lamp b { }\n\n    wire green a.out <-> b.in\n    wire green a.out <-> b.in // duplicate\n    wire green b.in <-> a.out // reversed\n    // own-line comment stays\n    wire red a.out <-> b.in");
  const parse = valid(source);
  const a = idOf(parse, "a");
  const b = idOf(parse, "b");

  it("adding an existing wire is a no-op in either direction", () => {
    expect(addWire(parse, "green", { entity: a, side: "out" }, { entity: b, side: "in" })).toEqual([]);
    expect(addWire(parse, "green", { entity: b, side: "in" }, { entity: a, side: "out" })).toEqual([]);
    expect(addWire(parse, "red", { entity: b, side: "in" }, { entity: a, side: "out" })).toEqual([]);
    const only = valid(circuit("arithmetic-combinator a { }\nsmall-lamp b { }\nwire green b.in <-> a.out"));
    expect(addWire(only, "green", { entity: "e1", side: "out" }, { entity: "e2", side: "in" })).toEqual([]);
  });

  it("adds a distinct connection in the given direction", () => {
    const changes = addWire(parse, "green", { entity: b, side: "in" }, { entity: a, side: "in" });
    expect(changes).toHaveLength(1);
    expect(changes[0]!.insert).toBe("    wire green b.in <-> a.in\n");
    expect(valid(applyChanges(source, changes)).circuit.wires).toHaveLength(3);
  });

  it("adds feedback wires on one entity", () => {
    const changes = addWire(parse, "red", { entity: a, side: "out" }, { entity: a, side: "in" });
    const after = valid(applyChanges(source, changes), parse);
    expect(after.circuit.wires).toContainEqual({ color: "red", a: { entity: a, side: "in" }, b: { entity: a, side: "out" } });
    expect(addWire(after, "red", { entity: a, side: "in" }, { entity: a, side: "out" })).toEqual([]);
  });

  it("validates terminals", () => {
    expect(failure(() => addWire(parse, "red", { entity: b, side: "out" }, { entity: a, side: "in" }))).toBe("invalid-terminal");
    expect(failure(() => addWire(parse, "red", { entity: a, side: "in" }, { entity: a, side: "in" }))).toBe("self-wire");
    expect(failure(() => addWire(parse, "red", { entity: "nope", side: "in" }, { entity: a, side: "in" }))).toBe("unknown-entity");
  });

  it("removeWire removes all duplicate and reversed declarations with their trailing comments", () => {
    const key = wireKey({ color: "green", a: { entity: a, side: "out" }, b: { entity: b, side: "in" } });
    const changes = removeWire(parse, key);
    expect(changes).toHaveLength(1);
    expect(applyChanges(source, changes)).toBe(circuit("    arithmetic-combinator a { }\n    small-lamp b { }\n\n    // own-line comment stays\n    wire red a.out <-> b.in"));
    expect(failure(() => removeWire(parse, "red|x.in|y.out"))).toBe("unknown-wire");
  });

  it("deleting an entity removes incident duplicate and reversed wires", () => {
    const result = applyChanges(source, deleteEntities(parse, [b]));
    expect(result).toBe(circuit("    arithmetic-combinator a { }\n\n    // own-line comment stays"));
    expect(valid(result).circuit.wires).toEqual([]);
  });

  it("appends the first wire after the last entity with the file's spacing", () => {
    const spaced = valid('circuit "t" {\n\tconstant-combinator a {\n\t\titem:x = 1\n\t}\n\n\tsmall-lamp b {\n\t}\n}\n');
    expect(applyChanges(spaced.source, addWire(spaced, "red", { entity: "e1", side: "out" }, { entity: "e2", side: "in" }))).toBe('circuit "t" {\n\tconstant-combinator a {\n\t\titem:x = 1\n\t}\n\n\tsmall-lamp b {\n\t}\n\n\twire red a.out <-> b.in\n}\n');
    const dense = valid("circuit \"t\" {\nconstant-combinator a { item:x = 1 }\nsmall-lamp b { }\n}");
    expect(applyChanges(dense.source, addWire(dense, "red", { entity: "e1", side: "out" }, { entity: "e2", side: "in" }))).toBe("circuit \"t\" {\nconstant-combinator a { item:x = 1 }\nsmall-lamp b { }\nwire red a.out <-> b.in\n}");
  });
});

describe("addEntity", () => {
  it("generates unique names per kind", () => {
    let parse: ParseResult = valid(circuit("    small-lamp lamp1 { }\n    small-lamp lamp3 { }"));
    const names: string[] = [];
    for (const prototype of ["small-lamp", "small-lamp", "constant-combinator", "arithmetic-combinator", "decider-combinator", "selector-combinator", "small-lamp"]) {
      const { changes, name } = addEntity(parse, prototype, { x: 0, y: 0 });
      names.push(name);
      parse = valid(applyChanges(parse.source, changes), parse);
    }
    expect(names).toEqual(["lamp2", "lamp4", "constant1", "arithmetic1", "decider1", "selector1", "lamp5"]);
    expect(parse.circuit!.entities.map((e) => e.name)).toEqual(["lamp1", "lamp3", ...names]);
    expect(parse.circuit!.entities.map((e) => e.id)).toEqual(["e1", "e2", "e3", "e4", "e5", "e6", "e7", "e8", "e9"]);
  });

  it("creates default configurations that parse back to the model defaults", () => {
    for (const prototype of PROTOTYPE_NAMES) {
      const empty = valid('circuit "t" {\n}\n');
      const { changes, name } = addEntity(empty, prototype, { x: 20, y: -40 }, "fresh");
      const after = valid(applyChanges(empty.source, changes));
      expect(name).toBe("fresh");
      expect(withoutId(after.circuit.entities[0]!)).toEqual({ ...DEFAULT_ENTITY[PROTOTYPES[prototype]!.kind], prototype, name: "fresh", position: { x: 20, y: -40 } });
    }
    expect(failure(() => addEntity(valid('circuit "t" {\n}\n'), "lamp", { x: 0, y: 0 }))).toBe("invalid-entity");
  });

  it("inserts into empty and single-line circuits", () => {
    const empty = valid('circuit "t" {}');
    expect(applyChanges(empty.source, addEntity(empty, "small-lamp", { x: 0, y: 0 }).changes)).toBe('circuit "t" {\n    small-lamp lamp1 at (0, 0) {\n    }\n}');
    const wiresOnly = valid(circuit("  small-lamp a { }\n  wire red a.in <-> a.in").replace("wire red a.in <-> a.in", ""));
    expect(applyChanges(wiresOnly.source, addEntity(wiresOnly, "small-lamp", { x: 0, y: 0 }).changes)).toBe('circuit "t" {\n  small-lamp a { }\n  small-lamp lamp1 at (0, 0) {\n  }\n  \n}\n');
    const inline = valid('circuit "t" { small-lamp a {} }');
    expect(valid(applyChanges(inline.source, addEntity(inline, "small-lamp", { x: 0, y: 0 }).changes)).circuit.entities).toHaveLength(2);
  });

  it("places the entity before leading wires when there is no entity yet", () => {
    const before = analyze('circuit "t" {\n    wire red a.out <-> b.in\n}\n');
    expect(before.hasErrors).toBe(true);
    const tabbed = valid('circuit "t" {\n\tsmall-lamp a {\n\t\talways-on = true\n\t}\n\twire red a.in <-> b.in\n\tsmall-lamp b {\n\t}\n\twire green a.in <-> b.in\n}\n');
    expect(applyChanges(tabbed.source, addEntity(tabbed, "decider-combinator", { x: 0, y: 20 }).changes)).toBe(
      'circuit "t" {\n\tsmall-lamp a {\n\t\talways-on = true\n\t}\n\twire red a.in <-> b.in\n\tsmall-lamp b {\n\t}\n\tdecider-combinator decider1 at (0, 20) {\n\t}\n\twire green a.in <-> b.in\n}\n',
    );
  });

  it("rejects invalid, reserved and duplicate names and bad positions", () => {
    expect(failure(() => addEntity(parsed, "small-lamp", { x: 0, y: 0 }, "1x"))).toBe("invalid-name");
    expect(failure(() => addEntity(parsed, "small-lamp", { x: 0, y: 0 }, "a-b"))).toBe("invalid-name");
    expect(failure(() => addEntity(parsed, "small-lamp", { x: 0, y: 0 }, "wire"))).toBe("reserved-name");
    expect(failure(() => addEntity(parsed, "small-lamp", { x: 0, y: 0 }, "twice"))).toBe("duplicate-name");
    expect(failure(() => addEntity(parsed, "small-lamp", { x: NaN, y: 0 }))).toBe("invalid-position");
    expect(failure(() => addEntity(parsed, "small-lamp", { x: 1e12, y: 0 }))).toBe("invalid-position");
  });
});

describe("move and rename", () => {
  it("inserts the at clause when absent", () => {
    const parse = valid(circuit("small-lamp a { }\nsmall-lamp b tile (1, 2) facing east {\n}"));
    expect(applyChanges(parse.source, moveEntities(parse, [{ id: "e1", position: { x: 100, y: -20 } }, { id: "e2", position: { x: 0, y: 0 } }]))).toBe(circuit("small-lamp a at (100, -20) { }\nsmall-lamp b at (0, 0) tile (1, 2) facing east {\n}"));
    const auto = parse.circuit.entities[0]!.position;
    expect(moveEntity(parse, "e1", auto)).toEqual([]);
  });

  it("rewrites irregular at clauses token by token", () => {
    const parse = valid(circuit("small-lamp a at ( 0x10 ,/* y */ -5 ) { }"));
    expect(applyChanges(parse.source, moveEntity(parse, "e1", { x: 16, y: 5 }))).toBe(circuit("small-lamp a at ( 0x10 ,/* y */ 5 ) { }"));
    expect(applyChanges(parse.source, moveEntity(parse, "e1", { x: 20, y: -5 }))).toBe(circuit("small-lamp a at ( 20 ,/* y */ -5 ) { }"));
  });

  it("renames self-wires and reversed references", () => {
    const parse = valid(circuit("decider-combinator gate { }\nsmall-lamp l { }\nwire red gate.out <-> gate.in\nwire green l.in <-> gate.out // gate stays in comments"));
    expect(applyChanges(parse.source, renameEntity(parse, "e1", "g2"))).toBe(circuit("decider-combinator g2 { }\nsmall-lamp l { }\nwire red g2.out <-> g2.in\nwire green l.in <-> g2.out // gate stays in comments"));
  });

  it("rejects invalid, duplicate and keyword names and unknown ids", () => {
    expect(failure(() => renameEntity(parsed, id("twice"), "9lives"))).toBe("invalid-name");
    expect(failure(() => renameEntity(parsed, id("twice"), ""))).toBe("invalid-name");
    expect(failure(() => renameEntity(parsed, id("twice"), "has space"))).toBe("invalid-name");
    expect(failure(() => renameEntity(parsed, id("twice"), "source"))).toBe("duplicate-name");
    expect(failure(() => renameEntity(parsed, id("twice"), "each"))).toBe("reserved-name");
    expect(failure(() => renameEntity(parsed, "e99", "x"))).toBe("unknown-entity");
    expect(failure(() => moveEntity(parsed, "e99", { x: 0, y: 0 }))).toBe("unknown-entity");
    expect(failure(() => deleteEntities(parsed, ["e99"]))).toBe("unknown-entity");
  });
});

describe("deleteEntities", () => {
  it("deletes several entities without blank-line debris", () => {
    const source = 'circuit "t" {\n    small-lamp a { }\n\n    small-lamp b { }\n\n    small-lamp c { }\n\n    small-lamp d { }\n}\n';
    const parse = valid(source);
    expect(applyChanges(source, deleteEntities(parse, ["e1"]))).toBe('circuit "t" {\n    small-lamp b { }\n\n    small-lamp c { }\n\n    small-lamp d { }\n}\n');
    expect(applyChanges(source, deleteEntities(parse, ["e2"]))).toBe('circuit "t" {\n    small-lamp a { }\n\n    small-lamp c { }\n\n    small-lamp d { }\n}\n');
    expect(applyChanges(source, deleteEntities(parse, ["e4"]))).toBe('circuit "t" {\n    small-lamp a { }\n\n    small-lamp b { }\n\n    small-lamp c { }\n}\n');
    expect(applyChanges(source, deleteEntities(parse, ["e2", "e3"]))).toBe('circuit "t" {\n    small-lamp a { }\n\n    small-lamp d { }\n}\n');
    expect(applyChanges(source, deleteEntities(parse, ["e3", "e4", "e3"]))).toBe('circuit "t" {\n    small-lamp a { }\n\n    small-lamp b { }\n}\n');
    expect(applyChanges(source, deleteEntities(parse, ["e1", "e2", "e3", "e4"]))).toBe('circuit "t" {\n}\n');
    expect(deleteEntities(parse, [])).toEqual([]);
  });

  it("keeps own-line comments and removes trailing comments of removed lines", () => {
    const source = circuit("    // about a\n    small-lamp a { } // trailing a\n    // about b\n    small-lamp b {\n        always-on = true // inner\n    } /* trailing b */\n    wire red a.in <-> b.in // trailing wire\n    // the end");
    const parse = valid(source);
    expect(applyChanges(source, deleteEntities(parse, ["e2"]))).toBe(circuit("    // about a\n    small-lamp a { } // trailing a\n    // about b\n    // the end"));
  });

  it("removes selected wires together with entities and their wires, as one edit", () => {
    const source = circuit("    small-lamp a { }\n    small-lamp b { }\n    small-lamp c { }\n\n    wire red a.in <-> b.in\n    wire green a.in <-> b.in // keep\n    wire red b.in <-> c.in\n    wire red b.in <-> a.in // the red one again");
    const parse = valid(source);
    const red = wireKey({ color: "red", a: { entity: "e2", side: "in" }, b: { entity: "e1", side: "in" } });
    const green = wireKey({ color: "green", a: { entity: "e1", side: "in" }, b: { entity: "e2", side: "in" } });
    // Every declaration of the connection goes, in either direction.
    expect(applyChanges(source, deleteEntities(parse, [], [red]))).toBe(circuit("    small-lamp a { }\n    small-lamp b { }\n    small-lamp c { }\n\n    wire green a.in <-> b.in // keep\n    wire red b.in <-> c.in"));
    expect(deleteEntities(parse, [], [red])).toEqual(removeWire(parse, red));
    // A wire of a deleted entity may be named as well; the wires that are left keep their lines.
    expect(applyChanges(source, deleteEntities(parse, ["e3"], [red, red]))).toBe(circuit("    small-lamp a { }\n    small-lamp b { }\n\n    wire green a.in <-> b.in // keep"));
    expect(applyChanges(source, deleteEntities(parse, ["e3"], [red, green]))).toBe(circuit("    small-lamp a { }\n    small-lamp b { }"));
    expect(executeCommand(parse, { type: "deleteEntities", ids: ["e3"], wires: [green] })).toMatchObject({ ok: true });
    expect(failure(() => deleteEntities(parse, ["e3"], ["red|e1.in|e9.in"]))).toBe("unknown-wire");
  });

  it("handles declarations sharing a line", () => {
    const source = 'circuit "t" { small-lamp a {} small-lamp b {} wire red a.in <-> b.in small-lamp c {} }';
    const parse = valid(source);
    expect(applyChanges(source, deleteEntities(parse, ["e2"]))).toBe('circuit "t" { small-lamp a {} small-lamp c {} }');
    expect(applyChanges(source, deleteEntities(parse, ["e1", "e3"]))).toBe('circuit "t" { small-lamp b {} }');
    expect(applyChanges(source, deleteEntities(parse, ["e1", "e2", "e3"]))).toBe('circuit "t" { }');
    const mixed = "circuit \"t\" {\n    small-lamp a {} small-lamp b {} // both\n    small-lamp c {}\n}";
    expect(applyChanges(mixed, deleteEntities(valid(mixed), ["e1"]))).toBe("circuit \"t\" {\n    small-lamp b {} // both\n    small-lamp c {}\n}");
    expect(applyChanges(mixed, deleteEntities(valid(mixed), ["e2"]))).toBe("circuit \"t\" {\n    small-lamp a {} // both\n    small-lamp c {}\n}");
  });
});

describe("invalid source", () => {
  const broken = analyze(comments.replace("* 2", "*"));

  it("yields no circuit and every command refuses", () => {
    expect(broken.hasErrors).toBe(true);
    expect(broken.circuit).toBeUndefined();
    const lamp = entityOf<Lamp>(parsed, "light");
    const attempts = [
      () => addEntity(broken, "small-lamp", { x: 0, y: 0 }),
      () => moveEntity(broken, "e1", { x: 0, y: 0 }),
      () => moveEntities(broken, []),
      () => renameEntity(broken, "e1", "x"),
      () => deleteEntities(broken, ["e1"]),
      () => addWire(broken, "red", { entity: "e1", side: "out" }, { entity: "e3", side: "in" }),
      () => removeWire(broken, "x"),
      () => updateEntity(broken, lamp.id, lamp),
    ];
    for (const attempt of attempts) expect(failure(attempt)).toBe("invalid-source");
    expect(executeCommand(broken, { type: "deleteEntities", ids: ["e1"] })).toMatchObject({ ok: false, code: "invalid-source" });
  });

  it("commands work again once the source is fixed, with stable ids", () => {
    const fixed = valid(comments, broken);
    expect(fixed.circuit.entities.map((e) => e.id)).toEqual(["e1", "e2", "e3"]);
    expect(moveEntity(fixed, "e1", { x: 0, y: 0 })).toHaveLength(2);
  });
});

describe("executeCommand", () => {
  it("returns changes, the generated name and typed failures as values", () => {
    expect(executeCommand(parsed, { type: "addEntity", prototype: "small-lamp", position: { x: 0, y: 0 } })).toMatchObject({ ok: true, name: "lamp1" });
    expect(executeCommand(parsed, { type: "moveEntities", moves: [{ id: id("twice"), position: { x: 0, y: 0 } }] })).toMatchObject({ ok: true, changes: [{ insert: "0" }, { insert: "0" }] });
    expect(executeCommand(parsed, { type: "renameEntity", id: id("twice"), name: "source" })).toMatchObject({ ok: false, code: "duplicate-name" });
    expect(executeCommand(parsed, { type: "removeWire", key: "nope" })).toMatchObject({ ok: false, code: "unknown-wire" });
    expect(executeCommand(parsed, { type: "addWire", color: "red", a: { entity: id("source"), side: "out" }, b: { entity: id("twice"), side: "in" } })).toEqual({ ok: true, changes: [] });
    expect(executeCommand(parsed, { type: "updateEntity", id: id("light"), entity: entityOf(parsed, "light") })).toEqual({ ok: true, changes: [] });
    expect(executeCommand(parsed, { type: "deleteEntities", ids: [id("light")] })).toMatchObject({ ok: true });
  });
});

describe("updateEntity: description", () => {
  const describeAs = (source: string, name: string, description: string | undefined): { changes: TextChange[]; result: string } => {
    const parse = valid(source);
    const current = entityOf<Entity>(parse, name);
    const changes = updateEntity(parse, current.id, { ...current, description });
    expectSorted(changes);
    const result = applyChanges(source, changes);
    expect(entityOf<Entity>(valid(result, parse), name).description).toBe(description || undefined);
    return { changes, result };
  };
  const AWKWARD = 'first line\nsecond "quoted" \\ line\n\n\ttabbed, Grüße 日本語 → 𝒜\r\n// no comment';
  const ENCODED = '"first line\\nsecond \\"quoted\\" \\\\ line\\n\\n\\ttabbed, Grüße 日本語 → 𝒜\\r\\n// no comment"';

  it("adds the property as one line at the top of the body, for every kind", () => {
    // A pole has nothing to say but its description: it is the empty body below.
    const statements = {
      "constant-combinator": "item:a = 1", "arithmetic-combinator": "item:a = item:b + 1", "decider-combinator": "output item:a = 1", "selector-combinator": "operation = count", "small-lamp": "always-on = true",
      "programmable-speaker": "volume = 50", "steel-chest": "read-contents = false",
    };
    for (const [prototype, statement] of Object.entries(statements)) {
      const source = circuit(`    // above\n    ${prototype} e at (0, 0) { // head\n        // inside\n        ${statement} // first\n    }\n    // below`);
      const { changes, result } = describeAs(source, "e", AWKWARD);
      const at = source.indexOf(`        ${statement}`);
      expect(changes).toEqual([{ from: at, to: at, insert: `        description = ${ENCODED}\n` }]);
      expect(result).toBe(source.replace(`        ${statement}`, `        description = ${ENCODED}\n        ${statement}`));
      expect(result.split("\n")).toHaveLength(source.split("\n").length + 1);
    }
    const empty = circuit("    small-lamp l { // head\n        // inside\n    }");
    expect(describeAs(empty, "l", "a\nb").result).toBe(empty.replace("// head\n", '// head\n        description = "a\\nb"\n'));
    const oneLine = circuit("    small-lamp l { always-on = true }");
    expect(describeAs(oneLine, "l", "a\nb").result).toBe(oneLine.replace("{ always-on", '{ description = "a\\nb" always-on'));
    expect(describeAs(circuit("\tsmall-lamp l {}"), "l", "a\nb").result).toBe(circuit('\tsmall-lamp l {\n\t\tdescription = "a\\nb"\n\t}'));
  });

  it("changes only the statement and keeps the comments and the spacing around it", () => {
    const { changes, result } = describeAs(comments, "twice", AWKWARD);
    const from = comments.indexOf('description = "doubles A"');
    expect(changes).toEqual([{ from, to: from + 'description = "doubles A"'.length, insert: `description = ${ENCODED}` }]);
    expect(result).toBe(comments.replace('description = "doubles A" //', `description = ${ENCODED} //`));
    // The same text again is no change, whatever the spelling in the source.
    expect(describeAs(result, "twice", AWKWARD).changes).toEqual([]);
    const spelled = circuit('    small-lamp l {\n        description   =   "a\tb" ; // raw tab\n    }');
    expect(describeAs(spelled, "l", "a\tb").changes).toEqual([]);
    expect(describeAs(spelled, "l", "a\tc").result).toBe(spelled.replace('description   =   "a\tb" ;', 'description = "a\\tc" ;'));
  });

  it("removes the property with its line, and leaves the rest of the body alone", () => {
    const expected = comments.replace('        description = "doubles A" // deliberately noncanonical order\n', "");
    for (const none of [undefined, ""]) {
      const { changes, result } = describeAs(comments, "twice", none);
      expect(changes).toHaveLength(1);
      expect(result).toBe(expected);
    }
    const oneLine = circuit('    small-lamp l { /* a */ description = "x" /* b */ always-on = true }');
    expect(describeAs(oneLine, "l", "").result).toBe(oneLine.replace('description = "x" ', ""));
    const only = circuit('    small-lamp l {\n        // note\n\n        description = "x"\n    }');
    expect(describeAs(only, "l", undefined).result).toBe(circuit("    small-lamp l {\n        // note\n    }"));
  });

  it("an empty description is none: nothing is written for it, and one written by hand stays until it changes", () => {
    const plain = circuit("    small-lamp l {\n        always-on = true\n    }");
    expect(describeAs(plain, "l", "").changes).toEqual([]);
    expect(executeCommand(valid(plain), { type: "updateEntity", id: "e1", entity: { ...entityOf<Lamp>(valid(plain), "l"), description: "" } })).toEqual({ ok: true, changes: [] });
    const written = circuit('    small-lamp l {\n        description = "" // empty\n        always-on = true\n    }');
    const parse = valid(written);
    const lamp = entityOf<Lamp>(parse, "l");
    expect(lamp.description).toBe("");
    expect(updateEntity(parse, lamp.id, lamp)).toEqual([]);
    expect(applyChanges(written, updateEntity(parse, lamp.id, { ...lamp, alwaysOn: false }))).toBe(written.replace("always-on = true", "always-on = false"));
    expect(applyChanges(written, updateEntity(parse, lamp.id, { ...lamp, description: undefined }))).toBe(plain);
    expect(applyChanges(written, updateEntity(parse, lamp.id, { ...lamp, description: "x" }))).toBe(written.replace('description = ""', 'description = "x"'));
  });
});

describe("updateEntity: statement-level minimal rewrite", () => {
  const update = (source: string, name: string, change: (entity: Entity) => Entity): string => {
    const parse = valid(source);
    const current = entityOf<Entity>(parse, name);
    const next = change(current);
    const changes = updateEntity(parse, current.id, next);
    expectSorted(changes);
    const result = applyChanges(source, changes);
    const after = valid(result, parse);
    expect(withoutId(entityOf(after, next.name))).toEqual(withoutId(next));
    return result;
  };

  const decider = circuit(`    decider-combinator gate at (0, 0) {
        // leading comment
        output virtual:signal-A = input   // first output
        when virtual:signal-A < 10 /* limit */ and virtual:signal-B > 0
        output virtual:signal-B   =   5 // second output

        else output virtual:signal-C = 1 // else
    }`);

  it("changing one number rewrites only that statement", () => {
    const result = update(decider, "gate", (e) => ({ ...(e as DeciderCombinator), outputs: [(e as DeciderCombinator).outputs[0]!, { ...(e as DeciderCombinator).outputs[1]!, constant: 6 }] }));
    expect(result).toBe(decider.replace("output virtual:signal-B   =   5 //", "output virtual:signal-B = 6 //"));
  });

  it("changing the condition rewrites only the when statement", () => {
    const result = update(decider, "gate", (e) => {
      const d = e as DeciderCombinator;
      return { ...d, conditions: [{ ...d.conditions[0]!, second: { type: "constant", value: 11 } }, d.conditions[1]!] };
    });
    expect(result).toBe(decider.replace("when virtual:signal-A < 10 /* limit */ and virtual:signal-B > 0", "when virtual:signal-A < 11 and virtual:signal-B > 0"));
  });

  it("switching a network selection, to none and back, rewrites only the statement it is in", () => {
    const select = (first: NetworkSelection, output: NetworkSelection) => (e: Entity): Entity => {
      const d = e as DeciderCombinator;
      return { ...d, conditions: [{ ...d.conditions[0]!, firstNetworks: first }, d.conditions[1]!], outputs: [{ ...d.outputs[0]!, networks: output }, d.outputs[1]!] };
    };
    const rewritten = decider.replace("when virtual:signal-A < 10 /* limit */ and", "when virtual:signal-A < 10 and");
    const none = update(decider, "gate", select(NONE, NONE));
    expect(none).toBe(rewritten.replace("when virtual:signal-A <", "when virtual:signal-A[none] <").replace("output virtual:signal-A = input   //", "output virtual:signal-A = input[none]   //"));
    const red = update(none, "gate", select(RED, BOTH_NETWORKS));
    expect(red).toBe(rewritten.replace("when virtual:signal-A <", "when virtual:signal-A[red] <"));
    expect(update(red, "gate", select(BOTH_NETWORKS, BOTH_NETWORKS))).toBe(rewritten);

    const arithmetic = circuit("    arithmetic-combinator a {\n        // product\n        item:x = item:a[red] * item:b /* b */ ; // both colors\n    }");
    const operand = update(arithmetic, "a", (e) => ({ ...(e as ArithmeticCombinator), second: { type: "signal", signal: { kind: "item", name: "b" }, networks: NONE } }));
    expect(operand).toBe(arithmetic.replace("item:b /* b */ ;", "item:b[none] /* b */ ;"));
    expect(update(operand, "a", (e) => ({ ...(e as ArithmeticCombinator), first: { type: "signal", signal: { kind: "item", name: "a" }, networks: NONE } }))).toBe(operand.replace("item:a[red]", "item:a[none]"));
  });

  it("writes an arithmetic expression without its output as the right side alone, in place, and with it again", () => {
    const withoutOutput = (entity: Entity): Entity => {
      const { output: _, ...rest } = entity as ArithmeticCombinator;
      return rest;
    };
    const x = { kind: "item" as const, name: "x" };
    const source = circuit('    arithmetic-combinator a {\n        description = "sum" // why\n        item:x = -5 + item:b[red] /* b */ ; // both\n    }');
    const emptied = update(source, "a", withoutOutput);
    expect(emptied).toBe(source.replace("item:x = -5 +", "-5 +"));
    expect(codes(emptied)).toEqual(["unconfigured"]);
    const changed = update(emptied, "a", (e) => ({ ...(e as ArithmeticCombinator), operation: "<<" }));
    expect(changed).toBe(emptied.replace("-5 +", "-5 <<"));
    expect(update(changed, "a", (e) => ({ ...(e as ArithmeticCombinator), operation: "+", output: x }))).toBe(source);
    // The expression of a new combinator: not written into an empty block, written where a statement stands, and an output is added to either.
    const blank = circuit("    arithmetic-combinator a {\n    }");
    expect(update(blank, "a", (e) => e)).toBe(blank);
    expect(update(blank, "a", (e) => ({ ...(e as ArithmeticCombinator), second: { type: "constant", value: 2 } }))).toBe(blank.replace("a {\n", "a {\n        0 * 2\n"));
    expect(update(blank, "a", (e) => ({ ...(e as ArithmeticCombinator), output: x }))).toBe(blank.replace("a {\n", "a {\n        item:x = 0 * 0\n"));
    const zero = update(source, "a", (e) => withoutOutput({ ...e, ...DEFAULT_ENTITY.arithmetic }));
    expect(zero).toBe(source.replace("item:x = -5 + item:b[red]", "0 * 0"));
    expect(update(zero, "a", (e) => ({ ...(e as ArithmeticCombinator), output: x }))).toBe(zero.replace("0 * 0", "item:x = 0 * 0"));
    const written = circuit("    arithmetic-combinator a { 0 * 0 }");
    expect(update(written, "a", (e) => e)).toBe(written);
    const each = { type: "signal" as const, signal: wildcardSignal("each"), networks: BOTH_NETWORKS };
    expect(update(written, "a", (e) => ({ ...(e as ArithmeticCombinator), first: each }))).toBe(written.replace("0 * 0", "each * 0"));
  });

  it("writes, changes and removes the networks property of a lamp in place", () => {
    const source = circuit("    small-lamp l {\n        // lit by b\n        when item:b > 0 // enable\n        always-on = true; // sep\n    }");
    const select = (inputNetworks: NetworkSelection) => (e: Entity): Entity => ({ ...(e as Lamp), inputNetworks });
    const none = update(source, "l", select(NONE));
    expect(none).toBe(source.replace("// enable\n", "// enable\n        networks = none\n"));
    const green = update(none, "l", select({ red: false, green: true }));
    expect(green).toBe(none.replace("networks = none", "networks = green"));
    expect(update(green, "l", select(BOTH_NETWORKS))).toBe(source);
    // A hand-written statement that keeps its meaning keeps its text.
    const written = circuit("    small-lamp l { networks   =   none /* dark */ always-on = true }");
    expect(update(written, "l", (e) => ({ ...(e as Lamp), alwaysOn: false }))).toBe(written.replace("always-on = true", "always-on = false"));
    expect(update(written, "l", select(RED))).toBe(written.replace("networks   =   none", "networks = red"));
  });

  it("inserts new outputs after the previous output and removes dropped ones with their line", () => {
    const added = update(decider, "gate", (e) => {
      const d = e as DeciderCombinator;
      return { ...d, outputs: [d.outputs[0]!, { signal: { kind: "item", name: "new" }, copyCountFromInput: false, constant: 3, networks: BOTH_NETWORKS }, d.outputs[1]!] };
    });
    expect(added).toBe(decider.replace("// first output\n", "// first output\n        output item:new = 3\n"));
    const removed = update(decider, "gate", (e) => ({ ...(e as DeciderCombinator), outputs: [(e as DeciderCombinator).outputs[1]!] }));
    expect(removed).toBe(decider.replace("        output virtual:signal-A = input   // first output\n", ""));
    const noElse = update(decider, "gate", (e) => ({ ...(e as DeciderCombinator), elseOutputs: [] }));
    expect(noElse).toBe(decider.replace("\n\n        else output virtual:signal-C = 1 // else", ""));
  });

  it("inserts a first output before the existing ones and a description at the top", () => {
    const result = update(decider, "gate", (e) => {
      const d = e as DeciderCombinator;
      return { ...d, description: "note", outputs: [{ signal: { kind: "item", name: "first" }, copyCountFromInput: true, constant: 1, networks: { red: true, green: false } }, ...d.outputs] };
    });
    expect(result).toBe(decider.replace("        output virtual:signal-A = input   //", '        description = "note"\n        output item:first = input[red]\n        output virtual:signal-A = input   //'));
  });

  it("keeps explicit default statements and flips them in place", () => {
    const source = circuit("    constant-combinator c {\n        enabled = true // on\n        item:a = 1\n    }\n    small-lamp l {\n        always-on = false; // sep\n    }");
    expect(update(source, "c", (e) => ({ ...(e as ConstantCombinator), enabled: false }))).toBe(source.replace("enabled = true // on", "enabled = false // on"));
    expect(update(source, "l", (e) => ({ ...(e as Lamp), alwaysOn: true }))).toBe(source.replace("always-on = false;", "always-on = true;"));
    expect(update(source, "l", (e) => ({ ...(e as Lamp), description: "d" }))).toBe(source.replace("        always-on = false;", '        description = "d"\n        always-on = false;'));
  });

  it("fills an empty body in each layout", () => {
    const set = (e: Entity): Entity => ({ ...(e as Lamp), alwaysOn: true, condition: { first: { kind: "item", name: "a" }, comparator: ">", second: { type: "constant", value: 0 } } });
    expect(update(circuit("    small-lamp l {\n    }"), "l", set)).toBe(circuit("    small-lamp l {\n        when item:a > 0\n        always-on = true\n    }"));
    expect(update(circuit("    small-lamp l {}"), "l", set)).toBe(circuit("    small-lamp l {\n        when item:a > 0\n        always-on = true\n    }"));
    expect(update(circuit("\tsmall-lamp l { /* keep */ }"), "l", set)).toBe(circuit("\tsmall-lamp l { /* keep */\n\t\twhen item:a > 0\n\t\talways-on = true\n\t}"));
    expect(update(circuit("    small-lamp l { // keep\n    }"), "l", set)).toBe(circuit("    small-lamp l { // keep\n        when item:a > 0\n        always-on = true\n    }"));
  });

  it("edits single-line bodies inline", () => {
    const source = circuit("    selector-combinator s at (0, 0) { operation = select  order = min  index = virtual:signal-I }");
    expect(update(source, "s", (e) => ({ ...(e as SelectorCombinator), mode: { ...(e as SelectorCombinator).mode, max: true } as SelectorCombinator["mode"] }))).toBe(source.replace("order = min", "order = max"));
    expect(update(source, "s", (e) => ({ ...(e as SelectorCombinator), mode: { operation: "select", max: false, index: { type: "signal", signal: { kind: "virtual", name: "signal-I" }, networks: BOTH_NETWORKS }, indexComparator: "<" } }))).toBe(
      source.replace("index = virtual:signal-I", "index = virtual:signal-I index-comparator = <"),
    );
    expect(update(source, "s", (e) => ({ ...(e as SelectorCombinator), mode: { operation: "count", output: { kind: "item", name: "n" } } }))).toBe(circuit("    selector-combinator s at (0, 0) { operation = count output = item:n }"));
    expect(update(source, "s", (e) => ({ ...(e as SelectorCombinator), mode: { operation: "stack-size" } }))).toBe(circuit("    selector-combinator s at (0, 0) { operation = stack-size }"));
  });

  it("replaces every statement of a single-line body", () => {
    const set = (e: Entity): Entity => ({ ...(e as Lamp), alwaysOn: false, condition: { first: { kind: "item", name: "a" }, comparator: ">", second: { type: "constant", value: 0 } }, inputNetworks: { red: true, green: false } });
    expect(update(circuit("    small-lamp l { always-on = true }"), "l", ({ ...e }) => ({ ...set(e), alwaysOn: true }))).toBe(circuit("    small-lamp l { when item:a > 0 networks = red always-on = true }"));
    expect(update(circuit("    small-lamp l {always-on = true}"), "l", ({ ...e }) => ({ ...set(e), alwaysOn: true }))).toBe(circuit("    small-lamp l {when item:a > 0 networks = red always-on = true}"));
    expect(update(circuit("    small-lamp l { colors = mapping }"), "l", (e) => ({ ...set(e), useColors: false }))).toBe(circuit("    small-lamp l { when item:a > 0 networks = red }"));
    expect(update(circuit("    constant-combinator c { item:a = 1 item:b = 2 }"), "c", (e) => ({ ...(e as ConstantCombinator), sections: [] }))).toBe(circuit("    constant-combinator c { }"));
    expect(update(circuit("    constant-combinator c { item:a = 1 item:b = 2 }"), "c", (e) => ({ ...(e as ConstantCombinator), enabled: false, sections: [] }))).toBe(circuit("    constant-combinator c { enabled = false }"));
  });

  it("rewrites constant filters with a sequence diff", () => {
    const source = circuit("    constant-combinator c {\n        item:a = 1 // a\n        item:b = 2 // b\n        item:c = 3 // c\n    }");
    const filters = (list: [string, number][]) => (e: Entity): Entity => ({ ...(e as ConstantCombinator), sections: list.length ? [{ active: true, multiplier: 1, filters: list.map(([name, count]) => ({ signal: { kind: "item", name }, count })) }] : [] });
    expect(update(source, "c", filters([["a", 1], ["b", 20], ["c", 3]]))).toBe(source.replace("item:b = 2", "item:b = 20"));
    expect(update(source, "c", filters([["a", 1], ["c", 3]]))).toBe(source.replace("        item:b = 2 // b\n", ""));
    expect(update(source, "c", filters([["a", 1], ["b", 2], ["x", 9], ["c", 3]]))).toBe(source.replace("// b\n", "// b\n        item:x = 9\n"));
    expect(update(source, "c", filters([["x", 9], ["a", 1], ["b", 2], ["c", 3]]))).toBe(source.replace("        item:a", "        item:x = 9\n        item:a"));
    expect(update(source, "c", filters([["c", 3], ["a", 1], ["b", 2]]))).toBe(circuit("    constant-combinator c {\n        item:c = 3\n        item:a = 1 // a\n        item:b = 2 // b\n    }"));
    expect(update(source, "c", filters([]))).toBe(circuit("    constant-combinator c {\n    }"));
  });

  it("switches between bare filters and sections and edits inside sections", () => {
    const bare = circuit("    constant-combinator c {\n        item:a = 1\n    }");
    const grouped = update(bare, "c", (e) => ({ ...(e as ConstantCombinator), sections: [{ group: "G", active: true, multiplier: 2, filters: [{ signal: { kind: "item", name: "a" }, count: 1 }] }] }));
    expect(grouped).toBe(circuit('    constant-combinator c {\n        section "G" {\n            multiplier = 2\n            item:a = 1\n        }\n    }'));

    const sections = circuit('    constant-combinator c {\n        section "G" { // group\n            item:a = 1 // a\n            active = true\n        }\n        section {\n            item:b = 2\n        }\n    }');
    const edit = (change: (sections: ConstantCombinator["sections"]) => ConstantCombinator["sections"]) => update(sections, "c", (e) => ({ ...(e as ConstantCombinator), sections: change((e as ConstantCombinator).sections) }));
    expect(edit(([g, s]) => [{ ...g!, filters: [{ signal: { kind: "item", name: "a" }, count: 7 }] }, s!])).toBe(sections.replace("item:a = 1 //", "item:a = 7 //"));
    expect(edit(([g, s]) => [{ ...g!, group: "H", active: false, multiplier: -0.5 }, s!])).toBe(sections.replace('"G"', '"H"').replace("active = true", "active = false\n            multiplier = -0.5"));
    expect(edit(([g, s]) => [{ active: g!.active, multiplier: g!.multiplier, filters: g!.filters }, { ...s!, group: "New" }])).toBe(sections.replace('section "G" {', "section {").replace("        section {\n            item:b", '        section "New" {\n            item:b'));
    expect(edit(([g]) => [g!])).toBe(sections.replace("        section {\n            item:b = 2\n        }\n", ""));
    expect(edit(([g, s]) => [g!, s!, { active: true, multiplier: 1, filters: [] }])).toBe(sections.replace("item:b = 2\n        }\n", "item:b = 2\n        }\n        section {\n        }\n"));
    expect(edit(([, s]) => [s!])).toBe(circuit("    constant-combinator c {\n        section {\n            item:b = 2\n        }\n    }"));
  });

  it("updates name, position and placement clauses together with statements", () => {
    const source = circuit("    small-lamp l { }\n    constant-combinator c at (0, 0) facing north { item:a = 1 }\n    wire red c.out <-> l.in");
    expect(update(source, "l", (e) => ({ ...e, name: "bulb", position: { x: 20, y: 40 }, placement: { tile: { x: 1.5, y: 2 }, direction: "west" } }))).toBe(
      circuit("    small-lamp bulb at (20, 40) tile (1.5, 2) facing west { }\n    constant-combinator c at (0, 0) facing north { item:a = 1 }\n    wire red c.out <-> bulb.in"),
    );
    expect(update(source, "c", (e) => ({ ...e, placement: { tile: { x: 3, y: 4 } } }))).toBe(source.replace("at (0, 0) facing north", "at (0, 0) tile (3, 4)"));
    expect(update(source, "c", ({ placement: _placement, ...e }) => ({ ...e, position: { x: 0, y: 20 } }) as Entity)).toBe(source.replace("at (0, 0) facing north", "at (0, 20)"));
    expect(update(source, "c", (e) => ({ ...e, placement: { direction: "south" } }))).toBe(source.replace("north", "south"));
  });

  it("rejects another prototype, bad names and inexpressible configurations", () => {
    const lamp = entityOf<Lamp>(parsed, "light");
    expect(failure(() => updateEntity(parsed, lamp.id, { ...DEFAULT_ENTITY.decider, prototype: "decider-combinator", id: lamp.id, name: lamp.name, position: lamp.position }))).toBe("prototype-mismatch");
    expect(failure(() => updateEntity(parsed, lamp.id, { ...lamp, name: "source" }))).toBe("duplicate-name");
    expect(failure(() => updateEntity(parsed, lamp.id, { ...lamp, name: "no good" }))).toBe("invalid-name");
    expect(failure(() => updateEntity(parsed, lamp.id, { ...lamp, useColors: false, colorMode: "components" }))).toBe("unrepresentable");
    expect(failure(() => updateEntity(parsed, lamp.id, { ...lamp, redSignal: { kind: "virtual", name: "signal-each" } }))).toBe("invalid-entity");
    expect(failure(() => updateEntity(parsed, "e99", lamp))).toBe("unknown-entity");
  });

  it("transforms randomized entities into each other in canonical, commented and single-line layouts", () => {
    const generator = new Generator(2026);
    for (let round = 0; round < 400; round++) {
      const kind = generator.pick(ENTITY_KINDS);
      const from = generator.entity(kind, "target");
      // Of the same prototype: an edit does not change which entity of the game it is.
      const to = { ...generator.entity(kind, generator.chance(0.2) ? "renamed" : "target", from.prototype), ...(generator.chance(0.5) ? { position: from.position } : {}) };
      const layout = round % 3;
      let declaration = printEntity(from);
      if (layout === 1) declaration = declaration.split("\n").map((line, i) => `${line} // c${i}`).join("\n");
      if (layout === 2) declaration = declaration.replace(/\n\s*/g, " ");
      const before = `circuit "r" {\n    // head\n    small-lamp pre { } // pre\n\n${declaration.replace(/^/gm, "    ")}\n\n    small-lamp post { } // post\n    wire red pre.in <-> post.in\n}\n`;
      const parse = valid(before);
      const target = entityOf<Entity>(parse, "target");
      expect(withoutId(target)).toEqual(withoutId(from));
      expect(updateEntity(parse, target.id, target)).toEqual([]);

      const changes = updateEntity(parse, target.id, { ...to, id: target.id });
      expectSorted(changes);
      const source = parse.sourceMap.entities.get(target.id)!;
      for (const change of changes) expect(change.from >= source.range.from && change.to <= source.range.to).toBe(true);
      const after = valid(applyChanges(before, changes), parse);
      // An empty description is written as none, unless the source spells it out already.
      expect(withoutId(entityOf(after, to.name))).toEqual(withoutId(to.description === "" && from.description !== "" ? { ...to, description: undefined } : to));
      expect(idOf(after, to.name)).toBe(target.id);
      expect(after.source.startsWith('circuit "r" {\n    // head\n    small-lamp pre { } // pre\n\n')).toBe(true);
      expect(after.source.endsWith("\n\n    small-lamp post { } // post\n    wire red pre.in <-> post.in\n}\n")).toBe(true);
      expect(updateEntity(after, target.id, entityOf(after, to.name))).toEqual([]);
    }
  });

  it("printCircuit output accepts every command", () => {
    const generator = new Generator(5);
    const printed = printCircuit(generator.circuit(6));
    const parse = valid(printed);
    const first = parse.circuit.entities[0]!;
    const deleted = valid(applyChanges(printed, deleteEntities(parse, [first.id])), parse);
    expect(deleted.circuit.entities.map((e) => e.name)).toEqual(parse.circuit.entities.slice(1).map((e) => e.name));
    expect(deleted.circuit.wires.every((w) => w.a.entity !== first.id && w.b.entity !== first.id)).toBe(true);
    expect(deleted.source).not.toMatch(/\n\n\n|\{\n\n|\n\n\}/);
  });
});

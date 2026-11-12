import { describe, expect, it } from "vitest";
import {
  addEntity, addWire, analyze, analyzeFragment, applyChanges, EditError, executeCommand, extractFragment, parseFragment, pasteFragment, printCircuit, printFragment, uniqueNames,
  type Fragment, type ParseResult,
} from "../src/index.ts";
import { circuit, fixture, Generator, idOf, portable, valid } from "./helpers.ts";

const EXAMPLE = `circuit "Feedback example" {
    constant source at (40, 80) {
        virtual:signal-A = 1
    }

    decider gate at (300, 80) tile (2.5, -1) facing east {
        description = "Counts A,\\nthen starts over."
        when virtual:signal-A < 10
        output virtual:signal-A = input
    }

    lamp light at (560, 80) {
        when virtual:signal-A > 8
    }

    wire red source.out <-> gate.in
    wire green gate.out <-> gate.in      // feedback
    wire green gate.out <-> light.in
}
`;
const example = valid(EXAMPLE);

function fragmentOf(source: string): Fragment {
  const result = analyzeFragment(source);
  if (!result.fragment) throw new Error(`Unexpected errors: ${JSON.stringify(result.diagnostics)}`);
  return result.fragment;
}

function copy(parse: ParseResult, ...names: string[]): Fragment {
  return extractFragment(parse.circuit!, names.map((name) => idOf(parse, name)));
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

/** Applies a paste and returns the new source with its analysis. */
function paste(parse: ParseResult, fragment: Fragment, shift = { x: 0, y: 0 }) {
  const { changes, names } = pasteFragment(parse, fragment, shift);
  const source = applyChanges(parse.source, changes);
  return { source, names, after: valid(source, parse) };
}

describe("extractFragment and printFragment", () => {
  it("takes the selected entities in declaration order and only the wires between them", () => {
    const fragment = extractFragment(example.circuit, [idOf(example, "gate"), idOf(example, "source"), "unknown"]);
    expect(fragment.entities.map((e) => e.name)).toEqual(["source", "gate"]);
    expect(printFragment(fragment)).toBe(`constant source at (40, 80) {
    virtual:signal-A = 1
}

decider gate at (300, 80) tile (2.5, -1) facing east {
    description = "Counts A,\\nthen starts over."
    when virtual:signal-A < 10
    output virtual:signal-A = input
}

wire red source.out <-> gate.in
wire green gate.out <-> gate.in
`);
    // A wire to an entity outside the selection is not copied.
    expect(printFragment(copy(example, "light"))).toBe("lamp light at (560, 80) {\n    when virtual:signal-A > 8\n}\n");
    expect(printFragment(copy(example, "source", "light"))).not.toContain("wire");
    expect(printFragment(extractFragment(example.circuit, []))).toBe("");
  });

  it("prints every expressible circuit so that it reads back as the same entities and wires", () => {
    const generator = new Generator(20261112);
    for (let round = 0; round < 60; round++) {
      const original = generator.circuit(generator.int(0, 8));
      const text = printFragment(original);
      const { fragment, diagnostics } = analyzeFragment(text);
      expect(diagnostics.filter((d) => d.severity === "error"), text).toEqual([]);
      expect(portable({ name: "", ...fragment! })).toEqual(portable({ ...original, name: "" }));
      // The text is the body of the printed circuit, one indentation level less.
      const body = text.replace(/^(?=.)/gm, "    ");
      expect(printCircuit(original)).toBe(`circuit ${JSON.stringify(original.name)} {\n${body}}\n`);
    }
  });
});

describe("parseFragment and analyzeFragment", () => {
  it("reads declarations without a circuit around them, with comments and separators", () => {
    const syntax = parseFragment("// copied\nlamp a { }; lamp b at (20, 40) { }\n/* and */ wire red a.in <-> b.in,\n");
    expect(syntax.diagnostics).toEqual([]);
    expect(syntax.members.map((m) => m.type)).toEqual(["entity", "entity", "wire"]);
    const fragment = fragmentOf("lamp a { }\nlamp b at (20, 40) { }\nwire red a.in <-> b.in\nwire red b.in <-> a.in");
    // An entity without a position gets the first free slot, as in a circuit.
    expect(fragment.entities.map((e) => [e.name, e.position])).toEqual([["a", { x: 280, y: 40 }], ["b", { x: 20, y: 40 }]]);
    expect(fragment.wires).toHaveLength(1);
  });

  it("accepts the source of a whole circuit and yields its members", () => {
    const fragment = fragmentOf(EXAMPLE);
    expect(portable({ name: "Feedback example", ...fragment })).toEqual(portable(example.circuit));
    expect(analyzeFragment(`${EXAMPLE}lamp extra { }`).hasErrors).toBe(true);
  });

  it("is empty for text without declarations", () => {
    for (const text of ["", "  \n", "// only a comment\n"]) expect(fragmentOf(text)).toEqual({ entities: [], wires: [] });
  });

  it("reports what is not a fragment and returns none", () => {
    const codes = (text: string) => {
      const result = analyzeFragment(text);
      expect(result.hasErrors).toBe(true);
      expect(result.fragment).toBeUndefined();
      return result.diagnostics.filter((d) => d.severity === "error").map((d) => d.code);
    };
    expect(codes("hello world")).toEqual(["syntax-error"]);
    expect(codes("https://example.org/a?b=1")).toContain("syntax-error");
    expect(codes("lamp a { }\n}")).toEqual(["syntax-error"]);
    expect(codes("lamp a { }\ncircuit \"x\" { }")).toEqual(["syntax-error"]);
    expect(codes("lamp a {")).toEqual(["syntax-error"]);
    expect(codes("lamp a { }\nlamp a { }")).toEqual(["duplicate-entity"]);
    expect(codes("lamp wire { }")).toContain("syntax-error");
    // A wire needs both of its entities in the fragment.
    expect(codes("lamp a { }\nwire red a.in <-> b.in")).toEqual(["unknown-entity"]);
    expect(codes("lamp a { }\nlamp b { }\nwire red a.out <-> b.in")).toEqual(["invalid-terminal"]);
    expect(codes("constant c { virtual:signal-A = 99999999999 }")).toEqual(["integer-range"]);
    expect(codes("import x")).toEqual(["unsupported-feature"]);
  });

  it("never throws on arbitrary text", () => {
    const generator = new Generator(7);
    const pieces = ["lamp", "wire", "circuit", "{", "}", "a", "b", ".", "in", "<->", "red", "at", "(", ")", "1", ",", '"', "\n", "virtual:signal-A", "=", "when", "//", "/*", "section"];
    for (let round = 0; round < 300; round++) {
      const text = Array.from({ length: generator.int(0, 14) }, () => generator.pick(pieces)).join(" ");
      expect(() => analyzeFragment(text)).not.toThrow();
    }
  });
});

describe("uniqueNames", () => {
  it("keeps free names and numbers the taken ones from 2, without their old digits", () => {
    expect(uniqueNames(["gate", "free"], ["gate"])).toEqual(["gate2", "free"]);
    expect(uniqueNames(["gate2"], ["gate", "gate2"])).toEqual(["gate3"]);
    expect(uniqueNames(["gate2"], ["gate2"])).toEqual(["gate3"]);
    expect(uniqueNames(["gate"], ["gate", "gate2", "gate3", "gate5"])).toEqual(["gate4"]);
    expect(uniqueNames(["lamp1", "lamp2"], ["lamp1", "lamp2"])).toEqual(["lamp3", "lamp4"]);
    expect(uniqueNames(["x_9", "_1", "a1b2"], ["x_9", "_1", "a1b2"])).toEqual(["x_2", "_2", "a1b3"]);
  });

  it("does not hand out a name that another copy keeps", () => {
    expect(uniqueNames(["a", "a2"], ["a"])).toEqual(["a3", "a2"]);
    expect(uniqueNames(["a2", "a"], ["a"])).toEqual(["a2", "a3"]);
    expect(uniqueNames(["a", "a"], [])).toEqual(["a", "a2"]);
  });
});

describe("pasteFragment", () => {
  it("appends renamed copies after the last entity and their wires at the end, as one sorted change set", () => {
    const { changes, names } = pasteFragment(example, copy(example, "source", "gate"), { x: 40, y: 40 });
    expect(names).toEqual(["source2", "gate2"]);
    expect(changes).toHaveLength(2);
    expect(applyChanges(EXAMPLE, changes)).toBe(`circuit "Feedback example" {
    constant source at (40, 80) {
        virtual:signal-A = 1
    }

    decider gate at (300, 80) tile (2.5, -1) facing east {
        description = "Counts A,\\nthen starts over."
        when virtual:signal-A < 10
        output virtual:signal-A = input
    }

    lamp light at (560, 80) {
        when virtual:signal-A > 8
    }

    constant source2 at (80, 120) {
        virtual:signal-A = 1
    }

    decider gate2 at (340, 120) facing east {
        description = "Counts A,\\nthen starts over."
        when virtual:signal-A < 10
        output virtual:signal-A = input
    }

    wire red source.out <-> gate.in
    wire green gate.out <-> gate.in      // feedback
    wire green gate.out <-> light.in
    wire red source2.out <-> gate2.in
    wire green gate2.out <-> gate2.in
}
`);
  });

  it("gives the copies new ids, keeps the existing ones and copies everything but the tile", () => {
    const { after, names } = paste(example, copy(example, "gate"), { x: 0, y: 200 });
    expect(names).toEqual(["gate2"]);
    expect(after.circuit.entities.map((e) => e.id)).toEqual(["e1", "e2", "e3", "e4"]);
    const [original, pasted] = [after.circuit.entities.find((e) => e.name === "gate")!, after.circuit.entities.find((e) => e.name === "gate2")!];
    expect(original.id).toBe(idOf(example, "gate"));
    expect(pasted).toEqual({ ...original, id: "e4", name: "gate2", position: { x: 300, y: 280 }, placement: { direction: "east" } });
    expect(original.placement).toEqual({ tile: { x: 2.5, y: -1 }, direction: "east" });
    // The feedback wire of the copy is the copy's own.
    expect(after.circuit.wires).toHaveLength(4);
    expect(after.sourceMap.wires.has("green|e4.in|e4.out")).toBe(true);
  });

  it("pastes the same fragment again with the next free names", () => {
    const fragment = copy(example, "source", "gate");
    const once = paste(example, fragment).after;
    const twice = paste(once, fragment);
    expect(twice.names).toEqual(["source3", "gate3"]);
    expect(twice.after.circuit.entities.map((e) => e.name)).toEqual(["source", "gate", "light", "source2", "gate2", "source3", "gate3"]);
    expect(twice.after.circuit.wires).toHaveLength(7);
    // A copy of the copy counts on from its number.
    expect(paste(twice.after, copy(twice.after, "gate2")).names).toEqual(["gate4"]);
  });

  it("keeps names that are free in the target and lets the wires follow the renamed ones", () => {
    const target = valid(circuit("    lamp light { }\n    constant feed { }"));
    const { source, names } = paste(target, fragmentOf("constant feed at (0, 0) { }\nlamp light at (0, 0) { }\narithmetic sum at (0, 0) { }\nwire red feed.out <-> sum.in\nwire green sum.out <-> light.in"));
    expect(names).toEqual(["feed2", "light2", "sum"]);
    expect(source).toContain("    wire red feed2.out <-> sum.in\n    wire green sum.out <-> light2.in\n");
  });

  it("touches nothing else in a file with comments and irregular spacing", () => {
    const comments = fixture("comments.face");
    const parsed = valid(comments);
    const { changes } = pasteFragment(parsed, copy(parsed, "source", "twice", "light"), { x: 0, y: 200 });
    const result = applyChanges(comments, changes);
    const entities = `
    constant source2 at (40, 280) {
        virtual:signal-A = 5
    }

    arithmetic twice2 at (300, 280) {
        description = "doubles A"
        virtual:signal-B = virtual:signal-A * 2
    }

    lamp light2 at (560, 280) {
        when virtual:signal-B > 8
    }
`;
    const wires = "    wire red source2.out <-> twice2.in\n    wire green twice2.out <-> light2.in\n";
    const lastEntityEnd = comments.indexOf("    wire green twice.out");
    expect(result).toBe(`${comments.slice(0, lastEntityEnd)}${entities}${comments.slice(lastEntityEnd, comments.lastIndexOf("}"))}${wires}}\n`);
    // Removing the inserted text gives the original back byte for byte.
    expect(result.replace(entities, "").replace(wires, "")).toBe(comments);
    expect(valid(result, parsed).circuit.wires).toHaveLength(4);
  });

  it("puts the copies where addEntity and addWire put theirs", () => {
    const lamp = fragmentOf("lamp lamp1 at (20, 40) {\n}\nconstant constant1 at (0, 0) {\n}\nwire red constant1.out <-> lamp1.in");
    const empty = valid('circuit "t" {\n}\n');
    const pasted = paste(empty, lamp).source;
    const first = addEntity(empty, "lamp", { x: 20, y: 40 });
    const second = valid(applyChanges(empty.source, first.changes));
    const third = valid(applyChanges(second.source, addEntity(second, "constant", { x: 0, y: 0 }).changes));
    expect(pasted).toBe(applyChanges(third.source, addWire(third, "red", { entity: idOf(third, "constant1"), side: "out" }, { entity: idOf(third, "lamp1"), side: "in" })));
    expect(pasted).toBe('circuit "t" {\n    lamp lamp1 at (20, 40) {\n    }\n\n    constant constant1 at (0, 0) {\n    }\n\n    wire red constant1.out <-> lamp1.in\n}\n');

    // The file's own style: tabs, no blank lines, no line break at the end.
    const dense = valid('circuit "t" {\n\tconstant a at (0, 0) {\n\t\titem:x = 1\n\t}\n\tlamp b at (0, 0) { }\n\twire red a.out <-> b.in\n}');
    expect(paste(dense, copy(dense, "a", "b")).source).toBe(
      'circuit "t" {\n\tconstant a at (0, 0) {\n\t\titem:x = 1\n\t}\n\tlamp b at (0, 0) { }\n\tconstant a2 at (0, 0) {\n\t\titem:x = 1\n\t}\n\tlamp b2 at (0, 0) {\n\t}\n\twire red a.out <-> b.in\n\twire red a2.out <-> b2.in\n}',
    );
    const inline = valid('circuit "t" { lamp a { } }');
    expect(paste(inline, copy(inline, "a")).after.circuit.entities.map((e) => e.name)).toEqual(["a", "a2"]);
    const braces = valid('circuit "t" {}');
    expect(paste(braces, lamp).after.circuit.wires).toHaveLength(1);
  });

  it("moves every position by the shift and rounds it", () => {
    const { after } = paste(example, copy(example, "source", "light"), { x: -100.4, y: 19.6 });
    expect(after.circuit.entities.slice(3).map((e) => e.position)).toEqual([{ x: -60, y: 100 }, { x: 460, y: 100 }]);
    expect(failure(() => pasteFragment(example, copy(example, "source"), { x: 1e12, y: 0 }))).toBe("invalid-position");
    expect(failure(() => pasteFragment(example, copy(example, "source"), { x: NaN, y: 0 }))).toBe("invalid-position");
  });

  it("an empty fragment changes nothing; an invalid one or an invalid source is refused", () => {
    expect(pasteFragment(example, { entities: [], wires: [] })).toEqual({ changes: [], names: [] });
    const gate = copy(example, "gate");
    expect(failure(() => pasteFragment(analyze(EXAMPLE.replace("< 10", "<")), gate))).toBe("invalid-source");
    expect(failure(() => pasteFragment(example, { entities: [{ ...gate.entities[0]!, name: "1x" }], wires: [] }))).toBe("invalid-name");
    expect(failure(() => pasteFragment(example, { entities: [{ ...gate.entities[0]!, name: "wire" }], wires: [] }))).toBe("reserved-name");
    expect(failure(() => pasteFragment(example, { entities: [...gate.entities, ...gate.entities], wires: [] }))).toBe("invalid-entity");
    // Wires must stay inside the fragment and end at terminals that exist.
    expect(failure(() => pasteFragment(example, { entities: gate.entities, wires: example.circuit.wires }))).toBe("invalid-terminal");
    expect(failure(() => pasteFragment(example, { entities: copy(example, "light").entities, wires: [{ color: "red", a: { entity: idOf(example, "light"), side: "out" }, b: { entity: idOf(example, "light"), side: "in" } }] }))).toBe("invalid-terminal");
    expect(failure(() => pasteFragment(example, { entities: gate.entities, wires: [{ color: "red", a: { entity: gate.entities[0]!.id, side: "in" }, b: { entity: gate.entities[0]!.id, side: "in" } }] }))).toBe("self-wire");
  });

  it("round trips through the clipboard text into another circuit", () => {
    const text = printFragment(copy(example, "source", "gate", "light"));
    const target = valid('circuit "Other" {\n    lamp gate at (0, 0) {\n    }\n}\n');
    const { after, names } = paste(target, fragmentOf(text), { x: 40, y: 40 });
    expect(names).toEqual(["source", "gate2", "light"]);
    // What arrived is what was copied, apart from the taken name, the tile and the shift.
    const arrived = extractFragment(after.circuit, after.circuit.entities.slice(1).map((e) => e.id));
    const expected = {
      entities: example.circuit.entities.map((e) => ({ ...e, name: e.name === "gate" ? "gate2" : e.name, position: { x: e.position.x + 40, y: e.position.y + 40 }, ...(e.placement ? { placement: { direction: "east" as const } } : {}) })),
      wires: example.circuit.wires,
    };
    expect(portable({ name: "", ...arrived })).toEqual(portable({ name: "", ...expected }));
  });

  it("runs as a command object and reports failures as values", () => {
    const result = executeCommand(example, { type: "pasteFragment", fragment: copy(example, "light"), shift: { x: 20, y: 0 } });
    expect(result).toMatchObject({ ok: true, names: ["light2"] });
    expect(executeCommand(example, { type: "pasteFragment", fragment: { entities: [{ ...example.circuit.entities[0]!, name: "in" }], wires: [] } })).toMatchObject({ ok: false, code: "reserved-name" });
  });
});

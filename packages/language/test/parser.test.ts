import { describe, expect, it } from "vitest";
import { analyze, parse, type CstEntity, type CstWire, type Range } from "../src/index.ts";
import { circuit, fixture, random } from "./helpers.ts";

const slice = (source: string, range: Range | undefined) => (range ? source.slice(range.from, range.to) : undefined);
const messages = (source: string) => parse(source).diagnostics.map((d) => d.message);

describe("concrete syntax tree", () => {
  const source = fixture("comments.face");
  const { cst, diagnostics } = parse(source);
  const members = cst.circuit!.members;

  it("parses the fixture without diagnostics", () => {
    expect(diagnostics).toEqual([]);
    expect(members.map((m) => m.type)).toEqual(["entity", "wire", "entity", "entity", "wire"]);
    expect(slice(source, cst.circuit!.name)).toBe('"Text / canvas experiment"');
    expect(source.slice(cst.circuit!.from, cst.circuit!.to)).toMatch(/^circuit[^]*\}$/);
    expect(cst.tokens.map((t) => t.text).join("")).toBe(source);
  });

  it("gives ranges for declaration, name, clauses, body and statements of an entity", () => {
    const entity = members[0] as CstEntity;
    expect(slice(source, entity)).toMatch(/^constant source at \(40, 80\) \{[^]*\}$/);
    expect(entity.kind).toBe("constant");
    expect(slice(source, entity.name)).toBe("source");
    expect(slice(source, entity.at)).toBe("at (40, 80)");
    expect(slice(source, entity.at!.x)).toBe("40");
    expect(slice(source, entity.at!.y)).toBe("80");
    expect(slice(source, entity.body)).toMatch(/^\{[^]*\}$/);
    expect(entity.body!.statements.map((s) => slice(source, s))).toEqual(["virtual:signal-A   =   5", "enabled = true"]);
  });

  it("gives ranges for wires and both terminals", () => {
    const wire = members[4] as CstWire;
    expect(slice(source, wire)).toBe("wire green twice.out <-> light.in");
    expect(slice(source, wire.color)).toBe("green");
    expect(slice(source, wire.a)).toBe("twice.out");
    expect(slice(source, wire.a!.name)).toBe("twice");
    expect(slice(source, wire.b)).toBe("light.in");
    expect(slice(source, wire.b!.side)).toBe("in");
  });

  it("parses header clauses in any order with tile decimals and facing", () => {
    const text = circuit("lamp a facing west tile (1.5, -2) at (20, -40) {}");
    const result = parse(text);
    const entity = result.cst.circuit!.members[0] as CstEntity;
    expect(result.diagnostics).toEqual([]);
    expect([slice(text, entity.at), slice(text, entity.tile), slice(text, entity.facing)]).toEqual(["at (20, -40)", "tile (1.5, -2)", "facing west"]);
  });

  it("ignores optional ; and , separators", () => {
    expect(messages(circuit("constant a { item:x = 1; item:y = 2, enabled = true };\nwire red a.out <-> a.out,"))).toEqual([]);
  });

  it("parses statement shapes of every form", () => {
    const text = circuit(`decider d {
      when each[red] >= 1 and virtual:signal-A != virtual:signal-B[green] or anything = 0
      output each = input[green]
      else output virtual:signal-A = -1
      description = "x"
    }
    constant c { section "g" { item:x = 1 active = false } }
    arithmetic a { each = each AND 0xff }`);
    const result = parse(text);
    expect(result.diagnostics).toEqual([]);
    const [d, c, a] = result.cst.circuit!.members as CstEntity[];
    expect(d!.body!.statements.map((s) => s.type)).toEqual(["when", "output", "output", "property"]);
    const when = d!.body!.statements[0]!;
    expect(when.type === "when" && when.conditions.map((x) => [x.join?.text, slice(text, x.first), x.comparator?.text, slice(text, x.second)])).toEqual([
      [undefined, "each[red]", ">=", "1"],
      ["and", "virtual:signal-A", "!=", "virtual:signal-B[green]"],
      ["or", "anything", "=", "0"],
    ]);
    const section = c!.body!.statements[0]!;
    expect(section.type === "section" && [slice(text, section.name), section.body!.statements.map((s) => s.type)]).toEqual(['"g"', ["assign", "property"]]);
    const expression = a!.body!.statements[0]!;
    expect(expression.type === "assign" && [slice(text, expression.target), slice(text, expression.first), expression.operator?.text, slice(text, expression.second)]).toEqual(["each", "each", "AND", "0xff"]);
  });
});

describe("error recovery", () => {
  it("reports an empty file", () => {
    expect(parse("").diagnostics).toEqual([{ from: 0, to: 0, severity: "error", code: "syntax-error", message: "Expected 'circuit' but found the end of the file" }]);
    expect(parse("// only a comment\n").cst.circuit).toBeUndefined();
  });

  it("reports a missing circuit name and brace but still parses members", () => {
    const result = parse('circuit {\n constant a {}\n}');
    expect(result.diagnostics.map((d) => d.message)).toEqual(["Expected the circuit name in double quotes but found '{'"]);
    expect(result.cst.circuit!.members).toHaveLength(1);
    expect(parse('circuit "x"\n constant a {}\n').cst.circuit!.members).toHaveLength(1);
  });

  it("resynchronizes at the next member after an unterminated block", () => {
    const text = circuit("constant a {\n  item:x = 1\n\nlamp b { }\nwire red a.out <-> b.in");
    const result = parse(text);
    expect(result.diagnostics.map((d) => [d.message, text.slice(d.from, d.to)])).toEqual([["Missing '}' to close this block", "{"]]);
    expect(result.cst.circuit!.members.map((m) => (m.type === "entity" ? m.name?.text : "wire"))).toEqual(["a", "b", "wire"]);
    expect((result.cst.circuit!.members[0] as CstEntity).body!.statements).toHaveLength(1);
  });

  it("resynchronizes at the next statement after a stray token", () => {
    const text = circuit("constant a {\n  item:x = 1\n  ) (\n  item:y = 2\n  enabled 5 true\n  enabled = false\n}");
    const result = parse(text);
    expect(result.diagnostics.map((d) => text.slice(d.from, d.to))).toEqual([") (", "enabled 5 true"]);
    expect((result.cst.circuit!.members[0] as CstEntity).body!.statements.map((s) => text.slice(s.from, s.to))).toEqual(["item:x = 1", "item:y = 2", "enabled = false"]);
  });

  it("skips a broken member including its braces", () => {
    const text = circuit("constan a { item:x = 1 }\nlamp b {}\n} extra");
    const result = parse(text);
    expect(result.cst.circuit!.members.map((m) => m.type === "entity" && m.name?.text)).toEqual(["b"]);
    expect(result.diagnostics.map((d) => d.message)).toEqual(["Expected an entity or wire declaration", "Unexpected content after the circuit"]);
  });

  it("treats a stray closing brace before further members as stray", () => {
    const result = parse(circuit("lamp a {} }\nlamp b {}"));
    expect(result.diagnostics.map((d) => d.message)).toEqual(["Unexpected '}'"]);
    expect(result.cst.circuit!.members).toHaveLength(2);
  });

  it("reports one error per incomplete statement and keeps partial nodes", () => {
    expect(messages(circuit("arithmetic a { virtual:signal-A = }"))).toEqual(["Expected a signal or an integer but found '}'"]);
    expect(messages(circuit("arithmetic a { virtual:signal-A = 1 }"))).toEqual(["Expected an arithmetic operator but found '}'"]);
    expect(messages(circuit("arithmetic a { virtual:signal-A = 1 + }"))).toEqual(["Expected a signal or an integer but found '}'"]);
    expect(messages(circuit("decider a { when }"))).toEqual(["Expected a signal but found '}'"]);
    expect(messages(circuit("decider a { when each }"))).toEqual(["Expected a comparator (<, >, =, !=, <=, >=) but found '}'"]);
    expect(messages(circuit("decider a { when each > 1 and }"))).toEqual(["Expected a signal but found '}'"]);
    expect(messages(circuit("decider a { output }"))).toEqual(["Expected a signal but found '}'"]);
    expect(messages(circuit("decider a { output each = foo }"))).toEqual(["Expected an integer or 'input' but found 'foo'"]);
    expect(messages(circuit("decider a { else when each > 1 }"))).toEqual(["Expected 'output' after 'else' but found 'when'"]);
    expect(messages(circuit("lamp a { networks = }"))).toEqual(["Expected a value for 'networks' but found '}'"]);
    expect(messages(circuit("lamp a { networks =\n always-on = true }"))).toEqual(["Expected a value for 'networks' but found 'always-on'"]);
    expect(messages(circuit("lamp a { when each[blue] > 1 }"))).toEqual(["Expected 'red' or 'green' but found 'blue'"]);
    expect(messages(circuit("constant a { section { section { } } }"))).toEqual(["Sections cannot be nested"]);
  });

  it("reports broken headers", () => {
    expect(messages(circuit("constant { }"))).toEqual(["Expected an entity name but found '{'"]);
    expect(messages(circuit("constant wire { }"))).toEqual(["'wire' is a reserved keyword and cannot be used as an entity name"]);
    expect(messages(circuit("constant my-name { }"))).toEqual(["'my-name' is not a valid entity name"]);
    expect(messages(circuit("constant a at (1) { }"))).toEqual(["Expected ',' but found ')'"]);
    expect(messages(circuit("constant a at (1, 2) at (3, 4) { }"))).toEqual(["Duplicate 'at' clause"]);
    expect(messages(circuit("constant a facing up { }"))).toEqual(["Expected north, east, south or west but found 'up'"]);
    expect(messages(circuit("constant a"))).toEqual(["Expected '{' but found '}'"]);
  });

  it("reports broken wires and continues with the next member", () => {
    const text = circuit("lamp a {}\nwire a.in <-> a.in\nwire red a.in\nwire red a.in <-> \nwire red a <-> a.in\nwire red in.in <-> a.in\nlamp b {}");
    const result = parse(text);
    expect(result.diagnostics.map((d) => d.message)).toEqual([
      "Expected a wire color (red or green) but found 'a'",
      "Expected '<->' but found 'wire'",
      "Expected an entity name but found 'wire'",
      "Expected '.' but found '<->'",
      "'in' is a reserved keyword and cannot be an entity name",
    ]);
    expect(result.cst.circuit!.members).toHaveLength(7);
  });

  it("reports reserved component keywords as unsupported", () => {
    const result = parse('import "lib"\ncircuit "x" {\n component foo { }\n port p\n lamp a {}\n}');
    expect(result.diagnostics.map((d) => [d.code, d.message.split(" ")[0]])).toEqual([["unsupported-feature", "'import'"], ["unsupported-feature", "'component'"], ["unsupported-feature", "'port'"]]);
    expect(result.cst.circuit!.members).toHaveLength(1);
  });

  it("reports lexical errors once and keeps parsing", () => {
    const result = parse(circuit('lamp a { description = "open\n always-on = true ? }'));
    expect(result.diagnostics.map((d) => d.message)).toEqual(["Unterminated string", "Unexpected character '?'"]);
    expect((result.cst.circuit!.members[0] as CstEntity).body!.statements).toHaveLength(2);
  });

  it("never throws and always terminates on mutated and random input", () => {
    const base = fixture("all-kinds.face");
    const next = random(7);
    const pieces = ["{", "}", "(", ")", "[", "]", "=", "<->", '"', "/*", "//", "\n", " ", "wire", "constant", "when", "output", "else", "section", "circuit", "each", "virtual:signal-A", "red", ".", ",", "5", "-", "at", "x", "import", "@", "and"];
    for (let round = 0; round < 400; round++) {
      let source = base;
      for (let edits = 1 + Math.floor(next() * 4); edits > 0; edits--) {
        const at = Math.floor(next() * source.length);
        const remove = next() < 0.5 ? Math.floor(next() * 12) : 0;
        source = source.slice(0, at) + (next() < 0.7 ? pieces[Math.floor(next() * pieces.length)] : "") + source.slice(at + remove);
      }
      const result = analyze(source);
      expect(result.cst.tokens.map((t) => t.text).join("")).toBe(source);
      expect(result.circuit === undefined).toBe(result.hasErrors);
      for (const d of result.diagnostics) expect(d.from <= d.to && d.from >= 0 && d.to <= source.length).toBe(true);
    }
    for (let round = 0; round < 300; round++) {
      let source = "";
      for (let i = Math.floor(next() * 30); i > 0; i--) source += pieces[Math.floor(next() * pieces.length)] + (next() < 0.5 ? " " : "");
      expect(() => analyze(source)).not.toThrow();
    }
  });
});

import { describe, expect, it } from "vitest";
import { analyze, declarationWords, parse, type CstEntity, type CstWhen, type CstWire, type Range } from "../src/index.ts";
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
    expect(slice(source, entity)).toMatch(/^constant-combinator source at \(40, 80\) \{[^]*\}$/);
    expect([slice(source, entity.word), entity.prototype, entity.kind]).toEqual(["constant-combinator", "constant-combinator", "constant"]);
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
    const text = circuit("small-lamp a facing west tile (1.5, -2) at (20, -40) {}");
    const result = parse(text);
    const entity = result.cst.circuit!.members[0] as CstEntity;
    expect(result.diagnostics).toEqual([]);
    expect([slice(text, entity.at), slice(text, entity.tile), slice(text, entity.facing)]).toEqual(["at (20, -40)", "tile (1.5, -2)", "facing west"]);
  });

  it("ignores optional ; and , separators", () => {
    expect(messages(circuit("constant-combinator a { item:x = 1; item:y = 2, enabled = true };\nwire red a.out <-> a.out,"))).toEqual([]);
  });

  it("parses statement shapes of every form", () => {
    const text = circuit(`decider-combinator d {
      when each[red] >= 1 and virtual:signal-A != virtual:signal-B[green] or anything = 0
      output each = input[green]
      else output virtual:signal-A = -1
      description = "x"
    }
    constant-combinator c { section "g" { item:x = 1 active = false } }
    arithmetic-combinator a { each = each AND 0xff }`);
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

  it("parses the network selections red, green and none", () => {
    const text = circuit("decider-combinator none { when each[none] > item:a[red] output each = input[none] }\nwire green none.out <-> none.in");
    const result = parse(text);
    expect(result.diagnostics).toEqual([]);
    const [d, wire] = result.cst.circuit!.members as [CstEntity, CstWire];
    // `none` is not reserved: it names the entity and is a selection only between the brackets.
    expect([d.name?.kind, d.name?.text, wire.a?.name.text]).toEqual(["ident", "none", "none"]);
    const when = d.body!.statements[0]!;
    const output = d.body!.statements[1]!;
    const condition = when.type === "when" ? when.conditions[0]! : undefined;
    expect([condition?.first?.networks?.selection?.text, condition?.second?.type === "signal" && condition.second.ref.networks?.selection?.text]).toEqual(["none", "red"]);
    expect(output.type === "output" && [slice(text, output.networks), output.networks?.selection?.text]).toEqual(["[none]", "none"]);
  });
});

describe("entity declarations", () => {
  const entities = (source: string) => parse(source).cst.circuit!.members.flatMap((m) => (m.type === "entity" ? [[source.slice(m.word.from, m.word.to), m.prototype, m.kind, m.name?.text]] : []));

  it("takes the game's name of an entity as the word, bare or in quotes, and has the kind from the game data", () => {
    const text = circuit('constant-combinator c { item:x = 1 }\n"small-lamp" l at (0, 0) { }\nsubstation s tile (1, 1) { }\nfast-inserter f facing north { }\n"assembling-machine-2" m { }');
    expect(parse(text).diagnostics).toEqual([]);
    expect(entities(text)).toEqual([
      ["constant-combinator", "constant-combinator", "constant", "c"],
      ['"small-lamp"', "small-lamp", "lamp", "l"],
      ["substation", "substation", "pole", "s"],
      ["fast-inserter", "fast-inserter", "entity", "f"],
      ['"assembling-machine-2"', "assembling-machine-2", "entity", "m"],
    ]);
    // The words that once named the kinds are words like any other: here they name the entities.
    const named = circuit("small-lamp lamp { }\nsmall-electric-pole pole { }\nsteel-chest entity { }\nwire red lamp.in <-> pole\nwire green pole <-> entity");
    expect(parse(named).diagnostics).toEqual([]);
    expect(entities(named).map(([, , , name]) => name)).toEqual(["lamp", "pole", "entity"]);
  });

  it("reads past a declaration whose word is no entity of the game, with one error, and reads the members behind it", () => {
    const text = circuit('small-lamp a { }\nlamp old at (0, 0) tile (1, 1) facing north { when virtual:signal-A > 0 colors = mapping }\n"no such thing" b { nonsense ( = ) 5 { } }\nsmall-lamp c { }\nwire red a.in <-> c.in');
    const result = parse(text);
    expect(result.diagnostics.map((d) => [d.code, text.slice(d.from, d.to)])).toEqual([["unknown-prototype", "lamp"], ["unknown-prototype", '"no such thing"']]);
    expect(result.cst.circuit!.members.map((m) => (m.type === "entity" ? m.name?.text : "wire"))).toEqual(["a", "c", "wire"]);
    // What is wrong inside it is not said: nested braces are matched, whatever stands between them.
    expect(messages(circuit("gate g { section { section { ) } } when }\nsmall-lamp c { }"))).toEqual([expect.stringContaining("Unknown entity 'gate'")]);
    // Without its closing brace it ends where the next declaration starts.
    const open = parse(circuit("gate g { read-contents = true\nsmall-lamp c { }\nwire red c.in <-> c.in"));
    expect(open.diagnostics.map((d) => d.code)).toEqual(["unknown-prototype"]);
    expect(open.cst.circuit!.members.map((m) => m.type)).toEqual(["entity", "wire"]);
    // A word alone, and a word with a name: the declaration that is being typed.
    expect(messages(circuit("gate"))).toEqual([expect.stringContaining("Unknown entity 'gate'")]);
    expect(messages(circuit("gate g\nsmall-lamp c { }"))).toEqual([expect.stringContaining("Unknown entity 'gate'")]);
    expect(entities(circuit("gate g\nsmall-lamp c { }"))).toEqual([["small-lamp", "small-lamp", "lamp", "c"]]);
  });

  it("does not take a statement of a block for a declaration, and ends a block without its brace at the next declaration", () => {
    // A string, a word and a brace in a row inside a block: a description in front of a section.
    expect(messages(circuit('constant-combinator c { description = "abc" section { item:x = 1 } section "g" { item:y = 2 } }'))).toEqual([]);
    expect(messages(circuit("programmable-speaker s { pitch = virtual:signal-A instrument = piano note = C4 }"))).toEqual([]);
    expect(messages(circuit("fast-inserter f { read-hand = hold logistic when item:a > 1 }"))).toEqual([]);
    // The next declaration ends the block, whichever way its word is written, and is no value of a property left open.
    for (const next of ["substation s { }", '"small-lamp" s at (0, 0) { }', "steel-chest s tile (0.5, 0.5) { }", "small-lamp s facing east { }"]) {
      const text = circuit(`small-lamp a {\n  always-on = true\n${next}`);
      expect(messages(text), next).toEqual(["Missing '}' to close this block"]);
      expect(entities(text).map(([, , , name]) => name), next).toEqual(["a", "s"]);
      const value = circuit(`small-lamp a {\n  description =\n${next}`);
      expect(messages(value), next).toEqual([expect.stringContaining("Expected a value for 'description'"), "Missing '}' to close this block"]);
      expect(entities(value).map(([, , , name]) => name), next).toEqual(["a", "s"]);
    }
    // A wire that is left open does not take the word of the next declaration for an entity name.
    const wire = circuit("small-electric-pole p { }\nwire red p <->\nsubstation s { }\nwire red p.\nsubstation t { }");
    expect(messages(wire)).toEqual(["Expected an entity name but found 'substation'", "Expected 'in' or 'out' but found 'substation'"]);
    expect(entities(wire).map(([, , , name]) => name)).toEqual(["p", "s", "t"]);
  });

  it("names the words of the declarations among the tokens, for the editor to style", () => {
    const text = circuit('small-lamp a { description = "x" }\n"small-lamp" b at (0, 0) { }\nlamp c { }\nwire red a.in <-> b.in\nsubstation');
    const { cst } = parse(text);
    // Complete declarations by their shape, whether the game has the entity or not; a word alone is none yet.
    expect([...declarationWords(cst.tokens)].map((token) => token.text)).toEqual(["small-lamp", '"small-lamp"', "lamp"]);
  });
});

describe("error recovery", () => {
  it("reports an empty file", () => {
    expect(parse("").diagnostics).toEqual([{ from: 0, to: 0, severity: "error", code: "syntax-error", message: "Expected 'circuit' but found the end of the file" }]);
    expect(parse("// only a comment\n").cst.circuit).toBeUndefined();
  });

  it("reports a missing circuit name and brace but still parses members", () => {
    const result = parse('circuit {\n constant-combinator a {}\n}');
    expect(result.diagnostics.map((d) => d.message)).toEqual(["Expected the circuit name in double quotes but found '{'"]);
    expect(result.cst.circuit!.members).toHaveLength(1);
    expect(parse('circuit "x"\n constant-combinator a {}\n').cst.circuit!.members).toHaveLength(1);
  });

  it("resynchronizes at the next member after an unterminated block", () => {
    const text = circuit("constant-combinator a {\n  item:x = 1\n\nsmall-lamp b { }\nwire red a.out <-> b.in");
    const result = parse(text);
    expect(result.diagnostics.map((d) => [d.message, text.slice(d.from, d.to)])).toEqual([["Missing '}' to close this block", "{"]]);
    expect(result.cst.circuit!.members.map((m) => (m.type === "entity" ? m.name?.text : "wire"))).toEqual(["a", "b", "wire"]);
    expect((result.cst.circuit!.members[0] as CstEntity).body!.statements).toHaveLength(1);
  });

  it("resynchronizes at the next statement after a stray token", () => {
    const text = circuit("constant-combinator a {\n  item:x = 1\n  ) (\n  item:y = 2\n  enabled 5 true\n  enabled = false\n}");
    const result = parse(text);
    expect(result.diagnostics.map((d) => text.slice(d.from, d.to))).toEqual([") (", "enabled 5 true"]);
    expect((result.cst.circuit!.members[0] as CstEntity).body!.statements.map((s) => text.slice(s.from, s.to))).toEqual(["item:x = 1", "item:y = 2", "enabled = false"]);
  });

  it("skips a broken member including its braces", () => {
    const text = circuit("= a { item:x = 1 }\nsmall-lamp b {}\n} extra");
    const result = parse(text);
    expect(result.cst.circuit!.members.map((m) => m.type === "entity" && m.name?.text)).toEqual(["b"]);
    expect(result.diagnostics.map((d) => d.message)).toEqual(["Expected an entity or wire declaration", "Unexpected content after the circuit"]);
  });

  it("treats a stray closing brace before further members as stray", () => {
    const result = parse(circuit("small-lamp a {} }\nsmall-lamp b {}"));
    expect(result.diagnostics.map((d) => d.message)).toEqual(["Unexpected '}'"]);
    expect(result.cst.circuit!.members).toHaveLength(2);
  });

  it("reports one error per incomplete statement and keeps partial nodes", () => {
    expect(messages(circuit("arithmetic-combinator a { virtual:signal-A = }"))).toEqual(["Expected a signal or an integer but found '}'"]);
    expect(messages(circuit("arithmetic-combinator a { virtual:signal-A = 1 }"))).toEqual(["Expected an arithmetic operator but found '}'"]);
    expect(messages(circuit("arithmetic-combinator a { virtual:signal-A = 1 + }"))).toEqual(["Expected a signal or an integer but found '}'"]);
    expect(messages(circuit("decider-combinator a { when }"))).toEqual(["Expected a signal or 0 but found '}'"]);
    expect(messages(circuit("decider-combinator a { when each }"))).toEqual(["Expected a comparator (<, >, =, !=, <=, >=) but found '}'"]);
    expect(messages(circuit("decider-combinator a { when each > 1 and }"))).toEqual(["Expected a signal or 0 but found '}'"]);
    expect(messages(circuit("decider-combinator a { when 0 }"))).toEqual(["Expected a comparator (<, >, =, !=, <=, >=) but found '}'"]);
    expect(messages(circuit("decider-combinator a { when 0 < }"))).toEqual(["Expected a signal or an integer but found '}'"]);
    expect(messages(circuit("decider-combinator a { when +0 < 1 }"))[0]).toBe("Expected a signal or 0 but found '+'");
    expect(messages(circuit("decider-combinator a { when 0.0 < 1 }"))[0]).toBe("Expected a signal or 0 but found '0.0'");
    expect(messages(circuit("programmable-speaker a { when }"))).toEqual(["Expected a signal but found '}'"]);
    expect(messages(circuit("decider-combinator a { output }"))).toEqual(["Expected a signal but found '}'"]);
    expect(messages(circuit("decider-combinator a { output each = foo }"))).toEqual(["Expected an integer or 'input' but found 'foo'"]);
    expect(messages(circuit("decider-combinator a { else when each > 1 }"))).toEqual(["Expected 'output' after 'else' but found 'when'"]);
    expect(messages(circuit("small-lamp a { networks = }"))).toEqual(["Expected a value for 'networks' but found '}'"]);
    expect(messages(circuit("small-lamp a { networks =\n always-on = true }"))).toEqual(["Expected a value for 'networks' but found 'always-on'"]);
    expect(messages(circuit("small-lamp a { when each[blue] > 1 }"))).toEqual(["Expected 'red', 'green' or 'none' but found 'blue'"]);
    expect(messages(circuit("decider-combinator a { when each[none > 1 }"))).toEqual(["Expected ']' but found '>'"]);
    expect(messages(circuit("constant-combinator a { section { section { } } }"))).toEqual(["Sections cannot be nested"]);
  });

  it("reports broken headers", () => {
    expect(messages(circuit("constant-combinator { }"))).toEqual(["Expected an entity name but found '{'"]);
    expect(messages(circuit("constant-combinator wire { }"))).toEqual(["'wire' is a reserved keyword and cannot be used as an entity name"]);
    expect(messages(circuit("constant-combinator my-name { }"))).toEqual(["'my-name' is not a valid entity name"]);
    expect(messages(circuit("constant-combinator a at (1) { }"))).toEqual(["Expected ',' but found ')'"]);
    expect(messages(circuit("constant-combinator a at (1, 2) at (3, 4) { }"))).toEqual(["Duplicate 'at' clause"]);
    expect(messages(circuit("constant-combinator a facing up { }"))).toEqual(["Expected north, east, south or west but found 'up'"]);
    expect(messages(circuit("constant-combinator a"))).toEqual(["Expected '{' but found '}'"]);
    expect(messages(circuit("constant-combinator"))).toEqual(["Expected an entity name but found '}'"]);
  });

  it("reports broken wires and continues with the next member", () => {
    const text = circuit("small-lamp a {}\nwire a.in <-> a.in\nwire red a.in\nwire red a.in <-> \nwire red a <-> a.in\nwire red in.in <-> a.in\nsmall-lamp b {}");
    const result = parse(text);
    expect(result.diagnostics.map((d) => d.message)).toEqual([
      "Expected a wire color (red or green) but found 'a'",
      "Expected '<->' but found 'wire'",
      "Expected an entity name but found 'wire'",
      "'in' is a reserved keyword and cannot be an entity name",
    ]);
    expect(result.cst.circuit!.members).toHaveLength(7);
  });

  it("reports reserved component keywords as unsupported", () => {
    const result = parse('import "lib"\ncircuit "x" {\n component foo { }\n port p\n small-lamp a {}\n}');
    expect(result.diagnostics.map((d) => [d.code, d.message.split(" ")[0]])).toEqual([["unsupported-feature", "'import'"], ["unsupported-feature", "'component'"], ["unsupported-feature", "'port'"]]);
    expect(result.cst.circuit!.members).toHaveLength(1);
  });

  it("parses the conditions of a generic entity, the role in front of `when` being part of the statement", () => {
    const text = circuit("inserter e { when item:a > 1 logistic when item:b < 2; input-left when anything = 0 read-hand = hold }");
    const { cst, diagnostics } = parse(text);
    expect(diagnostics).toEqual([]);
    const statements = (cst.circuit!.members[0] as CstEntity).body!.statements;
    expect(statements.map((s) => s.type)).toEqual(["when", "when", "when", "property"]);
    expect(statements.map((s) => slice(text, s))).toEqual(["when item:a > 1", "logistic when item:b < 2", "input-left when anything = 0", "read-hand = hold"]);
    expect(statements.filter((s): s is CstWhen => s.type === "when").map((s) => slice(text, s.role))).toEqual([undefined, "logistic", "input-left"]);
    // Any word in front of `when` is a role to the parser; which roles a prototype has is for the analysis.
    expect(parse(circuit("inserter e { stray when item:a > 1 }")).diagnostics).toEqual([]);
    // A word that is neither a property nor a role is skipped with one error, and the statements behind it are read.
    const lost = parse(circuit("inserter e { stray read-hand = hold }"));
    expect(lost.diagnostics.map((d) => d.message)).toEqual(["Unexpected 'stray'; expected a statement or '}'"]);
    expect((lost.cst.circuit!.members[0] as CstEntity).body!.statements.map((statement) => slice(lost.cst.tokens.map((t) => t.text).join(""), statement))).toEqual(["read-hand = hold"]);
    expect(messages('circuit "t" { inserter e { logistic')).toEqual(["Expected '=' or 'when' but found the end of the file", "Missing '}' to close this block"]);
  });

  it("reports lexical errors once and keeps parsing", () => {
    const result = parse(circuit('small-lamp a { description = "open\n always-on = true ? }'));
    expect(result.diagnostics.map((d) => d.message)).toEqual(["Unterminated string", "Unexpected character '?'"]);
    expect((result.cst.circuit!.members[0] as CstEntity).body!.statements).toHaveLength(2);
  });

  it("never throws and always terminates on mutated and random input", () => {
    const base = fixture("all-kinds.face");
    const next = random(7);
    const pieces = ["{", "}", "(", ")", "[", "]", "=", "<->", '"', "/*", "//", "\n", " ", "wire", "constant-combinator", "when", "output", "else", "section", "circuit", "each", "virtual:signal-A", "red", ".", ",", "5", "-", "at", "x", "import", "@", "and", "small-lamp", "inserter", "substation", '"small-lamp"', "lamp", "logistic", "blueprint-data"];
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

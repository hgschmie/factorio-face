import { ENTITY_KINDS, SELECTOR_OPERATIONS } from "@face/model";
import { describe, expect, it } from "vitest";
import { analyze, completionContext, ENTITY_PROPERTIES, enumValues, KEYWORDS, lookupProperty, propertiesFor, propertyNames, type Completion } from "../src/index.ts";
import { circuit, fixture } from "./helpers.ts";

/** Completion at the `|` marker. */
function at(marked: string): { prefix: string; from: number; to: number; expected: readonly Completion[]; get<T extends Completion["type"]>(type: T): Extract<Completion, { type: T }> | undefined } {
  const offset = marked.indexOf("|");
  const source = marked.replace("|", "");
  const context = completionContext(analyze(source), offset);
  return { ...context, get: (type) => context.expected.find((e) => e.type === type) as never };
}

describe("language tables", () => {
  it("exposes keywords and per-kind properties from one table", () => {
    expect(KEYWORDS).toContain("circuit");
    expect(KEYWORDS).toHaveLength(38);
    for (const kind of ENTITY_KINDS) expect(KEYWORDS).toContain(kind);
    expect(propertyNames("pole")).toEqual(["description", "prototype"]);
    expect(propertyNames("speaker")).toEqual(["description", "pitch", "instrument", "note", "volume", "volume-signal", "playback", "polyphony", "stop-playing-sounds", "show-alert", "show-on-map", "alert-icon", "alert-message"]);
    for (const kind of ENTITY_KINDS) expect(propertyNames(kind)).toContain("description");
    expect(propertyNames("constant")).toEqual(["description", "enabled"]);
    expect(propertyNames("constant", undefined, true)).toEqual(["active", "multiplier"]);
    expect(propertyNames("lamp")).toEqual(["description", "networks", "always-on", "colors", "red", "green", "blue", "rgb", "color"]);
    expect(propertyNames("selector", "select")).toEqual(["description", "operation", "order", "index", "index-comparator"]);
    expect(propertyNames("selector", "time")).toEqual(["description", "operation", "day-length", "day-tick", "game-tick"]);
    expect(propertiesFor("selector", "stack-size").map((p) => p.name)).toEqual(["description", "operation"]);
    for (const spec of Object.values(ENTITY_PROPERTIES).flat()) expect(spec.detail.length).toBeGreaterThan(0);
  });

  it("lists enum values per property and operation", () => {
    expect(enumValues("selector", "operation")).toEqual([...SELECTOR_OPERATIONS]);
    expect(enumValues("selector", "order", "select")).toEqual(["max", "min"]);
    expect(enumValues("selector", "order", "quality-select")).toEqual(["highest", "lowest"]);
    expect(enumValues("selector", "order", "count")).toEqual([]);
    expect(enumValues("lamp", "colors")).toEqual(["mapping", "components", "packed-rgb"]);
    expect(enumValues("lamp", "always-on")).toEqual(["true", "false"]);
    expect(enumValues("lamp", "networks")).toEqual(["red", "green", "none"]);
    expect(enumValues("selector", "source", "quality-transfer")).toEqual(["signal"]);
    expect(enumValues("constant", "active", undefined, true)).toEqual(["true", "false"]);
    expect(lookupProperty("selector", "interval", "select")).toEqual({ status: "inapplicable", operations: ["random"] });
    expect(lookupProperty("lamp", "nope", undefined)).toEqual({ status: "unknown" });
  });
});

describe("completionContext", () => {
  it("expects the circuit keyword in an empty document and members inside a circuit", () => {
    expect(at("|").expected).toEqual([{ type: "keyword", values: ["circuit"] }]);
    expect(at("cir|")).toMatchObject({ prefix: "cir", from: 0, to: 3, expected: [{ type: "keyword", values: ["circuit"] }] });
    expect(at('circuit "x" {\n    |\n}').get("keyword")!.values).toEqual([...ENTITY_KINDS, "wire"]);
    expect(at('circuit "x" {\n    lamp a { }\n    de|\n}')).toMatchObject({ prefix: "de", expected: [{ type: "keyword", values: [...ENTITY_KINDS, "wire"] }] });
    expect(at('circuit "x" {\n    lamp a { } |\n    lamp b { }\n}').get("keyword")!.values).toEqual([...ENTITY_KINDS, "wire"]);
  });

  it("expects a name, then header clauses and directions", () => {
    expect(at(circuit("lamp |")).expected).toEqual([{ type: "literal", kind: "name" }]);
    expect(at(circuit("lamp a |")).get("keyword")!.values).toEqual(["at", "tile", "facing"]);
    expect(at(circuit("lamp a at (0, 0) |")).get("keyword")!.values).toEqual(["tile", "facing"]);
    expect(at(circuit("lamp a facing |")).get("keyword")!.values).toEqual(["north", "east", "south", "west"]);
    expect(at(circuit("lamp a at (|")).expected).toEqual([{ type: "literal", kind: "number" }]);
  });

  it("expects statements of the entity kind", () => {
    const lamp = at(circuit("lamp a {\n    |\n}"));
    expect(lamp.get("keyword")!.values).toEqual(["when"]);
    expect(lamp.get("property")).toEqual({ type: "property", kind: "lamp", names: propertyNames("lamp") });
    expect(lamp.get("signal")).toBeUndefined();
    const constant = at(circuit("constant c { item:a = 1 | }"));
    expect(constant.get("keyword")!.values).toEqual(["section"]);
    expect(constant.get("property")!.names).toEqual(["description", "enabled"]);
    expect(constant.get("signal")).toEqual({ type: "signal", wildcards: [] });
    const section = at(circuit("constant c { section { | } }"));
    expect(section.get("property")!.names).toEqual(["active", "multiplier"]);
    expect(section.get("keyword")).toBeUndefined();
    expect(at(circuit("arithmetic a { | }")).get("signal")).toEqual({ type: "signal", wildcards: ["each"] });
    expect(at(circuit("decider d { | }")).get("keyword")!.values).toEqual(["when", "output", "else"]);
    expect(at(circuit("decider d { when each > 1 | }")).get("keyword")!.values).toEqual(["and", "or", "when", "output", "else"]);
    expect(at(circuit("decider d { else | }")).get("keyword")!.values).toEqual(["output"]);
  });

  it("narrows selector properties to the chosen operation", () => {
    expect(at(circuit("selector s { | }")).get("property")!.names).toEqual(propertyNames("selector", "select"));
    expect(at(circuit("selector s { operation = time | }")).get("property")!.names).toEqual(propertyNames("selector", "time"));
    expect(at(circuit("selector s {\n    |\n    operation = random\n}")).get("property")!.names).toEqual(["description", "operation", "interval"]);
  });

  it("expects property values: enum words, signals and literals", () => {
    expect(at(circuit("selector s { operation = | }")).get("enum")).toEqual({ type: "enum", property: "operation", values: [...SELECTOR_OPERATIONS] });
    expect(at(circuit("selector s { operation = quality-select order = lo| }"))).toMatchObject({ prefix: "lo", expected: [{ type: "enum", property: "order", values: ["highest", "lowest"] }] });
    expect(at(circuit("selector s { index = | }")).expected).toEqual([{ type: "literal", kind: "integer" }, { type: "signal", wildcards: [] }]);
    expect(at(circuit("selector s { operation = quality-transfer destination = | }")).expected).toEqual([{ type: "signal", wildcards: ["each"] }]);
    expect(at(circuit("selector s { operation = quality-transfer source = | }")).expected).toEqual([{ type: "enum", property: "source", values: ["signal"] }, { type: "literal", kind: "quality" }]);
    expect(at(circuit("lamp l { colors = | }")).get("enum")!.values).toEqual(["mapping", "components", "packed-rgb"]);
    expect(at(circuit("lamp l { always-on = t| }")).get("enum")!.values).toEqual(["true", "false"]);
    expect(at(circuit("lamp l { color = | }")).expected).toEqual([{ type: "literal", kind: "color" }]);
    expect(at(circuit("lamp l { description = | }")).expected).toEqual([{ type: "literal", kind: "string" }]);
    expect(at(circuit("constant c { section { multiplier = | } }")).expected).toEqual([{ type: "literal", kind: "number" }]);
    expect(at(circuit("lamp l { bogus = | }")).expected).toEqual([]);
  });

  it("expects signals with the wildcards legal at that position", () => {
    expect(at(circuit("decider d { when | }")).expected).toEqual([{ type: "signal", wildcards: ["everything", "anything", "each"] }]);
    expect(at(circuit("lamp l { when | }")).expected).toEqual([{ type: "signal", wildcards: ["anything", "everything"] }]);
    expect(at(circuit("lamp l { when virtual:sig| }"))).toMatchObject({ prefix: "virtual:sig", expected: [{ type: "signal", wildcards: ["anything", "everything"] }] });
    expect(at(circuit("lamp l { when item:a | }")).get("keyword")!.values).toEqual(["<", ">", "=", "!=", "<=", ">="]);
    expect(at(circuit("lamp l { when item:a > | }")).expected).toEqual([{ type: "signal", wildcards: [] }, { type: "literal", kind: "integer" }]);
    expect(at(circuit("arithmetic a { each = | }")).expected).toEqual([{ type: "signal", wildcards: ["each"] }, { type: "literal", kind: "integer" }]);
    expect(at(circuit("arithmetic a { each = each | }")).get("keyword")!.values).toEqual(["*", "/", "+", "-", "%", "^", "<<", ">>", "AND", "OR", "XOR"]);
    expect(at(circuit("arithmetic a { each = each[| }")).get("keyword")!.values).toEqual(["red", "green", "none"]);
    expect(at(circuit("decider d { output each = input[no| }"))).toMatchObject({ prefix: "no", expected: [{ type: "keyword", values: ["red", "green", "none"] }] });
    expect(at(circuit("lamp l { networks = | }")).expected).toEqual([{ type: "enum", property: "networks", values: ["red", "green", "none"] }]);
    expect(at(circuit("decider d { output | }")).expected).toEqual([{ type: "signal", wildcards: ["everything", "anything", "each"] }]);
    expect(at(circuit("decider d { output each = | }")).expected).toEqual([{ type: "keyword", values: ["input"] }, { type: "literal", kind: "integer" }]);
    expect(at(circuit("constant c { item:a = | }")).expected).toEqual([{ type: "literal", kind: "integer" }]);
  });

  it("expects wire colors, terminals with candidate entities and sides", () => {
    const source = "constant src { item:a = 1 }\ndecider gate { }\nlamp light { }\n";
    expect(at(circuit(`${source}wire |`)).get("keyword")!.values).toEqual(["red", "green"]);
    const terminal = at(circuit(`${source}wire red |`)).get("terminal")!;
    expect(terminal.entities).toEqual([{ name: "src", kind: "constant", sides: ["out"] }, { name: "gate", kind: "decider", sides: ["in", "out"] }, { name: "light", kind: "lamp", sides: ["in"] }]);
    expect(at(circuit(`${source}wire red ga|`))).toMatchObject({ prefix: "ga", expected: [{ type: "terminal" }] });
    expect(at(circuit(`${source}wire red src.|`)).expected).toEqual([{ type: "side", entity: "src", sides: ["out"] }]);
    expect(at(circuit(`${source}wire red gate.o|`))).toMatchObject({ prefix: "o", expected: [{ type: "side", entity: "gate", sides: ["in", "out"] }] });
    expect(at(circuit(`${source}wire red unknown.|`)).expected).toEqual([{ type: "side", entity: "unknown", sides: ["in", "out"] }]);
    expect(at(circuit(`${source}wire red src.out |`)).get("keyword")!.values).toEqual(["<->"]);
    expect(at(circuit(`${source}wire red src.out <-> |`)).get("terminal")!.entities).toHaveLength(3);
    expect(at(circuit(`${source}wire red src.out <-> light.|`)).expected).toEqual([{ type: "side", entity: "light", sides: ["in"] }]);
  });

  it("expects nothing inside comments and strings", () => {
    expect(at(circuit("lamp l { // when |\n }")).expected).toEqual([]);
    expect(at(circuit("lamp l { /* when | */ }")).expected).toEqual([]);
    expect(at(circuit('lamp l { description = "wh|" }')).expected).toEqual([]);
    expect(at(circuit('lamp l { description = "open|\n }')).expected).toEqual([]);
    expect(at(circuit("lamp l { /* open |")).expected).toEqual([]);
    expect(at(circuit("lamp l { /* closed */| }")).get("keyword")!.values).toEqual(["when"]);
  });

  it("is total: any offset of a real document yields a context", () => {
    const source = fixture("all-kinds.face");
    const parse = analyze(source);
    for (let offset = 0; offset <= source.length; offset += 7) {
      const context = completionContext(parse, offset);
      expect(context.from <= offset && offset <= context.to).toBe(true);
      expect(source.slice(context.from, offset)).toBe(context.prefix);
    }
    expect(completionContext(parse, -5).from).toBe(0);
    expect(completionContext(parse, source.length + 5).from).toBe(source.length);
  });
});

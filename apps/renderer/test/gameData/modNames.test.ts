// Names of mods' prototypes are not the game's own tidy ones: capitals, a digit first, dots, blanks, other letters, the words
// of the language. Every such name has to get through the language as a prototype and as a signal: written by an edit, read
// back the same.
import { analyze, executeCommand, printSignal, type TextChange } from "@face/language";
import { parseEntityTable, setEntityTable, signal, STANDARD_ENTITY_TABLE, type Entity } from "@face/model";
import { afterAll, describe, expect, it } from "vitest";
import data from "../../../../packages/model/data/entities-2.1.25.json" with { type: "json" };

const NAMES = ["bob-inserter-2", "Krastorio2-crate", "5d-chest", "chest.v2", "my chest", "chest_ü", 'a"b', "a\\b", "prototype", "entity", "true", "wire", "-leading", "kr:crate", "a/b", "a+b", "se-space@1", "tab\there", "lamp", "x".repeat(200)];
const EMPTY = 'circuit "t" {\n}\n';

function apply(text: string, changes: readonly TextChange[]): string {
  return [...changes].sort((a, b) => b.from - a.from).reduce((source, change) => source.slice(0, change.from) + change.insert + source.slice(change.to), text);
}

describe("names of mods in the language", () => {
  setEntityTable(parseEntityTable({ ...data, entities: [...data.entities, ...NAMES.map((name) => ({ name, type: "container", displayName: `Crate ${name.slice(0, 12)}`, placedBy: [] }))] }));
  afterAll(() => setEntityTable(STANDARD_ENTITY_TABLE));

  it.each(NAMES)("places an entity of the prototype %j and reads it back", (name) => {
    const added = executeCommand(analyze(EMPTY), { type: "addEntity", prototype: name, position: { x: 0, y: 0 } });
    expect(added).toMatchObject({ ok: true });
    if (!added.ok) return;
    const read = analyze(apply(EMPTY, added.changes));
    expect(read.diagnostics).toEqual([]);
    const entity = read.circuit!.entities[0] as Entity & { prototype?: string };
    expect(entity.prototype).toBe(name);
    // The entity is named after its prototype with what a name of the language can hold.
    expect(entity.name).toMatch(/^[A-Za-z_][A-Za-z0-9_]*1$/);
  });

  it.each(NAMES)("writes the signal %j and reads it back, as an item and as a quality", (name) => {
    for (const id of [signal("item", name), signal("virtual", "signal-A", name)]) {
      const read = analyze(`circuit "t" {\n    constant-combinator c at (0, 0) {\n        ${printSignal(id)} = 1\n    }\n}\n`);
      expect(read.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
      const constant = read.circuit!.entities[0] as Entity & { sections: { filters: { signal: unknown }[] }[] };
      expect(constant.sections[0]!.filters[0]!.signal).toEqual(id);
    }
  });
});

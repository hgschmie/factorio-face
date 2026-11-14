// The tables of docs/dsl.md that say which settings a generic entity has are written from the settings table of the model, so
// that the reference cannot drift from it. `UPDATE_DOCS=1 npx vitest run packages/language/test/docs.test.ts` rewrites them.
import { readFileSync, writeFileSync } from "node:fs";
import { conditionRole, ENTITY_SETTINGS, settingFields, STANDARD_ENTITY_TABLE, type SettingSpec } from "@face/model";
import { describe, expect, it } from "vitest";

const DSL = new URL("../../../docs/dsl.md", import.meta.url);
const BEGIN = /<!-- entity-settings:begin[^\n]*-->\n/;
const END = "<!-- entity-settings:end -->";

const code = (text: string): string => `\`${text}\``;
const list = (items: readonly string[]): string => (items.length > 1 ? `${items.slice(0, -1).join(", ")} or ${items.at(-1)}` : (items[0] ?? ""));

/** How a setting is written: its property word, or the statement of a condition. */
function word(spec: SettingSpec): string {
  if (spec.type !== "condition") return spec.key;
  const role = conditionRole(spec.key);
  return role === undefined ? "when" : `${role} when`;
}

function value(spec: SettingSpec): string {
  switch (spec.type) {
    case "boolean": return `${code("true")} or ${code("false")} (${code(String(spec.default))})`;
    case "enum": return `${list(spec.values.map((entry) => code(entry.word)))} (${code(spec.default)})`;
    case "signal": return spec.prototypeDefault === undefined ? "signal (none)" : `signal (the prototype's ${code(`default_${spec.prototypeDefault}_signal`)})`;
    case "networks": return `${code("red")}, ${code("green")} or ${code("none")} (both)`;
    case "condition": {
      const own = spec.gameDefault && code(`${spec.gameDefault.first!.name} ${spec.gameDefault.comparator} 0`);
      return own ? `comparison (not in use; while the other one of its side is, the game has ${own} here)` : "comparison (not in use)";
    }
  }
}

function field(spec: SettingSpec): string {
  if (spec.type === "condition") return `${code(spec.field)}, in use with ${code(spec.flag)}`;
  if (spec.type === "enum" && spec.flag) return `${code(spec.field)}; ${code(spec.flag.off)} is ${code(spec.flag.field)} off`;
  return settingFields(spec).map(code).join(", ");
}

/** The two tables: the words per group of prototype types that take the same settings, and every word in each form it has. */
export function settingsTables(): string {
  const types = Object.keys(ENTITY_SETTINGS);
  const groups = new Map<string, string[]>();
  for (const type of types) {
    const key = JSON.stringify(ENTITY_SETTINGS[type]!.settings);
    groups.set(key, [...(groups.get(key) ?? []), type]);
  }
  const first = ["| Prototype type | Prototypes | Conditions | Properties |", "| --- | --- | --- | --- |"];
  for (const group of groups.values()) {
    const { settings } = ENTITY_SETTINGS[group[0]!]!;
    const prototypes = STANDARD_ENTITY_TABLE.entities.filter((prototype) => group.includes(prototype.type)).map((prototype) => code(prototype.name));
    const conditions = settings.filter((spec) => spec.type === "condition").map((spec) => code(word(spec)));
    const properties = settings.filter((spec) => spec.type !== "condition").map((spec) => code(word(spec)));
    first.push(`| ${group.map(code).join(", ")} | ${prototypes.join(", ")} | ${conditions.join(", ") || "none"} | ${properties.join(", ") || "none"} |`);
  }

  const forms = new Map<string, { spec: SettingSpec; types: string[] }>();
  for (const type of types) {
    for (const spec of ENTITY_SETTINGS[type]!.settings) {
      const key = JSON.stringify(spec);
      const form = forms.get(key) ?? { spec, types: [] };
      forms.set(key, form);
      form.types.push(type);
    }
  }
  const perWord = new Map<string, number>();
  for (const { spec } of forms.values()) perWord.set(word(spec), (perWord.get(word(spec)) ?? 0) + 1);
  const second = ["| Word | Value (default) | Blueprint field | In the game | Prototype types |", "| --- | --- | --- | --- | --- |"];
  for (const { spec, types: having } of forms.values()) {
    second.push(`| ${code(word(spec))} | ${value(spec)} | ${field(spec)} | ${spec.label} | ${perWord.get(word(spec))! > 1 ? having.map(code).join(", ") : "all that have the word"} |`);
  }
  return `${first.join("\n")}\n\n${second.join("\n")}\n`;
}

describe("docs/dsl.md", () => {
  it("has the settings of the generic entity as the settings table of the model has them", () => {
    const text = readFileSync(DSL, "utf8");
    const begin = BEGIN.exec(text);
    const end = text.indexOf(END);
    expect(begin && end > begin.index).toBeTruthy();
    const from = begin!.index + begin![0].length;
    const tables = settingsTables();
    if (process.env.UPDATE_DOCS) writeFileSync(DSL, text.slice(0, from) + tables + text.slice(end));
    else expect(text.slice(from, end)).toBe(tables);
  });

  it("names every keyword of the language as reserved", async () => {
    const { KEYWORDS } = await import("../src/index.ts");
    const reserved = /Reserved keywords: `([^`]+)`/.exec(readFileSync(DSL, "utf8"))![1]!.split(" ");
    expect(reserved).toEqual([...KEYWORDS]);
  });
});

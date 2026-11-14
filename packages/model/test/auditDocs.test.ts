// The table of docs/factorio-audit.md 14.2 (per control behaviour its fields, what the editor makes of each and where its default
// is from) is written from the settings table and the extract of the API reference, so that the audit cannot drift from either.
// `UPDATE_DOCS=1 npx vitest run packages/model/test/auditDocs.test.ts` rewrites it.
import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { conditionRole, ENTITY_SETTINGS, settingFields, type SettingSpec } from "../src/index.ts";
import type { ControlBehaviors } from "./controlBehaviors.ts";

const AUDIT = new URL("../../../docs/factorio-audit.md", import.meta.url);
const BEGIN = /<!-- control-behaviors:begin[^\n]*-->\n/;
const END = "<!-- control-behaviors:end -->";
const reference = JSON.parse(readFileSync(new URL("../../../tests/fixtures/game/control-behaviors-2.1.23.json", import.meta.url), "utf8")) as ControlBehaviors;

const code = (text: string): string => `\`${text}\``;

function word(spec: SettingSpec): string {
  const role = spec.type === "condition" ? conditionRole(spec.key) : undefined;
  return spec.type !== "condition" ? spec.key : role === undefined ? "when" : `${role} when`;
}

/** What the editor makes of one field of a behaviour, and where the default it uses is from. */
function fieldCell(field: string, specs: readonly SettingSpec[], stated: string | undefined): string {
  const own = specs.filter((spec) => spec.field === field);
  const flagged = specs.filter((spec) => (spec.type === "condition" && spec.flag === field) || (spec.type === "enum" && spec.flag?.field === field));
  if (own.length === 0 && flagged.length === 0) return `${code(field)}: kept only`;
  if (own.length === 0) return `${code(field)}: in use of ${flagged.map((spec) => code(word(spec))).join(", ")}`;
  const spec = own[0]!;
  // Every default is the one of the game (fixture F-01). `[api]`: the reference states the same; `[api: x]`: it states another.
  const plain = (value: string): string => value.replace(/^defines\..*\./, "").replace(/_/g, "-").replace(/^send-/, "");
  const agrees = (ours: string): string => (stated === undefined ? "[game]" : plain(stated) === ours ? "[api]" : `[api: ${code(stated)}]`);
  const source =
    spec.type === "boolean" ? `default ${code(String(spec.default))} ${agrees(String(spec.default))}`
    : spec.type === "enum" ? `default ${code(spec.default)} ${spec.flag ? "[game]" : agrees(spec.default)}`
    : spec.type === "signal" ? (spec.prototypeDefault === undefined ? "no default" : `default ${code(`default_${spec.prototypeDefault}_signal`)} [data]`)
    : spec.type === "networks" ? "both [api]"
    : spec.gameDefault ? `in a blueprint without it ${code(`${spec.gameDefault.first!.name} ${spec.gameDefault.comparator} 0`)} [game]`
    : spec.flagOnByDefault ? "blank, its flag on [game]"
    : "blank";
  const numbers = spec.type === "enum" ? `; ${spec.values.filter((entry) => entry.value !== undefined).map((entry) => `${entry.word} ${entry.value}`).join(", ")} [game]` : "";
  return `${code(field)}: ${code(word(spec))} (${spec.type}; ${source}${numbers})`;
}

export function behaviorTable(): string {
  const byBehavior = new Map<string, string[]>();
  for (const [type, row] of Object.entries(ENTITY_SETTINGS)) byBehavior.set(row.behavior, [...(byBehavior.get(row.behavior) ?? []), type]);
  const lines = ["| Control behaviour | Prototype types | Fields: setting (field type; default) |", "| --- | --- | --- |"];
  for (const [behavior, types] of [...byBehavior].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    // The types of one behaviour differ at most in what they keep (the rail signal has no blue signal): the richest row is shown.
    const row = types.map((type) => ENTITY_SETTINGS[type]!).sort((a, b) => b.settings.length - a.settings.length)[0]!;
    const cells = (reference.behaviors[behavior] ?? []).map((field) => fieldCell(field.name, row.settings, field.default));
    const names = types.map((type) => `${code(type)}${ENTITY_SETTINGS[type]!.assumed ? " (assumed)" : ""}`).join(", ");
    lines.push(`| ${code(behavior.replace(/BlueprintControlBehavior$/, ""))} | ${names} | ${cells.join("; ")} |`);
  }
  return `${lines.join("\n")}\n`;
}

describe("docs/factorio-audit.md 14.2", () => {
  it("has the table of control behaviours as the settings table and the API reference give it", () => {
    const text = readFileSync(AUDIT, "utf8");
    const begin = BEGIN.exec(text);
    const end = text.indexOf(END);
    expect(begin && end > begin.index, "the markers control-behaviors:begin and :end").toBeTruthy();
    const from = begin!.index + begin![0].length;
    if (process.env.UPDATE_DOCS) writeFileSync(AUDIT, text.slice(0, from) + behaviorTable() + text.slice(end));
    else expect(text.slice(from, end)).toBe(behaviorTable());
  });

  it("names every field of every behaviour of a generic prototype type", () => {
    const table = behaviorTable();
    for (const row of Object.values(ENTITY_SETTINGS)) {
      for (const field of reference.behaviors[row.behavior]!) expect(table, `${row.behavior}.${field.name}`).toContain(code(field.name));
      for (const spec of row.settings) for (const field of settingFields(spec)) expect(table).toContain(code(field));
    }
  });
});

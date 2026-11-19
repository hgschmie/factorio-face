// What the blueprint book probe sends to the game: books written by hand, as a tool other than the game might write them.
// The strings are made here with fflate alone, not with packages/blueprints, so that the fixture can be held against that package.
import { strToU8, zlibSync } from "fflate";
import fs from "node:fs";
import path from "node:path";

// 2.1.25.0, which the game takes like its own 2.1.25.10 (fixture F-01).
const VERSION = 562954250027008;

/** A blueprint with one constant combinator; the label says which one it is. */
const blueprint = (label) => ({ blueprint: { item: "blueprint", label, entities: [{ entity_number: 1, name: "constant-combinator", position: { x: 0.5, y: 0.5 } }], version: VERSION } });
const book = (label, blueprints, rest = {}) => ({ blueprint_book: { item: "blueprint-book", label, ...(blueprints && { blueprints }), ...rest, version: VERSION } });
const at = (index, item) => ({ ...item, index });
const [A, B, C, D] = ["A", "B", "C", "D"].map(blueprint);

/** The books, as { label, data } and `plain: true` where the game is given the JSON text itself. */
export const CASES = [
  { label: "dense", data: book("dense", [at(0, A), at(1, B), at(2, C)], { active_index: 0 }) },
  { label: "no index", data: book("no index", [A, B, C]) },
  { label: "index on some", data: book("index on some", [at(3, A), B, at(1, C), D]) },
  { label: "no index, then index 0", data: book("no index, then index 0", [A, at(0, B), C]) },
  { label: "duplicate index", data: book("duplicate index", [at(0, A), at(0, B), at(1, C)]) },
  { label: "duplicate index, last", data: book("duplicate index, last", [at(0, A), at(1, B), at(1, C)]) },
  { label: "out of order", data: book("out of order", [at(2, A), at(0, B), at(1, C)]) },
  { label: "gap", data: book("gap", [at(0, A), at(3, B)]) },
  { label: "first index 1", data: book("first index 1", [at(1, A), at(2, B)]) },
  { label: "far index", data: book("far index", [at(0, A), at(500, B), at(5000, C)]) },
  { label: "appended after a gap", data: book("appended after a gap", [at(0, A), at(2, B), at(3, C)]) },
  { label: "active_index 1", data: book("active_index 1", [at(0, A), at(1, B), at(2, C)], { active_index: 1 }) },
  { label: "active_index on a gap", data: book("active_index on a gap", [at(0, A), at(2, B)], { active_index: 1 }) },
  { label: "active_index beyond", data: book("active_index beyond", [at(0, A), at(1, B)], { active_index: 7 }) },
  { label: "active_index beyond, first index 1", data: book("active_index beyond, first index 1", [at(1, A), at(2, B)], { active_index: 7 }) },
  { label: "active_index absent", data: book("active_index absent", [at(0, A), at(1, B)]) },
  { label: "three levels", data: book("outer", [at(0, book("middle", [at(0, book("inner", [at(0, blueprint("deep"))], { active_index: 0 }))], { active_index: 0 }))], { active_index: 0 }) },
  { label: "no blueprints", data: book("no blueprints") },
  { label: "empty blueprints", data: book("empty blueprints", []) },
  { label: "blueprint without entities", data: book("blueprint without entities", [at(0, { blueprint: { item: "blueprint", label: "blank", version: VERSION } }), at(1, A)]) },
  { label: "book without item and version", data: { blueprint_book: { label: "book without item and version", blueprints: [at(0, A)] } } },
  ...[65534, 65535, 65536, 100000, -1, 1.5].map((index) => ({ label: `index ${index}`, data: book(`index ${index}`, [at(0, A), at(index, B)]) })),
  { label: "plain JSON", plain: true, data: book("plain JSON", [at(0, A), at(1, B)], { active_index: 0 }) },
];

/** The blueprint string of a JSON object: the version character, then the deflated JSON in base64. */
export const encodeString = (data) => `0${Buffer.from(zlibSync(strToU8(JSON.stringify(data)), { level: 9 })).toString("base64")}`;

/** JSON in ASCII only, so that the Lua file is the same bytes whatever reads it. */
const asciiJson = (value) => JSON.stringify(value).replace(/[^\x00-\x7e]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);

/** The Lua source of the scenario: one line that holds the cases as a JSON string, then blueprint-book.lua. */
export function composeScenario(cases = CASES) {
  const json = asciiJson(cases.map(({ label, data, plain }) => ({ label, string: plain ? JSON.stringify(data) : encodeString(data) })));
  // A long string ends at the first `]==]`; base64 and JSON of ours have none, and a check costs nothing.
  if (json.includes("]==]")) throw new Error("the cases contain ']==]', which ends the Lua string they are passed in");
  return `local CASES_JSON = [==[${json}]==]\n${fs.readFileSync(path.join(import.meta.dirname, "..", "blueprint-book.lua"), "utf8")}`;
}

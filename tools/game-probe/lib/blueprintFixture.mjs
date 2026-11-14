// Fixture F-01 from what blueprints.lua records: every blueprint string of the game next to the JSON it holds, in a fixed order
// and one blueprint per line. The strings are decoded here with fflate alone, not with packages/blueprints, so that the
// fixture can be held against that package.
import { strFromU8, unzlibSync } from "fflate";

/** The JSON object of a blueprint string of the game. */
export function decodeString(text) {
  if (typeof text !== "string" || text[0] !== "0") throw new Error(`not a blueprint string: ${String(text).slice(0, 40)}`);
  return JSON.parse(strFromU8(unzlibSync(Buffer.from(text.slice(1), "base64"))));
}

const exported = (string) => ({ string, blueprint: decodeString(string) });
// The game writes an empty Lua table as an object.
const list = (value) => (Array.isArray(value) ? value : []);

/**
 * The fixture for a recording `{ game_version, active_mods, defines, fresh, cases: [{ label, sent, import_result, reexported,
 * ghosts, revived, rebuilt, native, errors }] }`; `source` says where the recording is from. A step the game could not do
 * is in `errors` of its case and its blueprint is missing.
 */
export function buildFixture({ game_version: gameVersion, active_mods: activeMods, defines, fresh, cases }, source) {
  if (!gameVersion || !defines || !Array.isArray(cases) || cases.length === 0) throw new Error("the recording has no game version, no defines or no cases");
  const freshOf = (entry) => (entry?.string ? exported(entry.string) : { error: String(entry?.error ?? "not recorded") });
  return {
    format: 1,
    id: "F-01-blueprints",
    covers: ["F-01", "F-02", "F-23"],
    title: "Blueprints: what the game exports for every supported entity and setting, and what it makes of the blueprints this project exports",
    provenance: "game",
    source,
    gameVersion,
    activeMods: Object.keys(activeMods ?? {}).sort(),
    layout:
      "defines: the numbers behind the defines a blueprint uses. fresh: one of every supported entity as the game places it, untouched (placed) and with its control behaviour created (withControlBehavior). " +
      "cases: per sample circuit of packages/blueprints/test/samples.ts the blueprint this project exported (sent), the result of LuaItemStack.import_stack (0: no errors), the game's export_stack of it right after (reexported), " +
      "of the entities it built from it (rebuilt: ghosts revived, then a new blueprint), and of the same circuit built through the runtime API without a blueprint of ours (native). Every blueprint is the string and the JSON it holds.",
    defines: Object.fromEntries(Object.keys(defines).sort().map((name) => [name, Object.fromEntries(Object.entries(defines[name]).sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])))])),
    fresh: { placed: freshOf(fresh?.placed), withControlBehavior: freshOf(fresh?.with_control_behavior) },
    cases: cases.map(({ label, sent, import_result: importResult, reexported, ghosts, revived, rebuilt, native, errors }) => {
      if (typeof label !== "string" || typeof sent !== "string") throw new Error(`a case without label or string: ${JSON.stringify(label)}`);
      return {
        label,
        ...(importResult !== undefined && { importResult }),
        ...(ghosts !== undefined && { ghosts }),
        ...(revived !== undefined && { revived }),
        errors: list(errors),
        sent: exported(sent),
        ...(reexported && { reexported: exported(reexported) }),
        ...(rebuilt && { rebuilt: exported(rebuilt) }),
        ...(native && { native: exported(native) }),
      };
    }),
  };
}

/** Every step of every case that the game could not do, as "label: step: error". */
export function fixtureErrors(fixture) {
  const fresh = Object.entries(fixture.fresh).flatMap(([name, entry]) => (entry.error ? [`fresh ${name}: ${entry.error}`] : []));
  return [...fresh, ...fixture.cases.flatMap((entry) => entry.errors.map((error) => `${entry.label}: ${error}`))];
}

const BLUEPRINTS = ["sent", "reexported", "rebuilt", "native"];

/** One line per blueprint: readable enough, small, and the same bytes for the same recording. */
export function serialiseFixture({ defines, fresh, cases, ...head }) {
  const line = (key, value, indent) => `${indent}${JSON.stringify(key)}: ${JSON.stringify(value)}`;
  const block = (key, record, indent) => `${indent}${JSON.stringify(key)}: {\n${Object.entries(record).map(([name, value]) => line(name, value, `${indent}  `)).join(",\n")}\n${indent}}`;
  const one = (entry) => {
    const { sent: _sent, reexported: _reexported, rebuilt: _rebuilt, native: _native, ...facts } = entry;
    const lines = [...Object.entries(facts).map(([key, value]) => line(key, value, "      ")), ...BLUEPRINTS.filter((key) => entry[key]).map((key) => line(key, entry[key], "      "))];
    return `    {\n${lines.join(",\n")}\n    }`;
  };
  const fields = Object.entries(head).map(([key, value]) => line(key, value, "  "));
  return `{\n${[...fields, block("defines", defines, "  "), block("fresh", fresh, "  ")].join(",\n")},\n  "cases": [\n${cases.map(one).join(",\n")}\n  ]\n}\n`;
}

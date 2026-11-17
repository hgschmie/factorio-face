import { describe, expect, it } from "vitest";
import standard from "../../../../packages/catalog/data/catalog-2.1.25.json" with { type: "json" };
import { parseCatalogData } from "../../src/gameData/catalogData.ts";
import { ValidationError } from "../../src/validation.ts";

type Json = Record<string, unknown>;
const signal = (name: string, more: Json = {}): Json => ({ name, displayName: name, order: "a", subgroup: "s", modules: [], ...more });
const minimal = (more: Json = {}): Json => ({
  schema: 1,
  game: { version: "2.1.25", build: 88022 },
  provenance: { generator: "test", generatedAt: "2026-11-14T00:00:00Z", locale: "en", commands: [], modSets: ["base"], icons: "" },
  modules: [{ name: "base", title: "Base", version: "2.1.25", requires: [], recommends: [], featureFlags: [] }],
  constants: { defaultItemWeight: 100, rocketLiftWeight: 1000, rocketSilos: [] },
  groups: [{ name: "g", displayName: "Group", order: "a", modules: [] }],
  subgroups: [{ name: "s", group: "g", order: "a", modules: [] }],
  qualities: [],
  signals: { item: [signal("plate", { stackSize: 50 })] },
  ...more,
});

describe("parseCatalogData", () => {
  it("accepts the standard catalog as it is committed, and a minimal one", () => {
    expect(parseCatalogData(standard)).toBe(standard);
    const data = minimal();
    expect(parseCatalogData(data)).toBe(data);
    expect(parseCatalogData(minimal({ speakers: [{ name: "speaker", maximumPolyphony: 4, modules: [], instruments: [{ name: "kit", displayName: "Kit", notes: ["F#3"], noteNames: { "F#3": "F sharp" } }] }] }))).toBeDefined();
    expect(parseCatalogData(minimal({ signals: { item: [signal("plate", { variants: [{ when: ["space-age"], stackSize: 10, icon: null }] })] } }))).toBeDefined();
  });

  it.each<[string, unknown, RegExp]>([
    ["no record", [], /not of schema 1/],
    ["another schema", minimal({ schema: 2 }), /not of schema 1/],
    ["no game version", minimal({ game: { version: "2.1", build: 1 } }), /game version is "2.1"/],
    ["a build that is no number", minimal({ game: { version: "2.1.25", build: "x" } }), /game build is "x"/],
    ["no provenance", minimal({ provenance: undefined }), /provenance undefined is not a record/],
    ["a module without dependencies", minimal({ modules: [{ name: "base", title: "Base", version: "1" }] }), /module base: requires is undefined/],
    ["constants of another shape", minimal({ constants: { defaultItemWeight: "heavy", rocketLiftWeight: 1, rocketSilos: [] } }), /constants are/],
    ["signals that are no lists", minimal({ signals: { item: { plate: {} } } }), /item signals are/],
    ["a kind the editor does not have", minimal({ signals: { custom: [] } }), /"custom" is not a kind of signal/],
    ["a signal without a name", minimal({ signals: { item: [{ displayName: "x", order: "a", subgroup: "s", modules: [] }] } }), /item signal name is undefined/],
    ["a signal with a field of the wrong type", minimal({ signals: { item: [signal("plate", { stackSize: "50" })] } }), /item signal plate: stackSize is "50"/],
    ["a signal with a field the format lacks", minimal({ signals: { item: [signal("plate", { script: "x" })] } }), /item signal plate: script is "x"/],
    ["a name with a control character", minimal({ signals: { item: [signal("pla\nte")] } }), /item signal pla\nte: name is/],
    ["a signal without modules", minimal({ signals: { item: [{ ...signal("plate"), modules: undefined }] } }), /plate: modules is undefined/],
    ["a signal in a subgroup that does not exist", minimal({ signals: { item: [signal("plate", { subgroup: "other" })] } }), /item signal "plate" is in a subgroup that does not exist: "other"/],
    ["a subgroup in a group that does not exist", minimal({ subgroups: [{ name: "s", group: "other", order: "a", modules: [] }] }), /subgroup "s" is in a group that does not exist/],
    ["a signal that occurs twice", minimal({ signals: { item: [signal("plate"), signal("plate")] } }), /a item signal occurs twice/],
    ["a variant that renames", minimal({ signals: { item: [signal("plate", { variants: [{ when: ["x"], name: "other" }] })] } }), /plate: variants are/],
    ["a variant with a wrong value", minimal({ signals: { item: [signal("plate", { variants: [{ when: ["x"], stackSize: "1" }] })] } }), /plate: variants are/],
    ["a field at the top the format lacks", minimal({ extra: 1 }), /unknown field "extra"/],
    ["an instrument without notes", minimal({ speakers: [{ name: "speaker", maximumPolyphony: 4, modules: [], instruments: [{ name: "kit", displayName: "Kit" }] }] }), /speaker speaker: instruments is/],
  ])("refuses %s", (_what, value, message) => {
    expect(() => parseCatalogData(value)).toThrow(ValidationError);
    expect(() => parseCatalogData(value)).toThrow(message);
  });
});

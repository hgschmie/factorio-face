// The record of the game a project was made with: when a save writes it, and what it says against the data in use.
import { describe, expect, it } from "vitest";
import type { ProjectMods } from "../../../desktop/src/ipc.ts";
import { builtInData, type DataInUse } from "../../src/gameData/dataInUse.ts";
import { compareMods, describeRecord, modsNotice, modsRecord } from "../../src/gameData/projectMods.ts";

const GAME_MODULES = ["base", "elevated-rails", "recycler", "quality", "space-age"].map((name) => ({ name, version: "2.1.24" }));
const game = (mods: readonly { name: string; version: string }[], version = "2.1.24"): DataInUse => {
  const loaded = [...GAME_MODULES.map((module) => ({ ...module, version })), ...mods];
  return { source: { kind: "game", version, build: 87808, readAt: "2026-11-14T12:00:00.000Z", mods: mods.length }, mods: loaded, problem: null };
};
const MODDED = game([{ name: "alpha", version: "1.0.0" }, { name: "beta", version: "0.4.2" }]);
const RECORD: ProjectMods = { gameVersion: "2.1.24", mods: [...GAME_MODULES, { name: "alpha", version: "1.0.0" }, { name: "beta", version: "0.4.2" }] };
const TAIL = " An entity the data in use does not have is an error in the source and a signal it does not have a warning, until the game is read with those mods; the project file keeps its record of them.";

describe("the record a save writes", () => {
  it("is the game and everything it had loaded, when the data was read from a game with mods", () => {
    expect(modsRecord(MODDED)).toEqual(RECORD);
  });

  it("is none for the built-in data and for a game without mods, so the project keeps the record it has", () => {
    expect(modsRecord(builtInData())).toBeUndefined();
    expect(modsRecord(game([]))).toBeUndefined();
  });

  it("reads as the game and its mods", () => {
    expect(describeRecord(RECORD)).toBe("Factorio 2.1.24 with alpha 1.0.0, beta 0.4.2");
    expect(describeRecord({ gameVersion: "2.1.30", mods: GAME_MODULES })).toBe("Factorio 2.1.30");
    const many = { gameVersion: "2.1.24", mods: Array.from({ length: 9 }, (_, index) => ({ name: `mod-${index}`, version: "1.0.0" })) };
    expect(describeRecord(many)).toBe("Factorio 2.1.24 with mod-0 1.0.0, mod-1 1.0.0, mod-2 1.0.0, mod-3 1.0.0, mod-4 1.0.0, mod-5 1.0.0 and 3 more");
  });
});

describe("the comparison with the data in use", () => {
  it("finds nothing when the data has everything the project was made with, whatever else it has", () => {
    expect(compareMods(RECORD, MODDED)).toEqual({ missing: [], changed: [] });
    expect(modsNotice(RECORD, MODDED)).toBeNull();
    expect(modsNotice(RECORD, game([{ name: "alpha", version: "1.0.0" }, { name: "beta", version: "0.4.2" }, { name: "gamma", version: "3.0.0" }]))).toBeNull();
  });

  it("names the mods the built-in data lacks", () => {
    expect(compareMods(RECORD, builtInData())).toEqual({ missing: [{ name: "alpha", version: "1.0.0" }, { name: "beta", version: "0.4.2" }], changed: [] });
    expect(modsNotice(RECORD, builtInData())).toBe(`This project was made with other game data. The data in use lacks alpha 1.0.0, beta 0.4.2.${TAIL}`);
  });

  it("names a mod in another version, and a module of the game that is not loaded", () => {
    const other = { ...game([{ name: "alpha", version: "1.1.0" }, { name: "beta", version: "0.4.2" }]), mods: [{ name: "base", version: "2.1.24" }, { name: "alpha", version: "1.1.0" }, { name: "beta", version: "0.4.2" }] };
    expect(compareMods(RECORD, other)).toEqual({ missing: GAME_MODULES.slice(1), changed: [{ name: "alpha", project: "1.0.0", current: "1.1.0" }] });
    expect(modsNotice(RECORD, other)).toBe(
      `This project was made with other game data. The data in use lacks elevated-rails 2.1.24, recycler 2.1.24, quality 2.1.24, space-age 2.1.24. It has alpha 1.1.0 instead of 1.0.0.${TAIL}`,
    );
  });

  it("names a game version that differs once, not once per module of the game", () => {
    const newer = game([{ name: "alpha", version: "1.0.0" }, { name: "beta", version: "0.4.2" }], "2.1.30");
    expect(compareMods(RECORD, newer)).toEqual({ gameVersion: { project: "2.1.24", current: "2.1.30" }, missing: [], changed: [] });
    expect(modsNotice(RECORD, newer)).toBe(`This project was made with other game data. It was made with Factorio 2.1.24; the data in use is of 2.1.30.${TAIL}`);
  });

  it("names the first few of many and counts the rest", () => {
    const many: ProjectMods = { gameVersion: "2.1.24", mods: Array.from({ length: 40 }, (_, index) => ({ name: `mod-${index}`, version: "1.0.0" })) };
    expect(modsNotice(many, builtInData())).toContain("The data in use lacks mod-0 1.0.0, mod-1 1.0.0, mod-2 1.0.0, mod-3 1.0.0, mod-4 1.0.0, mod-5 1.0.0 and 34 more.");
  });
});

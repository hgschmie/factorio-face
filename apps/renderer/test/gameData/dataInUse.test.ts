// The data a window works with: applied to the model and the catalog before anything else, and the built-in data when the
// given one cannot be used after all.
import { currentCatalog, findSignal, loadStandardCatalog } from "@face/catalog";
import { entityTable, isPrototypeName, signal, STANDARD_ENTITY_TABLE } from "@face/model";
import { afterEach, describe, expect, it } from "vitest";
import type { FaceApi, GameDataInUse } from "../../../desktop/src/ipc.ts";
import { applyData, builtInData, loadDataInUse } from "../../src/gameData/dataInUse.ts";
import { MOD_ENTITY, MOD_SIGNAL, MODDED_MODS, MODDED_SOURCE, moddedData } from "../fixtures/moddedData.ts";

const BUILT_IN: GameDataInUse = { source: { kind: "built-in", version: "2.1.24" }, problem: null, mods: [], catalog: null, entities: null };
const api = (answer: () => ReturnType<FaceApi["getGameData"]>): FaceApi => ({ getGameData: answer }) as unknown as FaceApi;

afterEach(() => applyData(BUILT_IN));

describe("the data in use", () => {
  it("is the built-in one without the desktop app and when the main process says so", async () => {
    const standard = { source: { kind: "built-in", version: "2.1.24" }, mods: loadStandardCatalog().modules.map(({ name, version }) => ({ name, version })), problem: null };
    expect(builtInData()).toEqual(standard);
    expect(await loadDataInUse(undefined)).toEqual(standard);
    expect(await loadDataInUse(api(async () => ({ ok: true, value: BUILT_IN })))).toEqual(standard);
    expect(entityTable()).toBe(STANDARD_ENTITY_TABLE);
    expect(currentCatalog()).toBe(loadStandardCatalog());
  });

  it("is the game's when the main process hands it over: the entity table and the catalog are replaced", async () => {
    const data = await loadDataInUse(api(async () => ({ ok: true, value: moddedData() })));
    expect(data).toEqual({ source: MODDED_SOURCE, mods: MODDED_MODS, problem: null });
    expect(entityTable()).not.toBe(STANDARD_ENTITY_TABLE);
    expect(entityTable().byName.get(MOD_ENTITY)).toMatchObject({ type: "container", width: 2, height: 2 });
    expect(isPrototypeName(MOD_ENTITY)).toBe(true);
    expect(findSignal(currentCatalog(), signal("virtual", MOD_SIGNAL))?.displayName).toBe("Mod signal");
    expect(currentCatalog().modules.map((module) => module.name)).toEqual(["base", "elevated-rails", "recycler", "quality", "space-age", "some-mod"]);

    // The built-in data afterwards brings both back.
    applyData(BUILT_IN);
    expect(entityTable()).toBe(STANDARD_ENTITY_TABLE);
    expect(currentCatalog()).toBe(loadStandardCatalog());
    expect(isPrototypeName(MOD_ENTITY)).toBe(false);
  });

  it("carries the reason why data read earlier is not in use", () => {
    const problem = "The data read from your game cannot be used: the file is of another format. The built-in data is in use.";
    expect(applyData({ ...BUILT_IN, problem })).toEqual(builtInData(problem));
  });

  it("falls back to the built-in data, with a message, when the tables cannot be used after all", () => {
    const lacking = applyData(moddedData(["substation"]));
    expect(lacking).toEqual(builtInData("The data read from your game cannot be used: The entity table of Factorio 2.1.24 has no substation. The built-in data is in use."));
    expect(entityTable()).toBe(STANDARD_ENTITY_TABLE);
    expect(currentCatalog()).toBe(loadStandardCatalog());

    const damaged = applyData({ ...moddedData(), entities: { schema: 2 } });
    expect(damaged.source).toEqual({ kind: "built-in", version: "2.1.24" });
    expect(damaged.problem).toBe("The data read from your game cannot be used: Entity table: not a table of schema 1. The built-in data is in use.");
    expect(applyData({ ...moddedData(), catalog: { schema: 7 } as never }).problem).toBe("The data read from your game cannot be used: Unsupported catalog schema 7. The built-in data is in use.");
    expect(currentCatalog()).toBe(loadStandardCatalog());
  });

  it("falls back when the main process cannot be asked", async () => {
    expect(await loadDataInUse(api(async () => ({ ok: false, error: "IPC call from an unknown sender" })))).toEqual(builtInData("The data of the game could not be loaded: IPC call from an unknown sender. The built-in data is in use."));
    expect((await loadDataInUse(api(() => Promise.reject(new Error("no handler"))))).problem).toBe("The data of the game could not be loaded: no handler. The built-in data is in use.");
  });
});

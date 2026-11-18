// What the user hid of the modules, as the editor holds it: the rule the offers are filtered by, the entries after a change,
// and what comes over IPC.
import { describe, expect, it } from "vitest";
import type { FaceApi } from "../../desktop/src/ipc.ts";
import { hiddenItems, loadHiddenItems, NOTHING_HIDDEN, parseHiddenItems, withHiddenModule } from "../src/settings/hiddenItems.ts";

const BASE = { module: "base", signals: ["item:wooden-chest", "virtual:signal-A"], entities: ["wooden-chest"] };
const MOD = { module: "some-mod", signals: ["virtual:mod-signal"], entities: [] };

describe("the rule", () => {
  const hidden = hiddenItems([BASE, MOD]);

  it("hides a signal or an entity that the entry of its first module names", () => {
    expect(hidden.signal({ key: "item:wooden-chest", modules: ["base"] })).toBe(true);
    expect(hidden.signal({ key: "item:iron-chest", modules: ["base"] })).toBe(false);
    expect(hidden.entity({ name: "wooden-chest", modules: ["base"] })).toBe(true);
    expect(hidden.entity({ name: "iron-chest", modules: ["base"] })).toBe(false);
    // A signal and an entity of one name are two things.
    expect(hidden.entity({ name: "mod-signal", modules: ["some-mod"] })).toBe(false);
    expect(hidden.signal({ key: "virtual:mod-signal", modules: ["some-mod"] })).toBe(true);
  });

  it("looks in the list of the first module only, where the dialog has the record", () => {
    expect(hidden.signal({ key: "virtual:mod-signal", modules: ["some-mod", "base"] })).toBe(true);
    expect(hidden.signal({ key: "virtual:mod-signal", modules: ["base", "some-mod"] })).toBe(false);
    expect(hidden.signal({ key: "item:wooden-chest", modules: [] })).toBe(false);
    expect(hidden.entity({ name: "wooden-chest", modules: ["other-mod"] })).toBe(false);
  });

  it("says what is stored for a module", () => {
    expect(hidden.of("base")).toBe(BASE);
    expect(hidden.of("nothing-hidden")).toEqual({ module: "nothing-hidden", signals: [], entities: [] });
    expect(hidden.entries).toEqual([BASE, MOD]);
    expect(NOTHING_HIDDEN.entries).toEqual([]);
    expect(NOTHING_HIDDEN.signal({ key: "item:wooden-chest", modules: ["base"] })).toBe(false);
  });
});

describe("the entries after a change", () => {
  it("have the module's entry replaced in its place, added at the end, or gone with nothing hidden", () => {
    const fewer = { module: "base", signals: [], entities: ["wooden-chest"] };
    expect(withHiddenModule([BASE, MOD], fewer)).toEqual([fewer, MOD]);
    expect(withHiddenModule([MOD], BASE)).toEqual([MOD, BASE]);
    expect(withHiddenModule([BASE, MOD], { module: "base", signals: [], entities: [] })).toEqual([MOD]);
    expect(withHiddenModule([MOD], { module: "base", signals: [], entities: [] })).toEqual([MOD]);
  });
});

describe("what comes from the main process", () => {
  it("is taken as it is, without what is no entry", () => {
    expect(parseHiddenItems([BASE, MOD])).toEqual([BASE, MOD]);
    expect(parseHiddenItems([BASE, null, "base", { module: "x" }, { module: 1, signals: [], entities: [] }, { module: "y", signals: [1], entities: [] }])).toEqual([BASE]);
    for (const value of [undefined, null, {}, "text"]) expect(parseHiddenItems(value)).toEqual([]);
  });

  it("is asked for once at start, and nothing is hidden when it cannot be said", async () => {
    const api = (getHiddenItems: FaceApi["getHiddenItems"]): FaceApi => ({ getHiddenItems }) as FaceApi;
    expect(await loadHiddenItems(undefined)).toEqual([]);
    expect(await loadHiddenItems(api(() => Promise.resolve({ ok: true, value: [BASE] })))).toEqual([BASE]);
    expect(await loadHiddenItems(api(() => Promise.resolve({ ok: false, error: "no settings" })))).toEqual([]);
    expect(await loadHiddenItems(api(() => Promise.reject(new Error("no bridge"))))).toEqual([]);
  });
});

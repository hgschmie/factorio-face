// Which icons a view asks for: only those the main process can draw (`DataInUse.icons`). A game with mods has signals and
// entities whose icon is an image of a mod; they have no URL, so every view shows what it shows without icons.
import { loadStandardCatalog } from "@face/catalog";
import { PROTOTYPE_NAMES, signal } from "@face/model";
import { afterEach, describe, expect, it } from "vitest";
import { layoutRow, STATUS_ROWS } from "../src/canvas/statusRows.ts";
import { prototypeIconId } from "../src/entities/registry.ts";
import { applyData } from "../src/gameData/dataInUse.ts";
import { catalogEntityIconUrl, prototypesWithIcon } from "../src/icons/catalogEntityIcons.ts";
import { catalogIconResolver, isDrawable, probeIcon } from "../src/icons/catalogSignalIcons.ts";
import { MOD_ENTITY, MOD_SIGNAL, MODDED_MODULES, moddedData, STANDARD_ICONS } from "./fixtures/moddedData.ts";
import { moddedKindsData } from "./fixtures/moddedKinds.ts";
import { createSession, EMPTY_SOURCE, project } from "./session/helpers.ts";

const ROOT = "face-asset://catalog/";
const DRAWABLE = new Set(STANDARD_ICONS);
const A = signal("virtual", "signal-A");
const MOD = signal("virtual", MOD_SIGNAL);

afterEach(() => applyData({ source: { kind: "built-in", version: "2.1.24" }, problem: null, mods: [], catalog: null, entities: null, icons: [] }));

describe("the URL of a catalog icon", () => {
  it("is there for an icon the main process draws and for no other one", () => {
    const iconUrl = catalogIconResolver(ROOT, 0, DRAWABLE);
    expect(iconUrl("virtual/signal-A")).toBe("face-asset://catalog/icons/virtual/signal-A.png");
    expect(iconUrl("group/logistics")).toBe("face-asset://catalog/icons/group/logistics.png");
    expect(iconUrl(`virtual/${MOD_SIGNAL}`)).toBeUndefined();
    expect(iconUrl("virtual/ltn-depot")).toBeUndefined();
    expect(catalogIconResolver(ROOT, 0, new Set())("virtual/signal-A")).toBeUndefined();
  });

  it("carries the icon revision, and is there for every icon while it is not known which ones can be drawn", () => {
    expect(catalogIconResolver(ROOT, 3, DRAWABLE)("item/iron-plate")).toBe("face-asset://catalog/icons/item/iron-plate.png?r=3");
    expect(catalogIconResolver(ROOT)(`virtual/${MOD_SIGNAL}`)).toBe(`face-asset://catalog/icons/virtual/${MOD_SIGNAL}.png`);
    expect([isDrawable(null, "anything/at-all"), isDrawable(DRAWABLE, "anything/at-all"), isDrawable(DRAWABLE, "item/iron-plate")]).toEqual([true, false, true]);
  });

  it("is probed with an icon that can be drawn: the signal A, another one when a mod drew that, none when there is none", () => {
    expect(probeIcon(null)).toBe("virtual/signal-A");
    expect(probeIcon(DRAWABLE)).toBe("virtual/signal-A");
    expect(probeIcon(new Set(["item/iron-plate", "item/copper-plate"]))).toBe("item/iron-plate");
    expect(probeIcon(new Set())).toBeUndefined();
  });
});

describe("the built-in data", () => {
  it("names no icon the app cannot draw: every group, quality and signal of the catalog resolves, whatever modules are on", () => {
    const catalog = loadStandardCatalog();
    const named = [...catalog.groups, ...catalog.qualities, ...catalog.signals].flatMap((entry) => [entry.icon, ...(entry.variants ?? []).flatMap((variant) => variant.icon ?? [])]);
    expect(named.length).toBeGreaterThan(1000);
    expect(named.filter((icon) => !DRAWABLE.has(icon))).toEqual([]);
  });
});

describe("a signal with an icon of a mod", () => {
  it("is written by its short name in a status row, laid out as text, beside a signal with an icon", () => {
    const data = applyData(moddedData());
    const catalog = createSession(EMPTY_SOURCE, { data, project: project(EMPTY_SOURCE, { modules: MODDED_MODULES }) }).session.state.catalog;
    const iconUrl = catalogIconResolver(ROOT, 0, data.icons);
    // As the app describes a signal for the views: the icon the catalog names, when it can be drawn.
    const iconOf = (id: typeof A): string | undefined => {
      const { icon } = catalog.describe(id);
      return icon === undefined ? undefined : iconUrl(icon);
    };
    expect(catalog.describe(MOD)).toMatchObject({ status: "known", displayName: "Mod signal", icon: `virtual/${MOD_SIGNAL}` });
    expect([iconOf(A), iconOf(MOD)]).toEqual(["face-asset://catalog/icons/virtual/signal-A.png", undefined]);

    const { contentX, icon: iconSize, iconGap, gap, charWidth } = STATUS_ROWS;
    const { items, more } = layoutRow([{ signal: MOD, value: 1 }, { signal: A, value: 5 }], iconOf, 3);
    const nameWidth = `${MOD_SIGNAL} 1`.length * charWidth;
    expect(more).toBe(0);
    expect(items).toEqual([
      { signal: MOD, line: 0, x: contentX, iconUrl: undefined, textX: contentX, text: `${MOD_SIGNAL} 1` },
      { signal: A, line: 0, x: contentX + nameWidth + gap, iconUrl: "face-asset://catalog/icons/virtual/signal-A.png", textX: contentX + nameWidth + gap + iconSize + iconGap, text: "5" },
    ]);
  });
});

describe("the entity icons that are asked for", () => {
  it("are those of the prototypes whose icon can be drawn: the game's own, not the chests of its editor", () => {
    const asked = prototypesWithIcon(DRAWABLE);
    expect(PROTOTYPE_NAMES.filter((prototype) => !asked.includes(prototype))).toEqual(["blue-chest", "crash-site-chest-1", "crash-site-chest-2", "red-chest"]);
    expect(asked.every((prototype) => DRAWABLE.has(prototypeIconId(prototype)))).toBe(true);
    expect(catalogEntityIconUrl(ROOT, "small-lamp", 2)).toBe("face-asset://catalog/icons/item/small-lamp.png?r=2");
    // Not known: every prototype is probed, as before.
    expect(prototypesWithIcon(null)).toEqual(PROTOTYPE_NAMES);
    expect(prototypesWithIcon(new Set())).toEqual([]);
  });

  it("leave out what a mod adds, whose icon is the mod's", () => {
    const crate = applyData(moddedData());
    expect(PROTOTYPE_NAMES).toContain(MOD_ENTITY);
    expect(prototypesWithIcon(crate.icons)).not.toContain(MOD_ENTITY);

    const kinds = applyData(moddedKindsData());
    // Every modded prototype with a kind, the one the game hides among them.
    const modded = PROTOTYPE_NAMES.filter((prototype) => prototype.startsWith("mod-") || prototype === "5d-lamp");
    expect(modded).toHaveLength(9);
    const asked = prototypesWithIcon(kinds.icons);
    expect(asked.filter((prototype) => modded.includes(prototype))).toEqual([]);
    expect(asked).toContain("constant-combinator");
    expect(asked).toHaveLength(PROTOTYPE_NAMES.length - modded.length - 4);
  });
});

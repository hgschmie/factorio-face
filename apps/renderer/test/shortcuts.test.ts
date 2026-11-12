// The shortcut table: one binding per key, a label on every platform, the native menu's accelerators all listed, and the matching
// of key events including modifiers and physical keys.
import { ENTITY_KINDS } from "@face/model";
import { describe, expect, it } from "vitest";
import { MENU_ACCELERATORS, menuAccelerator, platformAccelerator } from "../../desktop/src/accelerators.ts";
import { SIMPLE_MENU_COMMANDS } from "../../desktop/src/ipc.ts";
import { buildMenuTemplate } from "../../desktop/src/menu.ts";
import { ACCELERATOR_MODIFIERS, nudgeDelta, NUDGE_FAR_STEPS, SHORTCUT_GROUPS, shortcutFor, shortcutKeys, shortcutLabel, SHORTCUTS, withShortcut, type KeyStroke, type Shortcut } from "../src/shortcuts/shortcuts.ts";

const ALL: readonly Shortcut[] = SHORTCUTS;
const PLATFORMS = [["macOS", true], ["the other platforms", false]] as const;

/** A key event: the key as `KeyboardEvent.key`, the physical key derived from it unless given, and the modifiers held. */
function stroke(key: string, held: Partial<Record<"shift" | "alt" | "ctrl" | "meta", boolean>> & { readonly code?: string } = {}): KeyStroke {
  const code = held.code ?? (/^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : /^\d$/.test(key) ? `Digit${key}` : key);
  return { key, code, shiftKey: held.shift ?? false, altKey: held.alt ?? false, ctrlKey: held.ctrl ?? false, metaKey: held.meta ?? false };
}

const idFor = (event: KeyStroke, mac: boolean): string | undefined => shortcutFor(event, mac)?.id;

describe("shortcut table", () => {
  it("has every id once and every entry in a group, with either a key of the renderer or an accelerator of the menu", () => {
    expect(new Set(ALL.map((shortcut) => shortcut.id)).size).toBe(ALL.length);
    for (const shortcut of ALL) {
      expect(SHORTCUT_GROUPS, shortcut.id).toContain(shortcut.group);
      expect(shortcut.description.trim(), shortcut.id).not.toBe("");
      expect(shortcut.chord === undefined, shortcut.id).toBe(shortcut.scope === "menu");
      expect(shortcut.accelerator !== undefined, shortcut.id).toBe(shortcut.scope === "menu");
    }
    for (const group of SHORTCUT_GROUPS) expect(ALL.some((shortcut) => shortcut.group === group), group).toBe(true);
  });

  it.each(PLATFORMS)("has a label for every entry and no key twice on %s", (_name, mac) => {
    const labels = ALL.map((shortcut) => shortcutKeys(shortcut, mac).join("+"));
    for (const [index, shortcut] of ALL.entries()) {
      const keys = shortcutKeys(shortcut, mac);
      expect(keys.length, shortcut.id).toBeGreaterThan(0);
      for (const cap of keys) expect(cap.trim(), shortcut.id).not.toBe("");
      expect(labels.indexOf(labels[index]!), `${shortcut.id} shares ${labels[index]}`).toBe(index);
    }
  });

  it.each(PLATFORMS)("matches no key event with two entries on %s", (_name, mac) => {
    // Every key of every chord, with the chord's modifiers: exactly the entry it belongs to answers.
    for (const shortcut of ALL) {
      const chord = shortcut.chord;
      if (!chord || shortcut.scope === "clipboard") continue;
      const held = { shift: chord.shift ?? chord.anyShift ?? false, alt: chord.alt ?? false, [mac ? "meta" : "ctrl"]: chord.mod ?? false };
      const events = "code" in chord ? [stroke("", { ...held, code: chord.code })] : chord.key.map((key) => stroke(key, held));
      for (const event of events) expect(idFor(event, mac), `${shortcut.id} ${event.key}${event.code}`).toBe(shortcut.id);
    }
  });

  it("lists every accelerator of the native menu, as the main process registers it", () => {
    const listed = new Map(ALL.flatMap((shortcut) => (shortcut.accelerator === undefined ? [] : [[shortcut.id, shortcut.accelerator] as const])));
    expect([...listed.keys()].sort()).toEqual(Object.keys(MENU_ACCELERATORS).sort());
    for (const [id, accelerator] of Object.entries(MENU_ACCELERATORS)) expect(listed.get(id), id).toBe(accelerator);

    // The menu itself: every command item with a key has the key of the table, and no command item has another one.
    const flatten = (items: readonly Electron.MenuItemConstructorOptions[]): Electron.MenuItemConstructorOptions[] => items.flatMap((item) => [item, ...flatten(Array.isArray(item.submenu) ? item.submenu : [])]);
    for (const [platform, mac] of [["darwin", true], ["linux", false], ["win32", false]] as const) {
      const sent: string[] = [];
      const items = flatten(buildMenuTemplate({ platform, developerTools: false, recentProjects: [], send: (command) => void sent.push(command.id), clearRecentProjects: () => undefined }));
      const registered = new Map<string, string | undefined>();
      for (const item of items) {
        if (!item.click) continue;
        (item.click as () => void)();
        registered.set(sent.at(-1)!, item.accelerator);
      }
      expect([...registered.keys()].sort()).toEqual([...SIMPLE_MENU_COMMANDS].sort());
      for (const id of SIMPLE_MENU_COMMANDS) expect(registered.get(id), `${platform} ${id}`).toBe(menuAccelerator(id, mac));
      expect(items.filter((item) => item.accelerator !== undefined && !item.click)).toEqual([]);
    }
  });

  it("knows every modifier the accelerators use", () => {
    for (const accelerator of Object.values(MENU_ACCELERATORS)) {
      for (const mac of [true, false]) {
        const parts = platformAccelerator(accelerator, mac).split("+");
        expect(parts.at(-1), String(accelerator)).not.toBe("");
        for (const modifier of parts.slice(0, -1)) expect(Object.keys(ACCELERATOR_MODIFIERS), platformAccelerator(accelerator, mac)).toContain(modifier);
      }
    }
  });

  it("gives the building blocks the digits in palette order", () => {
    expect(ENTITY_KINDS.map((kind) => shortcutLabel(`tool.place.${kind}`, true))).toEqual(["1", "2", "3", "4", "5"]);
    ENTITY_KINDS.forEach((kind, index) => expect(shortcutFor(stroke(String(index + 1)), false)?.tool).toEqual({ type: "place", kind }));
  });
});

describe("shortcut labels", () => {
  it("writes the keys the way the platform does", () => {
    const labels = (id: Parameters<typeof shortcutLabel>[0]): [string, string] => [shortcutLabel(id, true), shortcutLabel(id, false)];
    expect(labels("tool.select")).toEqual(["Q", "Q"]);
    expect(labels("tool.wireRed")).toEqual(["⌥R", "Alt+R"]);
    expect(labels("tool.wireGreen")).toEqual(["⌥G", "Alt+G"]);
    expect(labels("edit.rotate")).toEqual(["R", "R"]);
    expect(labels("edit.rotateBack")).toEqual(["⇧R", "Shift+R"]);
    expect(labels("edit.delete")).toEqual(["⌫", "Del"]);
    expect(labels("edit.duplicate")).toEqual(["⌘D", "Ctrl+D"]);
    expect(labels("edit.cut")).toEqual(["⌘X", "Ctrl+X"]);
    expect(labels("edit.copy")).toEqual(["⌘C", "Ctrl+C"]);
    expect(labels("edit.undo")).toEqual(["⌘Z", "Ctrl+Z"]);
    expect(labels("edit.redo")).toEqual(["⇧⌘Z", "Ctrl+Y"]);
    expect(labels("edit.selectAll")).toEqual(["⌘A", "Ctrl+A"]);
    expect(labels("file.save")).toEqual(["⌘S", "Ctrl+S"]);
    expect(labels("file.saveAs")).toEqual(["⇧⌘S", "Ctrl+Shift+S"]);
    expect(labels("view.fit")).toEqual(["⌘0", "Ctrl+0"]);
    expect(labels("view.zoomIn")).toEqual(["⌘+", "Ctrl++"]);
    expect(labels("view.zoomOut")).toEqual(["⌘-", "Ctrl+-"]);
    expect(labels("simulation.toggleRun")).toEqual(["⌘R", "Ctrl+R"]);
    expect(labels("simulation.reset")).toEqual(["⇧⌘R", "Ctrl+Shift+R"]);
    expect(labels("view.shortcuts")).toEqual(["?", "?"]);
    expect(labels("tool.cancel")).toEqual(["Esc", "Esc"]);
  });

  it("gives the overview the keys as separate caps, modifiers first", () => {
    const keys = (id: string, mac: boolean) => shortcutKeys(ALL.find((shortcut) => shortcut.id === id)!, mac);
    expect(keys("edit.nudgeFar", true)).toEqual(["⇧", "Arrow keys"]);
    expect(keys("edit.nudgeFar", false)).toEqual(["Shift", "Arrow keys"]);
    expect(keys("edit.nudge", true)).toEqual(["Arrow keys"]);
    expect(keys("file.saveAs", false)).toEqual(["Ctrl", "Shift", "S"]);
    expect(keys("tool.placeAtCenter", true)).toEqual(["↩"]);
    expect(keys("tool.placeAtCenter", false)).toEqual(["Enter"]);
  });

  it("puts the key into a tooltip", () => {
    expect(withShortcut("Select and move", "tool.select")).toBe("Select and move (Q)");
  });
});

describe("key matching", () => {
  it.each(PLATFORMS)("tells the plain keys from the same keys with a modifier on %s", (_name, mac) => {
    const mod = mac ? "meta" : "ctrl";
    const otherMod = mac ? "ctrl" : "meta";
    expect(idFor(stroke("r"), mac)).toBe("edit.rotate");
    expect(idFor(stroke("R"), mac)).toBe("edit.rotate"); // Caps Lock
    expect(idFor(stroke("R", { shift: true }), mac)).toBe("edit.rotateBack");
    // Run, Reset and Step of the menu are not a rotation, a tool or anything else here.
    expect(idFor(stroke("r", { [mod]: true }), mac)).toBeUndefined();
    expect(idFor(stroke("R", { [mod]: true, shift: true }), mac)).toBeUndefined();
    expect(idFor(stroke("r", { [otherMod]: true }), mac)).toBeUndefined();
    expect(idFor(stroke("q"), mac)).toBe("tool.select");
    for (const held of [{ [mod]: true }, { [otherMod]: true }, { alt: true }, { shift: true }]) expect(idFor(stroke("q", held), mac), JSON.stringify(held)).toBeUndefined();
    expect(idFor(stroke("d", { [mod]: true }), mac)).toBe("edit.duplicate");
    expect(idFor(stroke("d"), mac)).toBeUndefined();
    expect(idFor(stroke("d", { [otherMod]: true }), mac)).toBeUndefined();
    expect(idFor(stroke("d", { [mod]: true, shift: true }), mac)).toBeUndefined();
    expect(idFor(stroke("d", { [mod]: true, alt: true }), mac)).toBeUndefined();
    // Digits pick a building block; with Cmd or Ctrl they are the view modes of the menu.
    expect(idFor(stroke("1"), mac)).toBe("tool.place.constant");
    expect(idFor(stroke("5"), mac)).toBe("tool.place.lamp");
    expect(idFor(stroke("6"), mac)).toBeUndefined();
    expect(idFor(stroke("0"), mac)).toBeUndefined();
    expect(idFor(stroke("1", { [mod]: true }), mac)).toBeUndefined();
    expect(idFor(stroke("!", { shift: true, code: "Digit1" }), mac)).toBeUndefined();
    // Keys of the browser and of the menu are left alone.
    for (const key of ["x", "c", "v", "a", "z", "s"]) expect(idFor(stroke(key, { [mod]: true }), mac), key).toBeUndefined();
    for (const key of ["x", "c", "v", "a", "z", "s", "g", "e", "w"]) expect(idFor(stroke(key), mac), key).toBeUndefined();
  });

  it("takes the wire tools from the physical key, whatever Option makes of the character", () => {
    expect(idFor(stroke("®", { alt: true, code: "KeyR" }), true)).toBe("tool.wireRed");
    expect(idFor(stroke("©", { alt: true, code: "KeyG" }), true)).toBe("tool.wireGreen");
    expect(idFor(stroke("r", { alt: true }), false)).toBe("tool.wireRed");
    expect(idFor(stroke("g", { alt: true }), false)).toBe("tool.wireGreen");
    expect(shortcutFor(stroke("g", { alt: true }), false)?.tool).toEqual({ type: "wire", color: "green" });
    for (const mac of [true, false]) {
      expect(idFor(stroke("g"), mac)).toBeUndefined();
      expect(idFor(stroke("R", { alt: true, shift: true }), mac)).toBeUndefined();
      expect(idFor(stroke("r", { alt: true, meta: true }), mac)).toBeUndefined();
      // AltGr arrives as Ctrl+Alt on Windows.
      expect(idFor(stroke("r", { alt: true, ctrl: true }), mac)).toBeUndefined();
      expect(idFor(stroke("q", { alt: true, ctrl: true }), mac)).toBeUndefined();
    }
  });

  it("takes the digits from the physical key, which a layout may put behind Shift", () => {
    // AZERTY: the key types "&" and the digit with Shift.
    expect(idFor(stroke("&", { code: "Digit1" }), false)).toBe("tool.place.constant");
    expect(idFor(stroke("1", { shift: true, code: "Digit1" }), false)).toBeUndefined();
    expect(idFor(stroke("1", { code: "Numpad1" }), false)).toBeUndefined();
  });

  it("opens the overview on the character, with or without Shift", () => {
    for (const mac of [true, false]) {
      expect(idFor(stroke("?", { shift: true, code: "Slash" }), mac)).toBe("view.shortcuts");
      expect(idFor(stroke("?", { shift: true, code: "Minus" }), mac)).toBe("view.shortcuts"); // German layout
      expect(idFor(stroke("?", { code: "Slash" }), mac)).toBe("view.shortcuts");
      expect(idFor(stroke("/", { code: "Slash" }), mac)).toBeUndefined();
      expect(idFor(stroke("?", { shift: true, alt: true }), mac)).toBeUndefined();
      expect(idFor(stroke("?", { shift: true, [mac ? "meta" : "ctrl"]: true }), mac)).toBeUndefined();
    }
  });

  it("moves with the arrows, further with Shift, and repeats only those", () => {
    for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]) {
      expect(idFor(stroke(key), true)).toBe("edit.nudge");
      expect(idFor(stroke(key, { shift: true }), false)).toBe("edit.nudgeFar");
      for (const held of [{ alt: true }, { meta: true }, { ctrl: true }]) for (const mac of [true, false]) expect(idFor(stroke(key, held), mac)).toBeUndefined();
    }
    expect(ALL.filter((shortcut) => shortcut.repeats).map((shortcut) => shortcut.id)).toEqual(["edit.nudge", "edit.nudgeFar"]);
  });

  it("knows the keys of the canvas and says that they need the focus there", () => {
    for (const key of ["Delete", "Backspace"]) expect(shortcutFor(stroke(key), true)).toMatchObject({ id: "edit.delete", scope: "canvas" });
    expect(shortcutFor(stroke("Enter"), false)).toMatchObject({ id: "tool.placeAtCenter", scope: "canvas" });
    expect(shortcutFor(stroke("Escape"), false)).toMatchObject({ id: "tool.cancel", scope: "circuit" });
    expect(idFor(stroke("Backspace", { meta: true }), true)).toBeUndefined();
    expect(idFor(stroke("Tab"), true)).toBeUndefined();
  });
});

describe("nudgeDelta", () => {
  it("is one grid step of 20 units, and five of them with Shift", () => {
    expect(NUDGE_FAR_STEPS).toBe(5);
    expect(nudgeDelta("ArrowLeft", false)).toEqual({ x: -20, y: 0 });
    expect(nudgeDelta("ArrowRight", false)).toEqual({ x: 20, y: 0 });
    expect(nudgeDelta("ArrowUp", false)).toEqual({ x: 0, y: -20 });
    expect(nudgeDelta("ArrowDown", false)).toEqual({ x: 0, y: 20 });
    expect(nudgeDelta("ArrowLeft", true)).toEqual({ x: -100, y: 0 });
    expect(nudgeDelta("ArrowDown", true)).toEqual({ x: 0, y: 100 });
  });
});

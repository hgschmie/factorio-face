import type { MenuItemConstructorOptions } from "electron";
import { describe, expect, it } from "vitest";
import { menuAccelerator } from "../src/accelerators.ts";
import { APP_NAME, type MenuCommand, type SimpleMenuCommandId } from "../src/ipc.ts";
import { buildMenuTemplate, type MenuOptions } from "../src/menu.ts";

function build(options: Partial<MenuOptions> = {}): { readonly template: MenuItemConstructorOptions[]; readonly sent: MenuCommand[]; readonly cleared: () => number } {
  const sent: MenuCommand[] = [];
  let cleared = 0;
  const template = buildMenuTemplate({ platform: "darwin", developerTools: false, recentProjects: [], send: (command) => void sent.push(command), clearRecentProjects: () => void cleared++, ...options });
  return { template, sent, cleared: () => cleared };
}

const OPENED = "2026-11-11T12:00:00.000Z";
const itemsOf = (item: MenuItemConstructorOptions): MenuItemConstructorOptions[] => (Array.isArray(item.submenu) ? item.submenu : []);
const flatten = (items: readonly MenuItemConstructorOptions[]): MenuItemConstructorOptions[] => items.flatMap((item) => [item, ...flatten(itemsOf(item))]);
const menu = (template: readonly MenuItemConstructorOptions[], label: string): MenuItemConstructorOptions[] => itemsOf(template.find((item) => item.label === label)!);
const names = (items: readonly MenuItemConstructorOptions[]): string[] => items.map((item) => (item.type === "separator" ? "-" : (item.label ?? `role:${item.role}`)));
const click = (item: MenuItemConstructorOptions): void => (item.click as () => void)();

describe("application menu", () => {
  it("has the application menu first on macOS only", () => {
    expect(names(build({ platform: "darwin" }).template)).toEqual([APP_NAME, "File", "Edit", "View", "Simulation", "role:windowMenu", "Help"]);
    for (const platform of ["linux", "win32"] as const) expect(names(build({ platform }).template)).toEqual(["File", "Edit", "View", "Simulation", "role:windowMenu", "Help"]);
  });

  it("has the required items in the File, Edit and Simulation menus", () => {
    const { template } = build({ platform: "darwin" });
    expect(names(menu(template, "File"))).toEqual(["New Project", "Open Project...", "Open Recent", "-", "Save", "Save As...", "-", "role:close"]);
    expect(names(menu(template, "Edit"))).toEqual(["Undo", "Redo", "-", "role:cut", "role:copy", "role:paste", "Delete", "Select All"]);
    expect(names(menu(template, "Simulation"))).toEqual(["Run / Pause", "Step", "Reset"]);
    // The system adds its search field to the menu with the help role.
    expect(template.find((item) => item.label === "Help")?.role).toBe("help");
    expect(menu(template, "Help").map((item) => [item.label, item.accelerator])).toEqual([["Keyboard Shortcuts", undefined]]);
    expect(names(menu(build({ platform: "linux" }).template, "File")).at(-1)).toBe("role:quit");
  });

  it("shows one full screen entry: the system's own in the View menu on macOS, the role item elsewhere", () => {
    const view = ["Circuit", "Source", "Split", "-", "Zoom In", "Zoom Out", "Actual Size", "Fit to Content"];
    const darwin = build({ platform: "darwin" }).template;
    expect(names(menu(darwin, "View"))).toEqual(view);
    expect(flatten(darwin).filter((item) => item.role === "togglefullscreen")).toHaveLength(0);
    // The system only adds its item to a menu with this title.
    expect(darwin.filter((item) => item.label === "View")).toHaveLength(1);
    for (const platform of ["linux", "win32"] as const) {
      const template = build({ platform }).template;
      expect(names(menu(template, "View"))).toEqual([...view, "-", "role:togglefullscreen"]);
      expect(flatten(template).filter((item) => item.role === "togglefullscreen")).toHaveLength(1);
    }
  });

  it("adds the developer tools at the end of the View menu when asked to", () => {
    expect(names(menu(build({ platform: "darwin", developerTools: true }).template, "View")).slice(-2)).toEqual(["-", "role:toggleDevTools"]);
    expect(names(menu(build({ platform: "linux", developerTools: true }).template, "View")).slice(-4)).toEqual(["-", "role:togglefullscreen", "-", "role:toggleDevTools"]);
    expect(flatten(build().template).some((item) => item.role === "toggleDevTools")).toBe(false);
  });

  it.each(["darwin", "linux", "win32"] as const)("has no stray separators and no accelerator twice on %s", (platform) => {
    const { template } = build({ platform, developerTools: true, recentProjects: [{ name: "Demo", path: "/projects/demo.faceproj", openedAt: OPENED }] });
    for (const item of flatten(template)) {
      const entries = names(itemsOf(item));
      if (entries.length === 0) continue;
      expect(entries[0]).not.toBe("-");
      expect(entries.at(-1)).not.toBe("-");
      expect(entries.join(" ")).not.toContain("- -");
    }
    const accelerators = flatten(template).flatMap((item) => (item.accelerator ? [item.accelerator.toLowerCase()] : []));
    expect(new Set(accelerators).size).toBe(accelerators.length);
  });

  it("forwards document commands to the renderer instead of acting in the main process", () => {
    const { template, sent } = build({ platform: "darwin" });
    for (const item of flatten(template)) if (item.click) click(item);
    expect(sent.map((command) => command.id)).toEqual([
      "file.new", "file.open", "file.save", "file.saveAs",
      "edit.undo", "edit.redo", "edit.delete", "edit.selectAll",
      "view.circuit", "view.source", "view.split", "view.zoomIn", "view.zoomOut", "view.zoomReset", "view.fit",
      "simulation.toggleRun", "simulation.step", "simulation.reset",
      "help.shortcuts",
    ]);
  });

  it("takes the keys of its commands from the accelerator table", () => {
    for (const platform of ["darwin", "linux", "win32"] as const) {
      const { template, sent } = build({ platform });
      const mac = platform === "darwin";
      for (const item of flatten(template)) {
        if (!item.click) continue;
        click(item);
        expect(item.accelerator, `${platform} ${item.label}`).toBe(menuAccelerator(sent.at(-1)!.id as SimpleMenuCommandId, mac));
      }
      expect(menu(template, "File").find((item) => item.label === "Save As...")?.accelerator).toBe("CmdOrCtrl+Shift+S");
      expect(menu(template, "View").find((item) => item.label === "Actual Size")?.accelerator).toBeUndefined();
    }
    // No letter of a menu title is a mnemonic, so Alt with a letter (the wire tools) opens no menu on Windows and Linux.
    for (const item of flatten(build({ platform: "win32" }).template)) expect(item.label ?? "").not.toContain("&");
  });

  it("leaves undo and redo to the renderer, which knows where the focus is", () => {
    for (const platform of ["darwin", "linux"] as const) {
      const edit = menu(build({ platform }).template, "Edit");
      expect(flatten(edit).some((item) => item.role === "undo" || item.role === "redo")).toBe(false);
      expect(edit.slice(0, 2).map((item) => [item.label, item.accelerator])).toEqual([["Undo", "CmdOrCtrl+Z"], ["Redo", platform === "darwin" ? "Shift+Cmd+Z" : "Ctrl+Y"]]);
      // Delete has no accelerator: a registered key would be taken away from text fields.
      expect(edit.find((item) => item.label === "Delete")?.accelerator).toBeUndefined();
    }
  });

  it("lists recent projects with a way to clear them", () => {
    expect(menu(menu(build().template, "File"), "Open Recent")).toEqual([{ label: "No Recent Projects", enabled: false }]);
    const { template, sent, cleared } = build({ recentProjects: [{ name: "Demo", path: "/projects/demo.faceproj", openedAt: OPENED }, { name: "Other", path: "/projects/other.faceproj", openedAt: OPENED }] });
    const recent = menu(menu(template, "File"), "Open Recent");
    expect(names(recent)).toEqual(["Demo (/projects/demo.faceproj)", "Other (/projects/other.faceproj)", "-", "Clear Recent Projects"]);
    click(recent[1]!);
    expect(sent).toEqual([{ id: "file.openRecent", path: "/projects/other.faceproj" }]);
    click(recent[3]!);
    expect(cleared()).toBe(1);
  });
});

// Native application menu. Items that belong to the document forward a command to the renderer instead of acting in main.
import type { MenuItemConstructorOptions } from "electron";
import { APP_NAME, type MenuCommand, type RecentProject, type SimpleMenuCommandId } from "./ipc.ts";

export interface MenuOptions {
  readonly platform: NodeJS.Platform;
  readonly developerTools: boolean;
  readonly recentProjects: readonly RecentProject[];
  send(command: MenuCommand): void;
  clearRecentProjects(): void;
}

export function buildMenuTemplate(options: MenuOptions): MenuItemConstructorOptions[] {
  const { platform, recentProjects, send } = options;
  const isMac = platform === "darwin";
  const command = (label: string, id: SimpleMenuCommandId, accelerator?: string): MenuItemConstructorOptions => ({ label, accelerator, click: () => send({ id }) });
  const separator: MenuItemConstructorOptions = { type: "separator" };

  const recentItems: MenuItemConstructorOptions[] =
    recentProjects.length === 0
      ? [{ label: "No Recent Projects", enabled: false }]
      : [...recentProjects.map((project) => ({ label: `${project.name} (${project.path})`, click: () => send({ id: "file.openRecent", path: project.path }) })), separator, { label: "Clear Recent Projects", click: options.clearRecentProjects }];

  const appMenu: MenuItemConstructorOptions[] = isMac
    ? [{ label: APP_NAME, submenu: [{ role: "about" }, separator, { role: "services" }, separator, { role: "hide" }, { role: "hideOthers" }, { role: "unhide" }, separator, { role: "quit" }] }]
    : [];

  const viewItems: MenuItemConstructorOptions[] = [
    command("Circuit", "view.circuit", "CmdOrCtrl+1"),
    command("Source", "view.source", "CmdOrCtrl+2"),
    command("Split", "view.split", "CmdOrCtrl+3"),
    separator,
    command("Zoom In", "view.zoomIn", "CmdOrCtrl+Plus"),
    command("Zoom Out", "view.zoomOut", "CmdOrCtrl+-"),
    command("Actual Size", "view.zoomReset"),
    command("Fit to Content", "view.fit", "CmdOrCtrl+0"),
    separator,
    { role: "togglefullscreen" },
  ];
  if (options.developerTools) viewItems.push(separator, { role: "toggleDevTools" });

  return [
    ...appMenu,
    {
      label: "File",
      submenu: [
        command("New Project", "file.new", "CmdOrCtrl+N"),
        command("Open Project...", "file.open", "CmdOrCtrl+O"),
        { label: "Open Recent", submenu: recentItems },
        separator,
        command("Save", "file.save", "CmdOrCtrl+S"),
        command("Save As...", "file.saveAs", "CmdOrCtrl+Shift+S"),
        separator,
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        // Undo, Redo, Delete and Select All act on the document or on a focused text field; the renderer decides which.
        command("Undo", "edit.undo", "CmdOrCtrl+Z"),
        command("Redo", "edit.redo", isMac ? "Shift+Cmd+Z" : "Ctrl+Y"),
        separator,
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        // No accelerator: a registered Delete or Backspace key would be taken away from text fields.
        command("Delete", "edit.delete"),
        command("Select All", "edit.selectAll", "CmdOrCtrl+A"),
      ],
    },
    { label: "View", submenu: viewItems },
    {
      label: "Simulation",
      submenu: [command("Run / Pause", "simulation.toggleRun", "CmdOrCtrl+R"), command("Step", "simulation.step", "CmdOrCtrl+T"), command("Reset", "simulation.reset", "CmdOrCtrl+Shift+R")],
    },
    { role: "windowMenu" },
  ];
}

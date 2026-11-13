// Native application menu. Items that belong to the document forward a command to the renderer instead of acting in main.
import type { MenuItemConstructorOptions } from "electron";
import { menuAccelerator } from "./accelerators.ts";
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
  // The keys are in accelerators.ts, which the shortcut overview of the renderer reads as well.
  const command = (label: string, id: SimpleMenuCommandId): MenuItemConstructorOptions => ({ label, accelerator: menuAccelerator(id, isMac), click: () => send({ id }) });
  const separator: MenuItemConstructorOptions = { type: "separator" };

  // The settings of the application, not of the project: where the platform's users look for them.
  const settings = command("Settings...", "app.settings");

  const recentItems: MenuItemConstructorOptions[] =
    recentProjects.length === 0
      ? [{ label: "No Recent Projects", enabled: false }]
      : [...recentProjects.map((project) => ({ label: `${project.name} (${project.path})`, click: () => send({ id: "file.openRecent", path: project.path }) })), separator, { label: "Clear Recent Projects", click: options.clearRecentProjects }];

  const appMenu: MenuItemConstructorOptions[] = isMac
    ? [
        {
          label: APP_NAME,
          submenu: [{ role: "about" }, separator, settings, separator, { role: "services" }, separator, { role: "hide" }, { role: "hideOthers" }, { role: "unhide" }, separator, { role: "quit" }],
        },
      ]
    : [];

  const viewItems: MenuItemConstructorOptions[] = [
    command("Circuit", "view.circuit"),
    command("Source", "view.source"),
    command("Split", "view.split"),
    separator,
    command("Zoom In", "view.zoomIn"),
    command("Zoom Out", "view.zoomOut"),
    command("Actual Size", "view.zoomReset"),
    command("Fit to Content", "view.fit"),
  ];
  // macOS adds its own Enter Full Screen item, with the system shortcut, to a menu titled View. Electron's role item does not use
  // the standard action, so the system does not recognize it as that item and both would be shown.
  if (!isMac) viewItems.push(separator, { role: "togglefullscreen" });
  if (options.developerTools) viewItems.push(separator, { role: "toggleDevTools" });

  return [
    ...appMenu,
    {
      label: "File",
      submenu: [
        command("New Project", "file.new"),
        command("Open Project...", "file.open"),
        { label: "Open Recent", submenu: recentItems },
        separator,
        command("Save", "file.save"),
        command("Save As...", "file.saveAs"),
        separator,
        ...(isMac ? [{ role: "close" } as const] : [settings, separator, { role: "quit" } as const]),
      ],
    },
    {
      label: "Edit",
      submenu: [
        // Undo, Redo, Delete and Select All act on the document or on a focused text field; the renderer decides which.
        command("Undo", "edit.undo"),
        command("Redo", "edit.redo"),
        separator,
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        // No accelerator: a registered Delete or Backspace key would be taken away from text fields.
        command("Delete", "edit.delete"),
        command("Select All", "edit.selectAll"),
      ],
    },
    { label: "View", submenu: viewItems },
    {
      label: "Simulation",
      submenu: [command("Run / Pause", "simulation.toggleRun"), command("Step", "simulation.step"), command("Reset", "simulation.reset")],
    },
    { role: "windowMenu" },
    { label: "Help", role: "help", submenu: [command("Keyboard Shortcuts", "help.shortcuts")] },
  ];
}

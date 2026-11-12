// The keyboard accelerators of the native menu's command items. Pure data: the main process registers them (menu.ts) and the
// renderer lists them in its shortcut overview, so both import this module at runtime. Keep it free of Node and Electron imports.
import type { SimpleMenuCommandId } from "./ipc.ts";

/** An Electron accelerator, or one per platform where they differ. */
export type MenuAccelerator = string | { readonly mac: string; readonly other: string };

export const MENU_ACCELERATORS = {
  "file.new": "CmdOrCtrl+N",
  "file.open": "CmdOrCtrl+O",
  "file.save": "CmdOrCtrl+S",
  "file.saveAs": "CmdOrCtrl+Shift+S",
  "edit.undo": "CmdOrCtrl+Z",
  "edit.redo": { mac: "Shift+Cmd+Z", other: "Ctrl+Y" },
  "edit.selectAll": "CmdOrCtrl+A",
  "view.circuit": "CmdOrCtrl+1",
  "view.source": "CmdOrCtrl+2",
  "view.split": "CmdOrCtrl+3",
  "view.zoomIn": "CmdOrCtrl+Plus",
  "view.zoomOut": "CmdOrCtrl+-",
  "view.fit": "CmdOrCtrl+0",
  "simulation.toggleRun": "CmdOrCtrl+R",
  "simulation.step": "CmdOrCtrl+T",
  "simulation.reset": "CmdOrCtrl+Shift+R",
} as const satisfies Partial<Record<SimpleMenuCommandId, MenuAccelerator>>;

export type AcceleratedCommandId = keyof typeof MENU_ACCELERATORS;

export function platformAccelerator(accelerator: MenuAccelerator, mac: boolean): string {
  return typeof accelerator === "string" ? accelerator : mac ? accelerator.mac : accelerator.other;
}

/** The accelerator of a menu command on that platform; undefined for a command without one. */
export function menuAccelerator(id: SimpleMenuCommandId, mac: boolean): string | undefined {
  const accelerator: MenuAccelerator | undefined = (MENU_ACCELERATORS as Partial<Record<SimpleMenuCommandId, MenuAccelerator>>)[id];
  return accelerator === undefined ? undefined : platformAccelerator(accelerator, mac);
}

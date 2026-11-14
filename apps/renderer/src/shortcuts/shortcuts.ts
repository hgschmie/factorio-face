// Every keyboard shortcut of the app in one table: the keys the renderer listens for, the accelerators of the native menu and
// the keys the browser handles. Key matching, the labels in tooltips and menus and the shortcut overview all read it. Pure.
import type { Point } from "@face/model";
import { MENU_ACCELERATORS, platformAccelerator, type AcceleratedCommandId, type MenuAccelerator } from "../../../desktop/src/accelerators.ts";
import { GRID } from "../canvas/geometry.ts";
import { KIND_INFO } from "../entities/kindInfo.ts";
import { KEYED_KINDS } from "../entities/registry.ts";
import { IS_MAC } from "../platform.ts";
import { SELECT_TOOL, type Tool } from "../workbench/controller.ts";

export const SHORTCUT_GROUPS = ["Tools", "Editing", "View", "Simulation", "File"] as const;
export type ShortcutGroup = (typeof SHORTCUT_GROUPS)[number];

/**
 * Who acts on the key, and where the focus has to be:
 * - `circuit`: `Workbench`, wherever the focus is while the canvas is shown, except in a text control, the source editor, a dialog or a menu;
 * - `window`: `Workbench`, with the same exceptions, in every view mode;
 * - `canvas`: `Canvas`, while the focus is inside it;
 * - `menu`: an accelerator of the native menu, whose command arrives over IPC;
 * - `clipboard`: the browser, which raises the cut, copy and paste events.
 */
export type ShortcutScope = "circuit" | "window" | "canvas" | "menu" | "clipboard";

interface PlatformText {
  readonly mac: string;
  readonly other: string;
}

/** A key with its modifiers. A modifier that is not named must be up. */
export type Chord = {
  /** Cmd on macOS, Ctrl elsewhere. */
  readonly mod?: true;
  readonly alt?: true;
  readonly shift?: true;
  /** Shift is neither compared nor shown: the character itself says whether it takes Shift on the layout in use. */
  readonly anyShift?: true;
  /** The key as labels show it. */
  readonly name: string | PlatformText;
} & (
  | { /** `KeyboardEvent.key` values, compared without case. */ readonly key: readonly string[] }
  // Where the character depends on a modifier (Option+R types a sign on macOS) or the layout puts it behind Shift (digits on AZERTY).
  | { /** `KeyboardEvent.code`: the physical key. */ readonly code: string }
);

export interface Shortcut {
  readonly id: string;
  readonly group: ShortcutGroup;
  /** What the key does, as the overview says it. */
  readonly description: string;
  readonly scope: ShortcutScope;
  /** The key the renderer matches. With the scope `clipboard` it is the browser's key and only shown. */
  readonly chord?: Chord;
  /** `menu` scope: the accelerator the main process registers. */
  readonly accelerator?: MenuAccelerator;
  /** The tool the key picks. */
  readonly tool?: Tool;
  /** A held key repeats the action. */
  readonly repeats?: true;
}

const ARROW_KEYS = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"] as const;
/** Grid steps an arrow key moves the selection by while Shift is held. */
export const NUDGE_FAR_STEPS = 5;

function menu<Id extends AcceleratedCommandId>(id: Id, group: ShortcutGroup, description: string) {
  return { id, group, description, scope: "menu", accelerator: MENU_ACCELERATORS[id] } as const;
}

function key<Id extends string>(id: Id, group: ShortcutGroup, description: string, scope: ShortcutScope, chord: Chord, more: Pick<Shortcut, "tool" | "repeats"> = {}) {
  return { id, group, description, scope, chord, ...more } as const;
}

const letter = (name: string): { readonly key: readonly string[]; readonly name: string } => ({ key: [name], name });

/** In the order the overview lists them. */
export const SHORTCUTS = [
  key("tool.select", "Tools", "Select and move", "circuit", letter("Q"), { tool: SELECT_TOOL }),
  key("tool.wireRed", "Tools", "Red wire", "circuit", { alt: true, code: "KeyR", name: "R" }, { tool: { type: "wire", color: "red" } }),
  key("tool.wireGreen", "Tools", "Green wire", "circuit", { alt: true, code: "KeyG", name: "G" }, { tool: { type: "wire", color: "green" } }),
  ...KEYED_KINDS.map((kind, index) => key(`tool.place.${kind}`, "Tools", `Place: ${KIND_INFO[kind].label}`, "circuit", { code: `Digit${index + 1}`, name: String(index + 1) }, { tool: { type: "place", kind } })),
  key("tool.placeAtCenter", "Tools", "Place in the middle of the view (focus on the canvas)", "canvas", { key: ["Enter"], name: { mac: "↩", other: "Enter" } }),
  // Inside the canvas the key is the canvas's own (there it also clears the selection); elsewhere `Workbench` acts on it.
  key("tool.cancel", "Tools", "Cancel the pending wire, then the tool, then the selection", "circuit", { key: ["Escape"], name: "Esc" }),

  menu("edit.undo", "Editing", "Undo"),
  menu("edit.redo", "Editing", "Redo"),
  key("edit.cut", "Editing", "Cut", "clipboard", { mod: true, ...letter("X") }),
  key("edit.copy", "Editing", "Copy", "clipboard", { mod: true, ...letter("C") }),
  key("edit.paste", "Editing", "Paste", "clipboard", { mod: true, ...letter("V") }),
  key("edit.duplicate", "Editing", "Duplicate the selection", "circuit", { mod: true, ...letter("D") }),
  key("edit.delete", "Editing", "Delete the selection (focus on the canvas)", "canvas", { key: ["Delete", "Backspace"], name: { mac: "⌫", other: "Del" } }),
  menu("edit.selectAll", "Editing", "Select all"),
  key("edit.rotate", "Editing", "Rotate clockwise", "circuit", letter("R")),
  key("edit.rotateBack", "Editing", "Rotate counter-clockwise", "circuit", { shift: true, ...letter("R") }),
  key("edit.flipHorizontal", "Editing", "Flip horizontal", "circuit", letter("H")),
  key("edit.flipVertical", "Editing", "Flip vertical", "circuit", letter("V")),
  key("edit.nudge", "Editing", "Move the selection one grid step (one tile on the board)", "circuit", { key: ARROW_KEYS, name: "Arrow keys" }, { repeats: true }),
  key("edit.nudgeFar", "Editing", `Move the selection ${NUDGE_FAR_STEPS} grid steps (tiles on the board)`, "circuit", { shift: true, key: ARROW_KEYS, name: "Arrow keys" }, { repeats: true }),

  menu("view.circuit", "View", "Circuit"),
  menu("view.source", "View", "Source"),
  menu("view.split", "View", "Split"),
  menu("view.zoomIn", "View", "Zoom in"),
  menu("view.zoomOut", "View", "Zoom out"),
  menu("view.fit", "View", "Fit to content"),
  key("view.display", "View", "Switch between Edit and Blueprint view", "circuit", letter("B")),
  key("view.shortcuts", "View", "Keyboard shortcuts", "window", { anyShift: true, key: ["?"], name: "?" }),

  menu("simulation.toggleRun", "Simulation", "Run / Pause"),
  menu("simulation.step", "Simulation", "Step"),
  menu("simulation.reset", "Simulation", "Reset"),

  menu("file.new", "File", "New project"),
  menu("file.open", "File", "Open project"),
  menu("file.save", "File", "Save"),
  menu("file.saveAs", "File", "Save as"),
  menu("app.settings", "File", "Application settings"),
] as const satisfies readonly Shortcut[];

export type ShortcutId = (typeof SHORTCUTS)[number]["id"];

const BY_ID: ReadonlyMap<string, Shortcut> = new Map(SHORTCUTS.map((shortcut) => [shortcut.id, shortcut]));

/** The part of a key event that decides a match. */
export interface KeyStroke {
  readonly key: string;
  readonly code: string;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
}

function matches(chord: Chord, event: KeyStroke, mac: boolean): boolean {
  const [mod, otherMod] = mac ? [event.metaKey, event.ctrlKey] : [event.ctrlKey, event.metaKey];
  if (otherMod || mod !== (chord.mod ?? false) || event.altKey !== (chord.alt ?? false)) return false;
  if (!chord.anyShift && event.shiftKey !== (chord.shift ?? false)) return false;
  return "code" in chord ? event.code === chord.code : chord.key.some((name) => name.toLowerCase() === event.key.toLowerCase());
}

/** The shortcut the renderer acts on for this key event, if any. Where the focus is and what state allows is the caller's business. */
export function shortcutFor(event: KeyStroke, mac = IS_MAC): (Shortcut & { readonly id: ShortcutId }) | undefined {
  const shortcuts: readonly (Shortcut & { readonly id: ShortcutId })[] = SHORTCUTS;
  return shortcuts.find(({ chord, scope }) => chord !== undefined && scope !== "clipboard" && matches(chord, event, mac));
}

interface Keys {
  readonly ctrl: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
  readonly cmd: boolean;
  readonly key: string;
}

function chordKeys(chord: Chord, mac: boolean): Keys {
  const mod = chord.mod ?? false;
  return { ctrl: mod && !mac, cmd: mod && mac, alt: chord.alt ?? false, shift: chord.shift ?? false, key: typeof chord.name === "string" ? chord.name : mac ? chord.name.mac : chord.name.other };
}

/** Modifier names of Electron accelerators, by the key they stand for. `either` is Cmd on macOS and Ctrl elsewhere. */
export const ACCELERATOR_MODIFIERS: Readonly<Record<string, "either" | "cmd" | "ctrl" | "alt" | "shift">> = {
  CmdOrCtrl: "either", CommandOrControl: "either", Cmd: "cmd", Command: "cmd", Ctrl: "ctrl", Control: "ctrl", Alt: "alt", Option: "alt", Shift: "shift",
};

function acceleratorKeys(accelerator: string, mac: boolean): Keys {
  const parts = accelerator.split("+");
  const name = parts.pop() ?? "";
  const held = new Set(parts.map((part) => ACCELERATOR_MODIFIERS[part]));
  return { ctrl: held.has("ctrl") || (held.has("either") && !mac), cmd: held.has("cmd") || (held.has("either") && mac), alt: held.has("alt"), shift: held.has("shift"), key: name === "Plus" ? "+" : name };
}

/** The keys of a shortcut as key caps, modifiers first, in the names of the platform. */
export function shortcutKeys(shortcut: Shortcut, mac = IS_MAC): readonly string[] {
  const keys = shortcut.chord ? chordKeys(shortcut.chord, mac) : acceleratorKeys(platformAccelerator(shortcut.accelerator ?? "", mac), mac);
  const modifiers = mac ? [keys.ctrl && "⌃", keys.alt && "⌥", keys.shift && "⇧", keys.cmd && "⌘"] : [keys.ctrl && "Ctrl", keys.alt && "Alt", keys.shift && "Shift", keys.cmd && "Meta"];
  return [...modifiers.filter((modifier) => modifier !== false), keys.key];
}

/** The shortcut as one label, the way the platform writes it: `⇧⌘Z` on macOS, `Ctrl+Shift+S` elsewhere. */
export function shortcutLabel(id: ShortcutId, mac = IS_MAC): string {
  return shortcutKeys(BY_ID.get(id)!, mac).join(mac ? "" : "+");
}

/** A tooltip that names the key: `Red wire (Alt+R)`. */
export function withShortcut(text: string, id: ShortcutId): string {
  return `${text} (${shortcutLabel(id)})`;
}

/** How far an arrow key moves the selection: `step` is one grid step, in canvas units on the edit canvas and one tile on the board. */
export function nudgeDelta(arrowKey: string, far: boolean, step = GRID): Point {
  const distance = step * (far ? NUDGE_FAR_STEPS : 1);
  const horizontal = arrowKey === "ArrowLeft" ? -1 : arrowKey === "ArrowRight" ? 1 : 0;
  const vertical = arrowKey === "ArrowUp" ? -1 : arrowKey === "ArrowDown" ? 1 : 0;
  return { x: horizontal * distance, y: vertical * distance };
}

// The module list of the project settings in words: what a row says, which rows a filter leaves, and the notes around the list.
// A title is what a mod calls itself: it is cut to a length here wherever it goes into a sentence, and shown as text. Pure.
import type { ModuleView } from "../workbench/controller.ts";
import { listOrder } from "../workbench/moduleOrder.ts";

export { listOrder };

/** The list gets a filter field from this many rows on. */
export const FILTER_FROM = 11;
/** Titles named in a sentence before it says how many more there are. */
export const NAMED = 4;
const TITLE_LENGTH = 60;

export const clip = (text: string): string => (text.length > TITLE_LENGTH ? `${text.slice(0, TITLE_LENGTH)}...` : text);
export const count = (amount: number, one: string, many = `${one}s`): string => `${amount} ${amount === 1 ? one : many}`;

/**
 * The titles of the modules named, in a list for a sentence: "Space Age, Quality", "A, B, C, D and 3 more". They come in the
 * order of the rows, whatever order the names have; a name the list does not have stands for itself, after the others.
 */
export function moduleTitles(names: readonly string[], modules: readonly ModuleView[], limit = NAMED): string {
  const listed = listOrder(modules.filter((module) => names.includes(module.name))).map((module) => module.title);
  const all = [...listed, ...names.filter((name) => !modules.some((module) => module.name === name))];
  const titles = all.slice(0, limit).map(clip);
  const more = all.length - titles.length;
  return `${titles.join(", ")}${more > 0 ? ` and ${more} more` : ""}`;
}

/** What switching this module does to others, or why it cannot be switched. */
export function consequence(module: ModuleView, modules: readonly ModuleView[]): string | null {
  if (module.missing.length > 0) return `Needs ${moduleTitles(module.missing, modules)}, which ${module.missing.length === 1 ? "is" : "are"} switched off`;
  if (!module.canDisable) return "Always enabled";
  if (module.enabled && module.disables.length > 0) return `Switching off also switches off ${moduleTitles(module.disables, modules)}`;
  if (!module.enabled && module.enables.length > 0) return `Switching on also switches on ${moduleTitles(module.enables, modules)}`;
  return null;
}

/** What the row of a module says whose counts are both zero: it adds only what cannot be chosen. */
export const NOTHING_TO_CHOOSE = "Only hidden signals or entities";

/**
 * The modules that have a row. A mod that adds only hidden signals or entities has one only while the project has it switched on
 * or uses something of it (`used`: the modules the source uses although they are off); otherwise nothing of it can be chosen
 * and it counts among the other mods. The catalog lists it all the same: the import of a blueprint switches it on by that list.
 */
export function listedRows(modules: readonly ModuleView[], used: readonly string[]): readonly ModuleView[] {
  return modules.filter((module) => module.game || module.signalCount > 0 || module.entityCount > 0 || module.enabled || used.includes(module.name));
}

/**
 * What the module brings, without a count of none: "12 signals, 3 entities", "771 signals", "3 entities". `hidden` is how many
 * of them the user hid in the settings of the application, said when there are some: "771 signals, 17 entities, 3 hidden".
 */
export function moduleCounts(module: ModuleView, hidden = 0): string {
  const counts = [module.signalCount > 0 && count(module.signalCount, "signal"), module.entityCount > 0 && count(module.entityCount, "entity", "entities"), hidden > 0 && `${hidden} hidden`].filter((part) => part !== false);
  return counts.length > 0 ? counts.join(", ") : NOTHING_TO_CHOOSE;
}

/** What a row says on hover: the title in full, which the row cuts after two lines, and the name where it is another. */
export function rowHint(module: ModuleView): string {
  return module.title === module.name ? module.name : `${module.title} (${module.name})`;
}

/** The rows whose title or name contains the text, whatever its case; all of them for an empty text. */
export function filterModules(modules: readonly ModuleView[], text: string): readonly ModuleView[] {
  const query = text.trim().toLowerCase();
  return query === "" ? modules : modules.filter((module) => module.title.toLowerCase().includes(query) || module.name.toLowerCase().includes(query));
}

/** That the source uses what is switched off; null when it does not. */
export function modulesOffNotice(names: readonly string[], modules: readonly ModuleView[]): string | null {
  if (names.length === 0) return null;
  return `This project uses signals or entities of ${moduleTitles(names, modules)}, which ${names.length === 1 ? "is" : "are"} switched off. They are marked with a warning and are not offered.`;
}

/** The mods without a row, in a line: those that add no signal or entity, and those that add only hidden ones. Null when every mod has a row. */
export function otherModsNote(amount: number): string | null {
  return amount > 0 ? `${count(amount, "other mod")} of your game ${amount === 1 ? "adds" : "add"} nothing that can be chosen here.` : null;
}

/** With the built-in data: where the mods come from. */
export const MODS_HINT = "The mods of your game appear here after the game has been read in the application settings.";

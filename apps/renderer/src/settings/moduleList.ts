// The module list of the project settings in words: what a row says, which rows a filter leaves, and the notes around the list.
// A title is what a mod calls itself: it is cut to a length here wherever it goes into a sentence, and shown as text. Pure.
import type { ModuleView } from "../workbench/controller.ts";

/** The list gets a filter field from this many rows on. */
export const FILTER_FROM = 11;
/** Titles named in a sentence before it says how many more there are. */
const NAMED = 4;
const TITLE_LENGTH = 60;

const clip = (text: string): string => (text.length > TITLE_LENGTH ? `${text.slice(0, TITLE_LENGTH)}...` : text);
const count = (amount: number, one: string, many = `${one}s`): string => `${amount} ${amount === 1 ? one : many}`;

/** The titles of the modules named, in a list for a sentence: "Space Age, Quality", "A, B, C, D and 3 more". */
export function moduleTitles(names: readonly string[], modules: readonly ModuleView[], limit = NAMED): string {
  const titles = names.slice(0, limit).map((name) => clip(modules.find((module) => module.name === name)?.title ?? name));
  const more = names.length - titles.length;
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

/** What the module brings: "771 signals", "12 signals, 3 entities". */
export function moduleCounts(module: ModuleView): string {
  return `${count(module.signalCount, "signal")}${module.entityCount > 0 ? `, ${count(module.entityCount, "entity", "entities")}` : ""}`;
}

const byTitle = new Intl.Collator("en", { sensitivity: "base", numeric: true });

/**
 * The rows in the order they are shown: the game's own modules as the catalog has them, then the mods by title, whatever its
 * case (the catalog has them by name, capitals first, which is no order of what the rows show).
 */
export function listOrder(modules: readonly ModuleView[]): readonly ModuleView[] {
  const mods = modules.filter((module) => !module.game).sort((a, b) => byTitle.compare(a.title, b.title) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return [...modules.filter((module) => module.game), ...mods];
}

/** What a row says on hover: the title in full, which the row may cut, and the name where it is another. */
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

/** The mods that are not in the list, in a line; null when every mod is. */
export function otherModsNote(amount: number): string | null {
  return amount > 0 ? `${count(amount, "other mod")} of your game ${amount === 1 ? "adds" : "add"} no signals or entities.` : null;
}

/** With the built-in data: where the mods come from. */
export const MODS_HINT = "The mods of your game appear here after the game has been read in the application settings.";

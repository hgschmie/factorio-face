// The order in which the modules of a project are shown and named, for the rows of the project settings and for every sentence
// that lists modules. Pure.
import type { ModuleView } from "./controller.ts";

const byTitle = new Intl.Collator("en", { sensitivity: "base", numeric: true });

/**
 * The game's own modules as the catalog has them, then the mods by title, whatever its case (the catalog has them by name,
 * capitals first, which is no order of what is shown). The list it is given stays as it is.
 */
export function listOrder<T extends Pick<ModuleView, "name" | "title" | "game">>(modules: readonly T[]): readonly T[] {
  const mods = modules.filter((module) => !module.game).sort((a, b) => byTitle.compare(a.title, b.title) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return [...modules.filter((module) => module.game), ...mods];
}

// Which switched-off modules a source uses: the game data of an analysis, with a note of every module that a signal or an
// entity of the source turned out to be of although it is off. The analysis asks about exactly what gets a warning.
import { analyze } from "@face/language";
import type { GameData } from "./analysis.ts";
import type { CatalogService } from "./catalogService.ts";

export interface ModuleUse {
  /** What the analysis is given in place of the services. */
  readonly game: GameData;
  /** The switched-off modules asked about so far, by name in the order of the module list. */
  off(): readonly string[];
}

export function moduleUse(services: CatalogService): ModuleUse {
  const seen = new Set<string>();
  const titles = (names: readonly string[]): readonly string[] => {
    for (const name of names) seen.add(name);
    return names.map((name) => services.titleOf(name));
  };
  return {
    game: {
      status: (id) => services.status(id),
      switchedOff: (id) => titles(services.signalModulesOff(id)),
      prototypes: { switchedOff: (prototype) => titles(services.prototypeModulesOff(prototype)) },
      instruments: services.instruments,
    },
    off: () => services.modules.map((module) => module.name).filter((name) => seen.has(name)),
  };
}

/** The modules that are off for `services` and that `source` uses a signal or an entity of. Never throws: the source may be any text. */
export function modulesUsedOff(source: string, services: CatalogService): readonly string[] {
  const use = moduleUse(services);
  analyze(source, undefined, { signals: use.game, prototypes: use.game.prototypes, instruments: use.game.instruments });
  return use.off();
}

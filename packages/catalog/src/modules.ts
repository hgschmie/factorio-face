// Dependency-aware enabling and disabling of modules: the game's own five and, with data read from a game, its mods.

import { STANDARD_MODULES, type ModuleInfo, type ModuleScoped } from "./types.ts";

/** The module no game is without: it is on whatever a project lists. */
export const BASE_MODULE = "base";

/** Whether a module is one of the game's own, as opposed to a mod. */
export function isGameModule(name: string): boolean {
  return (STANDARD_MODULES as readonly string[]).includes(name);
}

export interface ModuleResolution {
  /** The known enabled modules in catalog order, without duplicates. */
  readonly enabled: readonly string[];
  /** Names that are not modules of this catalog. */
  readonly unknown: readonly string[];
  /** Enabled modules whose hard dependencies are not all enabled. */
  readonly missing: readonly { readonly module: string; readonly requires: readonly string[] }[];
  /** Enabled modules whose recommended ("+") dependencies are switched off; informational. */
  readonly recommended: readonly { readonly module: string; readonly recommends: readonly string[] }[];
  /** True when nothing is unknown or missing. */
  readonly valid: boolean;
}

export interface ModuleChange {
  /** The resulting enabled modules in catalog order. */
  readonly enabled: readonly string[];
  /** Modules switched by this change, including the requested one, in catalog order. */
  readonly changed: readonly string[];
}

function ordered(modules: readonly ModuleInfo[], names: Iterable<string>): string[] {
  const wanted = new Set(names);
  return modules.map((m) => m.name).filter((name) => wanted.has(name));
}

function info(modules: readonly ModuleInfo[], name: string): ModuleInfo {
  const found = modules.find((m) => m.name === name);
  if (!found) throw new Error(`Unknown module "${name}"`);
  return found;
}

/** The module and everything it transitively requires, in catalog order. */
export function requiredModules(modules: readonly ModuleInfo[], name: string, withRecommended = false): string[] {
  const seen = new Set<string>();
  const visit = (current: string): void => {
    if (seen.has(current)) return;
    seen.add(current);
    const module = info(modules, current);
    module.requires.forEach(visit);
    if (withRecommended) module.recommends.forEach(visit);
  };
  visit(name);
  return ordered(modules, seen);
}

/** Enabled modules that transitively require `name` (not including `name`), in catalog order. */
export function dependentModules(modules: readonly ModuleInfo[], enabled: Iterable<string>, name: string): string[] {
  const active = new Set(enabled);
  return modules.filter((m) => m.name !== name && active.has(m.name) && requiredModules(modules, m.name).includes(name)).map((m) => m.name);
}

/** Checks a set of enabled modules: unknown names, missing hard dependencies and disabled recommendations. */
export function resolveModules(modules: readonly ModuleInfo[], enabled: Iterable<string>): ModuleResolution {
  const requested = [...new Set(enabled)];
  const known = ordered(modules, requested);
  const active = new Set(known);
  const unknown = requested.filter((name) => !modules.some((m) => m.name === name));
  const missing = [];
  const recommended = [];
  for (const module of modules) {
    if (!active.has(module.name)) continue;
    const requires = requiredModules(modules, module.name).filter((name) => !active.has(name));
    if (requires.length) missing.push({ module: module.name, requires });
    const recommends = module.recommends.filter((name) => !active.has(name));
    if (recommends.length) recommended.push({ module: module.name, recommends });
  }
  return { enabled: known, unknown, missing, recommended, valid: unknown.length === 0 && missing.length === 0 };
}

/** Enables a module together with its hard dependencies (and, on request, its recommended ones). */
export function enableModule(modules: readonly ModuleInfo[], enabled: Iterable<string>, name: string, options: { withRecommended?: boolean } = {}): ModuleChange {
  const before = new Set(enabled);
  const added = requiredModules(modules, name, options.withRecommended).filter((required) => !before.has(required));
  return { enabled: ordered(modules, [...before, ...added]), changed: added };
}

/** Disables a module together with every enabled module that depends on it; call `dependentModules` first to ask for confirmation. */
export function disableModule(modules: readonly ModuleInfo[], enabled: Iterable<string>, name: string): ModuleChange {
  info(modules, name);
  const before = new Set(enabled);
  const removed = [name, ...dependentModules(modules, before, name)].filter((module) => before.has(module));
  return { enabled: ordered(modules, [...before].filter((module) => !removed.includes(module))), changed: ordered(modules, removed) };
}

/** The names of the modules the records name as theirs, added to `into`. */
export function namedModules(records: Iterable<ModuleScoped>, into: Set<string> = new Set()): Set<string> {
  for (const record of records) for (const name of record.modules) into.add(name);
  return into;
}

/**
 * The modules a project switches: the game's own, and of the mods those that `contributing` names (the ones that add a
 * record). A mod that adds nothing is left out, and the others see through it: `requires` of a listed module is everything
 * listed that it needs, directly or through any chain of modules, and `recommends` what it recommends itself. The functions
 * above work on the result as on any module list. A name no module has is passed over.
 */
export function listedModules(modules: readonly ModuleInfo[], contributing: ReadonlySet<string>): ModuleInfo[] {
  const byName = new Map(modules.map((module) => [module.name, module]));
  const listed = new Set(modules.filter((module) => isGameModule(module.name) || contributing.has(module.name)).map((module) => module.name));
  const needed = (name: string): Set<string> => {
    const seen = new Set<string>();
    const pending = [...(byName.get(name)?.requires ?? [])];
    for (let current = pending.pop(); current !== undefined; current = pending.pop()) {
      if (current === name || seen.has(current) || !byName.has(current)) continue;
      seen.add(current);
      pending.push(...byName.get(current)!.requires);
    }
    return seen;
  };
  const names = modules.map((module) => module.name).filter((name) => listed.has(name));
  return modules.filter((module) => listed.has(module.name)).map((module) => {
    const requires = needed(module.name);
    return { ...module, requires: names.filter((other) => requires.has(other)), recommends: module.recommends.filter((other) => other !== module.name && listed.has(other)) };
  });
}

/** Whether an entry exists for the given enabled modules. Does not validate the module set itself. */
export function isAvailable(entry: ModuleScoped, enabled: ReadonlySet<string>): boolean {
  return entry.modules.every((name) => enabled.has(name)) && !entry.removedBy?.some((name) => enabled.has(name));
}

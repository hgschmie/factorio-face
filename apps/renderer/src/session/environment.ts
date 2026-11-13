// Builds the simulation environment from the catalog for one set of enabled modules.
import { availableQualities, availableSignals, isAvailable, pickerTree, speakerInstrumentNames, type Catalog, type RocketSiloInfo } from "@face/catalog";
import { createEnvironment, type EnvironmentData, type SimulationEnvironment } from "@face/simulation";

/** The engine reports 2^48 as lift weight when rockets carry no cargo weight limit (no Space Age); anything that large is "unlimited". */
export const UNLIMITED_LIFT_WEIGHT = 2 ** 48;

function liftWeightOf(silo: RocketSiloInfo, enabled: ReadonlySet<string>): number {
  let weight = silo.liftWeight;
  for (const variant of silo.variants ?? []) if (variant.when.every((name) => enabled.has(name)) && typeof variant.liftWeight === "number") weight = variant.liftWeight;
  return weight;
}

/** Weight one rocket lifts with these modules, or undefined when there is no finite limit (the rocket capacity mode then yields nothing). */
export function rocketLiftWeight(catalog: Catalog, enabled: ReadonlySet<string>): number | undefined {
  const weights = catalog.constants.rocketSilos.filter((silo) => isAvailable(silo, enabled)).map((silo) => liftWeightOf(silo, enabled));
  const weight = weights.length > 0 ? Math.max(...weights) : undefined;
  return weight !== undefined && Number.isFinite(weight) && weight > 0 && weight < UNLIMITED_LIFT_WEIGHT ? weight : undefined;
}

/** Items per rocket: lift weight / item weight, rounded down; 0 for an item heavier than a rocket lifts. Undefined without a usable weight. */
export function rocketCapacityOf(weight: number | undefined, liftWeight: number | undefined): number | undefined {
  if (liftWeight === undefined || weight === undefined || !Number.isFinite(weight) || weight <= 0) return undefined;
  return Math.floor(liftWeight / weight);
}

/** Every signal that exists for these modules in game order: group, subgroup, order string, kind, name (the picker's order, hidden signals included). */
function signalOrder(catalog: Catalog, enabled: ReadonlySet<string>): string[] {
  try {
    return pickerTree(catalog, enabled, { wildcards: true, parameters: true, hidden: true }).flatMap((group) => group.subgroups.flatMap((subgroup) => subgroup.signals.map((entry) => entry.key)));
  } catch {
    // A module set the game would not accept (hand-edited project file) can leave signals without their group; the engine then orders by key.
    return [];
  }
}

/**
 * Plain-data environment for the engine: signal order, stack sizes and rocket capacities of the items that exist for these
 * modules, the qualities with their levels, and the instruments of the speaker with their notes. Quality variants of one signal
 * are ordered by level by the engine.
 */
export function environmentData(catalog: Catalog, enabledModules: Iterable<string>): EnvironmentData {
  const enabled = new Set(enabledModules);
  const liftWeight = rocketLiftWeight(catalog, enabled);
  const stackSizes: Record<string, number> = {};
  const rocketCapacities: Record<string, number> = {};
  for (const entry of availableSignals(catalog, enabled, { kinds: ["item"] })) {
    if (entry.stackSize !== undefined) stackSizes[entry.key] = entry.stackSize;
    const capacity = rocketCapacityOf(entry.weight, liftWeight);
    if (capacity !== undefined) rocketCapacities[entry.key] = capacity;
  }
  return {
    signalOrder: signalOrder(catalog, enabled),
    stackSizes,
    rocketCapacities,
    qualities: availableQualities(catalog, enabled).map((quality) => ({ name: quality.name, level: quality.level })),
    instruments: speakerInstrumentNames(catalog, enabled),
  };
}

export function createCatalogEnvironment(catalog: Catalog, enabledModules: Iterable<string>): SimulationEnvironment {
  return createEnvironment(environmentData(catalog, enabledModules));
}

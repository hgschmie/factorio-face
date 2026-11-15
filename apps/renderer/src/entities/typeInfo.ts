// What a generic entity (kind `entity`) does on the circuit network, in a line, and what the editor has to say about it. Both are
// per prototype type of the game, like the settings (`ENTITY_SETTINGS` of @face/model): a further prototype of a type needs
// nothing here, and a type without a line gets one made from its settings. Pure.
import { entityTable, settingSpecsOf, type PrototypeName, type SettingSpec } from "@face/model";

const LOADER = "Switch it on a condition, set its filters by signal";

/** By prototype type, in the words of the palette: what the type is on a circuit for. */
export const TYPE_DESCRIPTIONS: Readonly<Record<string, string>> = {
  accumulator: "Send how far it is charged",
  "agricultural-tower": "Harvest and plant on conditions",
  "ammo-turret": "Switch a turret, choose its targets by signal",
  "artillery-turret": "Switch a turret, read its ammunition",
  "assembling-machine": "Set a recipe by signal, read what it works on",
  "asteroid-collector": "Set its filters by signal, read what it caught",
  boiler: "Switch it on a condition, read its fuel",
  "cargo-landing-pad": "Read what it holds, set its requests by signal",
  container: "Read what a chest holds",
  "display-panel": "Show a message per condition",
  "electric-turret": "Switch a turret, choose its targets by signal",
  "fluid-turret": "Switch a turret, choose its targets by signal",
  furnace: "Switch it on a condition, read what it works on",
  "heat-pipe": "Read its temperature",
  "infinity-container": "Read what a chest holds, set its requests by signal",
  "infinity-pipe": "Read the fluid it holds",
  inserter: "Switch it on a condition, set filters and stack size, read its hand",
  lab: "Set the research by signal, read its progress",
  "land-mine": "Arm it on a condition",
  "linked-container": "Read what a chest holds",
  loader: LOADER,
  "loader-1x1": LOADER,
  "logistic-container": "Read what a chest holds, set its requests by signal",
  "mining-drill": "Switch it on a condition, read the resources under it",
  "offshore-pump": "Switch it on a condition",
  pipe: "Read the fluid it holds",
  "pipe-to-ground": "Read the fluid it holds",
  "power-switch": "Join two power networks on a condition",
  "proxy-container": "Read what a chest holds",
  pump: "Switch it on a condition, set its fluid by signal",
  radar: "Share signals with every radar of the surface",
  "rail-chain-signal": "Close it on a condition, read its state",
  "rail-signal": "Close it on a condition, read its state",
  reactor: "Read its temperature and its fuel",
  roboport: "Read the items and the robots of its network",
  "rocket-silo": "Read its items and a launch",
  "space-platform-hub": "Read what the platform holds and where it flies",
  splitter: "Set its priorities and its filter by signal",
  "storage-tank": "Read the fluid it holds",
  "train-stop": "Switch it on a condition, read and set the train",
  "transport-belt": "Switch it on a condition, read what it carries",
  wall: "Open the gate beside it on a condition",
};

/** What the inspector adds about a type: where the game differs from what the editor shows. */
export const TYPE_NOTES: Readonly<Record<string, string>> = {
  wall: "In the game a wall connects to the circuit network only while a gate stands next to it. The editor has no gates: the wall is wired and exported as it is.",
  "display-panel": "The messages of a display panel are kept from a blueprint and not edited here.",
  lab: "The research conditions of a lab are kept from a blueprint and not edited here.",
};

/** A line for a type that has none of its own, from what its settings can do. */
export function describeSettings(specs: readonly SettingSpec[]): string {
  const parts: string[] = [];
  if (specs.some((spec) => spec.type === "condition" && !spec.logistic)) parts.push("act on a circuit condition");
  if (specs.some((spec) => spec.key.startsWith("set-"))) parts.push("take settings from signals");
  if (specs.some((spec) => spec.key.startsWith("read-"))) parts.push("send what it reads");
  const text = parts.join(", ");
  return text === "" ? "An entity of the game on the circuit network" : text.charAt(0).toUpperCase() + text.slice(1);
}

/** What a generic prototype is on a circuit for. */
export function typeDescription(prototype: PrototypeName): string {
  const type = entityTable().byName.get(prototype)?.type;
  return (type !== undefined && TYPE_DESCRIPTIONS[type]) || describeSettings(settingSpecsOf(prototype));
}

/** The notes of the inspector for a generic prototype: of its type, and that the game takes an entity no item builds into no blueprint. */
export function prototypeNotes(prototype: PrototypeName): readonly string[] {
  const game = entityTable().byName.get(prototype);
  if (!game) return [];
  const notes = TYPE_NOTES[game.type] === undefined ? [] : [TYPE_NOTES[game.type]!];
  if (game.placedBy.length === 0) notes.push("No item of the game builds this entity, and the game takes it into no blueprint: an export leaves it out, with its wires.");
  return notes;
}

// The names the game's runtime API has for what a blueprint names otherwise: the attribute of the control behaviour behind a
// field of `control_behavior`, and the define behind the number of an enum. From the API reference (runtime-api.json 2.1.23,
// the `Lua*ControlBehavior` classes and `defines.control_behavior`); the probe builds circuits with them and records the numbers.

import { ENTITY_SETTINGS, type EnumSetting } from "@face/model";

/** Per concept of `SettingsRow.behavior`: the fields whose attribute has another name. Every other field is an attribute of its own name. */
const RENAMED: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  AssemblingMachineBlueprintControlBehavior: {
    read_contents: "circuit_read_contents", read_ingredients: "circuit_read_ingredients", read_recipe_finished: "circuit_read_recipe_finished", read_working: "circuit_read_working",
    recipe_finished_signal: "circuit_recipe_finished_signal", set_recipe: "circuit_set_recipe", working_signal: "circuit_working_signal",
  },
  FurnaceBlueprintControlBehavior: {
    read_contents: "circuit_read_contents", read_ingredients: "circuit_read_ingredients", read_recipe_finished: "circuit_read_recipe_finished", read_working: "circuit_read_working",
    recipe_finished_signal: "circuit_recipe_finished_signal", working_signal: "circuit_working_signal",
  },
  AsteroidCollectorBlueprintControlBehavior: { circuit_read_contents: "read_content", circuit_set_filters: "set_filter" },
  InserterBlueprintControlBehavior: { stack_control_input_signal: "circuit_stack_control_signal" },
  MiningDrillBlueprintControlBehavior: { circuit_resource_read_mode: "resource_read_mode" },
  RailSignalBaseBlueprintControlBehavior: {
    red_output_signal: "red_signal", orange_output_signal: "orange_signal", green_output_signal: "green_signal", blue_output_signal: "blue_signal", circuit_close_signal: "close_signal", circuit_read_signal: "read_signal",
  },
  RocketSiloBlueprintControlBehavior: { read_items_mode: "read_mode" },
  SingleFluidBoxBlueprintControlBehavior: { circuit_mode_of_operation: "circuit_exclusive_mode_of_operation" },
  TrainStopBlueprintControlBehavior: { train_stopped_signal: "stopped_train_signal" },
  TransportBeltBlueprintControlBehavior: { circuit_read_hand_contents: "read_contents", circuit_contents_read_mode: "read_contents_mode" },
  WallBlueprintControlBehavior: { circuit_open_gate: "open_gate", circuit_read_sensor: "read_sensor" },
};

/** `LuaGenericOnOffControlBehavior` and what derives from it: the checkbox has another name there. */
const ON_OFF = { circuit_enabled: "circuit_enable_disable" };

/** The attribute of the runtime control behaviour that a field of the blueprint's `control_behavior` is. */
export function runtimeAttribute(behavior: string, field: string): string {
  return RENAMED[behavior]?.[field] ?? (ON_OFF as Readonly<Record<string, string>>)[field] ?? field;
}

export interface EnumDefine {
  /** The path below `defines.control_behavior`: `["inserter", "hand_read_mode"]`. */
  readonly path: readonly [string, string];
  /** The member of the define per word of the editor that has a number. */
  readonly members: Readonly<Record<string, string>>;
}

const underscored = (words: readonly string[]): Record<string, string> => Object.fromEntries(words.map((word) => [word, word.replaceAll("-", "_")]));

/** The define behind every enum of the settings table, by `behavior.field`. */
export const ENUM_DEFINES: Readonly<Record<string, EnumDefine>> = {
  "InserterBlueprintControlBehavior.circuit_hand_read_mode": { path: ["inserter", "hand_read_mode"], members: underscored(["pulse", "hold"]) },
  "MiningDrillBlueprintControlBehavior.circuit_resource_read_mode": { path: ["mining_drill", "resource_read_mode"], members: underscored(["this-miner", "entire-patch"]) },
  "TransportBeltBlueprintControlBehavior.circuit_contents_read_mode": { path: ["transport_belt", "content_read_mode"], members: underscored(["pulse", "hold", "entire-belt-hold"]) },
  "RadarBlueprintControlBehavior.mode": { path: ["radar", "mode"], members: underscored(["surface", "universe"]) },
  "RoboportBlueprintControlBehavior.read_items_mode": { path: ["roboport", "read_items_mode"], members: underscored(["none", "logistics", "missing-requests"]) },
  "RocketSiloBlueprintControlBehavior.read_items_mode": { path: ["rocket_silo", "read_mode"], members: underscored(["none", "logistic-inventory", "orbital-requests"]) },
  "SingleFluidBoxBlueprintControlBehavior.circuit_mode_of_operation": { path: ["single_fluid_box", "exclusive_mode"], members: { none: "none", contents: "send_contents", "segment-contents": "send_segment_contents" } },
};

/** The name under which the probe records a define, and the recording has it: `inserter_hand_read_mode`. */
export const defineGroup = (define: EnumDefine): string => define.path.join("_");

/** Every enum of the settings table with its define, once per `behavior.field`. */
export function enumSettings(): { key: string; spec: EnumSetting; define: EnumDefine | undefined }[] {
  const seen = new Map<string, EnumSetting>();
  for (const row of Object.values(ENTITY_SETTINGS)) for (const spec of row.settings) if (spec.type === "enum") seen.set(`${row.behavior}.${spec.field}`, spec);
  return [...seen].map(([key, spec]) => ({ key, spec, define: ENUM_DEFINES[key] }));
}

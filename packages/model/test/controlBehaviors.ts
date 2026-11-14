// What the game's API reference (`runtime-api.json`) says about the control behaviour of a blueprint entity, reduced to what the
// settings table is checked against: per entity type the concept that describes its `control_behavior` and the other fields the
// type adds to a blueprint entity, per concept its fields, and the values of the defines the fields use. The reduced form is in
// tests/fixtures/game/control-behaviors-2.1.23.json; `extractControlBehaviors` makes it from the reference, and the test compares
// the two where the reference is at hand.

export interface BehaviorField {
  readonly name: string;
  /** `boolean`, `SignalID`, `CircuitCondition`, `CircuitNetworkSelection`, `defines.control_behavior.inserter.hand_read_mode`, `[ResearchCondition]`. */
  readonly type: string;
  readonly optional: boolean;
  /** What "Defaults to ..." in the description names, as written there. */
  readonly default?: string;
}

export interface ControlBehaviors {
  readonly source: string;
  readonly apiVersion: string;
  /** Per entity type of the concept `BlueprintEntity`: the concept of its `control_behavior` (absent: the type has none of its own there) and its other fields. */
  readonly types: Readonly<Record<string, { readonly behavior?: string; readonly fields: readonly string[] }>>;
  /** The fields of every concept named above. */
  readonly behaviors: Readonly<Record<string, readonly BehaviorField[]>>;
  /** The value names of `defines.control_behavior.<group>.<enum>`, by that path. */
  readonly defines: Readonly<Record<string, readonly string[]>>;
}

type Json = Readonly<Record<string, unknown>>;
const list = (value: unknown): readonly Json[] => (Array.isArray(value) ? (value as Json[]) : []);

function typeName(type: unknown): string {
  if (typeof type === "string") return type;
  const complex = type as Json;
  switch (complex.complex_type) {
    case "array": return `[${typeName(complex.value)}]`;
    case "type": return typeName(complex.value);
    case "union": return list(complex.options).map(typeName).join("|");
    case "literal": return JSON.stringify(complex.value);
    default: return String(complex.complex_type);
  }
}

export function extractControlBehaviors(api: unknown): ControlBehaviors {
  const root = api as Json;
  const concepts = new Map(list(root.concepts).map((concept) => [concept.name as string, concept]));
  const parameters = (concept: Json | undefined): readonly Json[] => list((concept?.type as Json | undefined)?.parameters);
  const sorted = <T>(entries: [string, T][]): Record<string, T> => Object.fromEntries(entries.sort((a, b) => (a[0] < b[0] ? -1 : 1)));

  const types: [string, { behavior?: string; fields: string[] }][] = [];
  const named = new Set<string>();
  for (const group of list((concepts.get("BlueprintEntity")?.type as Json | undefined)?.variant_parameter_groups)) {
    const fields = list(group.parameters);
    const behavior = fields.find((field) => field.name === "control_behavior");
    if (behavior) named.add(typeName(behavior.type));
    types.push([group.name as string, { ...(behavior && { behavior: typeName(behavior.type) }), fields: fields.map((field) => field.name as string).filter((name) => name !== "control_behavior").sort() }]);
  }
  const behaviors = [...named].map((name): [string, BehaviorField[]] => [
    name,
    parameters(concepts.get(name))
      .map((field): BehaviorField => {
        const stated = /Defaults to `([^`]+)`/.exec(typeof field.description === "string" ? field.description : "");
        return { name: field.name as string, type: typeName(field.type), optional: field.optional === true, ...(stated && { default: stated[1]! }) };
      })
      .sort((a, b) => (a.name < b.name ? -1 : 1)),
  ]);
  const control = list(root.defines).find((define) => define.name === "control_behavior");
  const defines = list(control?.subkeys).flatMap((group) => list(group.subkeys).map((values): [string, string[]] => [`defines.control_behavior.${String(group.name)}.${String(values.name)}`, list(values.values).map((value) => value.name as string).sort()]));
  return {
    source: "runtime-api.json (stage runtime): the concept BlueprintEntity, the concepts of its control_behavior fields, defines.control_behavior",
    apiVersion: String(root.application_version),
    types: sorted(types),
    behaviors: sorted(behaviors),
    defines: sorted(defines),
  };
}

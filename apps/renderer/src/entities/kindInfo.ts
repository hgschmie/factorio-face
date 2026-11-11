// Display metadata per entity kind, shared by palette, canvas and inspector.
import type { EntityKind } from "@face/model";

export interface KindInfo {
  readonly label: string;
  readonly description: string;
  /** Category line shown above the label in the inspector. */
  readonly category: string;
}

export const KIND_INFO: Readonly<Record<EntityKind, KindInfo>> = {
  constant: { label: "Constant", description: "Emit steady signals", category: "Combinator" },
  arithmetic: { label: "Arithmetic", description: "Transform your signals", category: "Combinator" },
  decider: { label: "Decider", description: "Compare and decide", category: "Combinator" },
  selector: { label: "Selector", description: "Pick, count and sort signals", category: "Combinator" },
  lamp: { label: "Lamp", description: "See a condition light up", category: "Condition indicator" },
};

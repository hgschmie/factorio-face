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
  pole: { label: "Pole", description: "Relay signals over a distance", category: "Signal relay" },
  speaker: { label: "Speaker", description: "Sound an alert on a condition", category: "Condition indicator" },
};

/**
 * The kinds the palette offers and the digit keys 1 to 5 place. Poles and speakers are not among them yet: package H gives the
 * palette groups and adds them there. Until then they come into a circuit through the source.
 */
export const PALETTE_KINDS = ["constant", "arithmetic", "decider", "selector", "lamp"] as const satisfies readonly EntityKind[];

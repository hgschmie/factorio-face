// The bubble of the blueprint board: the full card of the entity under the pointer and its description, next to its footprint.
// An HTML overlay of constant screen size, so it stays readable at any zoom; it takes no pointer events.
import type { Entity } from "@face/model";
import { useLayoutEffect, useRef, useState } from "react";
import type { EntityIconResolver } from "../icons/EntityIcon.tsx";
import type { SignalDescriber } from "../inspector/SignalField.tsx";
import type { EntityStatus } from "../workbench/controller.ts";
import { placeBubble } from "./bubble.ts";
import { CardFace } from "./EntityCard.tsx";
import { CARD, type Rect } from "./geometry.ts";
import type { Size } from "./viewport.ts";

export interface EntityBubbleProps {
  readonly entity: Entity;
  /** The rectangle of the entity in screen pixels of the canvas. */
  readonly anchor: Rect;
  /** Size of the canvas. */
  readonly view: Size;
  readonly status?: EntityStatus;
  readonly describeSignal?: SignalDescriber;
  readonly resolveIcon?: EntityIconResolver;
}

export function EntityBubble({ entity, anchor, view, status, describeSignal, resolveIcon }: EntityBubbleProps) {
  const ref = useRef<HTMLDivElement>(null);
  // The description makes the bubble as high as its text; the height is known after the first layout.
  const [height, setHeight] = useState<number>(CARD.height);
  useLayoutEffect(() => {
    const measured = ref.current?.offsetHeight;
    if (measured !== undefined && measured !== height) setHeight(measured);
  });
  const placement = placeBubble(anchor, { width: CARD.width, height }, view);
  const description = entity.description?.trim();
  if (!placement) return null;
  const beside = placement.side === "right" || placement.side === "left";
  return (
    <div ref={ref} className={`entity-bubble side-${placement.side}`} style={{ left: placement.x, top: placement.y, width: CARD.width }} data-entity-name={entity.name} data-side={placement.side}>
      <svg className="bubble-card" width={CARD.width} height={CARD.height} viewBox={`0 0 ${CARD.width} ${CARD.height}`} role="img" aria-label={`${entity.name}, details`}>
        <g className={`bubble-face kind-${entity.kind}${status?.active ? " active" : ""}`}>
          <CardFace entity={entity} status={status} describeSignal={describeSignal} resolveIcon={resolveIcon} />
        </g>
      </svg>
      {description && <p className="bubble-description">{description}</p>}
      <span className="bubble-pointer" style={beside ? { top: placement.pointer } : { left: placement.pointer }} />
    </div>
  );
}

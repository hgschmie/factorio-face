// One entity drawn as a card. Purely presentational and memoized: pointer handling is delegated to the canvas through
// the data-entity-id / data-terminal attributes, so a card only re-renders when its own props change.
import { hasTerminal, type Entity, type TerminalSide } from "@face/model";
import { memo } from "react";
import { KIND_INFO } from "../entities/kindInfo.ts";
import { entitySummary, truncate } from "../entities/summary.ts";
import { EntityIconSvg, type EntityIconResolver } from "../icons/EntityIcon.tsx";
import type { EntityStatus } from "../workbench/controller.ts";
import { CARD } from "./geometry.ts";

export interface EntityCardProps {
  readonly entity: Entity;
  /** Position to draw at; differs from `entity.position` while the card is being dragged. */
  readonly x: number;
  readonly y: number;
  readonly selected: boolean;
  /** Draw only the body and terminals; used when zoomed out too far for text to be legible. */
  readonly outline: boolean;
  readonly shadow: boolean;
  /** Terminal that started a pending wire, if it belongs to this entity. */
  readonly pendingSide?: TerminalSide;
  readonly status?: EntityStatus;
  readonly resolveIcon?: EntityIconResolver;
}

const NAME_MAX_CHARS = 13;
const SUMMARY_MAX_CHARS = 15;

function Terminal({ side, pending }: { readonly side: TerminalSide; readonly pending: boolean }) {
  const cx = side === "out" ? CARD.width : 0;
  return (
    <g className={`terminal ${side}${pending ? " pending" : ""}`} data-terminal={side}>
      <circle className="terminal-hit" cx={cx} cy={CARD.terminalY} r="13" />
      <circle className="terminal-ring" cx={cx} cy={CARD.terminalY} r="8" />
      <circle className="terminal-core" cx={cx} cy={CARD.terminalY} r="3" />
      <title>{side === "out" ? "Output terminal" : "Input terminal"}</title>
    </g>
  );
}

export const EntityCard = memo(function EntityCard({ entity, x, y, selected, outline, shadow, pendingSide, status, resolveIcon }: EntityCardProps) {
  const info = KIND_INFO[entity.kind];
  const summary = entitySummary(entity);
  const className = `card kind-${entity.kind}${selected ? " selected" : ""}${status?.active ? " active" : ""}`;
  return (
    <g className={className} transform={`translate(${x},${y})`} data-entity-id={entity.id} data-entity-name={entity.name} data-kind={entity.kind} data-x={x} data-y={y}>
      <rect className="card-body" width={CARD.width} height={CARD.height} rx="9" filter={shadow ? "url(#card-shadow)" : undefined} />
      <rect className="card-accent" x="13" y="14" width="3" height="17" rx="1.5" />
      {!outline && (
        <>
          <text className="card-kind" x="25" y="26">
            {info.label.toUpperCase()}
          </text>
          <path className="card-divider" d={`M 10 45 H ${CARD.width - 10}`} />
          <EntityIconSvg kind={entity.kind} x={14} y={55} size={38} resolveIcon={resolveIcon} />
          <text className="card-name" x="62" y="70">
            {truncate(entity.name, NAME_MAX_CHARS)}
          </text>
          <text className="card-summary" x="62" y="92">
            {truncate(summary, SUMMARY_MAX_CHARS)}
          </text>
          {status && (
            <>
              <rect className="card-status-dot" x="13" y="108" width="5" height="5" rx="1" />
              <text className="card-status" x="25" y="114">
                {truncate(status.label, 24)}
              </text>
            </>
          )}
          <title>{`${info.label} ${entity.name}: ${summary}`}</title>
        </>
      )}
      {hasTerminal(entity.kind, "in") && <Terminal side="in" pending={pendingSide === "in"} />}
      {hasTerminal(entity.kind, "out") && <Terminal side="out" pending={pendingSide === "out"} />}
    </g>
  );
});

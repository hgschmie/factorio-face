// One entity drawn as a card. Purely presentational and memoized: pointer handling is delegated to the canvas through
// the data-entity-id / data-terminal / data-wire-color attributes, so a card only re-renders when its own props change.
import { TERMINALS, WIRE_COLORS, type Direction, type Entity, type TerminalSide, type WireColor } from "@face/model";
import { Fragment, memo } from "react";
import { facingOf } from "../entities/facing.ts";
import { KIND_INFO } from "../entities/kindInfo.ts";
import { entitySummary, truncate } from "../entities/summary.ts";
import { EntityIconSvg, type EntityIconResolver } from "../icons/EntityIcon.tsx";
import { Icon } from "../icons/Icon.tsx";
import type { SignalDescriber } from "../inspector/SignalField.tsx";
import type { EntityStatus, StatusSignal } from "../workbench/controller.ts";
import { CARD, PIN_RADIUS, PIN_SPACING, pinEdge, pinPoint } from "./geometry.ts";
import { inputText, layoutRow, rowPlacement, STATUS_ROWS, statusLines } from "./statusRows.ts";

export interface EntityCardProps {
  readonly entity: Entity;
  /** Position to draw at; differs from `entity.position` while the card is being dragged. */
  readonly x: number;
  readonly y: number;
  readonly selected: boolean;
  /** Draw only the body and pins; used when zoomed out too far for text to be legible. */
  readonly outline: boolean;
  readonly shadow: boolean;
  /** Pin that started a pending wire, if it belongs to this entity. */
  readonly pendingSide?: TerminalSide;
  readonly pendingColor?: WireColor;
  /** Live state from the simulation, shown in the status rows. */
  readonly status?: EntityStatus;
  readonly describeSignal?: SignalDescriber;
  readonly resolveIcon?: EntityIconResolver;
}

const NAME_MAX_CHARS = 13;
const SUMMARY_MAX_CHARS = 15;
const NOTE_ICON = 13;
const ENTITY_ICON = 34;
/** Left edge of the header, the body and the row markers; the right margin is the same. */
const MARGIN = STATUS_ROWS.markerX;
const TEXT_X = MARGIN + ENTITY_ICON + 9;
/** Baseline of the 9px row text below the center of its row. */
const ROW_BASELINE = 3.2;
/** How far the header content moves down on a card with pins on its top edge, which reach 7 units into the card. */
const HEADER_SHIFT = 2;

interface StatusRowProps {
  readonly kind: "red" | "green" | "out";
  /** Vertical center of the row and the distance to the next line. */
  readonly y: number;
  readonly pitch: number;
  /** Rows the signals may run on into; 1 by default. */
  readonly lines?: number;
  readonly signals: readonly StatusSignal[];
  /** An input without a wire of its color. */
  readonly dimmed?: boolean;
  readonly describeSignal?: SignalDescriber;
}

/**
 * One status row: a marker, then the signals that fit as icon and value (short name and value without a catalog icon) and
 * `+N` for the rest; an empty row shows a dash. Memoized: the engine keeps the list of a network or an output that did not
 * change, so a tick only renders the rows whose content changed.
 */
const StatusRow = memo(function StatusRow({ kind, y, pitch, lines = 1, signals, dimmed, describeSignal }: StatusRowProps) {
  const { items, more, moreX } = layoutRow(signals, describeSignal && ((signal) => describeSignal(signal).iconUrl), lines);
  const { icon, markerX, contentX } = STATUS_ROWS;
  const lastLine = items.at(-1)?.line ?? 0;
  return (
    <g className={`card-row ${kind}${dimmed ? " unwired" : ""}`} data-row={kind} transform={`translate(0,${y})`}>
      {kind === "out" ? <path className="row-marker" d={`M ${markerX} 0 h 6 m -2.6 -2.6 l 2.6 2.6 l -2.6 2.6`} /> : <rect className="row-marker" x={markerX} y={-5} width="3" height="10" rx="1.5" />}
      {items.map((item, index) => (
        <Fragment key={index}>
          {item.iconUrl && <image href={item.iconUrl} x={item.x} y={item.line * pitch - icon / 2} width={icon} height={icon} />}
          <text className="row-value" x={item.textX} y={item.line * pitch + ROW_BASELINE}>
            {item.text}
          </text>
        </Fragment>
      ))}
      {more > 0 && (
        <text className="row-more" x={moreX} y={lastLine * pitch + ROW_BASELINE}>
          +{more}
        </text>
      )}
      {items.length === 0 && (
        <text className="row-none" x={contentX} y={ROW_BASELINE}>
          –
        </text>
      )}
    </g>
  );
});

/** The state of a lamp in the place of the output row; the swatch is the color of its light. */
function LampRow({ y, lit, color }: { readonly y: number; readonly lit: boolean; readonly color?: string }) {
  return (
    <g className="card-row lamp" data-row="lamp" transform={`translate(0,${y})`}>
      {color && <rect className="row-swatch" x={STATUS_ROWS.markerX} y={-4} width="8" height="8" rx="1.5" style={{ fill: color }} />}
      <text className={lit ? "row-value" : "row-none"} x={STATUS_ROWS.contentX} y={ROW_BASELINE}>
        {lit ? "lit" : "off"}
      </text>
    </g>
  );
}

const ORIGIN = { x: 0, y: 0 };

/**
 * One connection pin: the place where wires of its color attach, on the edge of the card that the entity's facing gives its
 * terminal. The hit areas of the two pins of a terminal touch but do not overlap.
 */
function Pin({ side, color, facing, pending }: { readonly side: TerminalSide; readonly color: WireColor; readonly facing: Direction; readonly pending: boolean }) {
  const { x, y } = pinPoint(ORIGIN, side, color, facing);
  return (
    <g className={`pin ${color} ${side}${pending ? " pending" : ""}`} data-terminal={side} data-wire-color={color} data-edge={pinEdge(side, facing)}>
      <circle className="pin-hit" cx={x} cy={y} r={PIN_SPACING / 2} />
      <circle className="pin-dot" cx={x} cy={y} r={PIN_RADIUS} />
      <title>{`${color === "red" ? "Red" : "Green"} ${side === "out" ? "output" : "input"}`}</title>
    </g>
  );
}

export const EntityCard = memo(function EntityCard({ entity, x, y, selected, outline, shadow, pendingSide, pendingColor, status, describeSignal, resolveIcon }: EntityCardProps) {
  const info = KIND_INFO[entity.kind];
  const summary = entitySummary(entity);
  const description = entity.description?.trim();
  const facing = facingOf(entity);
  // Pins on the top or bottom edge reach into the header band or the last status row; only then that content gives way.
  const edges = TERMINALS[entity.kind].map((side) => pinEdge(side, facing));
  const headerY = edges.includes("top") ? HEADER_SHIFT : 0;
  const rows = rowPlacement(edges.includes("bottom"));
  const rowY = (line: number): number => rows.top + line * rows.pitch;
  const className = `card kind-${entity.kind}${selected ? " selected" : ""}${status?.active ? " active" : ""}`;
  return (
    <g
      className={className}
      transform={`translate(${x},${y})`}
      data-entity-id={entity.id}
      data-entity-name={entity.name}
      data-kind={entity.kind}
      data-facing={facing}
      data-x={x}
      data-y={y}
      data-status={status?.label}
      data-in-red={status?.input && inputText(status.input.red)}
      data-in-green={status?.input && inputText(status.input.green)}
    >
      <rect className="card-body" width={CARD.width} height={CARD.height} rx="9" filter={shadow ? "url(#card-shadow)" : undefined} />
      {/* The outline keeps the taller accent it always had; with text the accent is as high as the kind label's band. */}
      <rect className="card-accent" x={MARGIN} y={outline ? 14 : 7 + headerY} width="3" height={outline ? 17 : 13} rx="1.5" />
      {!outline && (
        <>
          <text className="card-kind" x={MARGIN + 9} y={17 + headerY}>
            {info.label.toUpperCase()}
          </text>
          {description && (
            <g className="card-note">
              <Icon name="note" size={NOTE_ICON} x={CARD.width - MARGIN - NOTE_ICON} y={7 + headerY} />
            </g>
          )}
          <path className="card-divider" d={`M 10 26.5 H ${CARD.width - 10}`} />
          <EntityIconSvg kind={entity.kind} x={MARGIN} y={32} size={ENTITY_ICON} resolveIcon={resolveIcon} />
          <text className="card-name" x={TEXT_X} y="46">
            {truncate(entity.name, NAME_MAX_CHARS)}
          </text>
          <text className="card-summary" x={TEXT_X} y="63">
            {truncate(summary, SUMMARY_MAX_CHARS)}
          </text>
          {status && (
            <>
              <path className="card-divider" d={`M 10 72.5 H ${CARD.width - 10}`} />
              {status.input && <StatusRow kind="red" y={rowY(0)} pitch={rows.pitch} signals={status.input.red.signals} dimmed={!status.input.red.wired} describeSignal={describeSignal} />}
              {status.input && <StatusRow kind="green" y={rowY(1)} pitch={rows.pitch} signals={status.input.green.signals} dimmed={!status.input.green.wired} describeSignal={describeSignal} />}
              {/* Without input rows (a constant combinator) the output has all three. */}
              {status.output && <StatusRow kind="out" y={rowY(status.input ? 2 : 0)} pitch={rows.pitch} lines={status.input ? 1 : 3} signals={status.output} describeSignal={describeSignal} />}
              {status.lamp && <LampRow y={rowY(2)} lit={status.lamp.lit} color={status.lamp.color} />}
            </>
          )}
          <title>{[`${info.label} ${entity.name}: ${summary}`, ...(description ? [description] : []), ...(status ? statusLines(status) : [])].join("\n")}</title>
        </>
      )}
      {TERMINALS[entity.kind].flatMap((side) =>
        WIRE_COLORS.map((color) => <Pin key={`${side}-${color}`} side={side} color={color} facing={facing} pending={pendingSide === side && pendingColor === color} />),
      )}
    </g>
  );
});

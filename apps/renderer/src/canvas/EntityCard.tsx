// One entity drawn as a card, and the face of a card on its own (`CardFace`). Purely presentational and memoized: pointer handling is delegated to the canvas through
// the data-entity-id / data-terminal / data-wire-color attributes, so a card only re-renders when its own props change.
import { facingOf, TERMINALS, WIRE_COLORS, type Entity, type TerminalSide, type WireColor } from "@face/model";
import { Fragment, memo, useContext } from "react";
import { entityTitle } from "../entities/kindInfo.ts";
import { summaryLines, truncate } from "../entities/summary.ts";
import { EntityIconSvg, type EntityIconResolver } from "../icons/EntityIcon.tsx";
import { Icon } from "../icons/Icon.tsx";
import { InstrumentsContext } from "../inspector/instruments.ts";
import type { SignalDescriber } from "../inspector/SignalField.tsx";
import type { EntityStatus, StatusSignal } from "../workbench/controller.ts";
import { CARD, PIN_RADIUS, PIN_SPACING, pinEdge, pinEdges, pinPlaces, pinPoint, type CardEdge } from "./geometry.ts";
import { inputText, layoutRow, rowPlacement, STATE_ROW_CHARS, STATUS_ROWS } from "./statusRows.ts";

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
/** A summary of two lines is set smaller, so more of it fits. */
const SUMMARY_LINE_CHARS = 18;
/** The heading of a card is spaced wide; beyond this many characters it is set closer, so that the longest name of an entity ("MEDIUM ELECTRIC POLE") fits beside the description marker. */
const TITLE_WIDE_CHARS = 16;
const TITLE_MAX_CHARS = 20;
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

/** The state of a speaker in the place of the output row: what it plays, behind a mark of sound waves that lights up with it. */
function SpeakerRow({ y, playing, text }: { readonly y: number; readonly playing: boolean; readonly text: string }) {
  const x = STATUS_ROWS.markerX;
  return (
    <g className={`card-row speaker${playing ? " playing" : ""}`} data-row="speaker" transform={`translate(0,${y})`}>
      <path className="row-marker" d={`M ${x} -1.5 h 2 l 2.5 -2.5 v 8 l -2.5 -2.5 h -2 z M ${x + 6.5} -2.5 a 3.6 3.6 0 0 1 0 5`} />
      <text className={playing ? "row-value" : "row-none"} x={STATUS_ROWS.contentX} y={ROW_BASELINE}>
        {truncate(text, STATE_ROW_CHARS)}
      </text>
    </g>
  );
}

const ORIGIN = { x: 0, y: 0 };
const PIN_TITLES: Readonly<Record<TerminalSide, string>> = { in: "input", out: "output", io: "connection" };

export interface PinProps {
  readonly side: TerminalSide;
  readonly color: WireColor;
  /** Center, relative to the corner of the entity. */
  readonly x: number;
  readonly y: number;
  readonly radius?: number;
  /** The edge of the entity the pin is on. */
  readonly edge: CardEdge;
  /** The pin started a pending wire. */
  readonly pending: boolean;
}

/**
 * One connection pin: the place where wires of its color attach. The canvas finds it by `data-terminal` and `data-wire-color`
 * inside the group of its entity. The hit areas of the two pins of a terminal touch but do not overlap. A connection point
 * that is drawn on two edges of a card has a pin on each; they are one terminal, told apart by `data-edge` only.
 */
export function Pin({ side, color, x, y, radius = PIN_RADIUS, edge, pending }: PinProps) {
  return (
    <g className={`pin ${color} ${side}${pending ? " pending" : ""}`} data-terminal={side} data-wire-color={color} data-edge={edge}>
      <circle className="pin-hit" cx={x} cy={y} r={PIN_SPACING / 2} />
      <circle className="pin-dot" cx={x} cy={y} r={radius} />
      <title>{`${color === "red" ? "Red" : "Green"} ${PIN_TITLES[side]}`}</title>
    </g>
  );
}

export interface CardFaceProps {
  readonly entity: Entity;
  /** Draw only the body and the accent; used when zoomed out too far for text to be legible. */
  readonly outline?: boolean;
  readonly shadow?: boolean;
  /** The edges that carry pins; the content next to pins on the top or the bottom edge gives way. None for a card without pins. */
  readonly pinEdges?: readonly CardEdge[];
  readonly status?: EntityStatus;
  readonly describeSignal?: SignalDescriber;
  readonly resolveIcon?: EntityIconResolver;
}

const NO_EDGES: readonly CardEdge[] = [];

/**
 * What a card shows, without its pins and without a place: body, what the entity is, description marker, icon, name, summary
 * and the status rows, in card units from (0, 0). The card on the edit canvas and the bubble of the blueprint board both draw it.
 */
export function CardFace({ entity, outline = false, shadow = false, pinEdges = NO_EDGES, status, describeSignal, resolveIcon }: CardFaceProps) {
  const title = entityTitle(entity).toUpperCase();
  const summary = summaryLines(entity, useContext(InstrumentsContext));
  const description = entity.description?.trim();
  // Pins on the top or bottom edge reach into the header band or the last status row; only then that content gives way.
  const headerY = pinEdges.includes("top") ? HEADER_SHIFT : 0;
  const rows = rowPlacement(pinEdges.includes("bottom"));
  const rowY = (line: number): number => rows.top + line * rows.pitch;
  return (
    <>
      <rect className="card-body" width={CARD.width} height={CARD.height} rx="9" filter={shadow ? "url(#card-shadow)" : undefined} />
      {/* The outline keeps the taller accent it always had; with text the accent is as high as the heading's band. */}
      <rect className="card-accent" x={MARGIN} y={outline ? 14 : 7 + headerY} width="3" height={outline ? 17 : 13} rx="1.5" />
      {!outline && (
        <>
          <text className={`card-kind${title.length > TITLE_WIDE_CHARS ? " long" : ""}`} x={MARGIN + 9} y={17 + headerY}>
            {truncate(title, TITLE_MAX_CHARS)}
          </text>
          {description && (
            <g className="card-note">
              <Icon name="note" size={NOTE_ICON} x={CARD.width - MARGIN - NOTE_ICON} y={7 + headerY} />
            </g>
          )}
          <path className="card-divider" d={`M 10 26.5 H ${CARD.width - 10}`} />
          <EntityIconSvg entity={entity} x={MARGIN} y={32} size={ENTITY_ICON} resolveIcon={resolveIcon} />
          {summary.length < 2 ? (
            <>
              <text className="card-name" x={TEXT_X} y="46">
                {truncate(entity.name, NAME_MAX_CHARS)}
              </text>
              <text className="card-summary" x={TEXT_X} y="63">
                {truncate(summary[0] ?? "", SUMMARY_MAX_CHARS)}
              </text>
            </>
          ) : (
            <>
              {/* Two lines under the name: all three move together and the summary is set smaller. */}
              <text className="card-name" x={TEXT_X} y="43">
                {truncate(entity.name, NAME_MAX_CHARS)}
              </text>
              {summary.slice(0, 2).map((line, index) => (
                <text key={index} className="card-summary small" x={TEXT_X} y={56 + index * 11.5}>
                  {truncate(line, SUMMARY_LINE_CHARS)}
                </text>
              ))}
            </>
          )}
          {status && (
            <>
              <path className="card-divider" d={`M 10 72.5 H ${CARD.width - 10}`} />
              {status.input && <StatusRow kind="red" y={rowY(0)} pitch={rows.pitch} signals={status.input.red.signals} dimmed={!status.input.red.wired} describeSignal={describeSignal} />}
              {status.input && <StatusRow kind="green" y={rowY(1)} pitch={rows.pitch} signals={status.input.green.signals} dimmed={!status.input.green.wired} describeSignal={describeSignal} />}
              {/* Without input rows (a constant combinator) the output has all three. */}
              {status.output && <StatusRow kind="out" y={rowY(status.input ? 2 : 0)} pitch={rows.pitch} lines={status.input ? 1 : 3} signals={status.output} describeSignal={describeSignal} />}
              {status.lamp && <LampRow y={rowY(2)} lit={status.lamp.lit} color={status.lamp.color} />}
              {status.speaker && <SpeakerRow y={rowY(2)} playing={status.speaker.playing} text={status.label} />}
            </>
          )}
        </>
      )}
    </>
  );
}

export const EntityCard = memo(function EntityCard({ entity, x, y, selected, outline, shadow, pendingSide, pendingColor, status, describeSignal, resolveIcon }: EntityCardProps) {
  const facing = facingOf(entity);
  const terminals = TERMINALS[entity.kind];
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
      data-status={status?.label || undefined}
      data-in-red={status?.input && inputText(status.input.red)}
      data-in-green={status?.input && inputText(status.input.green)}
    >
      <CardFace entity={entity} outline={outline} shadow={shadow} pinEdges={pinEdges(terminals, facing)} status={status} describeSignal={describeSignal} resolveIcon={resolveIcon} />
      {/* On the edge of the card that the entity's facing gives the terminal; a connection point without a direction is on two. */}
      {terminals.flatMap((side) =>
        pinPlaces(side).flatMap((place) =>
          WIRE_COLORS.map((color) => <Pin key={`${place}-${color}`} side={side} color={color} {...pinPoint(ORIGIN, place, color, facing)} edge={pinEdge(place, facing)} pending={pendingSide === side && pendingColor === color} />),
        ),
      )}
    </g>
  );
});

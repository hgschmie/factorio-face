// One entity on the blueprint board: its footprint on the tiles with compact content. The counterpart of EntityCard, and like
// it purely presentational and memoized; the canvas finds it and its pins through the same data attributes. Coordinates are
// canvas units from the top-left corner of the footprint.
import { facingOf, TERMINALS, tileHalves, tileCenter, tileSize, WIRE_COLORS, type Entity, type TerminalSide, type TileBox, type WireColor } from "@face/model";
import { memo } from "react";
import { truncate } from "../entities/summary.ts";
import { EntityIconSvg, type EntityIconResolver } from "../icons/EntityIcon.tsx";
import type { EntityStatus } from "../workbench/controller.ts";
import { BOARD_PIN, boardPinHeading, boardPinOffset, TILE } from "./board.ts";
import { Pin } from "./EntityCard.tsx";
import { arrowPath, DIRECTION_VECTOR, EDGE_TOWARDS } from "./geometry.ts";
import { compactOutput, inputText } from "./statusRows.ts";

export interface BlueprintEntityProps {
  readonly entity: Entity;
  /** The top-left tile of the footprint. */
  readonly tileX: number;
  readonly tileY: number;
  /** False for an entity without a `tile`, which stands at a derived place. */
  readonly placed: boolean;
  /** The `tile` is off the grid or shared with another entity. */
  readonly conflict: boolean;
  /** Part of a move in progress. */
  readonly moving?: boolean;
  /** The move in progress cannot end here: the entity stands on a tile that is taken. */
  readonly blocked?: boolean;
  readonly selected: boolean;
  /** Draw without text; used when zoomed out too far for it to be legible. */
  readonly outline: boolean;
  readonly pendingSide?: TerminalSide;
  readonly pendingColor?: WireColor;
  readonly status?: EntityStatus;
  readonly resolveIcon?: EntityIconResolver;
}

/** The body leaves this much of its tiles free on every side, so that neighbors stay apart and the board shows through. */
const INSET = 4;
/** Icon edge on one tile, on two tiles, on a square of four, and without text. */
const ICON = { single: 26, long: 28, square: 48, outline: 40 } as const;
/** How far the content of a 1x1 entity moves away from pins on its top or bottom end. */
const PIN_ROOM = 9;
/** How far the arrows of a 2x1 entity sit from the middle of their half, towards its outer end. */
const ARROW_SHIFT = 8;
const NOTCH = 7;
const NAME_CHARS = { single: 11, wide: 18, tall: 11 } as const;
/** Below the middle of a square of four tiles: the top of the icon above it and the baseline of the name. */
const SQUARE = { iconTop: -36, name: 30 } as const;
const OUTPUT_CHARS = { wide: 20, tall: 12 } as const;

export const BlueprintEntity = memo(function BlueprintEntity({ entity, tileX, tileY, placed, conflict, moving, blocked, selected, outline, pendingSide, pendingColor, status, resolveIcon }: BlueprintEntityProps) {
  const facing = facingOf(entity);
  const size = tileSize(entity, facing);
  const width = size.width * TILE;
  const height = size.height * TILE;
  const forward = DIRECTION_VECTOR[facing];
  const halves = tileHalves(entity, facing, tileCenter(entity, facing, { x: 0, y: 0 }));
  // Laid out along its two halves; an entity without them (one tile, or the 2x2 of a big pole) has its content in the middle
  // and neither arrows nor a notch: it has no direction to show.
  const long = halves.input.x !== halves.output.x || halves.input.y !== halves.output.y;
  const square = !long && size.width > 1 && size.height > 1;
  const middle = (half: TileBox) => ({ x: (half.x + half.width / 2) * TILE, y: (half.y + half.height / 2) * TILE });
  // The content sits in the middle of the footprint. On one tile it moves away from pins on the top or the bottom end.
  const pinsTowards = long || square ? { x: 0, y: 0 } : DIRECTION_VECTOR[boardPinHeading(TERMINALS[entity.kind][0]!, facing)];
  const center = { x: width / 2, y: height / 2 - pinsTowards.y * PIN_ROOM };
  const icon = outline ? ICON.outline : long ? ICON.long : square ? ICON.square : ICON.single;
  const iconTop = outline ? height / 2 - icon / 2 : center.y + (long ? -27 : square ? SQUARE.iconTop : -19);
  const nameChars = long || square ? (size.width === 2 ? NAME_CHARS.wide : NAME_CHARS.tall) : NAME_CHARS.single;
  // A lamp that is lit and a speaker that plays show it: the indicator, and a glow over the body in the color of the light.
  const lit = status?.active ?? false;
  const emitting = lit || (status?.output?.length ?? 0) > 0;
  const x = tileX * TILE;
  const y = tileY * TILE;
  const className = `card board-entity kind-${entity.kind}${selected ? " selected" : ""}${status?.active ? " active" : ""}${placed ? "" : " unplaced"}${conflict ? " conflict" : ""}${moving ? " moving" : ""}${blocked ? " blocked" : ""}`;
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
      data-tile-x={tileX}
      data-tile-y={tileY}
      data-placed={placed}
      data-conflict={conflict || undefined}
      data-blocked={blocked || undefined}
      data-status={status?.label || undefined}
      data-in-red={status?.input && inputText(status.input.red)}
      data-in-green={status?.input && inputText(status.input.green)}
    >
      <rect className="card-body" x={INSET} y={INSET} width={width - 2 * INSET} height={height - 2 * INSET} rx="6" />
      {lit && <rect className="board-glow" x={INSET + 1} y={INSET + 1} width={width - 2 * INSET - 2} height={height - 2 * INSET - 2} rx="5" style={status?.lamp?.color ? { fill: status.lamp.color } : undefined} />}
      {!placed && <title>No tile yet: shown at a place derived from the edit layout</title>}
      {conflict && <title>This tile is off the grid or taken by another entity</title>}
      <rect className="card-accent" x={INSET + 5} y={INSET + 5} width="3" height="11" rx="1.5" />
      {status && <circle className={`board-led${emitting ? " on" : ""}`} cx={width - INSET - 8} cy={INSET + 8} r="3.5" style={lit && status.lamp?.color ? { fill: status.lamp.color } : undefined} />}
      {long && (
        <>
          {/* Where the input half ends and the output half begins: a notch on both long edges, clear of the icon and the text. */}
          <path className="board-divider" d={size.width === 2 ? `M ${TILE} ${INSET} v ${NOTCH} M ${TILE} ${height - INSET} v ${-NOTCH}` : `M ${INSET} ${TILE} h ${NOTCH} M ${width - INSET} ${TILE} h ${-NOTCH}`} />
          {/* As the game marks a combinator: an arrow into the input end and one out of the output end, both along the facing. */}
          <path className="board-arrow in" d={arrowPath(middle(halves.input).x - forward.x * ARROW_SHIFT, middle(halves.input).y - forward.y * ARROW_SHIFT, forward)} />
          <path className="board-arrow out" d={arrowPath(middle(halves.output).x + forward.x * ARROW_SHIFT, middle(halves.output).y + forward.y * ARROW_SHIFT, forward)} />
        </>
      )}
      <EntityIconSvg entity={entity} x={center.x - icon / 2} y={iconTop} size={icon} resolveIcon={resolveIcon} />
      {!outline && (
        <>
          <text className="board-name" x={center.x} y={center.y + (long ? 13 : square ? SQUARE.name : 19)}>
            {truncate(entity.name, nameChars)}
          </text>
          {long && status?.output && (
            <text className="board-output" x={center.x} y={center.y + 26}>
              {compactOutput(status.output, size.width === 2 ? OUTPUT_CHARS.wide : OUTPUT_CHARS.tall)}
            </text>
          )}
        </>
      )}
      {TERMINALS[entity.kind].flatMap((side) =>
        WIRE_COLORS.map((color) => (
          <Pin key={`${side}-${color}`} side={side} color={color} {...boardPinOffset(entity, facing, side, color)} radius={BOARD_PIN.radius} edge={EDGE_TOWARDS[boardPinHeading(side, facing)]} pending={pendingSide === side && pendingColor === color} />
        )),
      )}
    </g>
  );
});

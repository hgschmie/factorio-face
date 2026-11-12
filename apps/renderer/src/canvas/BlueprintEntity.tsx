// One entity on the blueprint board: its footprint on the tiles with compact content. The counterpart of EntityCard, and like
// it purely presentational and memoized; the canvas finds it and its pins through the same data attributes. Coordinates are
// canvas units from the top-left corner of the footprint.
import { facingOf, TERMINALS, tileHalves, tileCenter, tileSize, WIRE_COLORS, type Entity, type Point, type TerminalSide, type WireColor } from "@face/model";
import { memo } from "react";
import { truncate } from "../entities/summary.ts";
import { EntityIconSvg, type EntityIconResolver } from "../icons/EntityIcon.tsx";
import type { EntityStatus } from "../workbench/controller.ts";
import { BOARD_PIN, boardPinOffset, TILE } from "./board.ts";
import { Pin } from "./EntityCard.tsx";
import { DIRECTION_VECTOR, pinEdge, pinHeading } from "./geometry.ts";
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
/** Icon edge on one tile, on two tiles, and without text. */
const ICON = { single: 26, long: 28, outline: 40 } as const;
/** How far the content of a 1x1 entity moves away from pins on its top or bottom end. */
const PIN_ROOM = 9;
/** How far the arrows of a 2x1 entity sit from the middle of their half, towards its outer end. */
const ARROW_SHIFT = 8;
const NOTCH = 7;
const NAME_CHARS = { single: 11, wide: 18, tall: 11 } as const;
const OUTPUT_CHARS = { wide: 20, tall: 12 } as const;

/** A triangle around (x, y) that points along `forward`. */
function arrowPath(x: number, y: number, forward: Point): string {
  const back = { x: x - forward.x * 4, y: y - forward.y * 4 };
  return `M ${x + forward.x * 5} ${y + forward.y * 5} L ${back.x + forward.y * 5} ${back.y - forward.x * 5} L ${back.x - forward.y * 5} ${back.y + forward.x * 5} Z`;
}

export const BlueprintEntity = memo(function BlueprintEntity({ entity, tileX, tileY, placed, conflict, selected, outline, pendingSide, pendingColor, status, resolveIcon }: BlueprintEntityProps) {
  const facing = facingOf(entity);
  const size = tileSize(entity.kind, facing);
  const width = size.width * TILE;
  const height = size.height * TILE;
  const long = size.width + size.height > 2;
  const forward = DIRECTION_VECTOR[facing];
  const halves = tileHalves(entity.kind, facing, tileCenter(entity.kind, facing, { x: 0, y: 0 }));
  // The content sits in the middle of the footprint. On one tile it moves away from pins on the top or the bottom end.
  const pinsTowards = long ? { x: 0, y: 0 } : DIRECTION_VECTOR[pinHeading(TERMINALS[entity.kind][0]!, facing)];
  const center = { x: width / 2, y: height / 2 - pinsTowards.y * PIN_ROOM };
  const icon = outline ? ICON.outline : long ? ICON.long : ICON.single;
  const iconTop = outline ? height / 2 - icon / 2 : center.y - (long ? 27 : 19);
  const nameChars = !long ? NAME_CHARS.single : size.width === 2 ? NAME_CHARS.wide : NAME_CHARS.tall;
  const lit = status?.lamp?.lit ?? false;
  const emitting = lit || (status?.output?.length ?? 0) > 0;
  const x = tileX * TILE;
  const y = tileY * TILE;
  const className = `card board-entity kind-${entity.kind}${selected ? " selected" : ""}${status?.active ? " active" : ""}${placed ? "" : " unplaced"}${conflict ? " conflict" : ""}`;
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
      data-status={status?.label}
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
          <path className="board-arrow in" d={arrowPath((halves.input.x + 0.5) * TILE - forward.x * ARROW_SHIFT, (halves.input.y + 0.5) * TILE - forward.y * ARROW_SHIFT, forward)} />
          <path className="board-arrow out" d={arrowPath((halves.output.x + 0.5) * TILE + forward.x * ARROW_SHIFT, (halves.output.y + 0.5) * TILE + forward.y * ARROW_SHIFT, forward)} />
        </>
      )}
      <EntityIconSvg kind={entity.kind} x={center.x - icon / 2} y={iconTop} size={icon} resolveIcon={resolveIcon} />
      {!outline && (
        <>
          <text className="board-name" x={center.x} y={center.y + (long ? 13 : 19)}>
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
          <Pin key={`${side}-${color}`} side={side} color={color} {...boardPinOffset(entity.kind, facing, side, color)} radius={BOARD_PIN.radius} edge={pinEdge(side, facing)} pending={pendingSide === side && pendingColor === color} />
        )),
      )}
    </g>
  );
});

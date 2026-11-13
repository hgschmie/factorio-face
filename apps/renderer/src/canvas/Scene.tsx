// The circuit itself, in the layout of the display mode: on the edit canvas wires below and cards above, on the blueprint
// board the footprints below and the wires above them, as the game draws them. Memoized as a whole, so camera changes that
// stay inside the current culling rectangle do not touch it, and with memoized children, so a drag only re-renders the moved
// entities and wires and a selection only the entities and wires whose state changed. Hovering a wire is CSS only.
import { exceedsWireReach, formatWireDistance, terminalKey, wireKey, type Circuit, type Entity, type EntityId, type TerminalRef, type Wire, type WireColor } from "@face/model";
import { memo, useMemo } from "react";
import type { EntityIconResolver } from "../icons/EntityIcon.tsx";
import type { SignalDescriber } from "../inspector/SignalField.tsx";
import type { EntityStatus } from "../workbench/controller.ts";
import { BlueprintEntity } from "./BlueprintEntity.tsx";
import { EntityCard } from "./EntityCard.tsx";
import { rectsIntersect, type Rect } from "./geometry.ts";
import type { Layout } from "./layout.ts";

/** Above this many visible cards the drop shadow filter is skipped; it dominates paint time on dense views. */
const SHADOW_LIMIT = 60;

export interface SceneProps {
  readonly circuit: Circuit;
  /** Where the entities and their pins are; a new one while a drag is in progress. */
  readonly layout: Layout;
  /** The wire reach of the project in tiles: on the board a longer wire between two entities with a tile is flagged. */
  readonly wireReach: number;
  readonly selection: ReadonlySet<EntityId>;
  /** The selected wires, as `wireKey`s. */
  readonly wireSelection: ReadonlySet<string>;
  /** Only elements intersecting this rectangle are rendered. */
  readonly visible: Rect;
  readonly outline: boolean;
  /** Terminal and color of the pin that started a pending wire. */
  readonly pendingTerminal: TerminalRef | null;
  readonly pendingColor?: WireColor;
  readonly entityStatus?: ReadonlyMap<EntityId, EntityStatus>;
  readonly describeSignal?: SignalDescriber;
  readonly resolveIcon?: EntityIconResolver;
}

interface RoutedWire {
  readonly key: string;
  readonly wire: Wire;
  readonly path: string;
  readonly bounds: Rect;
  readonly title: string;
  /** On the board: longer than the wire reach. */
  readonly tooLong: boolean;
}

interface WireViewProps {
  readonly id: string;
  readonly color: string;
  readonly path: string;
  readonly title: string;
  readonly selected: boolean;
  readonly tooLong: boolean;
}

/**
 * One wire. `wire-hit` is the wide stroke that takes the pointer while the select tool is active (the canvas reads `data-wire`
 * from the group); it is also what lights up on hover and for a selected wire. A wire that is longer than the wire reach has
 * `data-too-long` and a dashed band in the warning color under its core.
 */
const WireView = memo(function WireView({ id, color, path, title, selected, tooLong }: WireViewProps) {
  return (
    <g className={`wire ${color}${selected ? " selected" : ""}${tooLong ? " too-long" : ""}`} data-wire={id} data-color={color} data-too-long={tooLong || undefined}>
      <path className="wire-hit" d={path} />
      <path className="wire-casing" d={path} />
      {tooLong && <path className="wire-flag" d={path} />}
      <path className="wire-core" d={path} />
      <title>{title}</title>
    </g>
  );
});

function routeWires(circuit: Circuit, byId: ReadonlyMap<EntityId, Entity>, layout: Layout, wireReach: number): RoutedWire[] {
  const routed: RoutedWire[] = [];
  for (const wire of circuit.wires) {
    const a = byId.get(wire.a.entity);
    const b = byId.get(wire.b.entity);
    if (!a || !b || terminalKey(wire.a) === terminalKey(wire.b)) continue;
    // Only the board knows tiles; the edit canvas shows every wire as it always did.
    const distance = layout.mode === "blueprint" ? layout.wireDistance(a, b) : undefined;
    const tooLong = exceedsWireReach(distance, wireReach);
    const measure = distance === undefined ? "" : ` (${formatWireDistance(distance, wireReach)} tiles apart${tooLong ? `, over the wire reach of ${wireReach}` : ""})`;
    routed.push({ key: wireKey(wire), wire, ...layout.route(wire, a, b), title: `${wire.color}: ${a.name}.${wire.a.side} <-> ${b.name}.${wire.b.side}${measure}`, tooLong });
  }
  return routed;
}

export const Scene = memo(function Scene(props: SceneProps) {
  const { circuit, layout, wireReach, selection, wireSelection, visible, outline, pendingTerminal, pendingColor, entityStatus, describeSignal, resolveIcon } = props;
  const byId = useMemo(() => new Map(circuit.entities.map((entity) => [entity.id, entity])), [circuit.entities]);
  const wires = useMemo(() => routeWires(circuit, byId, layout, wireReach), [circuit, byId, layout, wireReach]);

  const inView = wires.filter((wire) => rectsIntersect(wire.bounds, visible));
  // Selected wires are drawn last, above the others.
  const visibleWires = wireSelection.size === 0 ? inView : [...inView.filter((wire) => !wireSelection.has(wire.key)), ...inView.filter((wire) => wireSelection.has(wire.key))];
  const inSight = circuit.entities.flatMap((entity) => {
    const rect = layout.rect(entity);
    return rectsIntersect(rect, visible) ? [{ entity, rect }] : [];
  });
  // On the board the entities of a move in progress are drawn last, above whatever they are dragged over.
  const isMoving = (entity: Entity): boolean => layout.mode === "blueprint" && layout.placement(entity).moving;
  const visibleEntities = [...inSight.filter(({ entity }) => !isMoving(entity)), ...inSight.filter(({ entity }) => isMoving(entity))];
  const shadow = visibleEntities.length <= SHADOW_LIMIT;

  const wireGroup = (
    <g className="wires" key="wires">
      {visibleWires.map((wire) => (
        <WireView key={wire.key} id={wire.key} color={wire.wire.color} path={wire.path} title={wire.title} selected={wireSelection.has(wire.key)} tooLong={wire.tooLong} />
      ))}
    </g>
  );
  const entityGroup = (
    <g className="cards" key="cards">
      {visibleEntities.map(({ entity, rect }) => {
        const pending = pendingTerminal?.entity === entity.id;
        const shared = {
          entity,
          selected: selection.has(entity.id),
          outline,
          pendingSide: pending ? pendingTerminal.side : undefined,
          pendingColor: pending ? pendingColor : undefined,
          status: entityStatus?.get(entity.id),
          resolveIcon,
        };
        if (layout.mode === "edit") return <EntityCard key={entity.id} {...shared} x={rect.x} y={rect.y} shadow={shadow} describeSignal={describeSignal} />;
        const { origin, placed, conflict, moving, blocked } = layout.placement(entity);
        return <BlueprintEntity key={entity.id} {...shared} tileX={origin.x} tileY={origin.y} placed={placed} conflict={conflict} moving={moving} blocked={blocked} />;
      })}
    </g>
  );
  return layout.mode === "edit" ? [wireGroup, entityGroup] : [entityGroup, wireGroup];
});

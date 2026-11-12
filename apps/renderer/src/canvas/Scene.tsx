// The circuit itself: wires below, cards above. Memoized as a whole, so camera changes that stay inside the current
// culling rectangle do not touch it, and with memoized children, so a drag only re-renders the moved cards and wires
// and a selection only the cards and wires whose state changed. Hovering a wire is CSS only.
import { terminalKey, wireKey, type Circuit, type Entity, type EntityId, type Point, type TerminalRef, type Wire, type WireColor } from "@face/model";
import { memo, useMemo } from "react";
import type { EntityIconResolver } from "../icons/EntityIcon.tsx";
import type { SignalDescriber } from "../inspector/SignalField.tsx";
import type { EntityStatus } from "../workbench/controller.ts";
import { EntityCard } from "./EntityCard.tsx";
import { facingOf } from "../entities/facing.ts";
import { cardRect, rectsIntersect, type Rect } from "./geometry.ts";
import { routeBounds, routePath, routeWire } from "./wireRouting.ts";

/** Above this many visible cards the drop shadow filter is skipped; it dominates paint time on dense views. */
const SHADOW_LIMIT = 60;

export interface SceneProps {
  readonly circuit: Circuit;
  /** Positions that override `entity.position` while a drag is in progress. */
  readonly previewPositions: ReadonlyMap<EntityId, Point> | null;
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
}

/**
 * One wire. `wire-hit` is the wide stroke that takes the pointer while the select tool is active (the canvas reads `data-wire`
 * from the group); it is also what lights up on hover and for a selected wire.
 */
const WireView = memo(function WireView({ id, color, path, title, selected }: { readonly id: string; readonly color: string; readonly path: string; readonly title: string; readonly selected: boolean }) {
  return (
    <g className={`wire ${color}${selected ? " selected" : ""}`} data-wire={id} data-color={color}>
      <path className="wire-hit" d={path} />
      <path className="wire-casing" d={path} />
      <path className="wire-core" d={path} />
      <title>{title}</title>
    </g>
  );
});

function routeWires(circuit: Circuit, byId: ReadonlyMap<EntityId, Entity>, positionOf: (entity: Entity) => Point): RoutedWire[] {
  const routed: RoutedWire[] = [];
  for (const wire of circuit.wires) {
    const a = byId.get(wire.a.entity);
    const b = byId.get(wire.b.entity);
    if (!a || !b || terminalKey(wire.a) === terminalKey(wire.b)) continue;
    const route = routeWire(wire.color, { position: positionOf(a), side: wire.a.side, facing: facingOf(a) }, { position: positionOf(b), side: wire.b.side, facing: facingOf(b) }, a.id === b.id);
    routed.push({ key: wireKey(wire), wire, path: routePath(route), bounds: routeBounds(route), title: `${wire.color}: ${a.name}.${wire.a.side} <-> ${b.name}.${wire.b.side}` });
  }
  return routed;
}

export const Scene = memo(function Scene({ circuit, previewPositions, selection, wireSelection, visible, outline, pendingTerminal, pendingColor, entityStatus, describeSignal, resolveIcon }: SceneProps) {
  const byId = useMemo(() => new Map(circuit.entities.map((entity) => [entity.id, entity])), [circuit.entities]);
  const wires = useMemo(() => routeWires(circuit, byId, (entity) => previewPositions?.get(entity.id) ?? entity.position), [circuit, byId, previewPositions]);

  const inView = wires.filter((wire) => rectsIntersect(wire.bounds, visible));
  // Selected wires are drawn last, above the others (and still below the cards).
  const visibleWires = wireSelection.size === 0 ? inView : [...inView.filter((wire) => !wireSelection.has(wire.key)), ...inView.filter((wire) => wireSelection.has(wire.key))];
  const visibleEntities = circuit.entities.filter((entity) => rectsIntersect(cardRect(previewPositions?.get(entity.id) ?? entity.position), visible));
  const shadow = visibleEntities.length <= SHADOW_LIMIT;

  return (
    <>
      <g className="wires">
        {visibleWires.map((wire) => (
          <WireView key={wire.key} id={wire.key} color={wire.wire.color} path={wire.path} title={wire.title} selected={wireSelection.has(wire.key)} />
        ))}
      </g>
      <g className="cards">
        {visibleEntities.map((entity) => {
          const position = previewPositions?.get(entity.id) ?? entity.position;
          const pending = pendingTerminal?.entity === entity.id;
          return (
            <EntityCard
              key={entity.id}
              entity={entity}
              x={position.x}
              y={position.y}
              selected={selection.has(entity.id)}
              outline={outline}
              shadow={shadow}
              pendingSide={pending ? pendingTerminal.side : undefined}
              pendingColor={pending ? pendingColor : undefined}
              status={entityStatus?.get(entity.id)}
              describeSignal={describeSignal}
              resolveIcon={resolveIcon}
            />
          );
        })}
      </g>
    </>
  );
});

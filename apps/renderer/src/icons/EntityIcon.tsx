// Entity icons: the game's artwork per prototype where the catalog serves it, a pictogram in the app's style otherwise.
// Pass an `EntityIconResolver` to swap in the images without touching the views.
import { prototypeOf, type EntityKind, type EntityShape, type PrototypeName } from "@face/model";
import type { ReactNode } from "react";

/** Returns an image URL for the prototype (for example `face-asset://catalog/...`), or undefined to use the pictogram. */
export type EntityIconResolver = (prototype: PrototypeName) => string | undefined;

const GLYPH_SIZE = 32;

/** The mark on the display of a combinator. */
const MARKS: Readonly<Partial<Record<EntityKind, ReactNode>>> = {
  constant: <path className="mark" d="M12 14h8M12 18h8" />,
  arithmetic: <path className="mark" d="m12.5 12.5 7 7m0-7-7 7" />,
  decider: <path className="mark" d="m12.5 12 7.5 4-7.5 4" />,
  selector: <path className="mark" d="M11 12.5h10M11 16h7M11 19.5h4" />,
};

/** A pole as a mast with its crossbar and insulators: the taller and the wider, the bigger the pole. A substation is a box with four of them. */
const POLES: Readonly<Partial<Record<PrototypeName, ReactNode>>> = {
  "small-electric-pole": <path className="mark" d="M16 9v19M11 13h10M11 10.5v2.5M21 10.5v2.5" />,
  "medium-electric-pole": <path className="mark" d="M16 5v23M10 9h12M10 6.5v2.5M22 6.5V9M12 28h8" />,
  "big-electric-pole": <path className="mark" d="M14 28 16 4l2 24M7 9h18M9 15h14M7 6.5V9M25 6.5V9M11 28h10" />,
  substation: (
    <>
      <rect className="frame" x="8" y="13" width="16" height="15" rx="2" />
      <path className="mark" d="M12 13V6M20 13V6M9 6h6M17 6h6M13 19h6M13 23h6" />
    </>
  ),
};

function Glyph({ kind, prototype }: { readonly kind: EntityKind; readonly prototype: PrototypeName }) {
  if (kind === "lamp") {
    return (
      <g className={`entity-glyph kind-${kind}`}>
        <circle className="frame" cx="16" cy="14" r="9" />
        <circle className="glow" cx="16" cy="14" r="4.5" />
        <path className="mark" d="M12 27h8M13 23.5h6" />
      </g>
    );
  }
  if (kind === "pole") return <g className={`entity-glyph kind-${kind}`}>{POLES[prototype] ?? POLES["small-electric-pole"]}</g>;
  if (kind === "speaker") {
    // A loudspeaker seen from the side, with the sound it sends out.
    return (
      <g className={`entity-glyph kind-${kind}`}>
        <path className="frame" d="M5 12.5h5l7-6v19l-7-6H5z" />
        <path className="mark" d="M21 12.5a5 5 0 0 1 0 7M24.5 9a10 10 0 0 1 0 14" />
      </g>
    );
  }
  return (
    <g className={`entity-glyph kind-${kind}`}>
      <rect className="frame" x="3" y="6" width="26" height="20" rx="4" />
      <rect className="display" x="7" y="9.5" width="18" height="13" rx="2" />
      {MARKS[kind]}
      <path className="mark" d="M9 26.5v2.5M23 26.5v2.5" />
    </g>
  );
}

export interface EntityIconProps {
  /** What to show: an entity, or just its kind and prototype. */
  readonly entity: EntityShape;
  readonly size?: number;
  readonly resolveIcon?: EntityIconResolver;
}

/** Icon for HTML contexts (palette, inspector). */
export function EntityIcon({ entity, size = 38, resolveIcon }: EntityIconProps) {
  const prototype = prototypeOf(entity);
  const url = resolveIcon?.(prototype);
  if (url) return <img className="entity-icon" src={url} width={size} height={size} alt="" draggable={false} />;
  return (
    <svg className="entity-icon" width={size} height={size} viewBox={`0 0 ${GLYPH_SIZE} ${GLYPH_SIZE}`} aria-hidden="true">
      <Glyph kind={entity.kind} prototype={prototype} />
    </svg>
  );
}

export interface EntityIconSvgProps extends EntityIconProps {
  readonly x: number;
  readonly y: number;
}

/** Icon for use inside the canvas SVG. */
export function EntityIconSvg({ entity, x, y, size = 38, resolveIcon }: EntityIconSvgProps) {
  const prototype = prototypeOf(entity);
  const url = resolveIcon?.(prototype);
  if (url) return <image href={url} x={x} y={y} width={size} height={size} />;
  return (
    <svg x={x} y={y} width={size} height={size} viewBox={`0 0 ${GLYPH_SIZE} ${GLYPH_SIZE}`} aria-hidden="true">
      <Glyph kind={entity.kind} prototype={prototype} />
    </svg>
  );
}

// Entity icons. Until the catalog package serves the game's artwork through face-asset://, each kind gets a placeholder
// pictogram in the app's style. Pass an `EntityIconResolver` to swap in real images without touching the views.
import type { EntityKind } from "@face/model";
import type { ReactNode } from "react";

/** Returns an image URL for the kind (for example `face-asset://catalog/...`), or undefined to use the placeholder. */
export type EntityIconResolver = (kind: EntityKind) => string | undefined;

const GLYPH_SIZE = 32;

const MARKS: Readonly<Record<Exclude<EntityKind, "lamp">, ReactNode>> = {
  constant: <path className="mark" d="M12 14h8M12 18h8" />,
  arithmetic: <path className="mark" d="m12.5 12.5 7 7m0-7-7 7" />,
  decider: <path className="mark" d="m12.5 12 7.5 4-7.5 4" />,
  selector: <path className="mark" d="M11 12.5h10M11 16h7M11 19.5h4" />,
};

function Glyph({ kind }: { readonly kind: EntityKind }) {
  if (kind === "lamp") {
    return (
      <g className={`entity-glyph kind-${kind}`}>
        <circle className="frame" cx="16" cy="14" r="9" />
        <circle className="glow" cx="16" cy="14" r="4.5" />
        <path className="mark" d="M12 27h8M13 23.5h6" />
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
  readonly kind: EntityKind;
  readonly size?: number;
  readonly resolveIcon?: EntityIconResolver;
}

/** Icon for HTML contexts (palette, inspector). */
export function EntityIcon({ kind, size = 38, resolveIcon }: EntityIconProps) {
  const url = resolveIcon?.(kind);
  if (url) return <img className="entity-icon" src={url} width={size} height={size} alt="" draggable={false} />;
  return (
    <svg className="entity-icon" width={size} height={size} viewBox={`0 0 ${GLYPH_SIZE} ${GLYPH_SIZE}`} aria-hidden="true">
      <Glyph kind={kind} />
    </svg>
  );
}

export interface EntityIconSvgProps extends EntityIconProps {
  readonly x: number;
  readonly y: number;
}

/** Icon for use inside the canvas SVG. */
export function EntityIconSvg({ kind, x, y, size = 38, resolveIcon }: EntityIconSvgProps) {
  const url = resolveIcon?.(kind);
  if (url) return <image href={url} x={x} y={y} width={size} height={size} />;
  return (
    <svg x={x} y={y} width={size} height={size} viewBox={`0 0 ${GLYPH_SIZE} ${GLYPH_SIZE}`} aria-hidden="true">
      <Glyph kind={kind} />
    </svg>
  );
}

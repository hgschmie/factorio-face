// Interface glyphs: 24-unit line icons that inherit the text color.
import type { ReactNode } from "react";

const GLYPHS = {
  cursor: <path d="m5 3 13 9-7 1-3 7z" />,
  wire: (
    <>
      <circle cx="5" cy="17" r="2" />
      <circle cx="19" cy="5" r="2" />
      <path d="M7 17h5V5h5" />
    </>
  ),
  code: <path d="m8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18" />,
  grid: (
    <>
      <rect x="3" y="3" width="6" height="6" rx="1" />
      <rect x="15" y="3" width="6" height="6" rx="1" />
      <rect x="3" y="15" width="6" height="6" rx="1" />
      <rect x="15" y="15" width="6" height="6" rx="1" />
    </>
  ),
  split: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M12 4v16" />
    </>
  ),
  undo: <path d="m8 3-5 5 5 5M3 8h10a7 7 0 0 1 0 14" />,
  redo: <path d="m16 3 5 5-5 5m5-5H11a7 7 0 0 0 0 14" />,
  save: (
    <>
      <path d="M3 3h14l4 4v14H3z" />
      <path d="M7 3v6h10V3M7 21v-8h10v8" />
    </>
  ),
  play: <path d="m8 4 12 8-12 8z" />,
  pause: <path d="M8 4v16M16 4v16" />,
  step: <path d="m5 5 10 7-10 7zM19 5v14" />,
  reset: <path d="M4 11a8 8 0 1 1 2 7M4 4v7h7" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  fit: (
    <>
      <path d="M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5" />
      <rect x="8" y="8" width="8" height="8" rx="1" />
    </>
  ),
  trash: <path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  bolt: <path d="m13 2-9 12h7l-1 8 10-13h-8z" />,
  arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
  arrowDown: <path d="M12 4v16m-6-6 6 6 6-6" />,
  arrowLeft: <path d="M20 12H4m6-6-6 6 6 6" />,
  arrowUp: <path d="M12 20V4m-6 6 6-6 6 6" />,
  rotateRight: <path d="M20 11a8 8 0 1 0-2 7M20 4v7h-7" />,
  rotateLeft: <path d="M4 11a8 8 0 1 1 2 7M4 4v7h7" />,
  settings: (
    <>
      <path d="M4 7h9m5 0h2M4 17h2m5 0h9" />
      <circle cx="15.5" cy="7" r="2.5" />
      <circle cx="8.5" cy="17" r="2.5" />
    </>
  ),
  note: <path d="M4 6h16M4 12h16M4 18h10" />,
  copy: (
    <>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M15 5V4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h1" />
    </>
  ),
  cut: (
    <>
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M8.5 8 20 19M8.5 16 20 5" />
    </>
  ),
  selectAll: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2" strokeDasharray="3 3" />
      <rect x="9" y="9" width="6" height="6" rx="1" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof GLYPHS;

export interface IconProps {
  readonly name: IconName;
  readonly size?: number;
  /** Position inside an enclosing SVG, such as the canvas; without meaning in HTML. */
  readonly x?: number;
  readonly y?: number;
}

export function Icon({ name, size = 18, x, y }: IconProps) {
  return (
    <svg x={x} y={y} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {GLYPHS[name]}
    </svg>
  );
}

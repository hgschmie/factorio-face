import { useState, type ReactNode } from "react";

interface IconImageProps {
  readonly src: string;
  /** Edge length in CSS pixels. */
  readonly size: number;
  readonly className?: string;
  /** Load the image when it comes into view: for the long lists of the signal picker. */
  readonly lazy?: boolean;
  /** What stands in for an image that does not load; nothing by default. */
  readonly fallback?: ReactNode;
}

/**
 * An icon of the catalog by its URL. Game data read from a game with mods names icons the app cannot draw, and the request for
 * such an icon fails: `fallback` is shown in its place then (in a `span.icon-fallback`), never the browser's broken image.
 */
export function IconImage({ src, size, className, lazy = false, fallback = null }: IconImageProps) {
  const [failed, setFailed] = useState<string>();
  if (failed === src) return fallback === null ? null : <span className="icon-fallback">{fallback}</span>;
  return <img className={className} src={src} width={size} height={size} alt="" loading={lazy ? "lazy" : undefined} draggable={false} onError={() => setFailed(src)} />;
}

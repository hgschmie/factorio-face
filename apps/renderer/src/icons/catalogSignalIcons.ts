// Signal, group and quality icons from the generated catalog, served through face-asset://. The generated directory is
// git-ignored and may be absent, so one well-known icon is probed first; without it every icon URL is undefined and the
// views fall back to names.
import { iconPath } from "@face/catalog";
import { useEffect, useMemo, useState } from "react";

export type CatalogIconUrl = (icon: string) => string | undefined;

const PROBE_ICON = "virtual/signal-A";
const NO_ICONS: CatalogIconUrl = () => undefined;

export function catalogIconUrl(catalogAssetUrl: string, icon: string): string {
  return iconPath(icon, `${catalogAssetUrl}icons`);
}

/** Resolver from catalog icon ids to URLs; resolves nothing until the probe icon has loaded. */
export function useCatalogIcons(catalogAssetUrl: string | undefined): CatalogIconUrl {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    if (!catalogAssetUrl) return;
    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (!cancelled) setAvailable(image.naturalWidth > 0);
    };
    image.src = catalogIconUrl(catalogAssetUrl, PROBE_ICON);
    return () => {
      cancelled = true;
    };
  }, [catalogAssetUrl]);
  return useMemo(() => (catalogAssetUrl && available ? (icon) => catalogIconUrl(catalogAssetUrl, icon) : NO_ICONS), [catalogAssetUrl, available]);
}

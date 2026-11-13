// Signal, group and quality icons, served by the main process through face-asset://: rendered from the user's installation of
// the game, or bundled files. Neither may be there, so one well-known icon is probed first; without it every icon URL is
// undefined and the views fall back to names.
import { iconPath } from "@face/catalog";
import { useEffect, useMemo, useState } from "react";

export type CatalogIconUrl = (icon: string) => string | undefined;

/** `probing` until the probe icon has loaded or failed. */
export type CatalogIconStatus = "probing" | "available" | "missing";

export interface CatalogIcons {
  readonly iconUrl: CatalogIconUrl;
  readonly status: CatalogIconStatus;
}

const PROBE_ICON = "virtual/signal-A";
const NO_ICONS: CatalogIconUrl = () => undefined;

/**
 * The query that makes an icon URL new after the installation in use changed: an image does not fetch an unchanged URL again.
 * Empty for revision 0, the installation found at start.
 */
export function revisionQuery(revision: number): string {
  return revision > 0 ? `?r=${revision}` : "";
}

export function catalogIconUrl(catalogAssetUrl: string, icon: string, revision = 0): string {
  return iconPath(icon, `${catalogAssetUrl}icons`) + revisionQuery(revision);
}

/** Resolves once the image has loaded or failed. */
export function probeImage(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image.naturalWidth > 0);
    image.onerror = () => resolve(false);
    image.src = url;
  });
}

/** Resolver from catalog icon ids to URLs of one icon revision; it resolves nothing until the probe icon of that revision has loaded. */
export function useCatalogIcons(catalogAssetUrl: string | undefined, revision = 0): CatalogIcons {
  const probeUrl = catalogAssetUrl === undefined ? undefined : catalogIconUrl(catalogAssetUrl, PROBE_ICON, revision);
  const [probed, setProbed] = useState<{ readonly url: string; readonly available: boolean }>();
  useEffect(() => {
    if (probeUrl === undefined) return;
    let cancelled = false;
    void probeImage(probeUrl).then((available) => {
      if (!cancelled) setProbed({ url: probeUrl, available });
    });
    return () => {
      cancelled = true;
    };
  }, [probeUrl]);
  // An answer for another revision says nothing about this one.
  const status: CatalogIconStatus = probed === undefined || probed.url !== probeUrl ? "probing" : probed.available ? "available" : "missing";
  return useMemo(() => {
    const iconUrl: CatalogIconUrl = catalogAssetUrl !== undefined && status === "available" ? (icon) => catalogIconUrl(catalogAssetUrl, icon, revision) : NO_ICONS;
    return { status, iconUrl };
  }, [catalogAssetUrl, revision, status]);
}

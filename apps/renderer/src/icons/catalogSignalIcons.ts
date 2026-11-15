// Signal, group and quality icons, served by the main process through face-asset://: rendered from the user's installation of
// the game, or bundled files. Neither may be there, so one well-known icon is probed first; without it every icon URL is
// undefined and the views fall back to names. Which icons there can be at all is data of the main process (`DataInUse.icons`):
// an icon that is not among them (a mod's) has no URL either, so nothing asks for it.
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

/** Whether an icon can be drawn, as far as `drawable` says: the ids the main process draws, or null when that is not known. */
export function isDrawable(drawable: ReadonlySet<string> | null, icon: string): boolean {
  return drawable === null || drawable.has(icon);
}

/** The URLs of the icons of one revision: undefined for an icon that cannot be drawn. */
export function catalogIconResolver(catalogAssetUrl: string, revision = 0, drawable: ReadonlySet<string> | null = null): CatalogIconUrl {
  return (icon) => (isDrawable(drawable, icon) ? catalogIconUrl(catalogAssetUrl, icon, revision) : undefined);
}

/** The icon that is asked for first: the well-known one, or any other one of a game whose signal A has a mod's picture. Undefined when there is none to draw. */
export function probeIcon(drawable: ReadonlySet<string> | null): string | undefined {
  if (drawable === null || drawable.has(PROBE_ICON)) return PROBE_ICON;
  const [first] = drawable;
  return first;
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

/**
 * Resolver from catalog icon ids to URLs of one icon revision; it resolves nothing until the probe icon of that revision has
 * loaded, and never an icon that is not among `drawable` (null: not known, every icon resolves).
 */
export function useCatalogIcons(catalogAssetUrl: string | undefined, revision = 0, drawable: ReadonlySet<string> | null = null): CatalogIcons {
  const probe = probeIcon(drawable);
  const probeUrl = catalogAssetUrl === undefined || probe === undefined ? undefined : catalogIconUrl(catalogAssetUrl, probe, revision);
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
  const status = ((): CatalogIconStatus => {
    // With nothing to draw there is nothing to wait for.
    if (catalogAssetUrl !== undefined && probe === undefined) return "missing";
    // An answer for another revision says nothing about this one.
    if (probed === undefined || probed.url !== probeUrl) return "probing";
    return probed.available ? "available" : "missing";
  })();
  return useMemo(() => {
    const iconUrl: CatalogIconUrl = catalogAssetUrl !== undefined && status === "available" ? catalogIconResolver(catalogAssetUrl, revision, drawable) : NO_ICONS;
    return { status, iconUrl };
  }, [catalogAssetUrl, revision, status, drawable]);
}

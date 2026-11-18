// Signal, group and quality icons, served by the main process through face-asset://: rendered from the user's installation of
// the game and the user's mods, or bundled files. None may be there, so well-known icons are probed first; without one of them
// every icon URL is undefined and the views fall back to names. Which icons there can be at all is data of the main process
// (`DataInUse.icons`, the ids of its icon table): an icon that is not among them has no URL either, so nothing asks for it.
// One that is among them can still fail when it is asked for (a mod that is gone since the game was read): every view that
// shows an icon gives way to the name or the pictogram then (`IconImage`, the status rows, the probes of the entity icons).
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
const PROBES = 3;
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

/**
 * The icons that are asked for first: the well-known one and two more, since any one icon can be a mod's picture that does not
 * load when it is asked for. Icons are there when one of them loads. None when there is none to draw.
 */
export function probeIcons(drawable: ReadonlySet<string> | null): string[] {
  if (drawable === null) return [PROBE_ICON];
  const probes = drawable.has(PROBE_ICON) ? [PROBE_ICON] : [];
  for (const icon of drawable) {
    if (probes.length >= PROBES) break;
    if (icon !== PROBE_ICON) probes.push(icon);
  }
  return probes;
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

/** Resolves with true as soon as one of the images has loaded, with false once all have failed. */
function probeImages(urls: readonly string[]): Promise<boolean> {
  return new Promise((resolve) => {
    let pending = urls.length;
    for (const url of urls) {
      void probeImage(url).then((loaded) => {
        if (loaded) resolve(true);
        else if (--pending === 0) resolve(false);
      });
    }
  });
}

/**
 * Resolver from catalog icon ids to URLs of one icon revision; it resolves nothing until a probe icon of that revision has
 * loaded, and never an icon that is not among `drawable` (null: not known, every icon resolves).
 */
export function useCatalogIcons(catalogAssetUrl: string | undefined, revision = 0, drawable: ReadonlySet<string> | null = null): CatalogIcons {
  const probeUrls = useMemo(() => {
    return catalogAssetUrl === undefined ? undefined : probeIcons(drawable).map((icon) => catalogIconUrl(catalogAssetUrl, icon, revision));
  }, [catalogAssetUrl, revision, drawable]);
  const [probed, setProbed] = useState<{ readonly urls: readonly string[]; readonly available: boolean }>();
  useEffect(() => {
    if (probeUrls === undefined || probeUrls.length === 0) return;
    let cancelled = false;
    void probeImages(probeUrls).then((available) => {
      if (!cancelled) setProbed({ urls: probeUrls, available });
    });
    return () => {
      cancelled = true;
    };
  }, [probeUrls]);
  const status = ((): CatalogIconStatus => {
    // With nothing to draw there is nothing to wait for.
    if (probeUrls?.length === 0) return "missing";
    // An answer for another revision says nothing about this one.
    if (probed === undefined || probed.urls !== probeUrls) return "probing";
    return probed.available ? "available" : "missing";
  })();
  return useMemo(() => {
    const iconUrl: CatalogIconUrl = catalogAssetUrl !== undefined && status === "available" ? catalogIconResolver(catalogAssetUrl, revision, drawable) : NO_ICONS;
    return { status, iconUrl };
  }, [catalogAssetUrl, revision, status, drawable]);
}

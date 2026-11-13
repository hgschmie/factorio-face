// Entity icons (the game's own artwork), served by the main process through face-asset://: rendered from the user's
// installation of the game, or bundled files. Neither may be there, so every icon is probed once per icon revision;
// prototypes whose icon does not load keep the inline pictogram. This is the only use of the catalog here: the path follows
// `iconPath` of @face/catalog (`icons/<icon id>.png`), with the icon id the registry gives for a prototype (`prototypeIconId`).
import { PROTOTYPE_NAMES, type PrototypeName } from "@face/model";
import { useEffect, useMemo, useState } from "react";
import { prototypeIconId } from "../entities/registry.ts";
import { catalogIconUrl, probeImage } from "./catalogSignalIcons.ts";
import type { EntityIconResolver } from "./EntityIcon.tsx";

export function catalogEntityIconUrl(catalogAssetUrl: string, prototype: PrototypeName, revision = 0): string {
  return catalogIconUrl(catalogAssetUrl, prototypeIconId(prototype), revision);
}

/** Resolver for the icons that exist under `catalogAssetUrl` in this icon revision; undefined (pictograms everywhere) until one is found. */
export function useCatalogEntityIcons(catalogAssetUrl: string | undefined, revision = 0): EntityIconResolver | undefined {
  const [probed, setProbed] = useState<{ readonly revision: number; readonly available: ReadonlySet<PrototypeName> }>();
  useEffect(() => {
    if (!catalogAssetUrl) return;
    let cancelled = false;
    void Promise.all(PROTOTYPE_NAMES.map(async (prototype) => ((await probeImage(catalogEntityIconUrl(catalogAssetUrl, prototype, revision))) ? prototype : null))).then((found) => {
      if (!cancelled) setProbed({ revision, available: new Set(found.filter((prototype) => prototype !== null)) });
    });
    return () => {
      cancelled = true;
    };
  }, [catalogAssetUrl, revision]);
  return useMemo(() => {
    const available = probed?.revision === revision ? probed.available : undefined;
    return catalogAssetUrl && available && available.size > 0 ? (prototype) => (available.has(prototype) ? catalogEntityIconUrl(catalogAssetUrl, prototype, revision) : undefined) : undefined;
  }, [catalogAssetUrl, revision, probed]);
}

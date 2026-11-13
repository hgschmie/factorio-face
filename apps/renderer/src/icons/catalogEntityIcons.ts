// Entity icons from the generated catalog (the game's own artwork), served by the main process through face-asset://.
// The generated directory is git-ignored and may be absent, so every icon is probed once; prototypes whose icon does not
// load keep the inline pictogram. This is the only use of the catalog here: the path follows `iconPath` of @face/catalog
// (`icons/<icon id>.png`), with the icon id the registry gives for a prototype (`prototypeIconId`).
import { PROTOTYPE_NAMES, type PrototypeName } from "@face/model";
import { useEffect, useMemo, useState } from "react";
import { prototypeIconId } from "../entities/registry.ts";
import type { EntityIconResolver } from "./EntityIcon.tsx";

export function catalogEntityIconUrl(catalogAssetUrl: string, prototype: PrototypeName): string {
  return `${catalogAssetUrl}icons/${prototypeIconId(prototype)}.png`;
}

function probe(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image.naturalWidth > 0);
    image.onerror = () => resolve(false);
    image.src = url;
  });
}

/** Resolver for the icons that exist under `catalogAssetUrl`; undefined (pictograms everywhere) until one is found. */
export function useCatalogEntityIcons(catalogAssetUrl: string | undefined): EntityIconResolver | undefined {
  const [available, setAvailable] = useState<ReadonlySet<PrototypeName>>(new Set());
  useEffect(() => {
    if (!catalogAssetUrl) return;
    let cancelled = false;
    void Promise.all(PROTOTYPE_NAMES.map(async (prototype) => ((await probe(catalogEntityIconUrl(catalogAssetUrl, prototype))) ? prototype : null))).then((found) => {
      if (!cancelled) setAvailable(new Set(found.filter((prototype) => prototype !== null)));
    });
    return () => {
      cancelled = true;
    };
  }, [catalogAssetUrl]);
  return useMemo(() => (catalogAssetUrl && available.size > 0 ? (prototype) => (available.has(prototype) ? catalogEntityIconUrl(catalogAssetUrl, prototype) : undefined) : undefined), [catalogAssetUrl, available]);
}

// Entity icons from the generated catalog (the game's own artwork), served by the main process through face-asset://.
// The generated directory is git-ignored and may be absent, so every icon is probed once; kinds whose icon does not
// load keep the inline placeholder. This is the only use of the catalog here: the path follows `iconPath` of
// @face/catalog (`icons/<icon id>.png`), with the icon ids of the five entity items.
import { ENTITY_KINDS, type EntityKind } from "@face/model";
import { useEffect, useMemo, useState } from "react";
import type { EntityIconResolver } from "./EntityIcon.tsx";

const ENTITY_ICON_IDS: Readonly<Record<EntityKind, string>> = {
  constant: "item/constant-combinator",
  arithmetic: "item/arithmetic-combinator",
  decider: "item/decider-combinator",
  selector: "item/selector-combinator",
  lamp: "item/small-lamp",
  // One icon per kind for now: every pole shows the small one. Package H draws the prototype.
  pole: "item/small-electric-pole",
  speaker: "item/programmable-speaker",
};

export function catalogEntityIconUrl(catalogAssetUrl: string, kind: EntityKind): string {
  return `${catalogAssetUrl}icons/${ENTITY_ICON_IDS[kind]}.png`;
}

function probe(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image.naturalWidth > 0);
    image.onerror = () => resolve(false);
    image.src = url;
  });
}

/** Resolver for the icons that exist under `catalogAssetUrl`; undefined (placeholders everywhere) until one is found. */
export function useCatalogEntityIcons(catalogAssetUrl: string | undefined): EntityIconResolver | undefined {
  const [available, setAvailable] = useState<ReadonlySet<EntityKind>>(new Set());
  useEffect(() => {
    if (!catalogAssetUrl) return;
    let cancelled = false;
    void Promise.all(ENTITY_KINDS.map(async (kind) => ((await probe(catalogEntityIconUrl(catalogAssetUrl, kind))) ? kind : null))).then((kinds) => {
      if (!cancelled) setAvailable(new Set(kinds.filter((kind) => kind !== null)));
    });
    return () => {
      cancelled = true;
    };
  }, [catalogAssetUrl]);
  return useMemo(() => (catalogAssetUrl && available.size > 0 ? (kind) => (available.has(kind) ? catalogEntityIconUrl(catalogAssetUrl, kind) : undefined) : undefined), [catalogAssetUrl, available]);
}

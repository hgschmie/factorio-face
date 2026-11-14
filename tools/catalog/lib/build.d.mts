// Types of build.mjs for the TypeScript that imports it (single.ts, and through it the app). Only what is used from there.
import type { CatalogData } from "@face/catalog";
import type { IconEntry } from "@face/catalog/icons";

/** The dumps of one module set: `data.raw`, the runtime dump and the display names by locale section. */
export interface DumpSet {
  readonly id: string;
  readonly mods: readonly string[];
  readonly raw: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly runtime: Readonly<Record<string, unknown>>;
  readonly locale: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

export interface BuildInput {
  readonly sets: readonly DumpSet[];
  readonly modules: CatalogData["modules"];
  readonly game: CatalogData["game"];
}

export const KINDS: readonly { readonly kind: string; readonly section: string; readonly locale: string; readonly prototype: string | undefined }[];
export const LOCALE_SECTIONS: readonly string[];
export const SPEAKER_LOCALE_SECTIONS: readonly string[];

/** The catalog without its provenance, which the caller adds, and the layers of every icon id it refers to. */
export function buildCatalog(input: BuildInput): { catalog: { -readonly [K in keyof CatalogData]: K extends "provenance" ? CatalogData[K] | undefined : CatalogData[K] }; icons: Map<string, IconEntry> };

// Types of entities.mjs for the TypeScript that imports it (single.ts, and through it the app). Only what is used from there.
import type { BuildInput } from "./build.mjs";

/** The entity table as its file has it; `parseEntityTable` of `@face/model` reads it. */
export interface EntityTableFile {
  readonly schema: 1;
  readonly game: BuildInput["game"];
  readonly generator: string;
  readonly runtimeChecked: boolean;
  readonly defaults: Readonly<Record<string, unknown>>;
  readonly entities: readonly (Readonly<Record<string, unknown>> & { readonly name: string })[];
}

export interface EntityBuildOptions {
  /** Leave out what cannot be derived or what the game contradicts, and say so in the notes, instead of failing. */
  readonly lenient?: boolean;
  readonly generator?: string;
}

export function buildEntityTable(input: BuildInput, options?: EntityBuildOptions): { table: EntityTableFile; notes: string[] };
export function entityTableText(table: Readonly<Record<string, unknown>> & { readonly entities: readonly unknown[] }): string;

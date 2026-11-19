// What the blueprint book probe sends to the game in its second run: books the game itself exported in the first run, with a
// blueprint written into them by the functions of packages/blueprints (addToBook, replaceInBook) as the editor's session uses
// them: the string of the game is decoded with canonicalBlueprintString, and the blueprint is an export of a sample circuit of
// packages/blueprints/test/samples.ts. Bundled with esbuild by blueprintBookCases.mjs, because the language package is not plain
// enough for Node's type stripping.

import { addToBook, canonicalBlueprintString, exportBlueprint, replaceInBook } from "../../../packages/blueprints/src/index.ts";
import { INSTRUMENTS, sampleCircuit, SAMPLES } from "../../../packages/blueprints/test/samples.ts";

/** The sample whose export is written: four entities of four kinds, red and green wires, one of them from an entity to itself. */
export const SAMPLE = "a counter with a speaker";

/**
 * The books of the game a blueprint is written into: the book the probe filled (a blueprint, an empty slot, a blueprint, a book
 * with a blueprint, two planners), a new book, the book the game made of the one written by hand with an item in the last slot,
 * and the book with a blueprint that has every field a replacement can keep.
 */
export const EDIT_INPUTS = ["book", "empty", "last slot", "carried"] as const;
export type EditInput = (typeof EDIT_INPUTS)[number];

export interface EditSpec {
  readonly label: string;
  readonly input: EditInput;
  readonly operation: "add" | "replace";
  /** The path of the book to add to, or of the blueprint to replace. */
  readonly target: readonly number[];
  readonly keep?: boolean;
}

export const EDITS: readonly EditSpec[] = [
  { label: "add to the book", input: "book", operation: "add", target: [] },
  { label: "add to the book inside the book", input: "book", operation: "add", target: [2] },
  { label: "add to an empty book", input: "empty", operation: "add", target: [] },
  { label: "add to a book whose last slot is taken", input: "last slot", operation: "add", target: [] },
  { label: "replace", input: "book", operation: "replace", target: [1] },
  { label: "replace and keep", input: "carried", operation: "replace", target: [0], keep: true },
];

export interface EditCase extends EditSpec {
  readonly sample: string;
  /** What the function returned: the path of the written blueprint and the string of the book. */
  readonly path: readonly number[];
  readonly string: string;
}

/** Every edit applied to the string the game exported for its input. Throws when a string is none or a function refuses. */
export function editCases(strings: Readonly<Record<EditInput, string>>): EditCase[] {
  const exported = exportBlueprint(sampleCircuit(SAMPLES.find((sample) => sample.label === SAMPLE)!), { instruments: INSTRUMENTS });
  if (!exported.ok) throw new Error(`Sample '${SAMPLE}': ${exported.problems.map((problem) => problem.message).join("; ")}`);
  const { blueprint } = exported.data;
  return EDITS.map((spec) => {
    const book = canonicalBlueprintString(strings[spec.input] ?? "");
    if (!book.ok) throw new Error(`${spec.label}: the string of '${spec.input}' is none: ${book.message}`);
    const edit = spec.operation === "add" ? addToBook(book.data, spec.target, blueprint) : replaceInBook(book.data, spec.target, blueprint, { keep: spec.keep === true });
    if (!edit.ok) throw new Error(`${spec.label}: ${edit.code}: ${edit.message}`);
    return { ...spec, sample: SAMPLE, path: edit.path, string: edit.string };
  });
}

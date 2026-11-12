// Circuit fragments: some entities and the wires between them, without a circuit around them. The printed form is what a copied
// selection carries on the clipboard; `analyzeFragment` (analyze.ts) reads it back and `pasteFragment` (commands.ts) inserts it.

import type { Circuit, EntityId } from "@face/model";
import { printMembers, type PrintOptions } from "./printer.ts";

export type Fragment = Pick<Circuit, "entities" | "wires">;

/** The entities `ids` of `circuit` in declaration order, with every wire whose two ends are both among them. */
export function extractFragment(circuit: Circuit, ids: Iterable<EntityId>): Fragment {
  const wanted = new Set(ids);
  return { entities: circuit.entities.filter((e) => wanted.has(e.id)), wires: circuit.wires.filter((w) => wanted.has(w.a.entity) && wanted.has(w.b.entity)) };
}

/** Canonical text of a fragment: the declarations as they would stand in a circuit, without indentation. Empty for an empty fragment. */
export function printFragment(fragment: Fragment, options: PrintOptions = {}): string {
  const { entities, wires } = printMembers(fragment, options);
  const blocks = [...entities, ...(wires.length ? [wires.join("\n")] : [])];
  return blocks.length ? `${blocks.join("\n\n")}\n` : "";
}

/**
 * Names for copies that must not clash with `taken`. A free name is kept; a taken one loses its trailing digits and gets the
 * smallest number from 2 that makes it free (`gate` -> `gate2`, `gate2` -> `gate3`). Names that are kept are never handed out.
 */
export function uniqueNames(names: readonly string[], taken: Iterable<string>): string[] {
  const used = new Set(taken);
  const kept = names.map((name) => {
    if (used.has(name)) return false;
    used.add(name);
    return true;
  });
  return names.map((name, i) => {
    if (kept[i]) return name;
    const base = name.replace(/\d+$/, "");
    let n = 2;
    while (used.has(`${base}${n}`)) n++;
    used.add(`${base}${n}`);
    return `${base}${n}`;
  });
}

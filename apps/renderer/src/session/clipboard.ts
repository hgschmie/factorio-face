// Copy and paste of entities: what goes on the clipboard, what is accepted from it and where a pasted group lands. Pure.
import { analyzeFragment, extractFragment, printFragment, type Fragment } from "@face/language";
import type { Circuit, Entity, EntityId, Point } from "@face/model";

/** How far a pasted group moves on, right and down, while one of its entities would land exactly on an existing one. */
export const PASTE_OFFSET = 40;
/** Longer clipboard text is not looked at; this is the limit of a circuit source. */
export const CLIPBOARD_TEXT_LIMIT = 5_000_000;

/** The declarations of the entities `ids` and of the wires between them, in the circuit language. Empty when none of them exists. */
export function clipboardText(circuit: Circuit, ids: readonly EntityId[]): string {
  return printFragment(extractFragment(circuit, ids));
}

/** The entities and wires that clipboard text declares; undefined unless the whole text is valid and declares at least one entity. */
export function readClipboardText(text: string): Fragment | undefined {
  if (text.length > CLIPBOARD_TEXT_LIMIT) return undefined;
  const { fragment } = analyzeFragment(text);
  return fragment && fragment.entities.length > 0 ? fragment : undefined;
}

/**
 * By how much the positions of a pasted fragment change. With `corner` the top-left corner of the group goes there; without it
 * the group goes where it was copied from. From there it moves on by `PASTE_OFFSET` until none of its entities sits exactly on
 * an existing one, so a copy never hides its original or an earlier copy.
 */
export function pasteShift(fragment: Fragment, existing: readonly Pick<Entity, "position">[], corner?: Point): Point {
  const key = (x: number, y: number) => `${x},${y}`;
  const occupied = new Set(existing.map(({ position }) => key(position.x, position.y)));
  const origin = { x: Math.min(...fragment.entities.map((e) => e.position.x)), y: Math.min(...fragment.entities.map((e) => e.position.y)) };
  const shift = corner && fragment.entities.length > 0 ? { x: Math.round(corner.x) - origin.x, y: Math.round(corner.y) - origin.y } : { x: 0, y: 0 };
  // Ends: a copy meets a given entity at one shift at most, so there are no more rounds than pairs of the two.
  while (fragment.entities.some(({ position }) => occupied.has(key(position.x + shift.x, position.y + shift.y)))) {
    shift.x += PASTE_OFFSET;
    shift.y += PASTE_OFFSET;
  }
  return shift;
}

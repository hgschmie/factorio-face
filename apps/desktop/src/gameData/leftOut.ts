// The wired entities a read of the game left out, as data for the window. The single-set build (tools/catalog/lib/single.ts
// with entities.mjs) names each in a note, "left out: <name>: <what was found>", one note per finding; the cache file keeps
// the notes as they are. They are text made from what a game with mods said: parsed conservatively, bounded, and never
// trusted to have this form. A finding whose words are not known here is kept under `other` with its text.
import type { LeftOutEntity, LeftOutReason } from "../ipc.ts";

export const LEFT_OUT_LIMITS = { entities: 500, nameLength: 200, detailLength: 500 } as const;

const PREFIX = "left out: ";
/** A prototype name without blanks or colons, then the finding: after ": ", or with the prototype's type in brackets first. */
const NOTE = /^([^\s:]+)(?:: | (?=\())(.+)$/;
/** The findings of entities.mjs and of the entity table's reader, most specific first. */
const REASONS: readonly (readonly [RegExp, LeftOutReason])[] = [
  [/^no collision box$/, "no-collision-box"],
  [/^(?:no selection box$|selectionBox is )/, "no-selection-box"],
  [/^tile size is /, "size"],
  [/takes a circuit wire |^has a wire reach at run time, but /, "connection"],
  [/^no rotation rule /, "unknown-type"],
  [/ at run time\b/, "mismatch"],
];

const oneLine = (text: string): string => text.replace(/[\s\u0000-\u001f\u007f-\u009f]+/g, " ").trim();
const reasonOf = (detail: string): LeftOutReason => REASONS.find(([pattern]) => pattern.test(detail))?.[1] ?? "other";

/**
 * One entry per entity, in the order of the notes: the first finding decides the reason, further ones are added to the
 * detail. A note of another form is listed whole, as a name without a detail.
 */
export function leftOutEntities(notes: readonly string[]): LeftOutEntity[] {
  const entities = new Map<string, LeftOutEntity>();
  for (const note of notes) {
    if (!note.startsWith(PREFIX)) continue;
    const text = oneLine(note.slice(PREFIX.length));
    const [, parsedName, finding] = NOTE.exec(text) ?? [];
    const wellFormed = parsedName !== undefined && finding !== undefined && parsedName.length <= LEFT_OUT_LIMITS.nameLength;
    const name = wellFormed ? parsedName : text.slice(0, LEFT_OUT_LIMITS.nameLength);
    const detail = wellFormed ? finding : "";
    if (name === "") continue;
    const known = entities.get(name);
    if (known) entities.set(name, { ...known, detail: [known.detail, detail].filter((part) => part !== "").join("; ").slice(0, LEFT_OUT_LIMITS.detailLength) });
    else if (entities.size < LEFT_OUT_LIMITS.entities) entities.set(name, { name, reason: wellFormed ? reasonOf(detail) : "other", detail: detail.slice(0, LEFT_OUT_LIMITS.detailLength) });
  }
  return [...entities.values()];
}

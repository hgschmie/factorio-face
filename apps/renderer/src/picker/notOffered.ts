// The search of the signal picker in words: which signals a text finds, and what the picker says about those it finds among
// the signals it does not offer (`CatalogView.notOffered`). A title is what a mod calls itself: cut to a length, shown as text. Pure.
import { clip, count, NAMED } from "../settings/moduleList.ts";
import type { NotOfferedSignal } from "../workbench/controller.ts";
import { byTitle } from "../workbench/moduleOrder.ts";

/** Whether a search finds a signal: its name in the game or its internal name contains the text, which is in lower case. */
export function matchesSearch(entry: { readonly name: string; readonly displayName: string }, query: string): boolean {
  return entry.displayName.toLowerCase().includes(query) || entry.name.toLowerCase().includes(query);
}

/**
 * What a search says about the signals it finds that the picker does not offer, or null when it finds none: how many are of
 * groups that are switched off in the project, by the title of the group, and how many the user hid. The groups come by title,
 * `NAMED` of them at most. A signal that needs several groups that are off counts for the first one it names.
 */
export function notOfferedNote(signals: readonly NotOfferedSignal[], search: string): string | null {
  const query = search.trim().toLowerCase();
  if (query === "") return null;
  const off = new Map<string, number>();
  let hidden = 0;
  for (const entry of signals) {
    if (!matchesSearch(entry, query)) continue;
    const title = entry.switchedOff[0];
    if (title === undefined) hidden += 1;
    else off.set(title, (off.get(title) ?? 0) + 1);
  }
  const groups = [...off].sort(([a], [b]) => byTitle.compare(a, b));
  const parts: string[] = [];
  if (groups.length === 1) {
    const [title, amount] = groups[0]!;
    parts.push(`${count(amount, "signal")} of ${clip(title)} ${amount === 1 ? "matches" : "match"}. It is switched off in this project (Project Settings).`);
  } else if (groups.length > 1) {
    const named = groups.slice(0, NAMED).map(([title, amount]) => `${clip(title)} (${amount})`);
    const more = groups.length - named.length;
    parts.push(`Signals of groups that are switched off in this project match: ${named.join(", ")}${more > 0 ? ` and ${more} more` : ""}. They are switched on in the Project Settings.`);
  }
  if (hidden === 1) parts.push('1 matching signal is hidden on this machine (Project Settings, "Signals and entities" of its group).');
  else if (hidden > 1) parts.push(`${hidden} matching signals are hidden on this machine (Project Settings, "Signals and entities" of their groups).`);
  return parts.length > 0 ? parts.join(" ") : null;
}

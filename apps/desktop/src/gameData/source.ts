// Where the data in use comes from, in words. Pure: the main process and the renderer both import it at runtime, so keep it
// free of Node and Electron imports.
import type { GameDataSource } from "../ipc.ts";

/** "Built in, Factorio 2.1.24", or "Read from your game on 14 November 2026: 2.1.24 with 3 mods". */
export function describeGameDataSource(source: GameDataSource, formatDate: (iso: string) => string = (iso) => new Date(iso).toLocaleDateString(undefined, { dateStyle: "long" })): string {
  if (source.kind === "built-in") return `Built in, Factorio ${source.version}`;
  const mods = source.mods === 0 ? "without mods" : `with ${source.mods} ${source.mods === 1 ? "mod" : "mods"}`;
  return `Read from your game on ${formatDate(source.readAt)}: ${source.version} ${mods}`;
}

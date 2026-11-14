// The record of the game a project was made with (`gameMods` of face.json): when it is written, and what it says against
// the data in use. Pure.
import { STANDARD_MODULES } from "@face/catalog";
import type { GameMod, ProjectMods } from "../../../desktop/src/ipc.ts";
import type { DataInUse } from "./dataInUse.ts";

const isGameModule = (name: string): boolean => (STANDARD_MODULES as readonly string[]).includes(name);
/** Mods named in a message before it says how many more there are. */
const NAMED = 6;

/** What a save writes: the game and what it had loaded, when the data in use was read from a game with mods. Undefined otherwise, and the project's record stays as it is. */
export function modsRecord(data: DataInUse): ProjectMods | undefined {
  return data.source.kind === "game" && data.source.mods > 0 ? { gameVersion: data.source.version, mods: data.mods.map(({ name, version }) => ({ name, version })) } : undefined;
}

export interface ModsDifference {
  /** The release the project was made with, when the data in use is of another one. */
  readonly gameVersion?: { readonly project: string; readonly current: string };
  /** Mods and modules of the project that the data in use does not have. */
  readonly missing: readonly GameMod[];
  /** Mods the data in use has in another version. */
  readonly changed: readonly { readonly name: string; readonly project: string; readonly current: string }[];
}

/** What the project's game had that the data in use lacks or has differently. A module of the game counts when it is missing; its version is the game's. */
export function compareMods(record: ProjectMods, data: DataInUse): ModsDifference {
  const current = new Map(data.mods.map((mod) => [mod.name, mod.version]));
  const missing = record.mods.filter((mod) => !current.has(mod.name));
  const changed = record.mods.flatMap((mod) => {
    const version = current.get(mod.name);
    return version === undefined || version === mod.version || isGameModule(mod.name) ? [] : [{ name: mod.name, project: mod.version, current: version }];
  });
  return { ...(record.gameVersion === data.source.version ? {} : { gameVersion: { project: record.gameVersion, current: data.source.version } }), missing, changed };
}

function listed<T>(items: readonly T[], show: (item: T) => string): string {
  const more = items.length - NAMED;
  return `${items.slice(0, NAMED).map(show).join(", ")}${more > 0 ? ` and ${more} more` : ""}`;
}

/** The difference in a sentence or three for the user; null when the data in use has everything the project was made with. */
export function modsNotice(record: ProjectMods, data: DataInUse): string | null {
  const { gameVersion, missing, changed } = compareMods(record, data);
  if (!gameVersion && missing.length === 0 && changed.length === 0) return null;
  const parts = [
    ...(gameVersion ? [`It was made with Factorio ${gameVersion.project}; the data in use is of ${gameVersion.current}.`] : []),
    ...(missing.length ? [`The data in use lacks ${listed(missing, (mod) => `${mod.name} ${mod.version}`)}.`] : []),
    ...(changed.length ? [`It has ${listed(changed, (mod) => `${mod.name} ${mod.current} instead of ${mod.project}`)}.`] : []),
  ];
  return `This project was made with other game data. ${parts.join(" ")} An entity the data in use does not have is an error in the source and a signal it does not have a warning, until the game is read with those mods; the project file keeps its record of them.`;
}

/** The record in words, for the project settings: "Factorio 2.1.24 with some-mod 1.2.3, other 0.4.0". */
export function describeRecord(record: ProjectMods): string {
  const mods = record.mods.filter((mod) => !isGameModule(mod.name));
  return `Factorio ${record.gameVersion}${mods.length ? ` with ${listed(mods, (mod) => `${mod.name} ${mod.version}`)}` : ""}`;
}

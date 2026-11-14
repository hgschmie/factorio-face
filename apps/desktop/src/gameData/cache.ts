// Keeps the data read from the user's game in one file under userData, so the game is not started again at every start of
// the app. The file is the app's own, but it is read like any file: with a size limit and through `parseGameData`; a file
// that is damaged or of another format is ignored and reported, and the built-in data applies. Discarding it returns to the
// built-in data for good.
import { mkdir, rm } from "node:fs/promises";
import { dirname } from "node:path";
import type { IconTable } from "@face/catalog/icons";
import { writeFileAtomic } from "../projectStore.ts";
import { readRegularFile } from "../regularFile.ts";
import { gameDataKeyId, parseGameData, type GameData } from "./gameData.ts";

export const GAME_DATA_FILE_NAME = "game-data.json";
export const GAME_DATA_FILE_VERSION = 1;
/** The standard game makes 0.7 MB. */
export const MAX_GAME_DATA_FILE_BYTES = 128 * 1024 * 1024;

export type CachedGameData =
  /** Nothing was read from a game, or it was discarded: the built-in data applies. */
  | { readonly status: "none" }
  /** There is a file and it cannot be used: the built-in data applies, and the user is told why. */
  | { readonly status: "damaged"; readonly message: string }
  | { readonly status: "ok"; readonly data: GameData; readonly iconTable: IconTable };

export class GameDataCache {
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  /** Reads the file. Never rejects. */
  async load(): Promise<CachedGameData> {
    let bytes: Uint8Array;
    try {
      bytes = await readRegularFile(this.filePath, MAX_GAME_DATA_FILE_BYTES);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { status: "none" };
      return { status: "damaged", message: `The data read from your game cannot be used: ${error instanceof Error ? error.message : String(error)}` };
    }
    try {
      const file = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
      const fields = typeof file === "object" && file !== null ? (file as Record<string, unknown>) : {};
      if (fields.version !== GAME_DATA_FILE_VERSION) throw new Error("the file is of another format");
      const { data, iconTable } = parseGameData(fields);
      if (fields.keyId !== gameDataKeyId(data.key)) throw new Error("the file does not belong to the game it names");
      return { status: "ok", data, iconTable };
    } catch (error) {
      return { status: "damaged", message: `The data read from your game cannot be used: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  /** Replaces the file with this data, after it was accepted once more. The file is whole or the old one stays. */
  async store(data: GameData): Promise<void> {
    const accepted = parseGameData(data).data;
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFileAtomic(this.filePath, JSON.stringify({ version: GAME_DATA_FILE_VERSION, keyId: gameDataKeyId(accepted.key), ...accepted }) + "\n");
  }

  /** Removes the file, damaged or not; the built-in data applies from the next start. True when there was one. */
  async discard(): Promise<boolean> {
    try {
      await rm(this.filePath);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }
}

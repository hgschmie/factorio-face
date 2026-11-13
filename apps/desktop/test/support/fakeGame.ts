import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface FakeGame {
  readonly version?: string;
  /** Modules besides `base` and `core`. */
  readonly modules?: readonly string[];
  /** Without images the tree looks like a headless build or a copy of the Lua data. */
  readonly images?: boolean;
}

/** Writes what the app looks at in a `data` directory of the game: the info files and one signal icon. */
export async function writeGameData(dataDirectory: string, { version = "2.1.24", modules = ["space-age", "quality", "elevated-rails", "recycler"], images = true }: FakeGame = {}): Promise<string> {
  const write = async (file: string, content: string | Uint8Array): Promise<void> => {
    await mkdir(dirname(join(dataDirectory, file)), { recursive: true });
    await writeFile(join(dataDirectory, file), content);
  };
  await write("core/info.json", JSON.stringify({ name: "core", title: "Core Factorio Data", dependencies: [] }));
  for (const name of ["base", ...modules]) await write(`${name}/info.json`, JSON.stringify({ name, version, title: name, dependencies: [] }));
  if (images) await write("base/graphics/icons/signal/signal_A.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
  return dataDirectory;
}

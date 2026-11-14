import { createHash } from "node:crypto";
import { lstat, readdir, readFile, readlink } from "node:fs/promises";
import { join } from "node:path";

/** Everything below a directory: per entry its kind, size, modification time and content (a link's target), without following links. */
export async function treeSnapshot(root: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const walk = async (directory: string, prefix: string): Promise<void> => {
    for (const name of (await readdir(directory)).sort()) {
      const file = join(directory, name);
      const info = await lstat(file);
      const stamp = `${info.size} ${info.mtimeMs}`;
      if (info.isSymbolicLink()) out[prefix + name] = `link ${await readlink(file)} ${stamp}`;
      else if (info.isDirectory()) {
        out[`${prefix}${name}/`] = `directory ${info.mtimeMs}`;
        await walk(file, `${prefix}${name}/`);
      } else out[prefix + name] = `file ${stamp} ${createHash("sha256").update(await readFile(file)).digest("hex")}`;
    }
  };
  await walk(root, "");
  return out;
}

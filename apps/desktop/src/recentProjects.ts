// Recently opened projects, stored as JSON under userData.
import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { LIMITS, type LoadedProject, type RecentProject } from "./ipc.ts";
import { readProject, writeFileAtomic } from "./projectStore.ts";
import { parseProjectPath, parseRecentProjects } from "./validation.ts";

export class RecentProjects {
  private entries: RecentProject[] | undefined;

  constructor(private readonly filePath: string) {}

  async list(): Promise<readonly RecentProject[]> {
    if (!this.entries) {
      try {
        this.entries = parseRecentProjects(JSON.parse(await readFile(this.filePath, "utf8")));
      } catch {
        // Missing or corrupt file: start empty; the next change rewrites it.
        this.entries = [];
      }
    }
    return this.entries;
  }

  async add(path: string, name: string, now = new Date()): Promise<void> {
    const others = (await this.list()).filter((entry) => entry.path !== path);
    this.entries = [{ path, name, openedAt: now.toISOString() }, ...others].slice(0, LIMITS.recentProjects);
    await this.persist();
  }

  async clear(): Promise<void> {
    this.entries = [];
    await this.persist();
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFileAtomic(this.filePath, JSON.stringify(this.entries ?? [], null, 2) + "\n");
  }
}

/**
 * The project a freshly started app opens: the top of the list, which is the one opened or saved last. Null when the list is empty.
 * Rejects when that project cannot be read; an older entry never stands in for it.
 */
export async function readLastProject(recentProjects: Pick<RecentProjects, "list">): Promise<LoadedProject | null> {
  const last = (await recentProjects.list())[0];
  return last ? readProject(parseProjectPath(last.path)) : null;
}

// Recently opened projects, stored as JSON under userData.
import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { LIMITS, type RecentProject } from "./ipc.ts";
import { writeFileAtomic } from "./projectStore.ts";
import { parseRecentProjects } from "./validation.ts";

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

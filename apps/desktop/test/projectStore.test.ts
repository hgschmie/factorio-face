import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LIMITS, type ProjectData } from "../src/ipc.ts";
import { buildMenuTemplate } from "../src/menu.ts";
import { createEmptyProject, readProject, writeFileAtomic, writeProject } from "../src/projectStore.ts";
import { RecentProjects } from "../src/recentProjects.ts";
import { parseProjectData, ValidationError } from "../src/validation.ts";

// Scratch space inside the repository; never the system temp directory.
const SCRATCH_ROOT = resolve(import.meta.dirname, "../../../.cache/tmp");
let scratch: string;

beforeAll(async () => {
  await mkdir(SCRATCH_ROOT, { recursive: true });
  scratch = await mkdtemp(join(SCRATCH_ROOT, "desktop-test-"));
});
afterAll(() => rm(scratch, { recursive: true, force: true }));

const project: ProjectData = {
  manifest: { formatVersion: 1, name: "Stored", gameVersion: "2.1.24", modules: ["base"], customSignalGroups: [], circuits: ["main.face", "second.face"] },
  files: [
    { name: "main.face", source: 'circuit "Stored" {\n    // umlauts and symbols: äöü →\n}\n' },
    { name: "second.face", source: "" },
  ],
};

describe("project directory", () => {
  it("writes face.json and the circuit files and reads them back unchanged", async () => {
    const directory = join(scratch, "roundtrip");
    await writeProject(directory, project);
    expect((await readdir(directory)).sort()).toEqual(["face.json", "main.face", "second.face"]);
    expect(JSON.parse(await readFile(join(directory, "face.json"), "utf8"))).toEqual(project.manifest);
    expect(await readProject(directory)).toEqual({ path: directory, data: project });
  });

  it("keeps unknown manifest fields across read and write", async () => {
    const directory = join(scratch, "unknown-fields");
    await writeProject(directory, project);
    const onDisk = { ...project.manifest, editor: { theme: "dusk" }, revision: 7 };
    await writeFile(join(directory, "face.json"), JSON.stringify(onDisk));
    const loaded = await readProject(directory);
    expect(loaded.data.manifest.extras).toEqual({ editor: { theme: "dusk" }, revision: 7 });
    // Saved again with changed settings, as the renderer does: the unknown fields are still top-level fields of the file.
    await writeProject(directory, parseProjectData({ ...loaded.data, manifest: { ...loaded.data.manifest, modules: ["base", "quality"] } }));
    expect(JSON.parse(await readFile(join(directory, "face.json"), "utf8"))).toEqual({ ...onDisk, modules: ["base", "quality"] });
  });

  it("replaces files atomically and leaves no temporary files behind", async () => {
    const directory = join(scratch, "overwrite");
    await writeProject(directory, project);
    const changed = { ...project, files: [{ name: "main.face", source: "changed\n" }, project.files[1]!] };
    await writeProject(directory, changed);
    expect(await readFile(join(directory, "main.face"), "utf8")).toBe("changed\n");
    expect((await readdir(directory)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("removes the temporary file when the rename fails", async () => {
    const directory = join(scratch, "failed-rename");
    await mkdir(join(directory, "target"), { recursive: true });
    await writeFile(join(directory, "target", "occupied"), "x");
    // Renaming a file over a non-empty directory fails.
    await expect(writeFileAtomic(join(directory, "target"), "content")).rejects.toThrow();
    expect(await readdir(directory)).toEqual(["target"]);
  });

  it("refuses to write into a non-empty directory that is not a project, or onto a file", async () => {
    const foreign = join(scratch, "foreign");
    await mkdir(foreign);
    await writeFile(join(foreign, "notes.txt"), "mine");
    await expect(writeProject(foreign, project)).rejects.toThrow(/not empty/);
    expect(await readdir(foreign)).toEqual(["notes.txt"]);
    await expect(writeProject(join(foreign, "notes.txt"), project)).rejects.toThrow(ValidationError);
  });

  it("accepts an existing empty directory", async () => {
    const empty = join(scratch, "empty");
    await mkdir(empty);
    await writeProject(empty, project);
    expect((await readProject(empty)).data.manifest.name).toBe("Stored");
  });

  it("reports a directory without manifest, invalid JSON and invalid manifests", async () => {
    const directory = join(scratch, "broken");
    await mkdir(directory);
    await expect(readProject(directory)).rejects.toThrow(/Not a face project/);
    await writeFile(join(directory, "face.json"), "{ nope");
    await expect(readProject(directory)).rejects.toThrow(/not valid JSON/);
    await writeFile(join(directory, "face.json"), JSON.stringify({ ...project.manifest, circuits: ["../../outside.face"] }));
    await expect(readProject(directory)).rejects.toThrow(ValidationError);
    await writeFile(join(directory, "face.json"), JSON.stringify({ ...project.manifest, circuits: ["missing.face"] }));
    await expect(readProject(directory)).rejects.toThrow(/ENOENT/);
  });

  it("refuses oversized files", async () => {
    const directory = join(scratch, "oversized");
    await mkdir(directory);
    await writeFile(join(directory, "face.json"), " ".repeat(LIMITS.manifestBytes + 1));
    await expect(readProject(directory)).rejects.toThrow(/too large/);
  });

  it("does not follow a circuit entry that is a directory", async () => {
    const directory = join(scratch, "dir-entry");
    await mkdir(join(directory, "main.face"), { recursive: true });
    await writeFile(join(directory, "face.json"), JSON.stringify({ ...project.manifest, circuits: ["main.face"] }));
    await expect(readProject(directory)).rejects.toThrow(/not a regular file/);
  });

  it("creates a valid empty project", () => {
    const empty = createEmptyProject("Fresh");
    expect(parseProjectData(empty)).toEqual(empty);
    expect(empty.files[0]!.source).toBe('circuit "Fresh" {\n}\n');
    expect(empty.manifest.modules).toEqual(["base", "space-age", "quality", "recycler", "elevated-rails"]);
  });
});

describe("recent projects", () => {
  it("stores the most recent first, without duplicates, bounded and across instances", async () => {
    const file = join(scratch, "profile", "recent-projects.json");
    const recent = new RecentProjects(file);
    expect(await recent.list()).toEqual([]);
    await recent.add("/projects/a", "A", new Date("2026-11-11T10:00:00Z"));
    await recent.add("/projects/b", "B", new Date("2026-11-11T11:00:00Z"));
    await recent.add("/projects/a", "A renamed", new Date("2026-11-11T12:00:00Z"));
    expect(await recent.list()).toEqual([
      { path: "/projects/a", name: "A renamed", openedAt: "2026-11-11T12:00:00.000Z" },
      { path: "/projects/b", name: "B", openedAt: "2026-11-11T11:00:00.000Z" },
    ]);
    for (let i = 0; i < 15; i++) await recent.add(`/projects/p${i}`, `P${i}`);
    expect(await recent.list()).toHaveLength(LIMITS.recentProjects);

    const reopened = new RecentProjects(file);
    expect((await reopened.list())[0]!.path).toBe("/projects/p14");
    await reopened.clear();
    expect(await new RecentProjects(file).list()).toEqual([]);
  });

  it("starts empty when the file is corrupt", async () => {
    const file = join(scratch, "corrupt-recent.json");
    await writeFile(file, "not json");
    expect(await new RecentProjects(file).list()).toEqual([]);
  });
});

describe("application menu", () => {
  const sent: unknown[] = [];
  const template = buildMenuTemplate({
    platform: "darwin",
    developerTools: false,
    recentProjects: [{ path: "/projects/a", name: "A", openedAt: "2026-11-11T12:00:00.000Z" }],
    send: (command) => sent.push(command),
    clearRecentProjects: () => sent.push("clear"),
  });
  const submenu = (label: string) => (template.find((menu) => menu.label === label)?.submenu ?? []) as Electron.MenuItemConstructorOptions[];
  const labels = (label: string) => submenu(label).map((item) => item.label ?? item.role ?? item.type);
  const click = (items: Electron.MenuItemConstructorOptions[], label: string) => (items.find((item) => item.label === label)!.click as () => void)();

  it("has the required menus and items", () => {
    expect(template[0]!.label).toBe("FActorio Circuit Editor");
    expect(labels("File")).toEqual(["New Project", "Open Project...", "Open Recent", "separator", "Save", "Save As...", "separator", "close"]);
    expect(labels("Edit")).toEqual(["Undo", "Redo", "separator", "cut", "copy", "paste", "Delete", "Select All"]);
    expect(labels("View")).toEqual(["Circuit", "Source", "Split", "separator", "Zoom In", "Zoom Out", "Actual Size", "Fit to Content", "separator", "togglefullscreen"]);
    expect(labels("Simulation")).toEqual(["Run / Pause", "Step", "Reset"]);
  });

  it("forwards commands to the renderer", () => {
    click(submenu("File"), "Save");
    click(submenu("Edit"), "Delete");
    click(submenu("View"), "Split");
    click(submenu("Simulation"), "Step");
    const recent = submenu("File").find((item) => item.label === "Open Recent")!.submenu as Electron.MenuItemConstructorOptions[];
    click(recent, "A (/projects/a)");
    click(recent, "Clear Recent Projects");
    expect(sent).toEqual([{ id: "file.save" }, { id: "edit.delete" }, { id: "view.split" }, { id: "simulation.step" }, { id: "file.openRecent", path: "/projects/a" }, "clear"]);
  });

  it("does not bind Delete or Backspace to the Delete item, so text fields keep those keys", () => {
    expect(submenu("Edit").find((item) => item.label === "Delete")!.accelerator).toBeUndefined();
  });

  it("omits the application menu and developer tools where they do not belong", () => {
    const other = buildMenuTemplate({ platform: "linux", developerTools: true, recentProjects: [], send: () => undefined, clearRecentProjects: () => undefined });
    expect(other[0]!.label).toBe("File");
    expect((other.find((menu) => menu.label === "View")!.submenu as Electron.MenuItemConstructorOptions[]).some((item) => item.role === "toggleDevTools")).toBe(true);
    expect(((other[0]!.submenu as Electron.MenuItemConstructorOptions[]).find((item) => item.label === "Open Recent")!.submenu as Electron.MenuItemConstructorOptions[])[0]).toMatchObject({ enabled: false });
  });
});

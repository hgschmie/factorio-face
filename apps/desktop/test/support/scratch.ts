import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterAll, beforeAll } from "vitest";

// Scratch space inside the repository; never the system temp directory.
const SCRATCH_ROOT = resolve(import.meta.dirname, "../../../../.cache/tmp");

/** Registers a scratch directory for the calling test file and returns a function that names paths inside it. */
export function useScratch(prefix: string): (...segments: string[]) => string {
  let scratch = "";
  beforeAll(async () => {
    await mkdir(SCRATCH_ROOT, { recursive: true });
    scratch = await mkdtemp(join(SCRATCH_ROOT, `${prefix}-`));
  });
  afterAll(() => rm(scratch, { recursive: true, force: true }));
  return (...segments) => join(scratch, ...segments);
}

// Checks the generated icon files. They are Wube artwork and git-ignored, so this suite is skipped on a checkout where
// `npm run catalog` has not been run.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ICON_SIZE, iconPath, loadStandardCatalog } from "../src/index.ts";

const ICON_ROOT = fileURLToPath(new URL("../generated/icons", import.meta.url));
const catalog = loadStandardCatalog();

describe.skipIf(!existsSync(ICON_ROOT))("generated icon files", () => {
  const entries = [...catalog.signals, ...catalog.groups, ...catalog.qualities];
  const ids = new Set(entries.flatMap((entry) => [entry.icon, ...(entry.variants ?? []).flatMap((variant) => (typeof variant.icon === "string" ? [variant.icon] : []))]));

  it("has a 64px PNG for every icon referenced by a signal, group or quality", () => {
    expect(ids.size).toBe(1138);
    for (const id of ids) {
      const file = iconPath(id, ICON_ROOT);
      expect(existsSync(file), id).toBe(true);
      const header = readFileSync(file).subarray(0, 24);
      expect(header.toString("latin1", 1, 4), id).toBe("PNG");
      expect([header.readUInt32BE(16), header.readUInt32BE(20)], id).toEqual([ICON_SIZE, ICON_SIZE]);
    }
  });
});

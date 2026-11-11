import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sourceDir = new URL("../src/", import.meta.url);
const sources = readdirSync(sourceDir).filter((name) => name.endsWith(".ts"));

describe("package boundaries", () => {
  it("src imports only @face/model and its own modules", () => {
    expect(sources.length).toBeGreaterThan(10);
    for (const name of sources) {
      const text = readFileSync(new URL(name, sourceDir), "utf8");
      for (const match of text.matchAll(/\bfrom\s+"([^"]+)"|\bimport\s*\(\s*"([^"]+)"/g)) {
        const specifier = match[1] ?? match[2]!;
        expect(specifier === "@face/model" || /^\.\/[a-z0-9-]+\.ts$/.test(specifier), `${name} imports ${specifier}`).toBe(true);
      }
    }
  });

  it("src uses no Node, DOM or timing globals and no syntax that type stripping cannot erase", () => {
    for (const name of sources) {
      const text = readFileSync(new URL(name, sourceDir), "utf8");
      expect(text, name).not.toMatch(/\b(process|require|Buffer|window|document|navigator|globalThis|performance|Date|setTimeout|Math\.random)\b/);
      expect(text, name).not.toMatch(/^\s*(export\s+)?(const\s+)?enum\s|^\s*namespace\s|constructor\([^)]*\b(private|public|protected|readonly)\s/m);
    }
  });
});

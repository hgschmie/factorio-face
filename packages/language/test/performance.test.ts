import { describe, expect, it } from "vitest";
import { addWire, analyze, applyChanges, deleteEntities, moveEntity, renameEntity, tokenize, updateEntity } from "../src/index.ts";
import { idOf } from "./helpers.ts";

/** The prototype's scale fixture in the production language: a chain of 1,000 entities joined by 999 wires. */
function largeSource(count: number): string {
  const lines = ["// Generated scale document.", 'circuit "Scale" {', "    constant n0 at (20, 20) { virtual:signal-A = 1 }"];
  for (let i = 1; i < count; i++) {
    lines.push(`    arithmetic n${i} at (${20 + (i % 25) * 240}, ${20 + Math.floor(i / 25) * 160}) { virtual:signal-A = virtual:signal-A + ${i} } // stage ${i}`);
    lines.push(`    wire ${i % 2 ? "red" : "green"} n${i - 1}.out <-> n${i}.in`);
  }
  lines.push("}", "");
  return lines.join("\n");
}

const time = <T>(action: () => T): [T, number] => {
  const start = performance.now();
  const result = action();
  return [result, performance.now() - start];
};

describe("scale", () => {
  const source = largeSource(1000);

  it("parses and analyzes 1,000 entities and 999 wires within a generous bound", () => {
    analyze(largeSource(50));
    const [result, cold] = time(() => analyze(source));
    expect(result.diagnostics).toEqual([]);
    expect(result.circuit!.entities).toHaveLength(1000);
    expect(result.circuit!.wires).toHaveLength(999);
    expect(tokenize(source).map((t) => t.text).join("")).toBe(source);

    const samples: number[] = [];
    let previous = result;
    for (let i = 0; i < 10; i++) {
      const [next, elapsed] = time(() => analyze(source.replace("+ 500 }", `+ ${600 + i} }`), previous));
      samples.push(elapsed);
      previous = next;
    }
    samples.sort((a, b) => a - b);
    const median = samples[5]!;
    console.info(`[language performance] ${source.length} chars: cold analyze ${cold.toFixed(1)} ms, incremental re-analyze median ${median.toFixed(1)} ms, max ${samples[9]!.toFixed(1)} ms`);
    expect(previous.circuit!.entities.map((e) => e.id)).toEqual(result.circuit!.entities.map((e) => e.id));
    expect(cold).toBeLessThan(2000);
    expect(median).toBeLessThan(1000);
  });

  it("edits the large document with small patches", () => {
    const parse = analyze(source);
    const n500 = idOf(parse, "n500");
    const [changes, elapsed] = time(() => [
      moveEntity(parse, n500, { x: 0, y: 0 }),
      renameEntity(parse, n500, "renamed500"),
      deleteEntities(parse, [n500]),
      addWire(parse, "green", { entity: idOf(parse, "n0"), side: "out" }, { entity: idOf(parse, "n999"), side: "in" }),
      updateEntity(parse, n500, { ...parse.circuit!.entities[500]!, description: "edited" }),
    ]);
    console.info(`[language performance] five edit commands on the large document: ${elapsed.toFixed(1)} ms`);
    expect(changes.map((c) => c.length)).toEqual([2, 3, 2, 1, 1]);
    const renamed = analyze(applyChanges(source, changes[1]!), parse);
    expect(renamed.hasErrors).toBe(false);
    expect(renamed.circuit!.wires).toHaveLength(999);
    expect(idOf(renamed, "renamed500")).toBe(n500);
    const deleted = analyze(applyChanges(source, changes[2]!), parse);
    expect([deleted.circuit!.entities.length, deleted.circuit!.wires.length]).toEqual([999, 997]);
    expect(elapsed).toBeLessThan(1000);
  });

  it("auto-places 1,000 entities without positions quickly and without overlap", () => {
    const text = `circuit "auto" {\n${Array.from({ length: 1000 }, (_, i) => `lamp l${i} { }`).join("\n")}\n}`;
    const [result, elapsed] = time(() => analyze(text));
    const seen = new Set(result.circuit!.entities.map((e) => `${e.position.x},${e.position.y}`));
    expect(seen.size).toBe(1000);
    expect(elapsed).toBeLessThan(2000);
  });
});

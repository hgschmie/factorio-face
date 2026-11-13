import { describe, expect, it } from "vitest";
import type { Circuit, Entity } from "@face/model";
import { compile, semanticCanonicalForm, semanticFingerprint } from "../src/index.ts";
import { GREEN, RED, arithmetic, circuit, cond, constant, decider, lamp, operand, out, pole, section, selector, sig, speaker, wire } from "./helpers.ts";

const base = (): Circuit =>
  circuit(
    [
      constant("c", [section({ A: 5 }, { group: "setpoints" }), section({ B: 1 }, { multiplier: 2 })]),
      arithmetic("a", "A", "+", 1, "A"),
      decider("d", [cond("A", ">", 0), cond("B", "<", "C", { join: "and" })], [out("A")], [out("B", 2)]),
      selector("s", { operation: "select", max: true, index: operand(0), indexComparator: "=" }),
      lamp("l", { condition: { first: sig("A"), comparator: ">", second: { type: "constant", value: 0 } }, color: { r: 1, g: 2, b: 3 } }),
    ],
    [wire("red", "c.out", "a.in"), wire("green", "a.out", "d.in"), wire("red", "d.out", "s.in"), wire("red", "s.out", "l.in")],
  );

const edit = (id: string, change: (entity: Entity) => Entity): Circuit => {
  const c = base();
  return { ...c, entities: c.entities.map((e) => (e.id === id ? change(e) : e)) };
};
const fingerprint = semanticFingerprint(base());

describe("semantic fingerprint", () => {
  it("is a stable short string", () => {
    expect(fingerprint).toMatch(/^s1-[0-9a-f]{32}$/);
    expect(semanticFingerprint(base())).toBe(fingerprint);
    expect(compile(base()).fingerprint).toBe(fingerprint);
  });

  it("ignores positions, placement, descriptions, entity names, the circuit name and section group names", () => {
    const c = base();
    const moved: Circuit = {
      name: "renamed",
      entities: c.entities.map((e, i) => ({ ...e, name: `other-${i}`, position: { x: i * 10, y: -i }, placement: { tile: { x: i, y: i }, direction: "south" }, description: "note" })),
      wires: c.wires,
    };
    expect(semanticFingerprint(moved)).toBe(fingerprint);
    expect(semanticFingerprint(edit("c", (e) => (e.kind === "constant" ? { ...e, sections: e.sections.map((s) => ({ ...s, group: "renamed" })) } : e)))).toBe(fingerprint);
  });

  it("ignores entity order, wire order, wire direction and duplicate wires", () => {
    const c = base();
    const shuffled: Circuit = { name: c.name, entities: [...c.entities].reverse(), wires: [...c.wires, c.wires[0]!].reverse().map((w) => ({ color: w.color, a: w.b, b: w.a })) };
    expect(semanticFingerprint(shuffled)).toBe(fingerprint);
  });

  it("treats normal quality and absent quality as the same signal and ignores the first condition's join", () => {
    expect(semanticFingerprint(edit("a", (e) => (e.kind === "arithmetic" ? { ...e, output: { kind: "virtual", name: "signal-A", quality: "normal" } } : e)))).toBe(fingerprint);
    expect(semanticFingerprint(edit("d", (e) => (e.kind === "decider" ? { ...e, conditions: e.conditions.map((c, i) => (i === 0 ? { ...c, join: "and" } : c)) } : e)))).toBe(fingerprint);
  });

  it("changes with every simulation-relevant edit", () => {
    const c = base();
    const variants: Circuit[] = [
      { ...c, wires: c.wires.slice(1) },
      { ...c, wires: [...c.wires, wire("green", "c.out", "a.in")] },
      { ...c, wires: c.wires.map((w, i) => (i === 0 ? { ...w, color: "green" } : w)) },
      { ...c, entities: c.entities.slice(1) },
      { ...c, entities: c.entities.map((e) => (e.id === "a" ? { ...e, id: "a2" } : e)) },
      edit("c", (e) => ({ ...e, enabled: false }) as Entity),
      edit("c", (e) => (e.kind === "constant" ? { ...e, sections: [section({ A: 6 }), e.sections[1]!] } : e)),
      edit("c", (e) => (e.kind === "constant" ? { ...e, sections: e.sections.map((s) => ({ ...s, multiplier: 3 })) } : e)),
      edit("c", (e) => (e.kind === "constant" ? { ...e, sections: e.sections.map((s) => ({ ...s, active: false })) } : e)),
      edit("a", () => arithmetic("a", "A", "-", 1, "A")),
      edit("a", () => arithmetic("a", "A", "+", 2, "A")),
      edit("a", () => arithmetic("a", "A", "+", 1, "B")),
      edit("a", () => arithmetic("a", "A", "+", 1)),
      edit("a", () => arithmetic("a", operand("A", RED), "+", 1, "A")),
      edit("a", () => arithmetic("a", "A", "+", 1, sig("virtual:signal-A@rare"))),
      edit("d", (e) => (e.kind === "decider" ? { ...e, conditions: e.conditions.map((x) => ({ ...x, join: "or" as const })) } : e)),
      edit("d", (e) => (e.kind === "decider" ? { ...e, conditions: e.conditions.map((x) => ({ ...x, comparator: "=" as const })) } : e)),
      edit("d", (e) => (e.kind === "decider" ? { ...e, conditions: e.conditions.map((x) => ({ ...x, firstNetworks: GREEN })) } : e)),
      edit("d", (e) => (e.kind === "decider" ? { ...e, outputs: [out("A", 1)] } : e)),
      edit("d", (e) => (e.kind === "decider" ? { ...e, outputs: [out("A", "input", RED)] } : e)),
      edit("d", (e) => (e.kind === "decider" ? { ...e, elseOutputs: [] } : e)),
      edit("s", () => selector("s", { operation: "select", max: false, index: operand(0), indexComparator: "=" })),
      edit("s", () => selector("s", { operation: "select", max: true, index: operand(0), indexComparator: "<" })),
      edit("s", () => selector("s", { operation: "random", interval: 5 })),
      edit("s", () => selector("s", { operation: "random", interval: 6 })),
      edit("s", () => selector("s", { operation: "quality-filter", comparator: ">", quality: "rare" })),
      edit("s", () => selector("s", { operation: "quality-transfer", source: { type: "quality", quality: "rare" }, destination: sig("A") })),
      edit("s", () => selector("s", { operation: "quality-transfer", source: { type: "signal", signal: sig("B") }, destination: sig("A") })),
      edit("s", () => selector("s", { operation: "time", gameTick: sig("T") })),
      edit("s", () => selector("s", { operation: "time", dayTick: sig("T") })),
      edit("l", (e) => ({ ...e, alwaysOn: true }) as Entity),
      edit("l", (e) => ({ ...e, useColors: true }) as Entity),
      edit("l", (e) => ({ ...e, colorMode: "components" }) as Entity),
      edit("l", (e) => ({ ...e, color: { r: 1, g: 2, b: 4 } }) as Entity),
      edit("l", (e) => ({ ...e, inputNetworks: RED }) as Entity),
      edit("l", (e) => ({ ...e, condition: undefined }) as Entity),
      edit("l", (e) => ({ ...e, rgbSignal: sig("A") }) as Entity),
    ];
    const fingerprints = variants.map(semanticFingerprint);
    expect(new Set([fingerprint, ...fingerprints]).size).toBe(variants.length + 1);
  });

  it("exposes the exact canonical form behind the hash", () => {
    const form = semanticCanonicalForm(base());
    expect(form).not.toContain("setpoints");
    expect(form).not.toContain("position");
    expect(JSON.parse(form)).toHaveLength(2);
    expect(semanticCanonicalForm(circuit([]))).toBe("[[],[]]");
  });

  it("ignores which pole a pole is, and changes with the wires on it", () => {
    const relay = (prototype: Parameters<typeof pole>[1], wires = [wire("red", "c.out", "p"), wire("red", "p", "l.in")]): Circuit => circuit([constant("c", [section({ A: 1 })]), pole("p", prototype), lamp("l")], wires);
    const small = semanticFingerprint(relay("small-electric-pole"));
    expect(semanticFingerprint(relay("big-electric-pole"))).toBe(small);
    expect(semanticFingerprint(relay("substation"))).toBe(small);
    expect(semanticFingerprint(relay("small-electric-pole", [wire("red", "c.out", "p")]))).not.toBe(small);
    expect(semanticFingerprint(relay("small-electric-pole", [wire("green", "c.out", "p"), wire("red", "p", "l.in")]))).not.toBe(small);
    expect(semanticCanonicalForm(relay("substation"))).toContain('["p","pole"]');
  });

  it("changes with what a speaker plays and when, not with how the sound is heard", () => {
    const condition = { first: sig("A"), comparator: ">" as const, second: { type: "constant" as const, value: 0 } };
    const of = (props: Parameters<typeof speaker>[1]): string => semanticFingerprint(circuit([speaker("s", { condition, ...props })]));
    const plain = of({});
    const relevant: Parameters<typeof speaker>[1][] = [
      { condition: { ...condition, comparator: "<" } },
      { condition: undefined },
      { condition: undefined, pitchSignal: sig("A") },
      { instrument: "piano" },
      { note: "F3" },
      { volume: 50 },
      { volumeSignal: sig("V") },
      { showAlert: true },
    ];
    for (const props of relevant) expect(of(props), JSON.stringify(props)).not.toBe(plain);
    expect(new Set(relevant.map(of)).size).toBe(relevant.length);
    for (const props of [{ playbackMode: "global" }, { allowPolyphony: true }, { stopPlayingSounds: true }, { showOnMap: false }, { alertMessage: "text" }, { alertIcon: sig("A") }] as const) expect(of(props), JSON.stringify(props)).toBe(plain);
  });
});

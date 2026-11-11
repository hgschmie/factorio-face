import { describe, expect, it } from "vitest";
import type { Comparator, Lamp, SignalId } from "@face/model";
import { MAPPING_COLORS, colorComponent, unpackRgb } from "../src/lamp.ts";
import { ANYTHING, EVERYTHING, GREEN, RED, arithmetic, circuit, constant, lamp, lampState, sig, simulate, wire } from "./helpers.ts";

const when = (first: string | SignalId | undefined, comparator: Comparator, second: number | string): Lamp["condition"] => ({
  ...(first !== undefined && { first: sig(first) }),
  comparator,
  second: typeof second === "number" ? { type: "constant", value: second } : { type: "signal", signal: sig(second) },
});
const ON = { lit: true };
const OFF = { lit: false };

describe("lamp lighting", () => {
  it("F-21 assumption: without circuit control a lamp is lit only when always-on (no day/night cycle)", () => {
    expect(lampState(lamp("l"))).toEqual(OFF);
    expect(lampState(lamp("l", { alwaysOn: true }))).toEqual(ON);
    expect(lampState(lamp("l"), { red: { A: 5 } })).toEqual(OFF);
    expect(lampState(lamp("l", { alwaysOn: true }), { red: { A: 5 } })).toEqual(ON);
  });

  it("F-21 assumption: a wired lamp with an enable condition follows the condition, regardless of always-on", () => {
    expect(lampState(lamp("l", { condition: when("A", ">", 0) }), { red: { A: 5 } })).toEqual(ON);
    expect(lampState(lamp("l", { condition: when("A", ">", 9) }), { red: { A: 5 } })).toEqual(OFF);
    expect(lampState(lamp("l", { condition: when("A", ">", 9), alwaysOn: true }), { red: { A: 5 } })).toEqual(OFF);
    expect(lampState(lamp("l", { condition: when("A", "<", "B") }), { red: { A: 5 }, green: { B: 6 } })).toEqual(ON);
  });

  it("F-21 assumption: an enable condition is ignored while the lamp has no wire", () => {
    expect(lampState(lamp("l", { condition: when("A", "=", 0) }))).toEqual(OFF);
    expect(lampState(lamp("l", { condition: when("A", ">", 0), alwaysOn: true }))).toEqual(ON);
  });

  it("F-21 assumption: the default condition (no first signal) is false", () => {
    expect(lampState(lamp("l", { condition: when(undefined, "<", 0) }), { red: { A: 5 } })).toEqual(OFF);
    expect(lampState(lamp("l", { condition: when(undefined, "=", 0), alwaysOn: true }), { red: { A: 5 } })).toEqual(OFF);
  });

  it("F-21 assumption: everything and anything work in the enable condition as in a decider", () => {
    const feed = { red: { A: 5, B: 9 } };
    expect(lampState(lamp("l", { condition: when(EVERYTHING, ">", 4) }), feed)).toEqual(ON);
    expect(lampState(lamp("l", { condition: when(EVERYTHING, ">", 5) }), feed)).toEqual(OFF);
    expect(lampState(lamp("l", { condition: when(ANYTHING, ">", 8) }), feed)).toEqual(ON);
    expect(lampState(lamp("l", { condition: when(ANYTHING, ">", 9) }), feed)).toEqual(OFF);
    expect(lampState(lamp("l", { condition: when(EVERYTHING, "<", "B") }), feed)).toEqual(ON);
    expect(lampState(lamp("l", { condition: when(EVERYTHING, ">", 0), inputNetworks: GREEN }), feed)).toEqual(ON);
    expect(lampState(lamp("l", { condition: when(ANYTHING, ">", 0), inputNetworks: GREEN }), feed)).toEqual(OFF);
  });

  it("F-22 assumption: the input network selection scopes the condition", () => {
    const feed = { red: { A: 5 }, green: { A: -5 } };
    expect(lampState(lamp("l", { condition: when("A", "=", 0) }), feed)).toEqual(ON);
    expect(lampState(lamp("l", { condition: when("A", "=", 5), inputNetworks: RED }), feed)).toEqual(ON);
    expect(lampState(lamp("l", { condition: when("A", "=", -5), inputNetworks: GREEN }), feed)).toEqual(ON);
    expect(lampState(lamp("l", { condition: when("A", "=", 0), inputNetworks: { red: false, green: false } }), feed)).toEqual(ON);
  });

  it("F-21 assumption: a lamp reacts in the same tick as its network and emits nothing", () => {
    const c = circuit([constant("c", { A: 1 }), arithmetic("n", "A", "+", 0, "A"), lamp("l", { condition: when("A", ">=", 3) })], [wire("red", "c.out", "n.in"), wire("green", "n.out", "n.in"), wire("green", "n.out", "l.in")]);
    const simulation = simulate(c);
    const states = [0, 1, 2, 3, 4].map((tick) => (tick > 0 && simulation.step(), [simulation.probe({ type: "terminal", entity: "l", side: "in" }, "virtual:signal-A"), simulation.snapshot().entities.l!.lamp!.lit]));
    expect(states).toEqual([[0, false], [1, false], [2, false], [3, true], [4, true]]);
    expect(simulation.snapshot().entities.l).not.toHaveProperty("output");
  });

  it("an invalid lamp stays dark", () => {
    expect(lampState(lamp("l", { condition: when("each", ">", 0), alwaysOn: true }), { red: { A: 5 } })).toEqual(OFF);
  });
});

describe("lamp colors", () => {
  const lit = { alwaysOn: true, useColors: true } as const;

  it("documented: the static color is shown while lit; a dark lamp has no color", () => {
    expect(lampState(lamp("l", { alwaysOn: true, color: { r: 255, g: 128, b: 0 } }))).toEqual({ lit: true, color: { r: 255, g: 128, b: 0 } });
    expect(lampState(lamp("l", { color: { r: 255, g: 128, b: 0 } }))).toEqual(OFF);
  });

  it("documented: color mapping uses the prototype's table", () => {
    expect(MAPPING_COLORS.map(([name]) => name)).toEqual(["signal-red", "signal-green", "signal-blue", "signal-yellow", "signal-pink", "signal-cyan", "signal-white", "signal-grey", "signal-black"]);
    for (const [name, color] of MAPPING_COLORS) expect(lampState(lamp("l", lit), { red: { [`virtual:${name}`]: 1 } }), name).toEqual({ lit: true, color });
    expect(lampState(lamp("l", lit), { red: { "virtual:signal-grey": 1 } }).color).toEqual({ r: 128, g: 128, b: 128 });
  });

  it("F-22 assumption: with several color signals the first positive one in mapping order wins", () => {
    const state = (values: Record<string, number>) => lampState(lamp("l", lit), { red: Object.fromEntries(Object.entries(values).map(([k, n]) => [`virtual:signal-${k}`, n])) }).color;
    expect(state({ green: 5, red: 1, blue: 9 })).toEqual({ r: 255, g: 0, b: 0 });
    expect(state({ cyan: 1, yellow: 1 })).toEqual({ r: 255, g: 255, b: 0 });
    expect(state({ red: -1, blue: 1 })).toEqual({ r: 0, g: 0, b: 255 });
    expect(state({ red: 0, black: 1 })).toEqual({ r: 0, g: 0, b: 0 });
  });

  it("F-22 assumption: without a positive color signal the lamp shows its static color, or the default light", () => {
    expect(lampState(lamp("l", lit), { red: { A: 5 } })).toEqual(ON);
    expect(lampState(lamp("l", { ...lit, color: { r: 1, g: 2, b: 3 } }), { red: { "virtual:signal-red": -4 } })).toEqual({ lit: true, color: { r: 1, g: 2, b: 3 } });
    expect(lampState(lamp("l", { ...lit, color: { r: 1, g: 2, b: 3 } }), { red: { "virtual:signal-red": 1 } }).color).toEqual({ r: 255, g: 0, b: 0 });
  });

  it("F-22 assumption: color signals of a quality other than normal do not count", () => {
    expect(lampState(lamp("l", lit), { red: { "virtual:signal-red@rare": 1 } })).toEqual(ON);
  });

  it("F-22 assumption: use-colors only applies when enabled; the condition still decides whether the lamp is lit", () => {
    expect(lampState(lamp("l", { alwaysOn: true }), { red: { "virtual:signal-red": 1 } })).toEqual(ON);
    expect(lampState(lamp("l", { useColors: true, condition: when("A", ">", 0) }), { red: { "virtual:signal-red": 1 } })).toEqual(OFF);
    expect(lampState(lamp("l", { useColors: true, condition: when("A", ">", 0) }), { red: { "virtual:signal-green": 1, A: 1 } })).toEqual({ lit: true, color: { r: 0, g: 255, b: 0 } });
  });

  it("documented: components mode reads red, green and blue from the default or configured signals", () => {
    const components = { ...lit, colorMode: "components" } as const;
    expect(lampState(lamp("l", components), { red: { "virtual:signal-red": 10, "virtual:signal-green": 20, "virtual:signal-blue": 30 } }).color).toEqual({ r: 10, g: 20, b: 30 });
    expect(lampState(lamp("l", { ...components, redSignal: sig("A"), greenSignal: sig("B"), blueSignal: sig("item:iron-plate") }), { red: { A: 1, B: 2, "item:iron-plate": 3, "virtual:signal-red": 99 } }).color).toEqual({ r: 1, g: 2, b: 3 });
    expect(lampState(lamp("l", components), { red: { "virtual:signal-blue": 255 } }).color).toEqual({ r: 0, g: 0, b: 255 });
  });

  it("F-22 assumption: components outside 0..255 are clamped", () => {
    expect([-1, 0, 255, 256, 2147483647, -2147483648].map(colorComponent)).toEqual([0, 0, 255, 255, 255, 0]);
    const components = { ...lit, colorMode: "components" } as const;
    expect(lampState(lamp("l", components), { red: { "virtual:signal-red": 256, "virtual:signal-green": -1, "virtual:signal-blue": 128 } }).color).toEqual({ r: 255, g: 0, b: 128 });
    expect(lampState(lamp("l", components), { red: { "virtual:signal-red": -5 } }).color).toEqual({ r: 0, g: 0, b: 0 });
  });

  it("F-22 assumption: packed RGB is 0xRRGGBB on the rgb signal; bits above 23 are ignored and 0 means no color", () => {
    expect(unpackRgb(0x123456)).toEqual({ r: 0x12, g: 0x34, b: 0x56 });
    expect(unpackRgb(0xffffff)).toEqual({ r: 255, g: 255, b: 255 });
    expect(unpackRgb(0x1000000)).toEqual({ r: 0, g: 0, b: 0 });
    expect(unpackRgb(-1)).toEqual({ r: 255, g: 255, b: 255 });
    expect(unpackRgb(255)).toEqual({ r: 0, g: 0, b: 255 });
    const packed = { ...lit, colorMode: "packed-rgb" } as const;
    expect(lampState(lamp("l", packed), { red: { "virtual:signal-white": 0xff8000 } }).color).toEqual({ r: 255, g: 128, b: 0 });
    expect(lampState(lamp("l", { ...packed, rgbSignal: sig("A") }), { red: { A: 0x0000ff, "virtual:signal-white": 0xff0000 } }).color).toEqual({ r: 0, g: 0, b: 255 });
    expect(lampState(lamp("l", { ...packed, color: { r: 9, g: 9, b: 9 } }), { red: { A: 1 } }).color).toEqual({ r: 9, g: 9, b: 9 });
  });

  it("F-22 assumption: the input network selection scopes the color signals", () => {
    const feed = { red: { "virtual:signal-red": 1 }, green: { "virtual:signal-blue": 1 } };
    expect(lampState(lamp("l", lit), feed).color).toEqual({ r: 255, g: 0, b: 0 });
    expect(lampState(lamp("l", { ...lit, inputNetworks: GREEN }), feed).color).toEqual({ r: 0, g: 0, b: 255 });
    expect(lampState(lamp("l", { ...lit, inputNetworks: RED }), { red: { "virtual:signal-red": 1 }, green: { "virtual:signal-red": -1 } }).color).toEqual({ r: 255, g: 0, b: 0 });
    expect(lampState(lamp("l", lit), { red: { "virtual:signal-red": 1 }, green: { "virtual:signal-red": -1 } })).toEqual(ON);
  });

  it("keeps the lamp state object while nothing changes", () => {
    const c = circuit([constant("c", { "virtual:signal-red": 1 }), arithmetic("n", "A", "+", 1, "A"), lamp("l", lit)], [wire("red", "c.out", "l.in"), wire("green", "n.out", "n.in"), wire("green", "n.out", "l.in")]);
    const simulation = simulate(c, 1);
    const before = simulation.snapshot().entities.l!;
    simulation.step();
    const after = simulation.snapshot().entities.l!;
    expect(after.lamp).toBe(before.lamp);
    expect(after.input).not.toBe(before.input);
  });
});

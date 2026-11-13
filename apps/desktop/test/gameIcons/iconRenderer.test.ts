import type { IconLayer } from "@face/catalog/icons";
import { describe, expect, it } from "vitest";
import { iconSource, renderIcon, renderIconPng } from "../../src/gameIcons/iconRenderer.ts";
import { COMPACT_ENCODING, decodePng, encodePng, type RgbaImage } from "../../src/gameIcons/png.ts";

const pixel = (image: RgbaImage, x: number, y: number): number[] => [...image.data.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4)];
const filled = (width: number, height: number, color: (x: number, y: number) => number[]): RgbaImage => {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set(color(i % width, Math.floor(i / width)), i * 4);
  return { width, height, data };
};

// 4x4 opaque red with a 2x2 mip level to its right, and a 4x4 half-transparent white.
const red = iconSource(filled(6, 4, (x) => (x < 4 ? [255, 0, 0, 255] : [0, 255, 0, 255])), 4);
const white = iconSource(filled(4, 4, () => [255, 255, 255, 128]), 4);
const layer = (icon: string, more: Partial<IconLayer> = {}): IconLayer => ({ icon: `__base__/${icon}.png`, size: 4, ...more });

describe("icon sources", () => {
  it("crops the first mip level and premultiplies it", () => {
    const source = iconSource(filled(6, 4, (x, y) => (x < 4 ? [255, 51, 0, y === 0 ? 255 : 51] : [0, 255, 0, 255])), 4);
    expect(source).toHaveLength(64);
    expect([...source.subarray(0, 4)]).toEqual([1, 0.2, 0, 1]);
    expect([...source.subarray(16, 20)].map((v) => Math.round(v * 1000) / 1000)).toEqual([0.2, 0.04, 0, 0.2]);
    // Nothing of the second mip level is taken.
    for (let i = 0; i < 16; i++) expect(source[i * 4 + 2]).toBe(0);
  });

  it("refuses an image that is smaller than the icon size", () => {
    expect(() => iconSource(filled(6, 4, () => [0, 0, 0, 0]), 8)).toThrow(RangeError);
    expect(() => iconSource(filled(8, 4, () => [0, 0, 0, 0]), 8)).toThrow(RangeError);
  });
});

describe("icon renderer", () => {
  it("uses the first mip level and scales it to the output size", () => {
    const image = renderIcon([layer("red")], [red], { expected: 4, output: 8 });
    expect([image.width, image.height]).toEqual([8, 8]);
    expect(pixel(image, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(pixel(image, 7, 7)).toEqual([255, 0, 0, 255]);
  });

  it("composites scaled, shifted and tinted layers in order", () => {
    const layers = [layer("red"), layer("white", { scale: 0.25, shift: [0.5, 0.5], tint: [0, 0, 1, 1] })];
    const image = renderIcon(layers, [red, white], { expected: 4, output: 8 });
    expect(pixel(image, 1, 1)).toEqual([255, 0, 0, 255]);
    // Bottom-right quadrant: blue-tinted white at about 50% over red.
    const [r, g, b, a] = pixel(image, 6, 6);
    expect(a).toBe(255);
    expect(g).toBe(0);
    expect(Math.abs((r ?? 0) - 127)).toBeLessThanOrEqual(1);
    expect(Math.abs((b ?? 0) - 128)).toBeLessThanOrEqual(1);
  });

  it("lets the alpha of a tint scale the coverage of its layer", () => {
    const image = renderIcon([layer("red", { tint: [1, 1, 1, 0.5] })], [red], { expected: 4, output: 4 });
    expect(pixel(image, 2, 2)).toEqual([255, 0, 0, 128]);
  });

  it("defaults to 64 pixels for a prototype that expects 64", () => {
    const source = iconSource(filled(120, 64, (x) => (x < 64 ? [0, 0, 255, 255] : [0, 0, 0, 0])), 64);
    const image = renderIcon([{ icon: "__base__/blue.png", size: 64 }], [source]);
    expect([image.width, image.height]).toEqual([64, 64]);
    expect(image.data.every((value, index) => value === [0, 0, 255, 255][index % 4])).toBe(true);
  });

  it("fills the slot with a group icon whose expected size is 128", () => {
    const source = iconSource(filled(128, 128, (x, y) => (x < 64 && y < 64 ? [255, 0, 0, 255] : [0, 0, 255, 255])), 128);
    const group = renderIcon([{ icon: "__base__/group.png", size: 128 }], [source], { expected: 128, output: 64 });
    expect(pixel(group, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(pixel(group, 31, 31)).toEqual([255, 0, 0, 255]);
    expect(pixel(group, 32, 32)).toEqual([0, 0, 255, 255]);
    expect(pixel(group, 63, 63)).toEqual([0, 0, 255, 255]);
    // The same layer in a 64 slot with the scale a 128 slot implies would be drawn at twice the slot and shrunk to fit.
    const explicit = renderIcon([{ icon: "__base__/group.png", size: 128, scale: 0.5 }], [source], { expected: 128, output: 64 });
    expect([...explicit.data]).toEqual([...group.data]);
  });

  it("shrinks the whole icon when a layer would leave the slot", () => {
    // The layer is as wide as the slot (2 units) and shifted right by half a unit: reach 1.5 against 1, so everything shrinks to
    // two thirds, the shift included. 8 of 12 pixels wide, from the fifth column to the right edge.
    const image = renderIcon([layer("red", { shift: [0.5, 0] })], [red], { expected: 4, output: 12 });
    const opaque = (x: number, y: number): boolean => pixel(image, x, y)[3] === 255;
    expect(opaque(3, 6)).toBe(false);
    expect(opaque(4, 6)).toBe(true);
    expect(opaque(11, 6)).toBe(true);
    expect(opaque(6, 1)).toBe(false);
    expect(opaque(6, 2)).toBe(true);
    expect(opaque(6, 9)).toBe(true);
    expect(opaque(6, 10)).toBe(false);
  });

  it("does not shrink for a floating layer, which is clipped instead", () => {
    const image = renderIcon([layer("red"), layer("white", { shift: [1, 1], floating: true })], [red, white], { expected: 4, output: 8 });
    expect(pixel(image, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(pixel(image, 3, 3)).toEqual([255, 0, 0, 255]);
    const [r, g, b, a] = pixel(image, 7, 7);
    expect(a).toBe(255);
    expect(r).toBe(255);
    expect(Math.abs((g ?? 0) - 128)).toBeLessThanOrEqual(1);
    expect(b).toBe(g);
  });

  it("leaves pixels without coverage fully transparent", () => {
    const image = renderIcon([layer("red", { scale: 0.25 })], [red], { expected: 4, output: 8 });
    expect(pixel(image, 0, 0)).toEqual([0, 0, 0, 0]);
    expect(pixel(image, 4, 4)).toEqual([255, 0, 0, 255]);
  });

  it("refuses sources that do not belong to the layers, and absurd scales", () => {
    expect(() => renderIcon([layer("red")], [], { expected: 4, output: 8 })).toThrow(RangeError);
    expect(() => renderIcon([layer("red", { size: 8 })], [red], { expected: 4, output: 8 })).toThrow(RangeError);
    expect(() => renderIcon([layer("red", { scale: 4096, floating: true })], [red], { expected: 4, output: 8 })).toThrow(RangeError);
  });

  it("encodes the rendered icon", () => {
    const layers = [layer("red"), layer("white", { scale: 0.25, shift: [0.5, 0.5] })];
    const image = renderIcon(layers, [red, white], { expected: 4, output: 8 });
    expect([...decodePng(renderIconPng(layers, [red, white], { expected: 4, output: 8 })).data]).toEqual([...image.data]);
    expect([...renderIconPng(layers, [red, white], { expected: 4, output: 8 }, COMPACT_ENCODING)]).toEqual([...encodePng(image, COMPACT_ENCODING)]);
  });
});

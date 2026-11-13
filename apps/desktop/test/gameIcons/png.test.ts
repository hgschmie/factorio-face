import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { COMPACT_ENCODING, decodePng, encodePng, FAST_ENCODING, MAX_PNG_DIMENSION, PngError, type PngEncoding, type RgbaImage } from "../../src/gameIcons/png.ts";

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** One chunk; the checksum is left at zero, which the decoder does not look at. */
function chunk(type: string, body: Uint8Array | number[] = []): number[] {
  const length = new DataView(new ArrayBuffer(4));
  length.setUint32(0, body.length);
  return [...new Uint8Array(length.buffer), ...[...type].map((char) => char.charCodeAt(0)), ...body, 0, 0, 0, 0];
}

interface Header { width: number; height: number; depth?: number; colorType: number; compression?: number; filter?: number; interlace?: number }

function header({ width, height, depth = 8, colorType, compression = 0, filter = 0, interlace = 0 }: Header): number[] {
  const body = new DataView(new ArrayBuffer(13));
  body.setUint32(0, width);
  body.setUint32(4, height);
  new Uint8Array(body.buffer).set([depth, colorType, compression, filter, interlace], 8);
  return chunk("IHDR", new Uint8Array(body.buffer));
}

/** A PNG file from a header, the filtered scanlines and any chunks between the two. */
function png(fields: Header, scanlines: number[], ...extra: number[][]): Uint8Array {
  return Uint8Array.from([...SIGNATURE, ...header(fields), ...extra.flat(), ...chunk("IDAT", deflateSync(Uint8Array.from(scanlines))), ...chunk("IEND")]);
}

const sample: RgbaImage = { width: 5, height: 3, data: Uint8Array.from({ length: 60 }, (_, i) => (i * 37 + 11) % 256) };

describe("png encoder", () => {
  const single = (filter: number): PngEncoding => ({ filters: [filter], level: 6 });
  const encodings: [string, PngEncoding][] = [["fast", FAST_ENCODING], ["compact", COMPACT_ENCODING], ["sub", single(1)], ["up", single(2)], ["paeth", single(4)]];
  it.each(encodings)("round-trips RGBA images with the %s encoding", (_, encoding) => {
    const decoded = decodePng(encodePng(sample, encoding));
    expect([decoded.width, decoded.height]).toEqual([5, 3]);
    expect([...decoded.data]).toEqual([...sample.data]);
  });

  it("keeps the smallest of the filters it is given", () => {
    const gradient: RgbaImage = { width: 64, height: 64, data: Uint8Array.from({ length: 64 * 64 * 4 }, (_, i) => (i % 4 === 3 ? 255 : (i >> 2) % 64 * 4)) };
    const sizes = [0, 1, 2, 4].map((filter) => encodePng(gradient, { filters: [filter], level: 9 }).length);
    expect(encodePng(gradient, COMPACT_ENCODING).length).toBe(Math.min(...sizes));
  });

  it("refuses images whose data does not match their size, and filters it does not know", () => {
    expect(() => encodePng({ width: 2, height: 2, data: new Uint8Array(15) })).toThrow(PngError);
    expect(() => encodePng({ width: 0, height: 2, data: new Uint8Array(0) })).toThrow(PngError);
    expect(() => encodePng(sample, { filters: [3], level: 1 })).toThrow(PngError);
    expect(() => encodePng(sample, { filters: [], level: 1 })).toThrow(PngError);
  });
});

describe("png decoder", () => {
  it("decodes the colour types the game uses", () => {
    // Two pixels each: filter byte, then the samples.
    expect([...decodePng(png({ width: 2, height: 1, colorType: 6 }, [0, 1, 2, 3, 4, 5, 6, 7, 8])).data]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect([...decodePng(png({ width: 2, height: 1, colorType: 4 }, [0, 10, 20, 30, 40])).data]).toEqual([10, 10, 10, 20, 30, 30, 30, 40]);
    const palette = chunk("PLTE", [255, 0, 0, 0, 255, 0, 0, 0, 255]);
    expect([...decodePng(png({ width: 3, height: 1, colorType: 3 }, [0, 2, 0, 1], palette, chunk("tRNS", [128, 64]))).data]).toEqual([0, 0, 255, 255, 255, 0, 0, 128, 0, 255, 0, 64]);
    expect([...decodePng(png({ width: 1, height: 1, colorType: 2 }, [0, 7, 8, 9])).data]).toEqual([7, 8, 9, 255]);
    expect([...decodePng(png({ width: 1, height: 1, colorType: 0 }, [0, 7])).data]).toEqual([7, 7, 7, 255]);
  });

  it("reverses every row filter", () => {
    // 2x2 gray with alpha, two bytes per pixel. Row 1 uses Sub and decodes to 10 20 | 10 20; row 2 in turn Up, Average and Paeth.
    const rows: [number, number[]][] = [[2, [60, 80, 11, 21]], [3, [55, 70, 33, 46]], [4, [60, 80, 61, 81]]];
    for (const [filter, expected] of rows) {
      const image = decodePng(png({ width: 2, height: 2, colorType: 4 }, [1, 10, 20, 0, 0, filter, 50, 60, 1, 1]));
      expect([...image.data].filter((_, i) => i % 4 === 0 || i % 4 === 3), `filter ${filter}`).toEqual([10, 20, 10, 20, ...expected]);
    }
    expect(() => decodePng(png({ width: 1, height: 1, colorType: 0 }, [5, 7]))).toThrow(/filter/);
  });

  it("joins image data that is split over several chunks", () => {
    const packed = deflateSync(Uint8Array.from([0, 1, 2, 3, 4]));
    const parts = [header({ width: 1, height: 1, colorType: 6 }), chunk("IDAT", packed.subarray(0, 3)), chunk("tEXt", [1, 2]), chunk("IDAT", packed.subarray(3)), chunk("IEND")];
    const file = Uint8Array.from([...SIGNATURE, ...parts.flat()]);
    expect([...decodePng(file).data]).toEqual([1, 2, 3, 4]);
  });

  it("rejects data that is not a PNG", () => {
    expect(() => decodePng(new Uint8Array(32))).toThrow(/Not a PNG/);
    expect(() => decodePng(new Uint8Array(0))).toThrow(/Not a PNG/);
    const jpeg = encodePng(sample).slice();
    jpeg.set([0xff, 0xd8, 0xff, 0xe0]);
    expect(() => decodePng(jpeg)).toThrow(PngError);
  });

  it("rejects every truncation of a valid file", () => {
    const file = encodePng(sample);
    for (let length = 0; length < file.length; length++) expect(() => decodePng(file.subarray(0, length)), `length ${length}`).toThrow(PngError);
    // A chunk whose declared length runs past the end of the file.
    const long = file.slice();
    new DataView(long.buffer, long.byteOffset).setUint32(8 + 25, 0xffffffff);
    expect(() => decodePng(long)).toThrow(/Truncated/);
  });

  it("fails only with PngError when bytes are damaged", () => {
    const file = encodePng(sample);
    for (let index = 0; index < file.length; index++) {
      for (const value of [0x00, 0xff, file[index]! ^ 0x55]) {
        const damaged = file.slice();
        damaged[index] = value;
        try {
          decodePng(damaged);
        } catch (error) {
          expect(error, `byte ${index} = ${value}`).toBeInstanceOf(PngError);
        }
      }
    }
  });

  it("rejects images beyond the size limit before reading their data", () => {
    const limit = MAX_PNG_DIMENSION;
    expect(() => decodePng(png({ width: limit + 1, height: 1, colorType: 6 }, [0]))).toThrow(/dimensions/);
    expect(() => decodePng(png({ width: 1, height: limit + 1, colorType: 6 }, [0]))).toThrow(/dimensions/);
    expect(() => decodePng(png({ width: 0xffffffff, height: 0xffffffff, colorType: 6 }, [0]))).toThrow(/dimensions/);
    expect(() => decodePng(png({ width: 0, height: 1, colorType: 6 }, [0]))).toThrow(/dimensions/);
    expect(() => decodePng(encodePng(sample), 4)).toThrow(/dimensions/);
    const wide: RgbaImage = { width: limit, height: 1, data: new Uint8Array(limit * 4) };
    expect(decodePng(encodePng(wide)).width).toBe(limit);
  });

  it("rejects interlaced images and formats the game does not use", () => {
    expect(() => decodePng(png({ width: 1, height: 1, colorType: 6, interlace: 1 }, [0, 1, 2, 3, 4]))).toThrow(/Interlaced/);
    expect(() => decodePng(png({ width: 1, height: 1, colorType: 6, depth: 16 }, [0, 1, 2, 3, 4, 5, 6, 7, 8]))).toThrow(/Unsupported PNG format/);
    expect(() => decodePng(png({ width: 8, height: 1, colorType: 0, depth: 1 }, [0, 0xaa]))).toThrow(/Unsupported PNG format/);
    expect(() => decodePng(png({ width: 1, height: 1, colorType: 5 }, [0, 1, 2]))).toThrow(/Unsupported PNG format/);
    expect(() => decodePng(png({ width: 1, height: 1, colorType: 6, compression: 1 }, [0, 1, 2, 3, 4]))).toThrow(/compression or filter/);
  });

  it("rejects palette images without a usable palette", () => {
    expect(() => decodePng(png({ width: 1, height: 1, colorType: 3 }, [0, 0]))).toThrow(/palette/);
    expect(() => decodePng(png({ width: 1, height: 1, colorType: 3 }, [0, 0], chunk("PLTE", [1, 2])))).toThrow(/palette/);
    expect(() => decodePng(png({ width: 1, height: 1, colorType: 3 }, [0, 1], chunk("PLTE", [1, 2, 3])))).toThrow(/outside the palette/);
  });

  it("never inflates more than the header declares", () => {
    // 64 MiB of zeros deflate to a few dozen kilobytes; the header promises one pixel.
    const bomb = Array.from(deflateSync(new Uint8Array(64 * 1024 * 1024)));
    const file = Uint8Array.from([...SIGNATURE, ...header({ width: 1, height: 1, colorType: 6 }), ...chunk("IDAT", bomb), ...chunk("IEND")]);
    expect(file.length).toBeLessThan(100_000);
    const before = process.memoryUsage().arrayBuffers;
    expect(() => decodePng(file)).toThrow(/larger than the header declares/);
    expect(process.memoryUsage().arrayBuffers - before).toBeLessThan(8 * 1024 * 1024);
  });

  it("rejects image data that is shorter than the header declares, and files without any", () => {
    expect(() => decodePng(png({ width: 2, height: 2, colorType: 6 }, [0, 1, 2, 3, 4, 5, 6, 7, 8]))).toThrow(/shorter/);
    expect(() => decodePng(Uint8Array.from([...SIGNATURE, ...header({ width: 1, height: 1, colorType: 6 }), ...chunk("IEND")]))).toThrow(/without image data/);
  });

  it("requires the header to come first and to have its fixed size", () => {
    expect(() => decodePng(Uint8Array.from([...SIGNATURE, ...chunk("IDAT", [1]), ...header({ width: 1, height: 1, colorType: 6 }), ...chunk("IEND")]))).toThrow(/header/);
    expect(() => decodePng(Uint8Array.from([...SIGNATURE, ...chunk("IHDR", [0, 0, 0, 1]), ...chunk("IEND")]))).toThrow(/header/);
    expect(() => decodePng(Uint8Array.from([...SIGNATURE, ...header({ width: 1, height: 1, colorType: 6 }), ...header({ width: 1, height: 1, colorType: 6 }), ...chunk("IEND")]))).toThrow(/header/);
  });

  it("decodes from a view into a larger buffer", () => {
    const file = encodePng(sample);
    const padded = new Uint8Array(file.length + 20);
    padded.set(file, 7);
    expect([...decodePng(padded.subarray(7, 7 + file.length)).data]).toEqual([...sample.data]);
  });
});

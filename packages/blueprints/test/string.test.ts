import { strToU8, unzlibSync, zlibSync } from "fflate";
import { describe, expect, it } from "vitest";
import { decodeBlueprintString, DEFAULT_LIMITS, encodeBlueprintString, formatVersion, packVersion, unpackVersion, EXPORT_VERSION, type DecodeErrorCode } from "../src/index.ts";

const base64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64");
const stringOf = (json: string): string => `0${base64(zlibSync(strToU8(json), { level: 9 }))}`;

function codeOf(text: string, limits = {}): DecodeErrorCode | "ok" {
  const result = decodeBlueprintString(text, limits);
  return result.ok ? "ok" : result.code;
}

const sample = { blueprint: { item: "blueprint", label: "Grüße ≥ 𠀀", entities: [{ entity_number: 1, name: "small-lamp", position: { x: 0.5, y: -1.5 } }], version: 562954250027008 } };

describe("blueprint string", () => {
  it("encodes as the game does: version character, base64, zlib at level 9", () => {
    const text = encodeBlueprintString(sample);
    expect(text.startsWith("0eN")).toBe(true);
    const inflated = unzlibSync(Buffer.from(text.slice(1), "base64"));
    expect(JSON.parse(Buffer.from(inflated).toString("utf8"))).toEqual(sample);
    expect(text).toBe(stringOf(JSON.stringify(sample)));
  });

  it("decodes what it encodes, for every length of the last base64 group", () => {
    for (let padding = 0; padding < 6; padding++) {
      const data = { blueprint: { label: "x".repeat(padding), n: [padding] } };
      const result = decodeBlueprintString(encodeBlueprintString(data));
      expect(result).toEqual({ ok: true, data });
    }
    expect(decodeBlueprintString(encodeBlueprintString(sample))).toEqual({ ok: true, data: sample });
  });

  it("decodes a string from another encoder, with or without padding, and with blanks and line breaks in it", () => {
    const text = stringOf(JSON.stringify(sample));
    expect(decodeBlueprintString(text)).toEqual({ ok: true, data: sample });
    expect(decodeBlueprintString(text.replace(/=+$/, ""))).toEqual({ ok: true, data: sample });
    const wrapped = `  ${text.replace(/(.{20})/g, "$1\r\n")} \n`;
    expect(decodeBlueprintString(wrapped)).toEqual({ ok: true, data: sample });
  });

  it("decodes a large string that inflates in several steps", () => {
    const data = { blueprint: { entities: Array.from({ length: 20000 }, (_, i) => ({ entity_number: i + 1, name: `entity-${(i * 7919) % 1000}`, position: { x: i + 0.5, y: (i * 31) % 97 } })) } };
    const text = encodeBlueprintString(data);
    expect(text.length).toBeGreaterThan(50_000);
    expect(decodeBlueprintString(text)).toEqual({ ok: true, data });
  });

  it("takes plain JSON, which the game also imports", () => {
    expect(decodeBlueprintString(`\n ${JSON.stringify(sample, null, 2)}\n`)).toEqual({ ok: true, data: sample });
    expect(codeOf("{ not json")).toBe("invalid-json");
    expect(codeOf('{"a": [1, 2}')).toBe("invalid-json");
  });

  it("refuses what is not a blueprint string, each with its own code", () => {
    expect(codeOf("")).toBe("empty");
    expect(codeOf(" \n\t ")).toBe("empty");
    expect(codeOf("1eNqrVkrKKU0tKMrMK1GyqlbKLEnNVbJSSsvPSUktKlayio7VUSpLLSrOzM9TsjI1szAzMTextDQ3NTM0qq0FAHmyE1c=")).toBe("unsupported-encoding");
    expect(codeOf("hello world")).toBe("unsupported-encoding");
    expect(codeOf("0")).toBe("invalid-base64");
    expect(codeOf("0eN!!")).toBe("invalid-base64");
    expect(codeOf("0eNqä")).toBe("invalid-base64");
    expect(codeOf("0abcde")).toBe("invalid-base64");
    expect(codeOf(`0${base64(strToU8("this is not a zlib stream at all"))}`)).toBe("invalid-compression");
    expect(codeOf(`0${base64(zlibSync(new Uint8Array([0xff, 0xfe, 0x80, 0x80])))}`)).toBe("invalid-utf8");
    expect(codeOf(stringOf("{ not json"))).toBe("invalid-json");
    expect(codeOf(stringOf(""))).toBe("invalid-json");
    for (const json of ["[1, 2]", '"text"', "12", "null", "true"]) expect(codeOf(stringOf(json))).toBe("not-an-object");
  });

  it("refuses a truncated string at every length", () => {
    // Without the padding, which a string may come without.
    const text = encodeBlueprintString(sample).replace(/=+$/, "");
    for (let length = 1; length < text.length; length++) {
      const result = decodeBlueprintString(text.slice(0, length));
      expect(result.ok, `length ${length}`).toBe(false);
      if (!result.ok) expect(["invalid-base64", "invalid-compression"]).toContain(result.code);
    }
  });

  it("refuses a damaged string: a flipped bit in the data, a wrong checksum, bytes after the end", () => {
    const compressed = zlibSync(strToU8(JSON.stringify(sample)), { level: 9 });
    const wrongChecksum = compressed.slice();
    wrongChecksum[wrongChecksum.length - 1]! ^= 0x01;
    expect(codeOf(`0${base64(wrongChecksum)}`)).toBe("invalid-compression");
    const trailing = new Uint8Array(compressed.length + 3);
    trailing.set(compressed);
    expect(codeOf(`0${base64(trailing)}`)).toBe("invalid-compression");
    let refused = 0;
    for (let at = 2; at < compressed.length - 4; at++) {
      const damaged = compressed.slice();
      damaged[at]! ^= 0x10;
      const result = decodeBlueprintString(`0${base64(damaged)}`);
      // A flipped bit that still inflates to something is caught by the checksum.
      if (!result.ok) refused++;
      else expect(result.data).toEqual(sample);
    }
    expect(refused).toBe(compressed.length - 6);
  });

  it("limits the length of the string", () => {
    const text = encodeBlueprintString(sample);
    expect(codeOf(text, { maxStringLength: text.length })).toBe("ok");
    expect(codeOf(text, { maxStringLength: text.length - 1 })).toBe("too-long");
    expect(codeOf(" ".repeat(100) + text, { maxStringLength: text.length })).toBe("ok");
    expect(codeOf(" ".repeat(3 * text.length), { maxStringLength: text.length })).toBe("too-long");
    expect(codeOf(JSON.stringify(sample), { maxStringLength: 10 })).toBe("too-long");
  });

  it("limits the decoded size without inflating a bomb in full", () => {
    const json = JSON.stringify(sample);
    const text = stringOf(json);
    expect(codeOf(text, { maxDecodedBytes: strToU8(json).length })).toBe("ok");
    expect(codeOf(text, { maxDecodedBytes: strToU8(json).length - 1 })).toBe("too-large");
    expect(codeOf(json, { maxDecodedBytes: json.length - 1 })).toBe("too-large");
    // Twice the limit in blanks is a string of some hundred kilobytes.
    const bomb = `0${base64(zlibSync(strToU8(`{"a":"${" ".repeat(2 * DEFAULT_LIMITS.maxDecodedBytes)}"}`), { level: 9 }))}`;
    expect(bomb.length).toBeLessThan(DEFAULT_LIMITS.maxStringLength);
    const started = performance.now();
    expect(codeOf(bomb)).toBe("too-large");
    expect(performance.now() - started).toBeLessThan(2000);
  });

  it("limits the nesting, also where a parser would run out of stack", () => {
    const nested = (depth: number): string => `${'{"a":'.repeat(depth)}1${"}".repeat(depth)}`;
    expect(codeOf(nested(64))).toBe("ok");
    expect(codeOf(nested(65))).toBe("too-deep");
    expect(codeOf(stringOf(nested(65)))).toBe("too-deep");
    expect(codeOf(nested(5), { maxDepth: 4 })).toBe("too-deep");
    expect(codeOf(stringOf(`{"a":${"[".repeat(200000)}${"]".repeat(200000)}}`))).toBe("too-deep");
    // Brackets inside strings are not nesting.
    expect(codeOf(`{"a":"${"[{".repeat(100)}","b":"\\"[[[[","c":"\\\\"}`, { maxDepth: 1 })).toBe("ok");
  });

  it("never throws, whatever the text", () => {
    const texts = ["0", "00", "0=", "0====", "0A", "0AA", "0AAA", "0AAAA", "0eJw", "0eJwDAAAAAAE", "{", "}", "{}", "\u0000", "0\u0000", "0eN\ud800", "0" + "A".repeat(1000)];
    for (const text of texts) expect(() => decodeBlueprintString(text)).not.toThrow();
    expect(decodeBlueprintString("{}")).toEqual({ ok: true, data: {} });
  });
});

describe("version number", () => {
  it("packs four 16-bit numbers, as the strings shipped with the game show", () => {
    expect(packVersion(2, 0, 0)).toBe(562949953421312);
    expect(packVersion(2, 1, 25)).toBe(562954250027008);
    expect(EXPORT_VERSION).toBe(562954250027008);
    expect(unpackVersion(562954249043969)).toEqual({ major: 2, minor: 1, patch: 10, build: 1 });
    expect(formatVersion(562954248388627)).toBe("2.1.0.19");
    expect(formatVersion(281483567300631)).toBe("1.2.10.23");
    // A number of JavaScript holds 53 bits exactly, which is enough for a major version below 32.
    expect(unpackVersion(packVersion(31, 65535, 65535, 65535))).toEqual({ major: 31, minor: 65535, patch: 65535, build: 65535 });
  });
});

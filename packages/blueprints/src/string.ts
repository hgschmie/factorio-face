// The blueprint string of the game: a version character, then base64 of a zlib stream of UTF-8 JSON (docs/factorio-audit.md 5.1).
// Decoding treats the text as untrusted: every step has a limit and a failure is a value, never an exception.

import { Unzlib, zlibSync } from "fflate";

export interface BlueprintLimits {
  /** Characters of the string as given, after blanks and line breaks are taken out. */
  readonly maxStringLength: number;
  /** Bytes of the JSON text after inflating. */
  readonly maxDecodedBytes: number;
  /** Nesting of objects and arrays in the JSON. */
  readonly maxDepth: number;
  /** Entities one blueprint may bring into the editor, counted after the unknown ones are dropped (`importBlueprint`). */
  readonly maxEntities: number;
}

export const DEFAULT_LIMITS: BlueprintLimits = { maxStringLength: 8 * 1024 * 1024, maxDecodedBytes: 32 * 1024 * 1024, maxDepth: 64, maxEntities: 5000 };

export type DecodeErrorCode =
  | "empty"
  | "too-long"
  | "unsupported-encoding"
  | "invalid-base64"
  | "invalid-compression"
  | "too-large"
  | "invalid-utf8"
  | "invalid-json"
  | "too-deep"
  | "not-an-object";

export type DecodeResult = { readonly ok: true; readonly data: Readonly<Record<string, unknown>> } | { readonly ok: false; readonly code: DecodeErrorCode; readonly message: string };

/** The only version character the game has used so far. */
export const STRING_VERSION = "0";

const fail = (code: DecodeErrorCode, message: string): DecodeResult => ({ ok: false, code, message });

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BASE64_VALUES = new Int8Array(128).fill(-1);
for (let i = 0; i < BASE64.length; i++) BASE64_VALUES[BASE64.charCodeAt(i)] = i;

/** Standard base64 from `start` on, with or without padding. Undefined for any other character or an impossible length. */
function decodeBase64(text: string, start: number): Uint8Array | undefined {
  let end = text.length;
  while (end > start && end > text.length - 2 && text[end - 1] === "=") end--;
  const length = end - start;
  if (length % 4 === 1) return undefined;
  const bytes = new Uint8Array(Math.floor((length * 3) / 4));
  let buffer = 0;
  let bits = 0;
  let at = 0;
  for (let i = start; i < end; i++) {
    const code = text.charCodeAt(i);
    const value = code < 128 ? BASE64_VALUES[code]! : -1;
    if (value < 0) return undefined;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[at++] = (buffer >> bits) & 0xff;
    }
  }
  return bytes;
}

function encodeBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  // In pieces, so that no single string concatenation runs over the whole input.
  for (let offset = 0; offset < bytes.length; offset += 3 * 8192) {
    let piece = "";
    const stop = Math.min(bytes.length, offset + 3 * 8192);
    for (let i = offset; i < stop; i += 3) {
      const [a, b, c] = [bytes[i]!, bytes[i + 1], bytes[i + 2]];
      piece += BASE64[a >> 2]! + BASE64[((a & 3) << 4) | ((b ?? 0) >> 4)]! + (b === undefined ? "=" : BASE64[((b & 15) << 2) | ((c ?? 0) >> 6)]!) + (c === undefined ? "=" : BASE64[c & 63]!);
    }
    parts.push(piece);
  }
  return parts.join("");
}

function adler32(chunks: readonly Uint8Array[]): number {
  let a = 1;
  let b = 0;
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; ) {
      // 5552 bytes are the most that cannot overflow 32 bits before the modulo.
      const stop = Math.min(chunk.length, i + 5552);
      for (; i < stop; i++) {
        a += chunk[i]!;
        b += a;
      }
      a %= 65521;
      b %= 65521;
    }
  }
  return ((b << 16) | a) >>> 0;
}

/** How much compressed input is inflated before the size is looked at again; deflate expands at most about 1000 times. */
const INFLATE_STEP = 4096;

type Inflated = { readonly bytes: Uint8Array } | { readonly error: "invalid-compression" | "too-large" };

/** Inflates a zlib stream to at most `limit` bytes and checks its checksum, which fflate leaves alone. */
function inflate(data: Uint8Array, limit: number): Inflated {
  const chunks: Uint8Array[] = [];
  let total = 0;
  let finished = false;
  const stream = new Unzlib((chunk, final) => {
    total += chunk.length;
    chunks.push(chunk);
    finished ||= final;
  });
  try {
    for (let offset = 0; offset < data.length && total <= limit; offset += INFLATE_STEP) stream.push(data.subarray(offset, offset + INFLATE_STEP), offset + INFLATE_STEP >= data.length);
  } catch {
    return { error: "invalid-compression" };
  }
  if (total > limit) return { error: "too-large" };
  if (!finished || data.length < 6) return { error: "invalid-compression" };
  const expected = ((data[data.length - 4]! << 24) | (data[data.length - 3]! << 16) | (data[data.length - 2]! << 8) | data[data.length - 1]!) >>> 0;
  if (adler32(chunks) !== expected) return { error: "invalid-compression" };
  if (chunks.length === 1) return { bytes: chunks[0]! };
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return { bytes };
}

/** The deepest nesting of `{` and `[` in JSON text, looked at before it is parsed so that the parser never recurses deeper than the limit. */
function jsonDepth(text: string): number {
  let depth = 0;
  let deepest = 0;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (inString) {
      if (code === 92) i++;
      else if (code === 34) inString = false;
    } else if (code === 34) inString = true;
    else if (code === 123 || code === 91) deepest = Math.max(deepest, ++depth);
    else if (code === 125 || code === 93) depth--;
  }
  return deepest;
}

function parseJson(text: string, limits: BlueprintLimits): DecodeResult {
  if (jsonDepth(text) > limits.maxDepth) return fail("too-deep", `The blueprint is nested deeper than ${limits.maxDepth} levels`);
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return fail("invalid-json", "The blueprint does not contain valid JSON");
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) return fail("not-an-object", "The blueprint does not contain a JSON object");
  return { ok: true, data: data as Record<string, unknown> };
}

const megabytes = (bytes: number): string => `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;

/**
 * Decodes a blueprint string to its JSON object. Blanks and line breaks anywhere in the text are ignored, as a string pasted from a
 * forum has them. Text that starts with `{` is taken as the plain JSON, which the game also imports since 2.0. What the object
 * holds (a blueprint, a book, a planner) is not looked at here.
 */
export function decodeBlueprintString(text: string, limits: Partial<BlueprintLimits> = {}): DecodeResult {
  const bounds = { ...DEFAULT_LIMITS, ...limits };
  // A string that is too long is refused before any work proportional to it beyond this one pass.
  if (text.length > bounds.maxStringLength * 2) return fail("too-long", `The text is longer than ${megabytes(bounds.maxStringLength)}`);
  const compact = text.replace(/\s+/g, "");
  if (compact.length === 0) return fail("empty", "There is no blueprint string");
  if (compact.length > bounds.maxStringLength) return fail("too-long", `The blueprint string is longer than ${megabytes(bounds.maxStringLength)}`);
  if (compact[0] === "{") {
    const trimmed = text.trim();
    if (trimmed.length > bounds.maxDecodedBytes) return fail("too-large", `The blueprint is larger than ${megabytes(bounds.maxDecodedBytes)}`);
    return parseJson(trimmed, bounds);
  }
  if (compact[0] !== STRING_VERSION) return fail("unsupported-encoding", `This is not a blueprint string: it starts with '${compact[0]}', a blueprint string starts with '${STRING_VERSION}'`);
  const compressed = decodeBase64(compact, 1);
  if (!compressed || compressed.length === 0) return fail("invalid-base64", "The blueprint string is damaged: it is not valid base64");
  const inflated = inflate(compressed, bounds.maxDecodedBytes);
  if ("error" in inflated) {
    return inflated.error === "too-large"
      ? fail("too-large", `The blueprint is larger than ${megabytes(bounds.maxDecodedBytes)} when unpacked`)
      : fail("invalid-compression", "The blueprint string is damaged or incomplete: it cannot be unpacked");
  }
  let json: string;
  try {
    json = new TextDecoder("utf-8", { fatal: true }).decode(inflated.bytes);
  } catch {
    return fail("invalid-utf8", "The blueprint string is damaged: its content is not valid UTF-8");
  }
  return parseJson(json, bounds);
}

/** The blueprint string of a JSON object, as the game writes it: version character, base64, zlib at level 9. */
export function encodeBlueprintString(data: unknown): string {
  return STRING_VERSION + encodeBase64(zlibSync(new TextEncoder().encode(JSON.stringify(data)), { level: 9 }));
}

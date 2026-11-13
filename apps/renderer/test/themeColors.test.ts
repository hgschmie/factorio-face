// Pins the theme: neutral colors are true grays without a green cast, chromatic colors are declared tokens, and filled controls stay readable.
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../../..");
const SOURCE_DIR = resolve(ROOT, "apps/renderer/src");
const STYLE_DIR = resolve(SOURCE_DIR, "styles");

type Rgb = readonly [number, number, number];

interface Literal {
  readonly file: string;
  readonly line: number;
  readonly text: string;
  readonly rgb: Rgb;
  /** The custom property the literal defines, when it is the value of one. */
  readonly token?: string;
}

/** Below this saturation a color is a neutral and has to be a gray. */
const NEUTRAL_SATURATION = 0.12;
/** Largest channel spread of a gray; #5c5a58 from the reference is the widest. */
const GRAY_SPREAD = 4;
const GREEN_CAST = 2;

/** Tokens that are chromatic on purpose. Any other token, and every literal outside tokens.css, has to be a gray. */
const CHROMATIC_TOKENS: ReadonlySet<string> = new Set([
  // cream headings
  "--text-strong",
  // orange accent
  "--accent", "--accent-fill", "--accent-bright", "--accent-border",
  // warm states: lit lamp card, the arrows on the blueprint board, warnings and notices
  "--card-lit", "--board-arrow", "--status-warning", "--notice-surface", "--notice-border", "--notice-text",
  // red: wire, errors, delete
  "--wire-red", "--wire-red-ui", "--wire-red-surface", "--wire-red-border", "--status-error",
  "--danger", "--danger-text", "--danger-surface", "--danger-surface-hover", "--danger-border",
  // green: see GREEN_TOKENS
  "--confirm", "--confirm-bright", "--confirm-edge", "--wire-green", "--wire-green-ui", "--wire-green-surface", "--wire-green-border",
  // entity kinds, traces and syntax
  "--kind-constant", "--kind-arithmetic", "--kind-decider", "--kind-selector", "--kind-lamp", "--kind-speaker",
  "--trace-2", "--trace-3", "--syntax-signal", "--syntax-number", "--syntax-string", "--syntax-atom",
]);

/** The only tokens in which green may dominate: the confirm action (also the ok status) and the green wire. */
const GREEN_TOKENS: ReadonlySet<string> = new Set(["--confirm", "--confirm-bright", "--confirm-edge", "--wire-green", "--wire-green-ui", "--wire-green-surface", "--wire-green-border"]);

const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/g;
const RGB_FUNCTION = /rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)[^)]*\)/g;

function parseHex(text: string): Rgb {
  const digits = text.slice(1);
  const wide = digits.length <= 4 ? [...digits].map((digit) => digit + digit).join("") : digits;
  return [0, 2, 4].map((at) => Number.parseInt(wide.slice(at, at + 2), 16)) as unknown as Rgb;
}

function literalsOf(file: string, source: string): Literal[] {
  const found: Literal[] = [];
  source.split("\n").forEach((text, index) => {
    const token = /^\s*(--[\w-]+)\s*:/.exec(text)?.[1];
    for (const match of text.matchAll(HEX)) found.push({ file, line: index + 1, text: match[0], rgb: parseHex(match[0]), token });
    for (const match of text.matchAll(RGB_FUNCTION)) found.push({ file, line: index + 1, text: match[0], rgb: [Number(match[1]), Number(match[2]), Number(match[3])], token });
  });
  return found;
}

function saturation([r, g, b]: Rgb): number {
  const max = Math.max(r, g, b);
  return max === 0 ? 0 : (max - Math.min(r, g, b)) / max;
}

function greenExcess([r, g, b]: Rgb): number {
  return g - Math.max(r, b);
}

/** The reason a color literal breaks the theme rules, or undefined when it is fine. */
function violation(rgb: Rgb, token?: string): string | undefined {
  if (greenExcess(rgb) > GREEN_CAST && !(token && GREEN_TOKENS.has(token))) return "green dominates outside the green tokens";
  if (saturation(rgb) < NEUTRAL_SATURATION) return Math.max(...rgb) - Math.min(...rgb) > GRAY_SPREAD ? "tinted neutral" : undefined;
  return token && CHROMATIC_TOKENS.has(token) ? undefined : "chromatic color that is not a declared token";
}

function filesBelow(directory: string, extension: RegExp): string[] {
  return readdirSync(directory, { recursive: true, encoding: "utf8" })
    .filter((name) => extension.test(name))
    .map((name) => resolve(directory, name))
    .sort();
}

const styleFiles = filesBelow(STYLE_DIR, /\.css$/);
// Views carry colors in SVG attributes; the editor theme is the one .ts file with colors of its own.
const themeFiles = [...styleFiles, ...filesBelow(SOURCE_DIR, /\.tsx$/), resolve(SOURCE_DIR, "editor/theme.ts")];
const sources = new Map(themeFiles.map((file) => [file, readFileSync(file, "utf8")]));
const literals = [...sources].flatMap(([file, source]) => literalsOf(file.slice(ROOT.length + 1), source));

const tokens = new Map<string, string>();
for (const file of styleFiles) for (const match of sources.get(file)!.matchAll(/^\s*(--[\w-]+)\s*:\s*([^;]+);/gm)) tokens.set(match[1]!, match[2]!.trim());

/** Follows var() references to the color a token stands for. */
function colorOf(token: string): Rgb {
  const value = tokens.get(token);
  if (value === undefined) throw new Error(`unknown token ${token}`);
  const reference = /^var\((--[\w-]+)\)$/.exec(value);
  return reference ? colorOf(reference[1]!) : parseHex(value);
}

function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }) as unknown as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(foreground: string, background: string): number {
  const [light, dark] = [luminance(colorOf(foreground)), luminance(colorOf(background))].sort((a, b) => b - a) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

describe("theme colors", () => {
  it("finds the color literals of the stylesheets and the editor theme", () => {
    expect(literals.filter((literal) => literal.file.endsWith("tokens.css")).length).toBeGreaterThan(40);
    expect(literals.some((literal) => literal.file.endsWith("Canvas.tsx"))).toBe(true);
  });

  it("recognizes the former olive palette as a violation", () => {
    for (const olive of ["#20251f", "#282e26", "#3b4236", "#dedfd4", "#91998b", "#555c50", "#afba75"]) expect(violation(parseHex(olive)), olive).toBeDefined();
    expect(violation(parseHex("#a9bb79"), "--status-ok")).toBeDefined();
    expect(violation([17, 24, 15])).toBeDefined();
  });

  it("accepts the reference grays and the declared accents", () => {
    for (const gray of ["#181818", "#1c1c1c", "#242324", "#313031", "#383837", "#414040", "#5c5a58", "#8e8e8e", "#000", "#ececec"]) expect(violation(parseHex(gray)), gray).toBeUndefined();
    expect(violation(parseHex("#f0a418"), "--accent")).toBeUndefined();
    expect(violation(parseHex("#5eb663"), "--confirm")).toBeUndefined();
    expect(violation(parseHex("#5eb663"), "--accent")).toBeDefined();
  });

  it("has no green cast, no tinted neutral and no undeclared chromatic color", () => {
    const problems = literals.flatMap((literal) => {
      const reason = violation(literal.rgb, literal.token);
      return reason ? [`${literal.file}:${literal.line} ${literal.token ?? ""} ${literal.text}: ${reason}`] : [];
    });
    expect(problems).toEqual([]);
  });

  it("keeps chromatic colors in tokens.css", () => {
    const outside = literals.filter((literal) => !literal.file.endsWith("tokens.css") && saturation(literal.rgb) >= NEUTRAL_SATURATION);
    expect(outside.map((literal) => `${literal.file}:${literal.line} ${literal.text}`)).toEqual([]);
  });

  it("refers only to tokens that exist", () => {
    const missing = [...sources].flatMap(([file, source]) => {
      const references = [...source.matchAll(/var\((--[\w-]+)/g)].map((match) => match[1]!);
      return references.filter((token) => !tokens.has(token)).map((token) => `${file.slice(ROOT.length + 1)}: ${token}`);
    });
    expect(missing).toEqual([]);
    for (const token of [...CHROMATIC_TOKENS, ...GREEN_TOKENS]) expect(tokens.has(token), token).toBe(true);
  });

  it("starts the window in the color of the workbench", () => {
    const main = readFileSync(resolve(ROOT, "apps/desktop/src/main.ts"), "utf8");
    const background = /WINDOW_BACKGROUND = "(#[0-9a-f]{6})"/.exec(main)?.[1];
    expect(background && parseHex(background)).toEqual(colorOf("--surface-window"));
  });

  it("keeps ink on filled controls and accent text on the grays readable", () => {
    for (const fill of ["--accent-fill", "--accent-bright", "--confirm", "--confirm-bright", "--surface-control"]) expect(contrast("--ink", fill), fill).toBeGreaterThanOrEqual(4.5);
    for (const surface of ["--gray-well", "--gray-frame", "--gray-card"]) {
      const readable = ["--accent", "--text", "--text-strong", "--text-soft", "--wire-red-ui", "--wire-green-ui", "--status-warning"];
      for (const text of readable) expect(contrast(text, surface), `${text} on ${surface}`).toBeGreaterThanOrEqual(4.5);
      for (const text of ["--text-muted", "--status-error", "--danger"]) expect(contrast(text, surface), `${text} on ${surface}`).toBeGreaterThanOrEqual(3);
    }
    for (const surface of ["--gray-well", "--gray-frame"]) expect(contrast("--status-error", surface), `--status-error on ${surface}`).toBeGreaterThanOrEqual(4.5);
    expect(contrast("--danger-text", "--danger-surface")).toBeGreaterThanOrEqual(4.5);
    expect(contrast("--notice-text", "--notice-surface")).toBeGreaterThanOrEqual(4.5);
  });
});

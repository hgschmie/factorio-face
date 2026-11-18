// The wired entities a read left out, from the notes of the build to the data the window gets: parsed conservatively, bounded,
// one line each. The notes are text made from what a game with mods said.
import { describe, expect, it } from "vitest";
import { LEFT_OUT_LIMITS, leftOutEntities } from "../../src/gameData/leftOut.ts";
import { LEFT_OUT_REASONS } from "../../src/ipc.ts";

const note = (text: string): string => `left out: ${text}`;

describe("the entities a read left out", () => {
  it("are none without notes, and a note that names no left-out entity is not one", () => {
    expect(leftOutEntities([])).toEqual([]);
    expect(leftOutEntities(["the wire reach of 1 prototypes grows with quality (pole: normal 32, legendary 42)", "left out:", note("  ")])).toEqual([]);
  });

  it("have the name and the finding of the note apart, and a reason for every finding of the build", () => {
    const findings: [string, (typeof LEFT_OUT_REASONS)[number]][] = [
      ["a: no collision box", "no-collision-box"],
      ["b: no selection box", "no-selection-box"],
      ["c: selectionBox is [0,0,0,0]", "no-selection-box"],
      ["d: tile size is 0 x 0 at run time, 1 x 1 as derived from data.raw", "size"],
      ["e: takes a circuit wire by data.raw (reach 9), but has no wire reach at run time", "connection"],
      ["f: has a wire reach at run time, but the selection rule on data.raw does not find it", "connection"],
      ["g (lamp) takes a circuit wire in data.raw of the dump, but the game has no entity of that name", "connection"],
      ["h: wire reach is 12 at run time, 9 as derived from data.raw", "mismatch"],
      ["i: hidden is true at run time, false in data.raw", "mismatch"],
      ["j: the entity as built has a direction at run time, the rotation table says false for type lamp", "mismatch"],
      ["k: has the flag building-direction-8-way, but has no direction at run time", "mismatch"],
      ["l: no rotation rule for prototype type odd-type; add it to ROTATION_BY_TYPE in tools/catalog/lib/entities.mjs or dump from the game", "unknown-type"],
      ['m: signal output is "item:odd name"', "other"],
      ["n: width is 0", "other"],
    ];
    const entities = leftOutEntities(findings.map(([text]) => note(text)));
    expect(entities.map((entity) => [entity.name, entity.reason])).toEqual(findings.map(([text, reason]) => [text[0], reason]));
    expect(entities[0]).toEqual({ name: "a", reason: "no-collision-box", detail: "no collision box" });
    expect(entities[6]!.detail).toBe("(lamp) takes a circuit wire in data.raw of the dump, but the game has no entity of that name");
    expect(new Set(entities.map((entity) => entity.reason))).toEqual(new Set(LEFT_OUT_REASONS));
  });

  it("reads the notes of a real game with mods", () => {
    const notes = ["compaktcircuit-pole: tile size is 0 x 0 at run time, 1 x 1 as derived from data.raw", "ee-infinity-wagon-chest: no selection box", "hps__fc-filter-combinator-ac: no collision box", "hps__ml-miniloader-i: selectionBox is [0,0,0,0]"].map(note);
    expect(leftOutEntities(notes).map((entity) => `${entity.name} ${entity.reason}`)).toEqual(["compaktcircuit-pole size", "ee-infinity-wagon-chest no-selection-box", "hps__fc-filter-combinator-ac no-collision-box", "hps__ml-miniloader-i no-selection-box"]);
  });

  it("list an entity once, with its first reason and every finding", () => {
    const entities = leftOutEntities([note("odd: tile size is 2 x 1 at run time, 1 x 1 as derived from data.raw"), note("other: no collision box"), note("odd: wire reach is 7 at run time, 9 as derived from data.raw")]);
    expect(entities).toEqual([
      { name: "odd", reason: "size", detail: "tile size is 2 x 1 at run time, 1 x 1 as derived from data.raw; wire reach is 7 at run time, 9 as derived from data.raw" },
      { name: "other", reason: "no-collision-box", detail: "no collision box" },
    ]);
  });

  it("list a note of another form whole, under no reason of its own, and never guess a name with blanks or colons", () => {
    expect(leftOutEntities([note("record 0 has no name"), note("odd name: no collision box"), note("a:b: no collision box")])).toEqual([
      { name: "record 0 has no name", reason: "other", detail: "" },
      { name: "odd name: no collision box", reason: "other", detail: "" },
      { name: "a:b: no collision box", reason: "other", detail: "" },
    ]);
  });

  it("are bounded and one line each, whatever a mod wrote into a name", () => {
    const hostile = leftOutEntities([note(`evil\u0000\u001b[31m\nname${String.fromCharCode(0x2028)}x: no\r\ncollision\tbox`), note(`${"n".repeat(300)}: no collision box`), note(`long: ${"d".repeat(2000)}`), ...Array.from({ length: 5 }, () => note(`many: ${"x".repeat(200)} at run time`))]);
    expect(hostile[0]).toEqual({ name: "evil [31m name x: no collision box", reason: "other", detail: "" });
    expect(hostile[1]).toEqual({ name: "n".repeat(LEFT_OUT_LIMITS.nameLength), reason: "other", detail: "" });
    expect(hostile[2]!.detail).toHaveLength(LEFT_OUT_LIMITS.detailLength);
    expect(hostile[3]!.detail).toHaveLength(LEFT_OUT_LIMITS.detailLength);
    for (const entity of hostile) expect(`${entity.name}${entity.detail}`).not.toMatch(/[\u0000-\u001f\u007f-\u009f]|\p{Zl}|\p{Zp}/u);

    const many = leftOutEntities(Array.from({ length: LEFT_OUT_LIMITS.entities + 50 }, (_, index) => note(`entity-${index}: no collision box`)));
    expect(many).toHaveLength(LEFT_OUT_LIMITS.entities);
    expect(many.at(-1)!.name).toBe(`entity-${LEFT_OUT_LIMITS.entities - 1}`);
  });
});

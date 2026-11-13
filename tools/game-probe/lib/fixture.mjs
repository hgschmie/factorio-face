// Fixture F-24 from what wire-reach.lua records: checked, put in a fixed order and written so that the file reads as a picture.

const entity = ({ name, width, height, facing, connector, reach }) => {
  if (!(reach > 0)) throw new Error(`${name}: no wire reach (${reach})`);
  return { name, width, height, ...(facing && { facing }), ...(connector && { connector }), reach };
};

/** The fixture for a recording `{ game_version, range, cases: [{ label, a, b, rows }] }`; `source` says where the recording is from. */
export function buildFixture({ game_version: gameVersion, range, cases }, source) {
  const side = 2 * range + 1;
  const row = new RegExp(`^[01]{${side}}$`);
  return {
    format: 1,
    id: "F-24-wire-reach",
    covers: ["F-24"],
    title: "Wire reach: every placement of an entity B around an entity A, and whether a red circuit wire from A connects to it",
    provenance: "game",
    source,
    gameVersion,
    layout: "A's top-left tile is (0, 0). rows[r][c] is '1' when the wire connects with B's top-left tile on (c - range, r - range). width and height are the tile footprint as placed; reach is the smaller of the two entities' reaches.",
    range,
    cases: cases.map(({ label, a, b, rows }) => {
      if (rows.length !== side || !rows.every((cells) => row.test(cells))) throw new Error(`${label}: not a ${side} x ${side} grid of 0 and 1:\n${rows.join("\n")}`);
      return { label, a: entity(a), b: entity(b), reach: Math.min(a.reach, b.reach), rows };
    }),
  };
}

/** One line per entity and per row: readable, small and the same bytes for the same recording. */
export function serialiseFixture({ cases, ...head }) {
  const fields = Object.entries(head).map(([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)}`);
  const one = ({ label, a, b, reach, rows }) =>
    ["    {", `      "label": ${JSON.stringify(label)},`, `      "a": ${JSON.stringify(a)},`, `      "b": ${JSON.stringify(b)},`, `      "reach": ${reach},`, '      "rows": [', rows.map((cells) => `        "${cells}"`).join(",\n"), "      ]", "    }"].join("\n");
  return `{\n${fields.join(",\n")},\n  "cases": [\n${cases.map(one).join(",\n")}\n  ]\n}\n`;
}

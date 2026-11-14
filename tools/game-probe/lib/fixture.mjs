// Fixture F-24 from what wire-reach.lua records: checked, put in a fixed order and written so that the file reads as a picture.

const entity = ({ name, type, width, height, facing, asked, connector, reach, selectionBox }) => {
  if (!(reach > 0)) throw new Error(`${name}: no wire reach (${reach})`);
  if (!(Array.isArray(selectionBox) && selectionBox.length === 4 && selectionBox.every(Number.isFinite))) throw new Error(`${name}: no selection box (${JSON.stringify(selectionBox)})`);
  return { name, type, width, height, ...(facing && { facing }), ...(asked && { asked }), ...(connector && { connector }), reach, selectionBox };
};

/** The cases of a recording the game could not set up, as [{ label, error }]; `buildFixture` leaves them out. */
export const failedCases = ({ cases }) => cases.filter((probed) => probed.error !== undefined);

/**
 * The fixture for a recording `{ game_version, range, cases: [{ label, a, b, range?, rows } | { label, error }] }`; `source` says
 * where the recording is from. A case keeps its `range` only where it is not the recording's.
 */
export function buildFixture({ game_version: gameVersion, range, cases }, source) {
  return {
    format: 1,
    id: "F-24-wire-reach",
    covers: ["F-24"],
    title: "Wire reach: every placement of an entity B around an entity A, and whether a red circuit wire from A connects to it",
    provenance: "game",
    source,
    gameVersion,
    layout: "A's top-left tile is (0, 0). rows[r][c] is '1' when the wire connects with B's top-left tile on (c - range, r - range), range being the case's own where it has one. width and height are the tile footprint as placed, facing is the direction the entity has in the game (north where there is none) and asked the one the probe asked for where the game did not give it. selectionBox is [left, top, right, bottom] of the prototype's selection box around the center of the entity when it faces north. reach is the smaller of the two entities' reaches.",
    range,
    cases: cases.filter((probed) => probed.error === undefined).map(({ label, a, b, range: own = range, rows }) => {
      const side = 2 * own + 1;
      const row = new RegExp(`^[01]{${side}}$`);
      if (rows.length !== side || !rows.every((cells) => row.test(cells))) throw new Error(`${label}: not a ${side} x ${side} grid of 0 and 1:\n${rows.join("\n")}`);
      return { label, a: entity(a), b: entity(b), reach: Math.min(a.reach, b.reach), ...(own !== range && { range: own }), rows };
    }),
  };
}

/** One line per entity and per row: readable, small and the same bytes for the same recording. */
export function serialiseFixture({ cases, ...head }) {
  const fields = Object.entries(head).map(([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)}`);
  const one = ({ label, a, b, reach, range, rows }) => {
    const fields = { label, a, b, reach, ...(range !== undefined && { range }) };
    const head = [...Object.entries(fields).map(([key, value]) => `"${key}": ${JSON.stringify(value)},`), '"rows": ['];
    return ["    {", ...head.map((line) => `      ${line}`), rows.map((cells) => `        "${cells}"`).join(",\n"), "      ]", "    }"].join("\n");
  };
  return `{\n${fields.join(",\n")},\n  "cases": [\n${cases.map(one).join(",\n")}\n  ]\n}\n`;
}

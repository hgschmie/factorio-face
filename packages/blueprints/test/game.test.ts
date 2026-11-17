// Fixture F-01: this package against the game itself. tests/fixtures/game/F-01-blueprints.json is recorded from the installed
// game by `make probe-blueprints` (tools/game-probe/blueprints.mjs); recording.ts has the tests that hold the package against it.
import { existsSync, readFileSync } from "node:fs";
import { PROTOTYPES } from "@face/model";
import { describe, expect, it } from "vitest";
import { CONNECTOR, encodeBlueprintString, packVersion, type BlueprintFile } from "../src/index.ts";
import { arrangement, recordingTests, shape, type RecordedBlueprint, type Recording } from "./recording.ts";
import { exportedSamples } from "./samples.ts";
import { imported } from "./helpers.ts";

const FIXTURE = new URL("../../../tests/fixtures/game/F-01-blueprints.json", import.meta.url);
const recording = existsSync(FIXTURE) ? (JSON.parse(readFileSync(FIXTURE, "utf8")) as Recording) : undefined;

describe.skipIf(!recording)(recording ? `the game, Factorio ${recording.gameVersion} (fixture F-01)` : "the game (fixture F-01): SKIPPED, not recorded; run `make probe-blueprints`", () => {
  if (recording) recordingTests(recording);
  else it("holds the package against tests/fixtures/game/F-01-blueprints.json", () => {});
});

const recorded = (data: object): RecordedBlueprint => ({ string: encodeBlueprintString(data), blueprint: data });

/** A blueprint as the game exports it after building it: somewhere else, the entities in another order, the poles joined by copper wires, its own version. */
function rebuiltByAGame(data: BlueprintFile): RecordedBlueprint {
  const { entities, wires = [], ...rest } = data.blueprint;
  const number = (old: number): number => entities.length + 1 - old;
  const moved = [...entities].reverse().map((entity) => ({ ...entity, entity_number: number(entity.entity_number), position: { x: entity.position.x - 17, y: entity.position.y + 4 } }));
  const poles = moved.filter((entity) => PROTOTYPES[entity.name]?.kind === "pole").map((entity) => entity.entity_number);
  const copper = poles.slice(1).map((pole, index) => [poles[index]!, CONNECTOR.poleCopper, pole, CONNECTOR.poleCopper]);
  const rewired = wires.map(([from, fromConnector, to, toConnector]) => (number(from) <= number(to) ? [number(from), fromConnector, number(to), toConnector] : [number(to), toConnector, number(from), fromConnector]));
  return recorded({ blueprint: { ...rest, entities: moved, wires: [...copper, ...rewired.reverse()], version: packVersion(2, 1, 25, 3) } });
}

describe("comparing with what the game built", () => {
  const [sample] = exportedSamples().filter((entry) => entry.label === "electric poles");

  it("does not depend on where the blueprint stands, the order of its entities or the copper wires the game adds", () => {
    const rebuilt = rebuiltByAGame(sample!.data);
    expect(rebuilt.blueprint.blueprint!.wires!.filter((wire) => wire[1] === CONNECTOR.poleCopper)).toHaveLength(3);
    expect(rebuilt.blueprint.blueprint!.entities!.map((entity) => entity.name)).toEqual([...sample!.data.blueprint.entities].reverse().map((entity) => entity.name));
    expect(shape(rebuilt.blueprint)).toEqual(shape(sample!.data));
    expect(arrangement(imported(rebuilt.blueprint).circuit)).toEqual(arrangement(imported(sample!.data).circuit));
  });

  it("sees a setting, a place or a wire that differs", () => {
    const changed = (change: (blueprint: { entities: Record<string, unknown>[]; wires: number[][] }) => void): RecordedBlueprint["blueprint"] => {
      const copy = JSON.parse(JSON.stringify(sample!.data)) as { blueprint: { entities: Record<string, unknown>[]; wires: number[][] } };
      change(copy.blueprint);
      return copy as unknown as RecordedBlueprint["blueprint"];
    };
    const variants = [
      changed((blueprint) => (blueprint.entities[0]!.name = "medium-electric-pole")),
      changed((blueprint) => ((blueprint.entities[5]!.control_behavior as { circuit_condition: { constant: number } }).circuit_condition.constant = 1)),
      changed((blueprint) => ((blueprint.entities[1]!.position as { x: number }).x += 1)),
      changed((blueprint) => (blueprint.wires[0]![1] = 2)),
      changed((blueprint) => blueprint.wires.pop()),
    ];
    for (const variant of variants) {
      expect(shape(variant)).not.toEqual(shape(sample!.data));
      expect(arrangement(imported(variant).circuit)).not.toEqual(arrangement(imported(sample!.data).circuit));
    }
  });
});

import { analyze } from "@face/language";
import type { Circuit } from "@face/model";
import { expect } from "vitest";
import { exportBlueprint, importBlueprint, type BlueprintEntity, type BlueprintFile, type ExportOptions, type ImportOptions, type ImportReport } from "../src/index.ts";
import { INSTRUMENTS, placed } from "./samples.ts";

/** The circuit of member declarations, as written: an entity has a `tile` only where the source gives it one. */
export function parse(body: string, name = "t"): Circuit {
  const result = analyze(`circuit ${JSON.stringify(name)} {\n${body}\n}\n`);
  const errors = result.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  if (!result.circuit || errors.length) throw new Error(`Unexpected errors: ${errors.map((error) => error.message).join("; ")}\n${body}`);
  return result.circuit;
}

/** The same with every entity on a place of its own. */
export function circuitOf(body: string, name = "t"): Circuit {
  return placed(parse(body, name));
}

export function exported(circuit: Circuit, options: ExportOptions = { instruments: INSTRUMENTS }): BlueprintFile {
  const result = exportBlueprint(circuit, options);
  if (!result.ok) throw new Error(`Export failed: ${result.problems.map((problem) => problem.message).join("; ")}`);
  return result.data;
}

/** The blueprint entities of member declarations, in their order. */
export function entitiesOf(body: string): readonly BlueprintEntity[] {
  return exported(circuitOf(body)).blueprint.entities;
}

/** The first one without number, name and position. */
export function settingsOf(body: string): Record<string, unknown> {
  const { entity_number: _number, name: _name, position: _position, ...settings } = entitiesOf(body)[0]!;
  return settings;
}

export function blueprintOf(entities: readonly unknown[], wires: readonly unknown[] = [], extra: Record<string, unknown> = {}): { blueprint: Record<string, unknown> } {
  return { blueprint: { item: "blueprint", entities, wires, version: 562954250027008, ...extra } };
}

export function imported(data: unknown, options: ImportOptions = { instruments: INSTRUMENTS }): { circuit: Circuit; report: ImportReport } {
  const result = importBlueprint(data, options);
  if (!result.ok) throw new Error(`Import failed: ${result.code}: ${result.message}`);
  return { circuit: result.circuit, report: result.report };
}

/** One blueprint entity at a place that fits it, read by the importer: the entity without its name and its place, and the notes about it. */
export function importedEntity(name: string, fields: Record<string, unknown> = {}, options: ImportOptions = { instruments: INSTRUMENTS }): { entity: Record<string, unknown>; notes: string[] } {
  const { circuit, report } = imported(blueprintOf([{ entity_number: 1, name, position: { x: 0.5, y: 0.5 }, ...fields }]), options);
  expect(circuit.entities).toMatchObject([{ prototype: name }]);
  const { id: _id, name: _name, position: _position, placement: _placement, ...entity } = circuit.entities[0]!;
  return { entity: JSON.parse(JSON.stringify(entity)) as Record<string, unknown>, notes: report.settings.map((note) => `${note.kind} ${note.field}`) };
}

export const A = { type: "virtual", name: "signal-A" } as const;
export const B = { type: "virtual", name: "signal-B" } as const;
export const IRON = { name: "iron-plate" } as const;

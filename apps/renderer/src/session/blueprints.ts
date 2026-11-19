// Blueprints of the game, as the app deals in them: what a pasted text or a file holds, the project a blueprint opens as, what
// the report of an import says, and the blueprint string of the circuit on show. The format itself is in @face/blueprints. Pure.
import {
  canonicalBlueprintString, EXPORT_VERSION, exportBlueprint, importBlueprint, itemOf, unpackVersion,
  type Blueprint, type BlueprintItemKind, type BookEntry, type ExportProblemCode, type ImportReport, type NoteKind,
} from "@face/blueprints";
import { printCircuit } from "@face/language";
import type { Circuit, SpeakerInstrument } from "@face/model";
import type { LoadedProject, ProjectBook, ProjectData } from "../../../desktop/src/ipc.ts";
import { EDIT_UNITS_PER_TILE } from "../canvas/board.ts";
import { GRID } from "../canvas/geometry.ts";
import { DEFAULT_FILE_NAME, PROJECT_NAME_LIMIT } from "./persistence.ts";

/** The name of the project a blueprint without a label opens as. */
export const IMPORTED_PROJECT_NAME = "Imported blueprint";
/** The name of the project a blueprint book without a label opens as, when it opens without a circuit. */
export const IMPORTED_BOOK_NAME = "Imported blueprint book";

/**
 * How the edit positions of an imported circuit follow from its tiles: the scale at which the board derives a tile from an edit
 * position, on the grid of the edit canvas. The edit canvas then shows the arrangement of the blueprint.
 */
export const IMPORT_SCALE = { unitsPerTile: EDIT_UNITS_PER_TILE, grid: GRID } as const;

/**
 * A blueprint is untrusted text, and its labels, prototype names and field names end up in dialogs: a name is shown up to this
 * length, a message up to `MESSAGE_LENGTH`, and a list up to `REPORT_LINES` (a book up to `BOOK_ROWS`) lines.
 */
const NAME_LENGTH = 80;
const MESSAGE_LENGTH = 600;
export const REPORT_LINES = 50;
export const BOOK_ROWS = 1000;

const clip = (text: string, length = NAME_LENGTH): string => (text.length > length ? `${text.slice(0, length)}...` : text);
const count = (amount: number, one: string, many = `${one}s`): string => `${amount} ${amount === 1 ? one : many}`;
/** The messages of the package are sentences without their full stop. */
export const sentence = (message: string): string => {
  const clipped = clip(message, MESSAGE_LENGTH);
  return /[.!?]$/.test(clipped) ? clipped : `${clipped}.`;
};

// Import

/** One note of the report on a setting of known entities. */
export interface ReportNote {
  readonly kind: NoteKind;
  /** The prototype, the field and what became of it: "lamp: control_behavior.use_colors is something the editor does not have". */
  readonly text: string;
  /** The entities it is about, by their names in the circuit: "3 entities: lamp1, lamp2, lamp3". */
  readonly entities: string;
}

/** What an import left out or changed, in words. Each list may be empty; a report with nothing in any of them is not made. */
export interface ImportReportView {
  /** "Imported 4 of 12 entities and 3 wires." */
  readonly summary: string;
  /** Per prototype: "6 x transport-belt". */
  readonly dropped: readonly string[];
  readonly wires: readonly string[];
  readonly settings: readonly ReportNote[];
  /** Warnings about the blueprint as a whole, and what of it is not kept. */
  readonly remarks: readonly string[];
  /** What the project has on that a new one has not, in a line: "Switched on: Some Mod." None when nothing was. */
  readonly modules: readonly string[];
}

/** The modules of the project an imported circuit opens as, and the titles of those among them that a new project has off, in the order of the rows of the project settings. */
export interface ImportModules {
  readonly modules: readonly string[];
  readonly switchedOn: readonly string[];
}

/** Modules named in the report before it says how many more there are; a title is a mod's own text and is cut like a name. */
const MODULES_NAMED = 12;

/** `had`: what had them off, "a new project has only the modules of the game itself on" for a blueprint that opens as one. */
function switchedOnLine(titles: readonly string[], had: string): string {
  const more = titles.length - MODULES_NAMED;
  const named = `${titles.slice(0, MODULES_NAMED).map((title) => clip(title)).join(", ")}${more > 0 ? ` and ${more} more` : ""}`;
  return `Switched on: ${named}. The blueprint has ${titles.length === 1 ? "its" : "their"} signals or entities; ${had}.`;
}

/** Why modules were off before an import switched them on: the second half of the line of the report that names them. */
export const NEW_PROJECT_HAD_OFF = "a new project has only the modules of the game itself on";
export const OPEN_PROJECT_HAD_OFF = "the project had them off";

const NOTE_WORDS: Readonly<Record<NoteKind, string>> = { ignored: "Ignored", invalid: "Invalid", changed: "Changed", reset: "Reset" };

/** The word a note of the report starts with. */
export function noteWord(kind: NoteKind): string {
  return NOTE_WORDS[kind];
}

/**
 * The report of an import, or null when the blueprint arrived whole and the project it opens as has the modules of a new one.
 * `switchedOn` are the titles of the modules it has on beyond those, `hadOff` the words for why they were off. The icons of a
 * blueprint are not worth a report: every blueprint of the game has them and an export makes new ones.
 */
export function importReport(report: ImportReport, switchedOn: readonly string[] = [], hadOff = NEW_PROJECT_HAD_OFF): ImportReportView | null {
  const dropped = report.dropped.slice(0, REPORT_LINES).map(({ name, count: amount, reason }) => `${amount} x ${clip(name)}${reason === "invalid" ? " (without a usable entity number or position)" : ""}`);
  const unlisted = report.dropped.slice(REPORT_LINES);
  if (unlisted.length > 0) dropped.push(`${count(unlisted.reduce((sum, entry) => sum + entry.count, 0), "entity", "entities")} of ${count(unlisted.length, "more prototype")}`);
  const { toDropped, copper, invalid } = report.wires;
  const wires = [
    toDropped > 0 && `${count(toDropped, "circuit wire")} to dropped entities went with them.`,
    copper > 0 && `${count(copper, "copper wire")} (power) ${copper === 1 ? "was" : "were"} dropped: the editor has circuit wires only.`,
    invalid > 0 && `${count(invalid, "wire")} ${invalid === 1 ? "was" : "were"} dropped as invalid: ${invalid === 1 ? "it does" : "they do"} not join two connection points that exist.`,
  ].filter((line) => line !== false);
  const settings = report.settings.slice(0, REPORT_LINES).map((note): ReportNote => {
    const more = note.count - note.entities.length;
    return { kind: note.kind, text: `${note.prototype}: ${clip(note.field)} ${clip(note.message, MESSAGE_LENGTH)}`, entities: `${count(note.count, "entity", "entities")}: ${note.entities.join(", ")}${more > 0 ? ` and ${more} more` : ""}` };
  });
  const ignored = report.ignored.filter((field) => field !== "icons");
  const remarks = [
    ...report.warnings.slice(0, REPORT_LINES).map(sentence),
    ...(report.settings.length > REPORT_LINES ? [`${count(report.settings.length - REPORT_LINES, "more note")} on settings ${report.settings.length - REPORT_LINES === 1 ? "is" : "are"} not listed.`] : []),
    ...(ignored.length > 0 ? [`Not kept from the blueprint itself: ${clip(ignored.map((field) => clip(field)).join(", "), MESSAGE_LENGTH)}.`] : []),
  ];
  const modules = switchedOn.length > 0 ? [switchedOnLine(switchedOn, hadOff)] : [];
  if (dropped.length + wires.length + settings.length + remarks.length + modules.length === 0) return null;
  const total = report.entities + report.dropped.reduce((sum, entry) => sum + entry.count, 0);
  const entities = total === report.entities ? count(total, "entity", "entities") : `${report.entities} of ${count(total, "entity", "entities")}`;
  return { summary: `Imported ${entities} and ${count(report.wires.imported, "wire")}.`, dropped, wires, settings, remarks, modules };
}

/** One line of the list of a blueprint book: an item of the book, in the order and the nesting of the book. */
export interface BookRow {
  /** What an import of this item selects. */
  readonly path: readonly number[];
  /** 0 for an item of the book itself, 1 for an item of a book inside it, and so on. */
  readonly depth: number;
  readonly kind: BlueprintItemKind;
  /** The label of the item, or what it is when it has none. */
  readonly label: string;
  /** "12 entities, 4 known to the editor" for a blueprint; what the item is otherwise. */
  readonly detail: string;
  /** A blueprint with at least one entity the editor knows. */
  readonly importable: boolean;
  /** A blueprint: an export of the circuit into the book can take its place. */
  readonly replaceable: boolean;
  /** A book: an export of the circuit into the book can be added at its end. */
  readonly addable: boolean;
  /**
   * What an export over this blueprint destroys, because the editor does not hold it and so cannot write it back: the entities
   * the editor does not know, and the tiles. Both 0 for an item that is no blueprint.
   */
  readonly lost: { readonly entities: number; readonly tiles: number };
}

const ITEM_NAMES: Readonly<Record<BlueprintItemKind, string>> = {
  blueprint: "Blueprint",
  book: "Blueprint book",
  "deconstruction-planner": "Deconstruction planner",
  "upgrade-planner": "Upgrade planner",
  unknown: "Unknown item",
};

/** The label of an item as a dialog shows it: bounded, and words for an item without one. */
export function itemLabel(kind: BlueprintItemKind, label: string): string {
  return clip(label.trim()) || `${ITEM_NAMES[kind]} without a label`;
}

/** The first `BOOK_ROWS` items of a book as rows. */
export function bookRows(entries: readonly BookEntry[]): BookRow[] {
  return entries.slice(0, BOOK_ROWS).map(({ path, kind, label, entities, known, tiles }): BookRow => {
    const detail = kind !== "blueprint" ? `${ITEM_NAMES[kind]}${kind === "book" ? "" : ", cannot be imported"}` : entities === 0 ? "No entities" : `${count(entities, "entity", "entities")}, ${known === 0 ? "none" : known} known to the editor`;
    const blueprint = kind === "blueprint";
    const lost = blueprint ? { entities: entities - known, tiles } : { entities: 0, tiles: 0 };
    return { path, depth: path.length - 1, kind, label: itemLabel(kind, label), detail, importable: blueprint && known > 0, replaceable: blueprint, addable: kind === "book", lost };
  });
}

/** That a book has more items than the rows that are listed. */
export function unlistedNote(unlisted: number): string {
  return `The book has ${count(unlisted, "more item")}, which ${unlisted === 1 ? "is" : "are"} not listed.`;
}

/** A blueprint as the editor takes it: the circuit of its known entities as source, and what there is to say about the rest. */
export interface ImportedBlueprint {
  /** The name of the project it opens as: its label, or `IMPORTED_PROJECT_NAME`. */
  readonly name: string;
  readonly source: string;
  /** How many entities the circuit has, and how many the blueprint had. */
  readonly entities: number;
  readonly total: number;
  /** The modules of the project it opens as; those of the empty project when absent. */
  readonly modules?: readonly string[];
  readonly report: ImportReportView | null;
  /** For a blueprint of a book: the book, which the project it opens as holds, with this blueprint as the origin of its circuit. */
  readonly book?: ProjectBook;
}

/** A blueprint book as the project it opens as without a circuit: the empty project that holds the book. */
export interface ImportedBook {
  /** The name of that project: the label of the book, or `IMPORTED_BOOK_NAME`. */
  readonly name: string;
  /** The book as a project keeps it, without an origin. */
  readonly book: ProjectBook;
}

export type BlueprintReading =
  | { readonly kind: "blueprint"; readonly blueprint: ImportedBlueprint }
  /**
   * A blueprint book: `rows` are its items, of which the user chooses one; `unlisted` counts the items beyond `BOOK_ROWS`. `rows`
   * is empty for a book without items. `book` is the whole book, whichever book inside it was selected: it opens as a project
   * without a circuit (`openBook`), which is all there is to open when no row is `importable`.
   */
  | { readonly kind: "book"; readonly message: string; readonly rows: readonly BookRow[]; readonly unlisted: number; readonly book: ImportedBook }
  | { readonly kind: "error"; readonly message: string };

/** A project name from the label of a blueprint, which is any text: one line, of bounded length, never empty (`fallback` for a label that leaves nothing). */
export function importedProjectName(label: string, fallback = IMPORTED_PROJECT_NAME): string {
  // Control characters and line breaks are not part of a project name (the main process refuses them).
  const cleaned = label.replace(/[\u0000-\u001f\u007f\s]+/g, " ").trim().slice(0, PROJECT_NAME_LIMIT).trim();
  return cleaned === "" ? fallback : cleaned;
}

/** The positions of a path that the project file takes as an origin: whole numbers up to the last slot the game counts. Checked by the main process (`LIMITS.bookOriginIndex`). */
export const ORIGIN_POSITION_LIMIT = 65_535;

/** `path` as the origin a project keeps, or undefined for one a project file does not take: no path at all, or a position beyond what the game counts. */
export function originOf(path: readonly number[] | undefined): readonly number[] | undefined {
  return path && path.length > 0 && path.every((position) => position <= ORIGIN_POSITION_LIMIT) ? [...path] : undefined;
}

export type BlueprintDataReading =
  | { readonly kind: "blueprint"; readonly blueprint: ImportedBlueprint }
  /** The item is a book: its items, the books inside it followed by theirs. */
  | { readonly kind: "items"; readonly message: string; readonly entries: readonly BookEntry[] }
  | { readonly kind: "error"; readonly message: string };

/**
 * What the decoded data of a blueprint string holds at `select` (the root without it): `readBlueprint` after the decoding, and
 * what a blueprint of a book that a project holds is read with. `hadOff` is how the report puts why modules were off.
 */
export function readBlueprintData(data: unknown, instruments: readonly SpeakerInstrument[], select?: readonly number[], modulesOf?: (source: string) => ImportModules, hadOff?: string): BlueprintDataReading {
  const result = importBlueprint(data, { instruments, ...IMPORT_SCALE, select });
  if (!result.ok) return result.code === "book" ? { kind: "items", message: sentence(result.message), entries: result.book ?? [] } : { kind: "error", message: sentence(result.message) };
  const { circuit, report } = result;
  const total = report.entities + report.dropped.reduce((sum, entry) => sum + entry.count, 0);
  if (circuit.entities.length === 0) {
    const names = report.dropped.slice(0, 5).map((entry) => clip(entry.name)).join(", ");
    const message = total === 0 ? "This blueprint has no entities." : `The editor knows none of the ${count(total, "entity", "entities")} of this blueprint (${names}${report.dropped.length > 5 ? ", ..." : ""}), so there is nothing to import.`;
    return { kind: "error", message };
  }
  const source = printCircuit(circuit);
  const needed = modulesOf?.(source);
  const blueprint: ImportedBlueprint = { name: importedProjectName(circuit.name), source, entities: circuit.entities.length, total, ...(needed && { modules: needed.modules }), report: importReport(report, needed?.switchedOn, hadOff) };
  return { kind: "blueprint", blueprint };
}

/**
 * What a text holds: a blueprint string or the plain JSON of one, pasted or read from a file. The text is untrusted; the importer
 * bounds its size and never throws. `select` names a blueprint of a book (`BookRow.path`). A blueprint without an entity the editor
 * knows is an error: there is nothing to open. `modulesOf` says which modules the source of the circuit needs (the session knows
 * the catalog); without it the project gets those of the empty project. A blueprint of a book comes with the book, as the string
 * a project keeps (`canonicalBlueprintString`), and so does the list of a book.
 */
export function readBlueprint(text: string, instruments: readonly SpeakerInstrument[], select?: readonly number[], modulesOf?: (source: string) => ImportModules): BlueprintReading {
  const canonical = canonicalBlueprintString(text);
  if (!canonical.ok) return { kind: "error", message: sentence(canonical.message) };
  const root = itemOf(canonical.data);
  const reading = readBlueprintData(canonical.data, instruments, select, modulesOf);
  // Only a book has items, and only in a book does a path lead to a blueprint.
  if (root.kind !== "book") return reading.kind === "items" ? { kind: "error", message: reading.message } : reading;
  const book: ProjectBook = { string: canonical.string };
  if (reading.kind === "items") {
    const name = importedProjectName(typeof root.body.label === "string" ? root.body.label : "", IMPORTED_BOOK_NAME);
    return { kind: "book", message: reading.message, rows: bookRows(reading.entries), unlisted: Math.max(0, reading.entries.length - BOOK_ROWS), book: { name, book } };
  }
  const origin = originOf(select);
  return reading.kind === "blueprint" ? { kind: "blueprint", blueprint: { ...reading.blueprint, book: { ...book, ...(origin && { origin }) } } } : reading;
}

/**
 * The project an imported blueprint opens as: the empty project with the name of the blueprint, its circuit, the modules that
 * needs, and the book it is of when it is of one. Without a `source` (a book that opens without a circuit) the circuit is that
 * of the empty project. It has no file.
 */
export function importedProject(empty: ProjectData, imported: Pick<ImportedBlueprint, "name" | "modules" | "book"> & { readonly source?: string }): LoadedProject {
  const fileName = empty.manifest.circuits[0] ?? DEFAULT_FILE_NAME;
  const modules = imported.modules ? [...imported.modules] : empty.manifest.modules;
  const source = imported.source ?? empty.files.find((file) => file.name === fileName)?.source ?? "";
  return { path: null, data: { manifest: { ...empty.manifest, name: imported.name, modules, circuits: [fileName] }, files: [{ name: fileName, source }], ...(imported.book && { book: imported.book }) } };
}

// Export

export interface BlueprintProblem {
  /** `invalid-source`: the source has errors, so there is no circuit to export. */
  readonly code: ExportProblemCode | "invalid-source";
  readonly message: string;
  /** Names of the entities it is about. */
  readonly entities: readonly string[];
}

export type BlueprintExport =
  | {
      readonly ok: true;
      readonly string: string;
      /** The version of the game the blueprint says it is from: "2.1.24". */
      readonly gameVersion: string;
      readonly warnings: readonly string[];
    }
  | { readonly ok: false; readonly problems: readonly BlueprintProblem[] };

/** The version an exported blueprint is written for, as the game shows versions. */
export function exportGameVersion(): string {
  const { major, minor, patch } = unpackVersion(EXPORT_VERSION);
  return `${major}.${minor}.${patch}`;
}

export const INVALID_SOURCE_PROBLEM: BlueprintProblem = { code: "invalid-source", entities: [], message: "The source has errors. A blueprint is made from the circuit, so fix them first." };

/** The blueprint of a circuit as the object the game's format has for it, which is what a blueprint book takes as an item, with its string. */
export type CircuitBlueprint =
  | { readonly ok: true; readonly blueprint: Blueprint; readonly string: string; readonly warnings: readonly string[] }
  | { readonly ok: false; readonly problems: readonly BlueprintProblem[] };

/** The blueprint of a circuit, or everything that is in the way of one. */
export function circuitBlueprint(circuit: Circuit, instruments: readonly SpeakerInstrument[]): CircuitBlueprint {
  const result = exportBlueprint(circuit, { instruments });
  if (!result.ok) return { ok: false, problems: result.problems.map(({ code, message, entities }) => ({ code, entities, message: sentence(message) })) };
  return { ok: true, blueprint: result.data.blueprint, string: result.string, warnings: result.warnings.map((warning) => sentence(warning.message)) };
}

/** The blueprint string of a circuit, or everything that is in the way of one. */
export function exportCircuit(circuit: Circuit, instruments: readonly SpeakerInstrument[]): BlueprintExport {
  const result = circuitBlueprint(circuit, instruments);
  return result.ok ? { ok: true, string: result.string, gameVersion: exportGameVersion(), warnings: result.warnings } : result;
}

/** The entities of the problems that the blueprint board is the place to solve: those without a `tile`. */
export function unplacedEntities(problems: readonly BlueprintProblem[]): readonly string[] {
  return problems.filter((problem) => problem.code === "no-tile").flatMap((problem) => problem.entities);
}

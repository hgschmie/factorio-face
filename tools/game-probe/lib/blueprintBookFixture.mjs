// Fixture F-30 from what blueprint-book.lua records: every string of the game decoded to the JSON it holds (with fflate alone,
// see blueprintFixture.mjs), the fields in a fixed order and one book per line.
import { decodeString } from "./blueprintFixture.mjs";

// The game writes an empty Lua table as an object.
const list = (value) => (Array.isArray(value) ? value : []);
const defined = (record) => Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
const decoded = (string) => (typeof string === "string" ? decodeString(string) : undefined);

/** What a stack holds: null for an empty one; `slot` where it is in a book, `size`, `activeIndex` and `slots` where it is one. */
function contents(held) {
  if (!held || held.empty) return null;
  return defined({ slot: held.slot, item: held.item, label: held.label, entities: held.entities, size: held.size, activeIndex: held.active_index, slots: held.slots === undefined ? undefined : list(held.slots).map(contents) });
}

const state = (recorded) => defined({ contents: contents(recorded?.contents), exported: decoded(recorded?.exported), error: recorded?.error });
const inserts = (recorded) => list(recorded).map(({ item, inserted, slot, size }) => defined({ item, inserted, slot, size }));

// Where in the fixture the book is that an edit wrote into, by the name lib/blueprintBookEdits.ts has for it.
const inputPlace = (input, lastSlotCase) => ({ book: "book.exported", empty: "native.empty.exported", "last slot": `the exported of the import '${lastSlotCase}'`, carried: "native.carried.exported" })[input];

/**
 * The fixture for a recording `{ game_version, native: { errors, empty, empty_labelled, beyond_size, blank_blueprint, carried, full },
 * imports: [{ label, import_result, contents, exported, error }], limits: { inserted, imported } }` and the books that were sent (`cases`
 * of blueprintBookCases.mjs: { label, data, plain }); `source` says where the recording is from. `edits` has the second run:
 * `cases` of lib/blueprintBookEdits.ts ({ label, input, operation, target, keep, sample, path, string }), the `imports` the game
 * recorded for them, and `lastSlotCase`, the label of the case whose export is the input 'last slot'.
 */
export function buildFixture({ game_version: gameVersion, native, imports, limits }, cases, source, edits) {
  if (!gameVersion || !native?.full?.state?.exported || list(imports).length !== cases.length || !limits) throw new Error("the recording has no game version, no book, no limits or not one import per case");
  if (list(edits.imports).length !== edits.cases.length) throw new Error("the second recording has not one import per edit");
  const { full } = native;
  const { inserted, imported } = limits;
  return {
    format: 1,
    id: "F-30-blueprint-book",
    covers: ["F-30"],
    title: "Blueprint books: what the game exports for a book, what it makes of books written by hand, and how many slots a book has",
    provenance: "game",
    source,
    gameVersion,
    layout:
      "Every `exported` is the JSON of a string the game exported. contents: what a stack holds as the runtime API says it; of a book its label, size (#inventory: the slots up to the last one that is not empty), " +
      "activeIndex (LuaItemCommon.active_index) and slots (those that are not empty, each with its number); slot numbers and activeIndex count from 1 as the API does, `index` and `active_index` in the JSON from 0. " +
      "entities: of a blueprint. native: books made through the runtime API. empty: a new book; emptyLabelled: with a label. beyondSize: set_stack on slot 5 of a new book. blankBlueprint: a book of a blueprint that nothing was put into and one with a combinator. " +
      "book: a book the probe filled: a blueprint, a blueprint, a blueprint, a book, an upgrade planner and a deconstruction planner inserted (inserts: the slot each landed in and the size after), the second cleared (sizeAfterClear), " +
      "labels, descriptions, icons and the active index set; string is what the game exported for it and exported the JSON in that. items: its items exported on their own. " +
      "reimport: the game reading its own string (importResult; sameString: it exports the same again). active: active_index set to `set` (from 1), what it then reads and writes, the error where the game refused; it was 3 before each. " +
      "added: two more blueprints inserted, afterAdding the book then (exportedIndexes: the `index` of every item it writes), sizeAfterClearingLast the size once the last slot is cleared. " +
      "imports: per book written by hand what was sent (sent; plain: as JSON text, not deflated), the result of LuaItemStack.import_stack (0: no errors, -1: imported with errors, 1: failed), what the stack then holds and what the game exports for it. " +
      "limits: inserted: blueprints inserted into a new book one by one until it took no more (filled: slots that are not empty; canInsert: whether it takes one more); " +
      "imported: one book written by hand with `sent` blueprints labelled 1 to `sent`, none with an index (exported: how many items the game writes for it, lastIndex the `index` of the last). errors: what the game refused while the probe made its books. " +
      "carried (in native): a book of one blueprint with two entities that has, set through the runtime API, every field a replacement can keep: description, icons, label color, snap-to-grid, absolute-snapping and position-relative-to-grid. " +
      "edits: books of this recording that packages/blueprints wrote a blueprint into and the game then read, in a second run: input says where in the fixture the book is that was written into, operation, target and keep what was done " +
      "(add: addToBook to the book at the path `target`; replace: replaceInBook of the blueprint at `target`, with `keep`), sample the sample circuit of packages/blueprints/test/samples.ts whose export was written, " +
      "path the path the function returned for it, sent the book it returned; importResult, contents and exported as for imports.",
    errors: list(native.errors),
    native: {
      empty: state(native.empty),
      emptyLabelled: state(native.empty_labelled),
      beyondSize: defined({ sizeBefore: native.beyond_size?.size_before, error: native.beyond_size?.error, sizeAfter: native.beyond_size?.size_after }),
      blankBlueprint: { inserts: inserts(native.blank_blueprint?.inserts), ...state(native.blank_blueprint?.state) },
      carried: state(native.carried),
    },
    book: {
      sizeFresh: full.size_fresh,
      inserts: inserts(full.inserts),
      sizeAfterClear: full.size_after_clear,
      contents: contents(full.state.contents),
      string: full.state.exported,
      exported: decoded(full.state.exported),
      items: list(full.items).map(({ slot, exported }) => defined({ slot, exported: decoded(exported) })),
      reimport: defined({ importResult: full.reimport?.import_result, sameString: full.reimport?.same_string, sameContents: full.reimport?.same_contents }),
      active: list(full.active).map(({ set, read, exported, error }) => defined({ set, read, exportedActiveIndex: decoded(exported)?.blueprint_book?.active_index, error })),
      added: inserts(full.added),
      afterAdding: defined({ contents: contents(full.state_after_adding?.contents), exportedIndexes: decoded(full.state_after_adding?.exported)?.blueprint_book?.blueprints?.map((item) => item.index) }),
      sizeAfterClearingLast: full.size_after_clearing_last,
    },
    imports: cases.map(({ label, data, plain }, index) => {
      const recorded = imports[index];
      if (recorded.label !== label) throw new Error(`the recording has '${recorded.label}' where '${label}' was sent`);
      return defined({ label, plain, sent: data, importResult: recorded.import_result, contents: contents(recorded.contents), exported: decoded(recorded.exported), error: recorded.error });
    }),
    edits: edits.cases.map(({ label, input, operation, target, keep, sample, path, string }, index) => {
      const recorded = edits.imports[index];
      if (recorded.label !== label) throw new Error(`the second recording has '${recorded.label}' where '${label}' was sent`);
      const what = { label, input: inputPlace(input, edits.lastSlotCase), operation, target, keep, sample, path, sent: decoded(string) };
      return defined({ ...what, importResult: recorded.import_result, contents: contents(recorded.contents), exported: decoded(recorded.exported), error: recorded.error });
    }),
    limits: {
      inserted: defined({ tried: inserted.tried, inserted: inserted.inserted, size: inserted.size, filled: inserted.filled, canInsert: inserted.can_insert, error: inserted.error }),
      imported: defined({
        sent: imported.sent, importResult: imported.import_result, size: imported.size, filled: imported.filled, firstLabel: imported.first_label, lastLabel: imported.last_label,
        exported: imported.exported, lastIndex: imported.last_index, error: imported.error,
      }),
    },
  };
}

/** Everything the game could not do, as "step: error". */
export function fixtureErrors(fixture) {
  const refused = [...[...fixture.imports, ...fixture.edits].map((entry) => [entry.label, entry.error]), ["inserting", fixture.limits.inserted.error], ["importing many", fixture.limits.imported.error]];
  return [...fixture.errors, ...refused.filter(([, error]) => error !== undefined).map(([step, error]) => `${step}: ${error}`)];
}

/**
 * A value as JSON text that is spread over lines as far as `shape` says: a number of levels, or per key of an object the shape
 * of its value; everything below is one line.
 */
function render(value, shape, indent) {
  if (!shape || value === null || typeof value !== "object" || Object.keys(value).length === 0) return JSON.stringify(value);
  const inner = `${indent}  `;
  const below = (key) => (typeof shape === "number" ? shape - 1 : shape[key]);
  if (Array.isArray(value)) return `[\n${value.map((element) => `${inner}${render(element, below(), inner)}`).join(",\n")}\n${indent}]`;
  const fields = Object.entries(value).filter(([, element]) => element !== undefined);
  return `{\n${fields.map(([key, element]) => `${inner}${JSON.stringify(key)}: ${render(element, below(key), inner)}`).join(",\n")}\n${indent}}`;
}

/** One book per line: readable, and the same bytes for the same recording. */
export function serialiseFixture(fixture) {
  const top = Object.fromEntries(Object.keys(fixture).map((key) => [key, 0]));
  return `${render(fixture, { ...top, native: 1, book: { items: 1, active: 1, afterAdding: 1 }, imports: 2, edits: 2, limits: 1 }, "")}\n`;
}

const slotsOf = (held) => (held?.slots ?? []).map((item) => `${item.slot}: ${item.item === "blueprint-book" ? `book '${item.label}' [${slotsOf(item)}]` : item.label ?? item.item}`).join(", ");

/** The answers of a fixture, as lines to print. */
export function summarise({ native, book, imports, edits, limits }) {
  const { inserted, imported } = limits;
  return [
    `a new book has ${native.empty.contents.size} slots and exports ${JSON.stringify(native.empty.exported)}`,
    `the book of the probe: slots ${slotsOf(book.contents)}; exported with index ${book.exported.blueprint_book.blueprints.map((item) => item.index).join(", ")} and active_index ${book.exported.blueprint_book.active_index}`,
    `two blueprints added to it land in slots ${book.added.map((entry) => entry.slot).join(" and ")}`,
    ...[...imports, ...edits].map((entry) => `${entry.label}: import_stack ${entry.importResult}; ${entry.contents ? `${entry.contents.size} slots, active ${entry.contents.activeIndex}; ${slotsOf(entry.contents)}` : "nothing"}`),
    `a book took ${inserted.inserted} of ${inserted.tried} blueprints inserted one by one (${inserted.size} slots)`,
    `a book written by hand with ${imported.sent} blueprints: import_stack ${imported.importResult}, ${imported.filled} in ${imported.size} slots, the last one '${imported.lastLabel}'`,
  ];
}

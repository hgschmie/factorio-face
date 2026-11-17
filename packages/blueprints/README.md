# @face/blueprints

Blueprints of the game: the blueprint string, import of a blueprint as a circuit of the editor, export of a circuit as a blueprint. Pure TypeScript without Node APIs; it runs in the renderer, in a worker and in vitest. It depends on `@face/model`, on `@face/language` (the importer checks with `checkEntity` that the circuit it returns can be written in the circuit language exactly) and on `fflate`. It does not depend on `@face/catalog`: the one thing it needs from the game data, the instruments of the speaker, is passed in.

The editor is a circuit editor, not a blueprint editor. An import keeps the entities the editor knows with their circuit wires, drops everything else and says what it dropped. The editor knows every entity of the game that a circuit wire connects to (`PROTOTYPES` of `@face/model`, 98 prototypes of Factorio 2.1.25): the four combinators, the lamp, the four electric poles and the programmable speaker with a kind of their own, and the other 88 (chests, inserters, belts, machines, turrets, train stops, ...) as generic entities (kind `entity`), whose circuit settings it models and whose other fields it keeps for the blueprint unread. What it drops is what no circuit wire connects to: gates, rails, rolling stock, and entities the game data in use does not have. With data read from a game with mods (`setEntityTable`) a modded prototype of one of the six types with a kind of its own is an entity of that kind that holds its `prototype`, and its name is what the export writes; a modded speaker stays unknown.

Game facts are in `docs/factorio-audit.md` (sections 3 to 5 and 12; the control behaviours of the generic entities in section 14). The format is held against the game itself: fixture F-01 is a recording of Factorio 2.1.25 that every shape, number, default and direction of this package is tested against ("Verified against the game" below, with what is still open).

## API

```ts
import { decodeBlueprintString, encodeBlueprintString, inspectBlueprint, importBlueprint, importBlueprintString, exportBlueprint } from "@face/blueprints";
```

### The string

```ts
decodeBlueprintString(text: string, limits?: Partial<BlueprintLimits>): DecodeResult
encodeBlueprintString(data: unknown): string

type DecodeResult = { ok: true; data: Readonly<Record<string, unknown>> } | { ok: false; code: DecodeErrorCode; message: string };
type DecodeErrorCode = "empty" | "too-long" | "unsupported-encoding" | "invalid-base64" | "invalid-compression" | "too-large" | "invalid-utf8" | "invalid-json" | "too-deep" | "not-an-object";
```

A blueprint string is the character `0`, then base64 of a zlib stream of UTF-8 JSON. `decodeBlueprintString` takes that, with blanks and line breaks anywhere in it (a string pasted from a forum) and with or without base64 padding, and it takes the plain JSON, which the game also imports: text that starts with `{`. The content of a file is passed the same way; reading the file is the caller's business. It never throws: bad input is a result with a code and a message for a person. The Adler-32 checksum of the stream is verified (fflate does not), so a string that was cut or changed is `invalid-compression`.

`encodeBlueprintString` writes what the game writes: `0`, standard base64 with padding, zlib level 9.

### Limits

```ts
interface BlueprintLimits { maxStringLength: number; maxDecodedBytes: number; maxDepth: number; maxEntities: number }
DEFAULT_LIMITS = { maxStringLength: 8 MiB, maxDecodedBytes: 32 MiB, maxDepth: 64, maxEntities: 5000 }
```

| Limit | Applies to | Failure |
| --- | --- | --- |
| `maxStringLength` | characters of the string without blanks, also of plain JSON; text of more than twice that is refused unread | `too-long` |
| `maxDecodedBytes` | bytes of the JSON after inflating. The stream is inflated in steps of 4 KiB of input and given up as soon as the output passes the limit, so a small string that unpacks to gigabytes costs a few megabytes | `too-large` |
| `maxDepth` | nesting of objects and arrays, counted in the text before it is parsed | `too-deep` |
| `maxEntities` | entities of one blueprint that come into the editor, counted after the unknown ones are dropped: a stretch of 20000 rails with 30 combinators is 30 | `too-many-entities` (import) |

The number of entities and wires in the JSON itself is bounded by `maxDecodedBytes`; an import is one pass over them.

### Looking at a string without importing it

```ts
inspectBlueprint(data: unknown): BlueprintInspection

type BlueprintInspection =
  | { kind: "blueprint"; label: string; entities: number; known: number; version?: string }
  | { kind: "book"; label: string; entries: readonly BookEntry[] }
  | { kind: "deconstruction-planner" | "upgrade-planner" | "unknown"; label: string };

interface BookEntry { path: readonly number[]; kind: "blueprint" | "book" | "deconstruction-planner" | "upgrade-planner" | "unknown"; label: string; entities: number; known: number }
```

For a book the entries are all its items in order, a book inside a book included and followed by its own entries (the tree is in `path`: the positions in the nested `blueprints` lists). `entities` and `known` are filled for blueprints: how many entities it has and how many of them the editor knows.

### Import

```ts
importBlueprint(data: unknown, options?: ImportOptions): ImportResult
importBlueprintString(text: string, options?: ImportOptions): ImportResult   // decodes first; the codes of the decoder pass through

interface ImportOptions {
  instruments?: readonly SpeakerInstrument[];   // speakerInstrumentNames(catalog) of @face/catalog
  unitsPerTile?: number;                         // default 92 (DEFAULT_UNITS_PER_TILE)
  grid?: number;                                 // default 20 (DEFAULT_EDIT_GRID); 1 for none
  select?: readonly number[];                    // the path of a blueprint in a book
  limits?: Partial<BlueprintLimits>;
}

type ImportResult =
  | { ok: true; circuit: Circuit; report: ImportReport }
  | { ok: false; code: ImportErrorCode; message: string; book?: readonly BookEntry[] };
type ImportErrorCode = DecodeErrorCode | "not-a-blueprint" | "book" | "unsupported-item" | "unsupported-version" | "invalid-selection" | "too-many-entities";
```

- **A book is not imported.** The result is `code: "book"` with `book`, the entries as `inspectBlueprint` lists them; the caller lets the user choose a blueprint and imports again with `select: entry.path`. Selecting a book inside the book lists that one.
- **Planners are refused** (`unsupported-item`: "This is a deconstruction planner, not a blueprint; the editor imports blueprints only"), and so is anything that is neither (`not-a-blueprint`).
- **Versions.** Factorio 2.0 and 2.1 are imported. Strings of the pre-release of 2.0 (version 1.2.x, the only circuit the game data ships is one) have the same layout and are imported with a warning. 1.1 and older are refused (`unsupported-version`): they stored wires and combinator settings differently. A newer version is imported with a warning. A blueprint without a usable `version` is imported.
- **The circuit.** The label of the blueprint is its name ("" without one). Entities are in the order of the blueprint and named by the naming rule of the editor for new entities (`entityNameBase` of the model), what the entity is and a number: `constant1`, `decider1`, `decider2`, `pole1`, and for a generic entity its prototype without a tier number, `fast_inserter1`, `steel_chest2`, `assembling_machine1`. Ids are `e1`, `e2`, ... The blueprint position is `placement.tile`, unchanged, also when it is off the tile grid (the editor then warns `tile-off-grid`). The direction is `placement.direction`; east is not said, as the editor does not say it, and an entity that cannot turn (a lamp, a pole, a speaker, a chest) has none. For the directions of the generic entities see "Generic entities" below. A blueprint of a space platform has its hub at (0, 0) and comes in as it is.
- **Edit positions** (`position`, the `at` of the language) are derived from the tiles so that the edit canvas shows the arrangement of the blueprint: the top-left tile of each footprint times `unitsPerTile`, rounded to `grid`, with the top-left corner of the whole at (0, 0). The defaults are the scale and the grid at which the renderer derives a tile from an edit position (`EDIT_UNITS_PER_TILE` and `GRID` in `apps/renderer`), so entities that touch in the game overlap as cards; pass a larger `unitsPerTile` (a card is 184 x 128) for cards that stand apart.
- **The result can be printed.** `analyze(printCircuit(circuit))` has no errors and gives the same entities. Where the game allows a state the language has no words for, the importer brings it into the nearest one and reports it (see the table below); an entity that still cannot be written (a wildcard where neither the game nor the language takes one) is reset to the defaults of its kind, keeps its place and wires (a generic entity also what it kept of the blueprint), and is reported with `kind: "reset"`.
- It never throws, whatever the data.

#### What import drops, and the report

```ts
interface ImportReport {
  version?: string;                              // "2.1.25.0"
  entities: number;                              // in the circuit
  dropped: readonly { name: string; count: number; reason: "unknown" | "invalid" }[];   // most frequent first
  wires: { imported: number; copper: number; toDropped: number; invalid: number };
  settings: readonly ImportNote[];
  ignored: readonly string[];                    // fields of the blueprint itself: "description", "icons", "tiles", ...
  warnings: readonly string[];
}
interface ImportNote { prototype: PrototypeName; field: string; kind: "ignored" | "invalid" | "changed" | "reset"; message: string; count: number; entities: readonly string[] }
```

| Dropped | Reported as |
| --- | --- |
| Entities of a prototype the editor does not know: everything that no circuit wire connects to (gates, rails, rolling stock) and modded entities | `dropped`, by prototype name with a count, `reason: "unknown"` |
| Entities of a known prototype without a usable `entity_number` or `position`, or with a number that is taken | `dropped`, `reason: "invalid"` |
| Circuit wires with an end on a dropped entity | `wires.toDropped` |
| Copper wires (connectors 5 and 6: power between poles and switches) | `wires.copper` |
| Wires that are none: not four whole numbers, an entity number the blueprint does not have, a connector the entity does not have, a red connector wired to a green one, a connector wired to itself | `wires.invalid` |
| Fields of the blueprint besides `item`, `label`, `entities`, `wires`, `version` that hold something: `description`, `icons`, `label_color`, `snap-to-grid`, `absolute-snapping`, `position-relative-to-grid`, `tiles`, `schedules`, `stock_connections`, `parameters` | `ignored`, by field name |
| Of a combinator, a lamp, a pole or a speaker, the fields the editor does not model: `quality` other than normal, `tags`, `items`, `mirror`, `connect_to_logistic_network`, anything a later game version adds | `settings`, `kind: "ignored"` (`changed` for `mirror` and the logistic connection of a lamp) |
| Of a generic entity: wiring of an older format on the entity itself (`wires`, `connections`, `neighbours`) | `settings`, `kind: "ignored"`. Every other field it does not model is kept, not dropped, and not reported |

A note of `settings` is about one field of one prototype: `field` is the path in the entity record with list positions left out (`control_behavior.sections.sections[].filters[].comparator`), `message` reads as the rest of a sentence that starts with the field ("is something the editor does not have"), `count` is the number of entities it applies to and `entities` names the first five of them. The kinds:

- `ignored`: the editor has nothing like it; dropped.
- `invalid`: not a value the field takes (a text for a number, an operation the game does not have); the default stands in.
- `changed`: read, but not kept as it was. These are the cases:

| In the blueprint | In the circuit |
| --- | --- |
| A direction that is not one of 0, 4, 8, 12 on a combinator, or on a generic entity that is built in four directions or two | the one of them before it (1, 2, 3 are north), which is how the game builds it |
| Generic entity: a direction that is not a quarter turn (a turret of eight directions, a rail signal of sixteen) | faces the nearest quarter turn in the editor; the direction itself is kept and written back. An odd direction on an entity of eight is the even one before it, as in the game |
| Generic entity: a condition kept while its flag is off | no condition |
| Constant combinator: a signal twice in one section | once, the counts added (32 bits, wrapping) |
| Constant combinator: a wildcard signal in a filter | the filter is dropped |
| Constant combinator: a quality comparator other than `=` on a filter | taken as `=` |
| Arithmetic combinator: operands but no output signal | not configured (the language has an expression or none) |
| Decider combinator: a condition without a left side next to other conditions or outputs | the condition is dropped; this can change what the combinator decides. The blank rows of a combinator without any setting are passed over silently |
| Lamp: a condition kept while "enable/disable" is off | no condition |
| Lamp: a color mode kept while "use colors" is off, or a mode number that is none | color mapping |
| Lamp: a `color` that is none | no color |
| Speaker: "signal value is pitch" without a signal | not configured |
| Speaker: a comparator and right side next to "signal value is pitch" | dropped (not used in that mode) |
| Speaker: "signal value is volume" without a signal, or a signal kept while it is off | volume from the slider, no signal |
| Speaker: a volume outside 0 to 1 | the nearest end |
| Speaker: an instrument or note beyond the lists given, or no lists given and an id other than 0 | the first instrument, the first note |

Passed over without a note, because they mean nothing where they stand: what a logistic request has and a constant combinator does not, which is not written back: the request fields of a filter (`max_count`, `minimum_delivery_count`, `import_from`), which a logistic group shared with a requester or a platform hub brings along, and `trash_not_requested`; a `direction` on a lamp, a pole, a speaker or a generic entity that does not turn (the game drops it too); the one empty section of a constant combinator as the game places it, and `sections: null`, which the game writes when all sections were removed (both are no section in the editor); a side of a splitter that is on without a condition, which gets the condition the game has for it (its signal I or O below 0 for left, above 0 for right); on a lamp and on a generic entity a condition whose flag is on and that has no left side, written or not ("enable/disable" on without a signal), which is the unset condition of the model (`UNSET_CONDITION`, `when unset` in the source) and does in the simulation what it does in the game (fixture F-29), whatever comparator and constant stand behind the blank signal; on a generic entity a mode that is kept while its checkbox is off (`circuit_hand_read_mode` without `circuit_read_hand_contents`), a blank condition next to a flag that is off, and a signal that is the prototype's own default; a constant next to the signal that takes its place; the networks of a decider output that emits a constant and the constant of one that copies; the fields of the selector modes that are not selected (the game keeps them); empty filter slots, gaps in the slot numbers and decider outputs without a signal; `quality: "normal"`; `logistic_condition` while the lamp is not connected to the logistic network.

### Export

```ts
exportBlueprint(circuit: Circuit, options?: ExportOptions): ExportResult

interface ExportOptions { instruments?: readonly SpeakerInstrument[]; version?: number }   // version: default EXPORT_VERSION, 2.1.25.0
type ExportResult =
  | { ok: true; data: BlueprintFile; string: string; warnings: readonly ExportWarning[] }
  | { ok: false; problems: readonly ExportProblem[] };
interface ExportProblem { code: "empty" | "no-tile" | "off-grid" | "overlap" | "custom-signal" | "unknown-instrument" | "unknown-note" | "invalid-blueprint-data"; entities: readonly string[]; message: string }
interface ExportWarning { code: "description-lost" | "wire-too-long" | "no-item"; entities: readonly string[]; message: string }
```

`data` is the root object (`{ blueprint: { icons, entities, wires, item, label, version } }`, typed in `schema.ts`), `string` its blueprint string. Entity numbers are 1, 2, ... in the order of the circuit; the position is the `tile`; the label is the name of the circuit. Every entity is written as the game writes it, field for field and in the game's order of the fields ("Mapping decisions").

A circuit with the hub of a space platform is written around its (first) hub: every position is the `tile` less the tile of the hub. The game builds such a blueprint with its positions as they are, the hub being the one that stands at (0, 0) of every platform, whose settings it takes from the blueprint; a hub anywhere else would leave the rest of the circuit in the wrong place.

The export fails, with everything that is in the way at once, when

- an entity has no `tile` (`no-tile`: one problem whose `entities` are the names of all of them, "3 entities have no place in the game (no 'tile'): 'a', 'c', 'd'. Place every entity on the blueprint board first"),
- a `tile` is off the tile grid for its entity (`off-grid`) or two entities share a tile (`overlap`): the game would move or refuse them. A land mine stands anywhere and is never off the grid; for overlaps it counts with the nearest tile,
- an entity uses a custom signal (`custom-signal`, one problem per entity that names the signals): the game does not have it,
- a speaker names an instrument or a note that the lists in `instruments` do not have, or names one and no lists were given (`unknown-instrument`, `unknown-note`),
- the kept data of a generic entity (`blueprintData`, `blueprint-data` in the source) is not the JSON text of an object (`invalid-blueprint-data`),
- the circuit has no entities (`empty`).

It warns, and exports, when anything but a combinator has a description (the game has one on combinators only), when a wire is longer than it reaches in the game (9 tiles, a pole its own reach: the game may not connect it), and when the circuit has an entity that no item builds (`no-item`: the chests of the game's editor and of the crash site, `blue-chest`, `red-chest`, `crash-site-chest-1` and `-2`): the game leaves such an entity and its wires out when it reads the blueprint, and says that the import had errors.

`connectorId(entity, end, color)` is the connector number of a wire end, exported for callers that show it.

## In the app

The desktop app uses the package in its renderer (`apps/renderer/src/session/blueprints.ts`): `importBlueprintString` with `speakerInstrumentNames` of the catalog and with the renderer's own scale and grid (`EDIT_UNITS_PER_TILE` of `canvas/board.ts`, `GRID` of `canvas/geometry.ts`; `apps/renderer/test/session/blueprints.test.ts` pins that they equal `DEFAULT_UNITS_PER_TILE` and `DEFAULT_EDIT_GRID`), and `exportBlueprint` with the instruments of the project's modules. The package knows no module: an import keeps every entity and signal the game data in use has, whichever module or mod it is of. The session then gives the project it opens the modules of a new project and those that the signals and entities of the imported circuit are of, with what they require, and adds what that switched on to the report ("Switched on: ..."; `apps/renderer/README.md`, "Blueprints of the game"). An export does not look at the modules either: an entity or signal of a module that is off is written like any other. The limits are the defaults; the main process bounds the files it reads and writes by the same numbers (`LIMITS.blueprintFileBytes`, `LIMITS.blueprintStringLength` in `apps/desktop/src/ipc.ts`, pinned against `DEFAULT_LIMITS` in `apps/desktop/test/blueprintFiles.test.ts`). The dialogs are described in `apps/renderer/README.md`, "Blueprints of the game".

## Mapping decisions

Every row is what the game itself writes (fixture F-01), also the order of the fields.

| Topic | Decision |
| --- | --- |
| Direction | `defines.direction` in sixteen steps: north 0 (not written), east 4, south 8, west 12. Written for every entity that can turn (the entity table of the model says which). An entity of the editor without `facing` faces east, so it is written as 4; a blueprint entity without `direction` faces north and is imported as `facing north` |
| Fields of an entity | `entity_number`, `name`, `position`, `direction`, `control_behavior`, then the fields of its kind (`color` before `always_on`; `parameters`, `alert_parameters`), `player_description` last |
| Connector ids | 1 red and 2 green for the input of an arithmetic, decider or selector combinator and for the one connection point of every other entity (also the constant combinator, whose terminal the editor calls `out`, and every generic entity); 3 red and 4 green for the output of those three. 5 and 6 are copper. A wire is `[entity, connector, entity, connector]` with the lower entity number first; the list is in the order of the first end (entity, then connector), then of the second |
| Signals | `type` left out for an item, `quality` left out for normal; in a constant combinator filter `quality` and `comparator: "="` always |
| Conditions | `first_signal`, then `second_signal` or `constant` (also when it is 0), then `comparator`, always (also `<`); written `≥`, `≤`, `≠`, both spellings read. A condition of a decider combinator differs: see there |
| Network selection | written `{ red, green }` with both keys when it is not both; any subset of the keys read |
| Constant combinator | `sections` always, then `is_on` only when off; per section `index`, `filters` (slots numbered 1, 2, ...), `group`, `multiplier` other than 1, `active` only when false. A combinator without sections is written as the game places one: with one empty section, `[{ index: 1 }]`, which is read as no section |
| Arithmetic | always written: signal or constant per side (a constant also when 0), `operation`, `output_signal`, and after these the network selections. One that is not configured is `{ first_constant: 0, second_constant: 0, operation: "*" }`; the game places one as `{ second_constant: 0, operation: "*" }` and writes the first constant from its first reading of a blueprint on |
| Decider | always written, with all three lists (`conditions`, `outputs`, `else_outputs`), also the empty ones. A condition: `first_signal`, `second_signal` or `constant`, `comparator`, the network selections, `compare_type` only for `and`; unlike every other condition a `constant` of 0 and the `comparator` `<` are left out. Outputs: `copy_count_from_input` only when false, `constant` other than 1. One without anything is written as the game places it, with a blank condition and a blank output: `[{}]`, `[{}]`, `[]` |
| Selector | always written, the parameters directly in `control_behavior` (no `selector_conditions` wrapper; the wrapper of the pre-release is read). Only the fields of the selected mode: `select_max` and index always (`index_comparator` only when not `=`), `random_update_interval` unless 0, `select_highest_quality` always, `quality_source_static` unless normal, the time signals as game tick, day tick, day length. As placed: `{ operation: "select", select_max: true, index_constant: 0 }` |
| Lamp | `input_networks`, `circuit_enabled` with `circuit_condition` when there is a condition (`circuit_enabled` alone for the unset one, as the game writes it), `use_colors`, the color signals, then `color_mode` 0 mapping (not written), 1 components, 2 packed RGB; `color` as 0 to 1 with `a: 1` (read: 0 to 1, or 0 to 255 when a value is above 1). No `control_behavior` at the defaults |
| Speaker | `control_behavior` first, then `parameters` and `alert_parameters`, both always in full. The control behaviour is `circuit_condition` (only when there is one) and `circuit_parameters` in full; none at all for a speaker the circuit does not concern (no condition, no pitch signal, the first instrument and note, nothing to stop). Volume percent / 100. The pitch signal is the left side of the condition with `signal_value_is_pitch` |
| Instruments | `instrument_id` and `note_id` are positions from 0 in the lists passed as `instruments`; the editor has the names. Id 0 is imported as "not said" (the first instrument, the first note of the instrument), which is what the model means by absent |
| Floats | the game stores multipliers, volumes and colors in 32 bits and writes them out in full (0.800000011920928955078125 for a volume of 80). Read: the shortest decimal that names the float (0.8); volume in percent to seven digits |
| Version | `EXPORT_VERSION`: 2.1.25.0; the game takes the build number 0 (it writes 2.1.25.10 itself; 2.1.24 wrote 2.1.24.1) |
| Icons | up to four, the items that build the most frequent prototypes (`placedBy` of the entity table); a prototype no item builds (four chests of the game's editor) is shown as an entity signal |
| Space platform | a circuit with the hub of a platform has the hub at (0, 0) (see "Export") |

## Generic entities

The 88 prototypes without a kind of their own are one kind, `entity`, with the prototype saying which one it is. Their mapping is not code per entity but the settings table of the model (`ENTITY_SETTINGS` in `packages/model/src/entitySettings.ts`, one row per prototype type): a setting names the field of `control_behavior` it is read from and written to, its type and its default. `src/generic.ts` reads and writes by that table, so a further prototype type is a row there and nothing here.

| Setting | In the blueprint | Read | Written |
| --- | --- | --- | --- |
| boolean | the field | the value, the default of the table without one | when it is not the default |
| signal | the field, a SignalID | absent when it is the prototype's own default signal (`EntityPrototype.signals`) | when the entity names one that is not the default |
| network selection (`input_networks`, `output_networks`) | `{ red, green }` | any subset of the keys; both without the field | both keys, when it is not both |
| condition | the condition and the boolean flag that says it is in use (`circuit_condition` with `circuit_enabled`; the two conditions of a splitter side share `set_input_side`) | in the settings exactly when the flag is on: the condition, or the unset condition where it has no left side or is not written. Two exceptions where it is not written: a side of a splitter has the one the game takes for it (`gameDefault` of the setting: signal I or O `< 0` for left, `> 0` for right), and the open-gate condition of a wall is unset only when the blueprint names the flag (the game writes `circuit_open_gate: true` for a wall with a wire, fixture F-29); a wall whose blueprint does not name it has no condition | the flag as `true` and the condition; a condition that is the game's own for its place is left out, as the game leaves it out. The unset condition is the flag alone (`circuit_enabled: true` without `circuit_condition`, as the game writes it), but for a side of a splitter, where a missing condition means the game's own: there it is a condition without a left side, `{ constant: 0, comparator: "<" }`. The open-gate flag of a wall, which the game has on in a new wall, is written as `false` for a wall without that condition as soon as the wall has any setting |
| mode (enum) | the number of the game's define (from 0; the modes of a radar from 1); where the game has a checkbox in front of the modes, also that flag | the word of the number; the off word when the flag is off; the first mode when the flag is on without a number. The roboport's `read_items_mode` is also read as the boolean the API reference gives it (the game writes the number) | when it is not the default: the flag (`false` alone for the off word) and the number |

**What is kept.** Everything else the blueprint says about a generic entity stays with it as `blueprintData`: the JSON text (`JSON.stringify`) of an object laid out like the entity record, with its keys in the order of the record. In it: `recipe`, `filters`, `request_filters`, `bar`, `items`, `quality` other than normal, `mirror`, `tags`, `station`, `player_description`, fields of the `control_behavior` without a setting (the messages of a display panel, the research conditions of a lab, whatever a later version adds), and a `direction` the editor cannot hold. Not in it: `entity_number`, `name`, `position`, the modelled fields of the `control_behavior`, fields that are `null`, `quality: "normal"`, and entity-level wiring of an older format. Without anything to keep there is no `blueprintData`. The text is held byte for byte by the model and by the circuit language (`blueprint-data = "..."`).

On export the kept object is written back with the modelled fields over it. The fields stand in the order they were kept in, `direction` and `control_behavior` among them, so that importing the result gives the same text; where the kept data has no `direction` or no `control_behavior` and the entity needs one, it comes first, in this order. In the `control_behavior` the kept fields come first, then the settings in the order of the game: the network selections, then the settings in the order of the table, a flag before its condition or mode, but for the control behaviours where the game has another order (`FIELD_ORDER` in `src/generic.ts`: the condition of a wall, a rail signal and a logistic chest comes last, for example). Kept data that names a modelled field, a number, a name or a position loses to the editor.

A setting of the editor that the game has no use for on a prototype is written and not kept by the game: `read-fuel` on a machine or a lab that burns nothing, the sent networks of a turret without ammunition (`laser-turret`, `tesla-turret`) and of a `heat-exchanger`, the read networks of an `infinity-chest`. The settings table is per prototype type and does not know these.

**Directions.** Read as the game builds them (fixture F-01 has what becomes of each of the sixteen directions for every prototype). A quarter turn (0, 4, 8, 12) is the entity's `facing`; on an entity of four directions any other direction is the quarter turn before it, with a note. An entity the game builds in two directions (the storage tank) faces north or east: 8 is read as north and 12 as east. Of an entity of eight or sixteen directions (a flamethrower turret, a rail signal) a direction that is no quarter turn is kept in `blueprintData` and reported as `changed`; the entity faces the nearest quarter turn in the editor (halfway goes clockwise). A direction on a prototype that does not turn is passed over, as the game passes over it: a chest, a radar, and also the gun, laser, rocket and tesla turrets, which have a direction in the game that no blueprint holds. On export a kept direction is written while the entity still faces the quarter turn nearest to it; once it was turned in the editor, the editor's direction is written.

A crafting machine with fluid boxes (`assembling-machine-2` and `-3`, the chemical plant, the foundry, ...) has four directions in the entity table. The game holds the direction of some of them only while their recipe uses the fluid boxes: without a recipe `assembling-machine-2`, `-3`, `biochamber`, `cryogenic-plant`, `electromagnetic-plant` and `foundry` face north whatever they are built with. The package writes the direction the editor has; the recipe is kept data.

## Round trips

**Editor to blueprint to editor** keeps everything the editor models: every setting of every kind, tiles, directions, wires. `test/roundtrip.test.ts` proves it for the sample circuits and for 400 generated ones. What differs afterwards is a matter of form, and the test spells it out (`afterRoundTrip`):

- names and ids are new (the naming rule), because a blueprint has neither; edit positions are derived from the tiles;
- a circuit with the hub of a space platform stands around its hub, which is at (0, 0);
- `facing east` is not said; `facing` on an entity that cannot turn is gone; a storage tank facing south or west faces north or east;
- an empty description is none; the description of anything but a combinator is gone (warning at export);
- kept data that holds nothing (`{}`) is none; a kept direction on an entity that does not turn is gone;
- a section group named "" is no group; one section without group, filters, multiplier or switch is no section;
- a side of a splitter with one of its two conditions has the game's own condition for the other (an unset condition is one it has, and stays);
- the first instrument and the first note of an instrument, named explicitly, are not said;
- the source signal of a quality transfer loses its quality (the game's field has none).

Exporting what came back gives the same blueprint and the same string.

**Blueprint to editor to blueprint** keeps everything about the known entities that the editor models, their circuit wires, and of a generic entity every field it does not model, as it stood. Lost are:

- the entities the editor does not know, with their wires, and all copper wires;
- entity numbers (renumbered from 1) and the order of wires;
- of the blueprint: description, icons (new ones are made), label color, snapping (`snap-to-grid`, `absolute-snapping`, `position-relative-to-grid`), tiles, schedules, stock connections, parameters, the version it was from;
- of a combinator, a lamp, a pole or a speaker: entity quality, tags, item requests, mirroring, every field the editor does not model or does not know (reported in `settings`), gaps in filter slot numbers, and the states of the table under `changed` above;
- of a lamp and of a generic entity: the comparator and the constant of a condition that was in use without a left side (`{ comparator: "=", constant: 0 }` comes back as the flag alone; neither changes what the entity does);
- of a generic entity: a condition that was kept while its flag was off, the open-gate flag of a wall whose blueprint has a control behaviour and does not name the flag (the game has it on then; it comes back as off), a mode kept while its checkbox was off, fields that were `null`, `quality: "normal"`, a direction the game does not build the entity in, and where its `direction` and `control_behavior` stood among its fields if it kept neither;
- of a constant combinator: that it had no section at all (it comes back with the one empty section of a new one);
- how defaults were written: the blueprint comes back in the form of "Mapping decisions".

A blueprint that this package exported comes back identical, and so does every further trip of any blueprint: what the first import kept is what every later one keeps (`test/generic.test.ts`).

## Verified against the game

`tests/fixtures/game/F-01-blueprints.json` is a recording of Factorio 2.1.25 with its five standard modules (recorded again on 2026-11-17; but for the version numbers it is what 2.1.24 gave on 2026-11-14), made by `make probe-blueprints` (below). `test/game.test.ts` holds the package against it (`test/recording.ts`), and it is where every row of "Mapping decisions" and of the settings table is from. The recording has:

- the numbers of the defines: directions, connectors, the lamp's color modes, and the modes of the generic entities;
- every prototype as the game places it, untouched and with its control behaviour created, as blueprints (the hub of a space platform on a platform);
- for every generic prototype what the control behaviour of a new entity says for each setting of the table: the defaults, the default signals included;
- for every prototype what becomes of each of the sixteen directions: in a blueprint that is given it, on the entity built from that, in the blueprint the game makes of that entity, and on an entity created with it;
- per sample circuit of `test/samples.ts` the blueprint the game makes of ours right after reading it, of what it built from ours, and of the same circuit built through the runtime API without a blueprint of ours.

The tests: every string of the game decodes; each of the three blueprints imports to the circuit that was sent, with nothing reported; the exporter writes every entity and wire as the game does, compared field by field and in the order of the fields with the first and the third (floats to six digits); an entity as the game places it is the default of the editor; the defaults and the numbers of the settings table are the game's; the directions are those of the entity table. For a generic entity the comparison is about what the editor models: its direction and the fields of its `control_behavior` that are settings; the fields it only keeps are the game's business (it gives a train stop a name, a display panel an empty message).

What the game corrected in this package is listed in `docs/factorio-audit.md` 12.2. What it showed that the editor does not have:

- The game drops `blue-chest`, `red-chest`, `crash-site-chest-1` and `crash-site-chest-2` from a blueprint it reads, because no item builds them (`import_stack` returns -1). The editor has them; the export warns.
- A wall has a connection point and a control behaviour only while a gate stands next to it. The editor has no gates; a wall of a blueprint the game built kept its wire and its settings without one.
- The game keeps `read_fuel` only on what burns fuel, and has no value for the networks of some prototypes (see "Generic entities").
- A new arithmetic combinator of the game has nothing on its left side, which it writes as no `first_constant`; the editor has 0 there, and the game reads a blueprint without the field as 0 as well.

### Still not verified

| What | Why the probe does not settle it |
| --- | --- |
| That the game builds an offshore pump, a mining drill and an asteroid collector from our blueprint with their settings | The probe builds on plain ground: no water, no ore, no space. Their blueprints are verified as the game reads them and as it writes them for entities it created; the step in between is not |
| That the game takes the fields a generic entity only keeps (`recipe`, `filters`, `request_filters`, ...) back as they stand | The samples are circuits of the editor and carry no kept data, and the comparison leaves kept fields out |
| The direction of a crafting machine whose recipe uses its fluid boxes | The samples have no recipes. `import_stack` kept a direction on an `assembling-machine-2` without one, building through the API did not |
| That an instrument or note id is the instrument or note the editor names | A blueprint has the numbers only; the names are from the prototype dump of the catalog, in its order |
| What the game does with a wire longer than its reach when it reads a blueprint | No sample has one: it would be missing from what the game built and the comparison would say so for the wrong reason. The reach itself is fixture F-24 |
| A control behaviour of a generic entity without a circuit wire, through a build | Every generic sample is wired. Lamps and speakers without a wire kept theirs |
| `read_fuel` of a lab; the networks of a heat exchanger, an electric turret, an infinity chest | The game has no value for them on these prototypes; a field written for them is not kept |
| Blueprints of other versions (2.0, the 1.2 pre-release, 1.1) and of mods | The probe runs the installed game, 2.1.25 with the standard modules. Older strings are tested with the ones the game data ships (`test/shipped.test.ts`) |

### The probe

`make probe-blueprints` (`npm run probe-blueprints`, `tools/game-probe/blueprints.mjs`) records the fixture from the installed game, headless and sandboxed like the other probes, in about three seconds; its state is in `.runtime/game-probe/blueprints`, apart from the wire reach probe. A change to a sample of `test/samples.ts` needs a new recording (a test says so). For every sample circuit (between them every setting of every kind and every kind of wire; for the generic entities one prototype per control behaviour of the settings table, generated from the table with every setting away from its default and wired to a constant combinator, and a few written by hand) the game

1. imports the blueprint string this package exported and exports it again (`reexported`),
2. builds it, revives the ghosts and exports a blueprint of what stands there (`rebuilt`),
3. builds the same circuit through the runtime API, without a blueprint of ours, and exports that (`native`).

For a generic entity the third step sets every setting through the attribute of its runtime control behaviour and every mode through its define by name (`tools/game-probe/lib/blueprintCases.ts`, `test/gameNames.ts`). The sample with the hub of a space platform is built on two platforms the probe makes, one per step, so that each hub is untouched. What the game does not do on plain ground is recorded per case and named by a test: `unbuilt` (the three prototypes of the table above) and `helpers` (the gate the probe builds below every wall for the third step, which is in the game's blueprint and dropped by the import). A step the game refuses is recorded with its error and fails its test.

To compare the fixture with the game without writing it: `source scripts/env.sh && node tools/game-probe/blueprints.mjs --check`.

## Tests

`npx vitest run packages/blueprints`: the codec with malformed, truncated, damaged and oversized input (`string.test.ts`); export and import of every setting of every kind, wires between every two kinds of connection point, books, refused items, versions, dropped entities and the report (`export.test.ts`, `import.test.ts`); the generic entities, driven by the settings table: every prototype type with every setting in and out, defaults left out and spelled out, junk in every field, the kept data byte for byte also through the source of the editor, the directions of prototypes with one, two, four, eight and sixteen of them, wires, a foreign blueprint and its further trips (`generic.test.ts`); the two round trips and import of damaged blueprints (`roundtrip.test.ts`); the condition in use without a signal, from the blueprints the game wrote for 22 prototypes (fixture F-29) through the source and the simulation and back (`unsetCondition.test.ts`); the strings that ship with the game (`shipped.test.ts`); the recording of the game (`game.test.ts` with `recording.ts`). The parts of the probe that run without the game are tested in `tools/game-probe/lib/blueprintFixture.test.ts`.

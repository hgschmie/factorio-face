# @face/blueprints

Blueprints of the game: the blueprint string, import of a blueprint as a circuit of the editor, export of a circuit as a blueprint. Pure TypeScript without Node APIs; it runs in the renderer, in a worker and in vitest. It depends on `@face/model`, on `@face/language` (the importer checks with `checkEntity` that the circuit it returns can be written in the circuit language exactly) and on `fflate`. It does not depend on `@face/catalog`: the one thing it needs from the game data, the instruments of the speaker, is passed in.

The editor is a circuit editor, not a blueprint editor. An import keeps the entities the editor knows with their circuit wires, drops everything else and says what it dropped. The editor knows every entity of the game that a circuit wire connects to (`PROTOTYPES` of `@face/model`, 98 prototypes of Factorio 2.1.24): the four combinators, the lamp, the four electric poles and the programmable speaker with a kind of their own, and the other 88 (chests, inserters, belts, machines, turrets, train stops, ...) as generic entities (kind `entity`), whose circuit settings it models and whose other fields it keeps for the blueprint unread. What it drops is what no circuit wire connects to: gates, rails, rolling stock, modded entities.

Game facts are in `docs/factorio-audit.md` (sections 3 to 5 and 12; the control behaviours of the generic entities in its own section). What the game itself has not confirmed yet is listed under "Not verified against the game" below.

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
- **The circuit.** The label of the blueprint is its name ("" without one). Entities are in the order of the blueprint and named by the naming rule of the editor for new entities (`entityNameBase` of the model), what the entity is and a number: `constant1`, `decider1`, `decider2`, `pole1`, and for a generic entity its prototype without a tier number, `fast_inserter1`, `steel_chest2`, `assembling_machine1`. Ids are `e1`, `e2`, ... The blueprint position is `placement.tile`, unchanged, also when it is off the tile grid (the editor then warns `tile-off-grid`). The direction is `placement.direction`; east is not said, as the editor does not say it, and an entity that cannot turn (a lamp, a pole, a speaker, a chest) has none. For the directions of the generic entities see "Generic entities" below.
- **Edit positions** (`position`, the `at` of the language) are derived from the tiles so that the edit canvas shows the arrangement of the blueprint: the top-left tile of each footprint times `unitsPerTile`, rounded to `grid`, with the top-left corner of the whole at (0, 0). The defaults are the scale and the grid at which the renderer derives a tile from an edit position (`EDIT_UNITS_PER_TILE` and `GRID` in `apps/renderer`), so entities that touch in the game overlap as cards; pass a larger `unitsPerTile` (a card is 184 x 128) for cards that stand apart.
- **The result can be printed.** `analyze(printCircuit(circuit))` has no errors and gives the same entities. Where the game allows a state the language has no words for, the importer brings it into the nearest one and reports it (see the table below); an entity that still cannot be written (a wildcard where neither the game nor the language takes one) is reset to the defaults of its kind, keeps its place and wires (a generic entity also what it kept of the blueprint), and is reported with `kind: "reset"`.
- It never throws, whatever the data.

#### What import drops, and the report

```ts
interface ImportReport {
  version?: string;                              // "2.1.24.0"
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
| Of a combinator, a lamp, a pole or a speaker, the fields the editor does not model: `quality` other than normal, `tags`, `items`, `mirror`, the logistic fields of a filter (`max_count`, `import_from`, ...), `connect_to_logistic_network`, anything a later game version adds | `settings`, `kind: "ignored"` (`changed` for `mirror` and the logistic connection of a lamp) |
| Of a generic entity: wiring of an older format on the entity itself (`wires`, `connections`, `neighbours`) | `settings`, `kind: "ignored"`. Every other field it does not model is kept, not dropped, and not reported |

A note of `settings` is about one field of one prototype: `field` is the path in the entity record with list positions left out (`control_behavior.sections.sections[].filters[].max_count`), `message` reads as the rest of a sentence that starts with the field ("is something the editor does not have"), `count` is the number of entities it applies to and `entities` names the first five of them. The kinds:

- `ignored`: the editor has nothing like it; dropped.
- `invalid`: not a value the field takes (a text for a number, an operation the game does not have); the default stands in.
- `changed`: read, but not kept as it was. These are the cases:

| In the blueprint | In the circuit |
| --- | --- |
| A direction that is not one of 0, 4, 8, 12 on a combinator | the nearest of the four |
| Generic entity: a direction that is not a quarter turn (a turret of eight directions, a rail signal of sixteen) | faces the nearest quarter turn in the editor; the direction itself is kept and written back |
| Generic entity: a flag on with a blank condition ("enable/disable" without a signal) | not in use |
| Generic entity: a condition kept while its flag is off | no condition |
| Constant combinator: a signal twice in one section | once, the counts added (32 bits, wrapping) |
| Constant combinator: a wildcard signal in a filter | the filter is dropped |
| Constant combinator: a quality comparator other than `=` on a filter | taken as `=` |
| Arithmetic combinator: operands but no output signal | not configured (the language has an expression or none) |
| Decider combinator: a condition without a left side next to other conditions or outputs | the condition is dropped; this can change what the combinator decides. The blank rows of a combinator without any setting are passed over silently |
| Lamp: "enable/disable" on with a blank condition | not controlled by the circuit |
| Lamp: a condition kept while "enable/disable" is off | no condition |
| Lamp: a color mode kept while "use colors" is off, or a mode number that is none | color mapping |
| Lamp: a `color` that is none | no color |
| Speaker: "signal value is pitch" without a signal | not configured |
| Speaker: a comparator and right side next to "signal value is pitch" | dropped (not used in that mode) |
| Speaker: "signal value is volume" without a signal, or a signal kept while it is off | volume from the slider, no signal |
| Speaker: a volume outside 0 to 1 | the nearest end |
| Speaker: an instrument or note beyond the lists given, or no lists given and an id other than 0 | the first instrument, the first note |

Passed over without a note, because they mean nothing where they stand: a `direction` on a lamp, a pole or a speaker; on a generic entity a mode that is kept while its checkbox is off (`circuit_hand_read_mode` without `circuit_read_hand_contents`), a blank condition next to a flag that is off, and a signal that is the prototype's own default; a constant next to the signal that takes its place; the networks of a decider output that emits a constant and the constant of one that copies; the fields of the selector modes that are not selected (the game keeps them); empty filter slots, gaps in the slot numbers and decider outputs without a signal; `quality: "normal"`; `logistic_condition` while the lamp is not connected to the logistic network.

### Export

```ts
exportBlueprint(circuit: Circuit, options?: ExportOptions): ExportResult

interface ExportOptions { instruments?: readonly SpeakerInstrument[]; version?: number }   // version: default EXPORT_VERSION, 2.1.24.0
type ExportResult =
  | { ok: true; data: BlueprintFile; string: string; warnings: readonly ExportWarning[] }
  | { ok: false; problems: readonly ExportProblem[] };
interface ExportProblem { code: "empty" | "no-tile" | "off-grid" | "overlap" | "custom-signal" | "unknown-instrument" | "unknown-note" | "invalid-blueprint-data"; entities: readonly string[]; message: string }
interface ExportWarning { code: "description-lost" | "wire-too-long"; entities: readonly string[]; message: string }
```

`data` is the root object (`{ blueprint: { icons, entities, wires, item, label, version } }`, typed in `schema.ts`), `string` its blueprint string. Entity numbers are 1, 2, ... in the order of the circuit; the position is the `tile`; the label is the name of the circuit.

The export fails, with everything that is in the way at once, when

- an entity has no `tile` (`no-tile`: one problem whose `entities` are the names of all of them, "3 entities have no place in the game (no 'tile'): 'a', 'c', 'd'. Place every entity on the blueprint board first"),
- a `tile` is off the tile grid for its entity (`off-grid`) or two entities share a tile (`overlap`): the game would move or refuse them. A land mine stands anywhere and is never off the grid; for overlaps it counts with the nearest tile,
- an entity uses a custom signal (`custom-signal`, one problem per entity that names the signals): the game does not have it,
- a speaker names an instrument or a note that the lists in `instruments` do not have, or names one and no lists were given (`unknown-instrument`, `unknown-note`),
- the kept data of a generic entity (`blueprintData`, `blueprint-data` in the source) is not the JSON text of an object (`invalid-blueprint-data`),
- the circuit has no entities (`empty`).

It warns, and exports, when anything but a combinator has a description (the game has one on combinators only) and when a wire is longer than it reaches in the game (9 tiles, a pole its own reach): the game may not connect it.

`connectorId(entity, end, color)` is the connector number of a wire end, exported for callers that show it.

## In the app

The desktop app uses the package in its renderer (`apps/renderer/src/session/blueprints.ts`): `importBlueprintString` with `speakerInstrumentNames` of the catalog and with the renderer's own scale and grid (`EDIT_UNITS_PER_TILE` of `canvas/board.ts`, `GRID` of `canvas/geometry.ts`; `apps/renderer/test/session/blueprints.test.ts` pins that they equal `DEFAULT_UNITS_PER_TILE` and `DEFAULT_EDIT_GRID`), and `exportBlueprint` with the instruments of the project's modules. The limits are the defaults; the main process bounds the files it reads and writes by the same numbers (`LIMITS.blueprintFileBytes`, `LIMITS.blueprintStringLength` in `apps/desktop/src/ipc.ts`, pinned against `DEFAULT_LIMITS` in `apps/desktop/test/blueprintFiles.test.ts`). The dialogs are described in `apps/renderer/README.md`, "Blueprints of the game".

## Mapping decisions

| Topic | Decision |
| --- | --- |
| Direction | `defines.direction` in sixteen steps: north 0 (not written), east 4, south 8, west 12. Written for every entity that can turn (the entity table of the model says which). An entity of the editor without `facing` faces east, so it is written as 4; a blueprint entity without `direction` faces north and is imported as `facing north` |
| Connector ids | 1 red and 2 green for the input of an arithmetic, decider or selector combinator and for the one connection point of every other entity (also the constant combinator, whose terminal the editor calls `out`, and every generic entity); 3 red and 4 green for the output of those three. 5 and 6 are copper. A wire is `[entity, connector, entity, connector]` with the lower entity number first, the list sorted |
| Signals | `type` left out for an item, `quality` left out for normal; in a constant combinator filter `quality` and `comparator: "="` always, as the game data has them |
| Comparators | written `≥`, `≤`, `≠` as the game does; both spellings read |
| Network selection | written `{ red, green }` with both keys when it is not both; any subset of the keys read |
| Constant combinator | `is_on` only when off; per section `index`, `filters` (slots numbered 1, 2, ...), `group`, `multiplier` other than 1, `active` only when false. No `control_behavior` without sections |
| Arithmetic | signal or constant per side (a constant also when 0), `operation` always. No `control_behavior` when not configured |
| Decider | `comparator` always, `constant` when there is no second signal, `compare_type` only for `and`; outputs: `copy_count_from_input` only when false, `constant` other than 1. Empty lists left out; no `control_behavior` without any |
| Selector | parameters directly in `control_behavior` (no `selector_conditions` wrapper; the wrapper is read). Only the fields of the selected mode. No `control_behavior` for select, descending, index 0, `=` |
| Lamp | `circuit_enabled` with `circuit_condition` when there is a condition; `use_colors`; `color_mode` 0 mapping (not written), 1 components, 2 packed RGB; `color` as 0 to 1 with `a: 1` (read: 0 to 1, or 0 to 255 when a value is above 1). No `control_behavior` at the defaults |
| Speaker | `parameters`, `alert_parameters` and `control_behavior` (`circuit_condition`, `circuit_parameters`) always in full. Volume percent / 100. The pitch signal is the left side of the condition with `signal_value_is_pitch` |
| Instruments | `instrument_id` and `note_id` are positions from 0 in the lists passed as `instruments`; the editor has the names. Id 0 is imported as "not said" (the first instrument, the first note of the instrument), which is what the model means by absent |
| Floats | the game stores multipliers, volumes and colors in 32 bits. Read: the shortest decimal that names the float (0.1 for 0.10000000149011612); volume in percent to seven digits |
| Version | `EXPORT_VERSION`: 2.1.24.0 |
| Icons | up to four, the items that build the most frequent prototypes (`placedBy` of the entity table); a prototype no item builds (four chests of the game's editor) is shown as an entity signal |

## Generic entities

The 88 prototypes without a kind of their own are one kind, `entity`, with the prototype saying which one it is. Their mapping is not code per entity but the settings table of the model (`ENTITY_SETTINGS` in `packages/model/src/entitySettings.ts`, one row per prototype type): a setting names the field of `control_behavior` it is read from and written to, its type and its default. `src/generic.ts` reads and writes by that table, so a further prototype type is a row there and nothing here.

| Setting | In the blueprint | Read | Written |
| --- | --- | --- | --- |
| boolean | the field | the value, the default of the table without one | when it is not the default |
| signal | the field, a SignalID | absent when it is the prototype's own default signal (`EntityPrototype.signals`) | when the entity names one that is not the default |
| network selection (`input_networks`, `output_networks`) | `{ red, green }` | any subset of the keys; both without the field | both keys, when it is not both |
| condition | the condition and the boolean flag that says it is in use (`circuit_condition` with `circuit_enabled`; the two conditions of a splitter side share `set_input_side`) | in the settings exactly when the flag is on and the condition has a left side | the flag as `true` and the condition |
| mode (enum) | the number of the game's define; where the game has a checkbox in front of the modes, also that flag | the word of the number; the off word when the flag is off; the first mode when the flag is on without a number. The roboport's `read_items_mode` is also read as the boolean the API reference gives it | when it is not the default: the flag (`false` alone for the off word) and the number |

**What is kept.** Everything else the blueprint says about a generic entity stays with it as `blueprintData`: the JSON text (`JSON.stringify`) of an object laid out like the entity record, with its keys in the order of the record. In it: `recipe`, `filters`, `request_filters`, `bar`, `items`, `quality` other than normal, `mirror`, `tags`, `station`, `player_description`, fields of the `control_behavior` without a setting (the messages of a display panel, the research conditions of a lab, whatever a later version adds), and a `direction` the editor cannot hold. Not in it: `entity_number`, `name`, `position`, the modelled fields of the `control_behavior`, fields that are `null`, `quality: "normal"`, and entity-level wiring of an older format. Without anything to keep there is no `blueprintData`. The text is held byte for byte by the model and by the circuit language (`blueprint-data = "..."`).

On export the kept object is written back with the modelled fields over it. The fields stand in the order they were kept in, `direction` and `control_behavior` among them, so that importing the result gives the same text; where the kept data has no `direction` or no `control_behavior` and the entity needs one, it comes first, in this order. In the `control_behavior` the kept fields come first, then the settings in the order of the table, a flag before its condition or mode. Kept data that names a modelled field, a number, a name or a position loses to the editor.

**Directions.** A quarter turn (0, 4, 8, 12) is the entity's `facing`. An entity the game builds in two directions (the storage tank) faces north or east: 8 is read as north and 12 as east. A direction that is no quarter turn (the eight directions of a flamethrower turret, the sixteen of a rail signal) is kept in `blueprintData` and reported as `changed`; the entity faces the nearest quarter turn in the editor (halfway goes clockwise). A direction on a prototype the entity table says cannot turn is kept without a note, because the table's rotation is provisional. On export a kept direction is written while the entity still faces the quarter turn nearest to it, or cannot turn in the editor; once it was turned in the editor, the editor's direction is written.

## Round trips

**Editor to blueprint to editor** keeps everything the editor models: every setting of every kind, tiles, directions, wires. `test/roundtrip.test.ts` proves it for the sample circuits and for 400 generated ones. What differs afterwards is a matter of form, and the test spells it out (`afterRoundTrip`):

- names and ids are new (the naming rule), because a blueprint has neither; edit positions are derived from the tiles;
- `facing east` is not said; `facing` on an entity that cannot turn is gone; a storage tank facing south or west faces north or east;
- an empty description is none; the description of anything but a combinator is gone (warning at export);
- kept data that holds nothing (`{}`) is none;
- a section group named "" is no group;
- the first instrument and the first note of an instrument, named explicitly, are not said;
- the source signal of a quality transfer loses its quality (the game's field has none).

Exporting what came back gives the same blueprint and the same string.

**Blueprint to editor to blueprint** keeps everything about the known entities that the editor models, their circuit wires, and of a generic entity every field it does not model, as it stood. Lost are:

- the entities the editor does not know, with their wires, and all copper wires;
- entity numbers (renumbered from 1) and the order of wires;
- of the blueprint: description, icons (new ones are made), label color, snapping (`snap-to-grid`, `absolute-snapping`, `position-relative-to-grid`), tiles, schedules, stock connections, parameters, the version it was from;
- of a combinator, a lamp, a pole or a speaker: entity quality, tags, item requests, mirroring, every field the editor does not model or does not know (reported in `settings`), gaps in filter slot numbers, and the states of the table under `changed` above;
- of a generic entity: a condition that was kept while its flag was off, a flag that was on with a blank condition, a mode kept while its checkbox was off, fields that were `null`, `quality: "normal"`, and where its `direction` and `control_behavior` stood among its fields if it kept neither;
- how defaults were written: the blueprint comes back in the form of "Mapping decisions".

A blueprint that this package exported comes back identical, and so does every further trip of any blueprint: what the first import kept is what every later one keeps (`test/generic.test.ts`).

## Not verified against the game

The format is implemented from the API reference (`runtime-api.json`, 2.1.23), the blueprint strings that ship in the game data and, where neither says, from assumption; `docs/factorio-audit.md` section 12 has the provenance of each. The strings in the game data confirm: the envelope, the root fields and their order, `entity_number`/`name`/`position`/`direction`, entity `quality`, the constant combinator's sections and filters, lamps with `always_on`, connector ids 1, 3 and 5, and that the game reads a selector's parameters inside a `selector_conditions` wrapper (`test/shipped.test.ts`, `tests/fixtures/blueprints/shipped-2.1.24.json`).

Not confirmed by anything the game wrote, until the probe has run:

- whether 2.1.24 writes the selector's parameters flat (as the API says and as this package writes them) or in the wrapper;
- which defaults the game leaves out and which it writes: `is_on`, `active`, `multiplier`, a constant operand of 0, the `operation` `*`, `copy_count_from_input`, an output `constant` of 1, `compare_type: "or"`, `select_max`, `index_constant`, `random_update_interval` 0, `circuit_enabled`, `use_colors`, `color_mode` 0, and whether an untouched entity has a `control_behavior` at all;
- the shape of a network selection that is not both (`{ red: true, green: false }` or `{ green: false }`);
- the numbers of `defines.control_behavior.lamp.color_mode` (0, 1, 2 assumed from the order in the API), of connectors 2 and 4, and of the directions;
- everything about the arithmetic and decider combinator, the lamp's `control_behavior` and `color`, and the whole programmable speaker (there is no example of any of them in the game data): field names are from the API reference;
- how the game writes "any quality" in a quality filter (assumed: no `quality_filter`) and a quality transfer from the default quality;
- the sections of an untouched constant combinator (the model says none; the game may have one empty section);
- whether the game accepts a `version` with build number 0, a blueprint with the icons this package makes, and a wire longer than its reach.

Of the generic entities nothing is confirmed by a string the game wrote, except that a display panel has `control_behavior.parameters` and an `icon`, and that belts, inserters, chests and assembling machines without a wire have no `control_behavior` (`test/shipped.test.ts`). Field names and which behaviour a prototype type has are from the API reference (`BlueprintEntity` and the `*BlueprintControlBehavior` concepts). Until the probe has run, these stay open:

- the numbers of every mode: `circuit_hand_read_mode` (pulse 0, hold 1), `circuit_contents_read_mode` (pulse 0, hold 1, entire belt hold 2), `circuit_resource_read_mode` (this miner 0, entire patch 1), the radar's `mode` (surface 0, universe 1), `circuit_mode_of_operation` of pipes and tanks (none 0, contents 1, segment contents 2), `read_items_mode` of the roboport (none 0, logistics 1, missing requests 2) and of the rocket silo (none 0, logistic inventory 1, orbital requests 2); and whether the roboport's is a number at all (the blueprint concept of the API reference says boolean, the runtime class a define);
- every default the table marks `assumed`: that a mining drill reads its resources and a rail signal its state without being told, that a belt and an inserter read nothing, the `read_*` and `set_research` of the lab, `read_ammo` of the artillery turret, `read_robot_stats`, `circuit_read_sensor` of the wall, and the defaults of the modes above;
- what the game writes at a default: whether it spells out the fields the API reference does not mark optional (`circuit_read_hand_contents`, `circuit_contents_read_mode`, `circuit_close_signal`, `circuit_read_signal`, `circuit_open_gate`, `circuit_read_sensor`, the signals of a train stop, a heat pipe or a tank), whether it writes a prototype's default signal, and whether an untouched or unwired entity has a `control_behavior` at all. This package writes none of them at a default, and reads either form;
- whether the game reads a missing field as its own default, as this package assumes when it leaves a default out;
- the control behaviours of `infinity-pipe` and `linked-container`, for which the API reference names none: taken as those of a pipe and of a container;
- how the game writes the direction of an entity it builds in two, eight or sixteen directions, and whether the entity table is right about which prototypes turn (it is provisional there);
- whether a control behaviour survives in a blueprint for an entity without a circuit wire (the samples of the probe wire every generic entity for that reason);
- the names of the control behaviours' attributes in the runtime API, which the probe builds its circuits with (`test/gameNames.ts`, from the API reference);
- that the game takes the fields this package only keeps (`recipe`, `filters`, ...) back as they stand when other fields around them change.

### The probe

`make probe-blueprints` (`npm run probe-blueprints`, `tools/game-probe/blueprints.mjs`) records `tests/fixtures/game/F-01-blueprints.json` from the installed game, headless and sandboxed like the other probes. It cannot run from an agent session. For every sample circuit of `test/samples.ts` (between them every setting of every kind and every kind of wire; for the generic entities one prototype per control behaviour of the settings table, generated from the table with every setting away from its default and wired to a constant combinator) the game

1. imports the blueprint string this package exported and exports it again (`reexported`),
2. builds it, revives the ghosts and exports a blueprint of what stands there (`rebuilt`),
3. builds the same circuit through the runtime API, without a blueprint of ours, and exports that (`native`).

It also exports one of every supported entity as the game places it (all 98; one the game does not place by script on a plain surface is left out and named by the test), and records the numbers behind the defines, those of the modes of the generic entities among them. For a generic entity the third step sets every setting through the attribute of its runtime control behaviour and every mode through its define by name (`tools/game-probe/lib/blueprintCases.ts`, `test/gameNames.ts`). `test/game.test.ts` then holds the package against the recording: every string of the game decodes; each of the three blueprints imports to the circuit that was sent, with nothing reported; the exporter writes every entity and wire as the game does (compared field by field with `reexported` and with `native`, floats to six digits); an entity as the game places it is the default of the editor; the numbers of the modes are those of the settings table. For a generic entity the comparison is about what the editor models: its direction and its `control_behavior` in the shapes, its settings in the circuit; the fields it only keeps (a station name the game gives a train stop) are the game's business. Until the fixture exists these tests are skipped under the name "the game (fixture F-01): SKIPPED, not recorded yet; run `make probe-blueprints`", and the same tests run on a recording made up from this package's own exports, which proves the tests but not the game. A step the game refuses is recorded with its error and fails its test; a difference in a default is a finding, to be fixed in `export.ts` (or in `DEFAULT_ENTITY` of the model) with the recording as the reference.

To compare the fixture with the game without writing it: `source scripts/env.sh && node tools/game-probe/blueprints.mjs --check`.

## Tests

`npx vitest run packages/blueprints`: the codec with malformed, truncated, damaged and oversized input (`string.test.ts`); export and import of every setting of every kind, wires between every two kinds of connection point, books, refused items, versions, dropped entities and the report (`export.test.ts`, `import.test.ts`); the generic entities, driven by the settings table: every prototype type with every setting in and out, defaults left out and spelled out, junk in every field, the kept data byte for byte also through the source of the editor, the directions of prototypes with one, two, four, eight and sixteen of them, wires, a foreign blueprint and its further trips (`generic.test.ts`); the two round trips and import of damaged blueprints (`roundtrip.test.ts`); the strings that ship with the game (`shipped.test.ts`); the game recording (`game.test.ts`). The parts of the probe that run without the game are tested in `tools/game-probe/lib/blueprintFixture.test.ts`.

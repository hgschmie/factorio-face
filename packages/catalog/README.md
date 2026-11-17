# @face/catalog

Signal catalog of Factorio 2.1.25 for the five standard modules `base`, `elevated-rails`, `recycler`, `quality` and `space-age`:
every prototype that can be a circuit signal, with English name, order, group/subgroup, flags, icon reference and module provenance.

- `data/catalog-2.1.25.json` - generated, committed. No image data.
- `data/icons-2.1.25.json` - generated, committed: the icon table, which says for every icon id which image files of the game it is
  composited from. Paths and numbers only, no image data.
- `../model/data/entities-2.1.25.json` - generated, committed: the entity table, every prototype a circuit wire connects to with its
  tile size, directions and wire reach (see "Entity table"). It lives in `@face/model`, which reads it and cannot depend on this
  package; the generator, its dumps and its `--check` are the same.
- `generated/icons/**.png`, `generated/manifest.json` - generated, git-ignored (Wube artwork; local builds only). The app does not need
  them: it renders icons from the user's installation of the game (see "Icons"). They are its fallback when no installation is in use,
  and the reference the generator's output is compared against.
- `src/` - browser-safe TypeScript API (no Node APIs; imports the JSON). The icon table has its own entry points
  (`@face/catalog/icons`, `@face/catalog/icons/standard`), so the renderer bundle does not carry it.
- Generator: `tools/catalog/` (`make catalog` or `npm run catalog`).

## Regenerating

```
make catalog                                        # runs the game 25 times headless (under a minute), writes JSON, icons, manifest
node tools/catalog/generate.mjs --reuse-dumps       # rebuild from the dumps in .runtime/factorio-dump without starting the game
node tools/catalog/generate.mjs --reuse-dumps --check   # exit 1 if the committed catalog, icon table or entity table is out of date
node tools/catalog/generate.mjs --from-dumps --no-icons # never starts the game: fails when the dumps are missing or of another version
node tools/catalog/generate.mjs --from-dumps --output .runtime/catalog-compare   # everything into a scratch directory, to compare
node tools/catalog/compare-icons.mjs                # compare rendered icons with a game icon dump, if one is present
```

Options: `--accept-version`, `--reuse-dumps`, `--from-dumps`, `--no-icons`, `--no-sandbox`, `--check`, `--output <dir>`. Environment:
`FACTORIO_BIN`, `FACTORIO_DATA`.

`--output <dir>` writes `data/` and `generated/` below `<dir>` instead of this package (the entity table into that `data/` too) and
touches nothing here; `diff -r` against `generated/icons` then shows whether a change to the generator or the compositor changes a
single byte.

`--reuse-dumps` starts the game after all when a dump is missing or stale; `--from-dumps` is the way to rebuild where the game cannot run
(an agent session, CI): it reads the dumps and the game's data files (`info.json`, the locale files for the speaker) and nothing else.
With `--no-icons` it leaves `generated/icons` as it is.

The generator is pinned to 2.1.25. It reads the `info.json` of all five modules and the binary's `--version`; any other version stops it
with a clear message unless `--accept-version` is given, in which case it writes `data/catalog-<version>.json` and
`data/icons-<version>.json` and `entities-<version>.json` (then update the imports in `src/standard.ts`, `src/standardIconTable.ts` and
`packages/model/src/entityTable.ts` and the pinned numbers in the tests). The run is idempotent: the catalog is rewritten only when its
content changes (`provenance.generatedAt` is the time of the last content change), the icon table and the entity table have no timestamp
and are rewritten only when their text changes, and icons are byte-identical between runs.

## Extraction method

All data comes from the game itself. For each of the eight module sets the game accepts (see below) three headless runs are made:

| Run | Command | Used for |
| --- | --- | --- |
| data | `--dump-data` | `data.raw`: icon definitions (`icon`, `icons`, `icon_size`, tint, scale, shift), utility constants; for the entity table the wire distances, collision and selection boxes, tile sizes, flags and default signals |
| locale | `--dump-prototype-locale` | English display names per prototype type (config `locale=en`) |
| runtime | `--test-scenario face-catalog-dump --test-ticks 600` | the engine's finalised prototypes |

The runtime run exists because `data.raw` is the input of the engine, not its result. A scenario (`tools/catalog/runtime-dump/control.lua`)
reads `prototypes.*` on the first tick and writes `script-output/face-runtime-dump.json`. Only this gives: the effective `group`, `subgroup`
and `order` (recipes and entities inherit them from products and items), computed item weights, `LuaRecipePrototype.hide_from_signal_gui`
and `LuaAsteroidChunkPrototype.hide_from_signal_gui` / `item_signal_alias` (derived by the engine), `LuaVirtualSignalPrototype.special`,
`items_to_place_this` of entities, and the rocket silo lift weight. Since 2026-11-14 it also writes `circuit_entities`: for every
prototype with a wire reach what the entity table needs and `data.raw` lacks or only implies, and for an entity it builds of each whether
it has a direction (see "Entity table"). Since 2026-11-15 every prototype it lists also says which mod created it (`created`, from
`prototypes.get_history(type, name)` with the prototype's own type: "ammo", "lamp", "planet"; `core` for the engine's own data). That is
for the single-set mode below, as are three fields of a recipe: what it consumes (`ingredients`) and produces (`products`), each entry
by `type` ("item" or "fluid") and `name`, and the mods that changed the recipe after its creation (`changed`, the second half of the
same history; the game writes an empty list as `{}`). This generator has its exact attribution from the eight sets and reads none of
these fields. `--test-scenario` is new in 2.1.24 and runs headless.

Module sets are selected through `mod-list.json` in an isolated mod directory. Dependencies per `info.json`: `elevated-rails -> base`,
`recycler -> base`, `quality -> base, recycler`, `space-age -> base, elevated-rails, recycler, + quality`. The `+` marker (changelog 2.1.0:
"Added mod dependency modifier "+", which marks the mod as optional but recommended. Mod gets enabled by default but can be turned off.")
means Space Age runs without Quality, so there are eight valid sets, not seven; all eight are dumped:

`base`, `base+elevated-rails`, `base+recycler`, `base+elevated-rails+recycler`, `base+recycler+quality`, `base+elevated-rails+recycler+quality`,
`base+elevated-rails+recycler+space-age`, `base+elevated-rails+recycler+quality+space-age`.

### Icons

Icons are composited from the game's source PNGs according to the `IconData` rules (first mip level, layers in order, premultiplied tint,
scale and shift relative to an `expected_icon_size / 2` slot). Output is 64 px straight-alpha RGBA, also for item groups (128 px sources).
Identical layer stacks share one icon id: a recipe or entity that uses the icon of its item refers to `item/<name>`; 2253 signals and 12
groups need 1139 icons (about 10 MB as files).

There is one implementation of this, shared by the generator and the app, in three places:

| What | Where | Why there |
| --- | --- | --- |
| Icon table: `IconLayer`, `IconEntry`, `IconTable`, `parseIconTable`, `iconTableFile`, `iconFileLocation` | `src/iconTable.ts` (`@face/catalog/icons`) | no Node APIs; it describes the committed file |
| PNG codec and compositor: `decodePng`, `encodePng`, `iconSource`, `renderIcon`, `renderIconPng` | `apps/desktop/src/gameIcons/png.ts`, `iconRenderer.ts` | the codec needs `node:zlib`, which a package must not import; the generator imports the two files as they are |
| Prototype to layers (`iconLayers`), the table's text (`iconTableText`), rendering from a data directory (`iconFileRenderer`) | `tools/catalog/lib/prototypeIcons.ts`, `iconFiles.ts` | only the generator sees prototypes and writes files |

The generator writes the files with the codec's `COMPACT_ENCODING` (best of four row filters, deflate level 9); the app renders the same
pixels from the user's installation while it runs and encodes them with `FAST_ENCODING`. The codec reads what the game's icon files use:
8 bits per sample, not interlaced, at most 1024 pixels on a side. A layer may only name a `.png` inside one of the game's own modules
(`base`, `core`, `space-age`, `quality`, `elevated-rails`, `recycler`); the generator refuses to write a table with anything else.

In the running app `GameIcons` (`apps/desktop/src/gameIcons/gameIcons.ts`) does this for the installation the application settings name
(`gameSettings.ts`: the user's choice, or the installation the app finds by itself, `/Applications/factorio.app` on macOS). The renderer
asks for `face-asset://catalog/icons/<icon id>.png`, the same URL under which a generated file would be served, and the main process
answers with the icon rendered from the installation, else the generated file, else a gray placeholder when the installation should
have the icon but lacks its files (a module that is not installed), else 404 (`assetHandler.ts`). Against Factorio 2.1.24 installed on
the development machine all 1138 icons render, and the pixels equal those of the generated files.

`--dump-icon-sprites` is not used, see "Isolation". One such dump of the `base` set exists from the pilot run and serves as reference:
`compare-icons.mjs` finds a mean absolute error of 0.24/255 per channel over 1141 base icons, worst case 0.65/255 (`lane-splitter`, a
scaled and shifted overlay), including all tinted barrel recipes. The game's own dump stores premultiplied colour in its PNGs; ours are
straight alpha, which is what browsers expect.

## Isolation

Requirement: running the game must not write anything outside this repository. Measures (`tools/catalog/lib/dump.mjs`):

1. `--config <dump>/sets/<set>/config/config.ini` with `[path] read-data=<game data>` and `write-data=<dump>/sets/<set>`, and
   `--mod-directory <dump>/sets/<set>/mods`. `<dump>` is `.runtime/factorio-dump`. Log, lock, `player-data.json`, saves, temp, scenarios,
   mods, `mod-settings.dat` and `script-output` all live below `write-data`. Crash uploads, Steam networking and blueprint storage are off.
2. `HOME`, `CFFIXED_USER_HOME` and `TMPDIR` point into `<dump>` (macOS frameworks then create their per-user files there, e.g.
   `<dump>/home/Library/Application Support/CrashReporter`).
3. The process runs under `sandbox-exec` with a profile that denies every file write outside `<dump>` and all IP networking. This is
   enforced by the kernel for the game process. (`--no-sandbox` is required on other platforms.)
4. Before and after every single run, `tools/catalog/lib/isolation.mjs` fingerprints (path, size, mtime of every entry, SHA-256)
   the game installation, `~/Library/Application Support/factorio`, `~/.factorio`, the per-user macOS cache and temp directories of the
   bundle id (`$(getconf DARWIN_USER_CACHE_DIR)/com.factorio`, `.../T/com.factorio`) and any `*factorio*` entry in `~/Library/{Preferences,
   Saved Application State,Caches,HTTPStorages,WebKit,Logs,Containers,Application Scripts,Cookies}`. Any difference aborts the generator.
   The fingerprints of the last run are kept in `generated/manifest.json`.

Result on 2026-11-11 (macOS, standalone 2.1.24 build 87808): all headless runs (`--version`, `--dump-data`, `--dump-prototype-locale`,
`--test-scenario`; 25 per generator run, 102 in total during development) left every watched location unchanged. The game logs
"Running in headless mode" for them and opens no window. The run of 2026-11-17 against 2.1.25 (build 88022) was the same: 25 runs, no
watched location changed.

One exception, from the pilot phase: a single `--dump-icon-sprites` run (base set). That command starts the graphics stack, and macOS
updated the modification time of the empty file `$(getconf DARWIN_USER_CACHE_DIR)/com.factorio/com.apple.metalfe/modules.timestamp`
(the system-managed Metal shader cache of the game's bundle id; 74 entries before and after, no other change). The write is made by a
system service on behalf of the process, so the sandbox profile cannot prevent it. The check caught it, the command was removed from the
generator, and icons are rendered from the source PNGs instead. Nothing else outside the repository was touched by any run.

If the game is running while the generator runs, the generator prints a notice and continues: it uses its own write directory and lock.
The game's own writes to its user directory would then be reported by the isolation check as a (false) violation. This case was not
exercised; no game instance was running during development.

## Provenance rules

Module provenance is not part of `data.raw`; it is derived from presence in the eight dumps:

- `modules`: the unique minimal module set in which the prototype exists, reduced by implied dependencies (`["quality"]` rather than
  `["base", "recycler", "quality"]`). All listed modules must be enabled. Two recipes need two independent modules:
  `rail-ramp-recycling` and `rail-support-recycling` have `["elevated-rails", "recycler"]`.
- `removedBy`: modules that delete the prototype. Space Age removes the item and recipe `satellite` and the recipe `satellite-recycling`.
- `variants`: field overrides that apply when all modules in `when` are enabled, in list order; `null` resets a field to its default.
  20 signals have one, e.g. `space-science-pack` stack size 2000 -> 200, `rocket-silo` and `cargo-landing-pad` move to the `space` group,
  `quality:normal` is hidden unless Quality is enabled.

The generator proves for every signal, group and subgroup that these three rules reproduce all eight dumps exactly (presence and every
recorded field) and fails otherwise. Prototypes of the always-loaded `core` data (the `*-unknown` placeholders, some groups) are attributed
to `base`, which cannot be disabled either.

## Which signals are selectable

The catalog keeps every prototype of the eight signal kinds; blueprint import must resolve all of them. `visibility` says how the in-game
signal selection treats them. The engine does not export that decision for whole prototypes, so it is derived (`visibilityOf` in
`tools/catalog/lib/build.mjs`) from finalised flags, first match wins:

| Rule | visibility | Count |
| --- | --- | --- |
| virtual `signal-everything`, `signal-anything`, `signal-each` | `wildcard` | 3 |
| `parameter = true` (`parameter-0`..`9` as item, fluid, entity, recipe, asteroid chunk) | `parameter` | 50 |
| virtual, `special` and not hidden: `signal-item-parameter`, `-fuel-`, `-fluid-`, `-signal-parameter` (train interrupt wildcards) | `parameter` | 4 |
| `hidden = true` (includes all `*-unknown` placeholders) | `hidden` | 936 |
| recipe or asteroid chunk with `hide_from_signal_gui` (engine-computed: a recipe is hidden when an item, fluid or virtual signal has the same icon) | `hidden` | 256 |
| entity with `items_to_place_this` (the item signal represents it) | `hidden` | 124 |
| everything else | `normal` | 880 |

The raw facts (`hidden`, `parameter`, `special`, `wildcard`, `hideFromSignalGui`, `placedBy`, `itemAlias`) are stored next to the
conclusion. The first five rules rest on engine-provided flags. The entity rule is an inference: it yields enemies, trees,
remnants, resource patches, `entity-ghost` and `item-on-ground` but no buildable entities, which is consistent with the 2.1.20 changelog
entry "Fixed that several environmental entities did not show in the signals list"; it could not be read from the engine and was not
checked against the running GUI. 2.1.25 added one more of this kind, `depleted-mining-drill-proxy` ("Entity with no minable
resources", the deconstruction planner's filter for depleted mining drills): an `entity-ghost` prototype without an item, so the rule
makes it `normal` like `entity-ghost`. The docs say that
`hide_from_signal_gui` is true for hidden recipes; the engine reports false for them, hence `hidden` is checked first.

Picker order: groups by `order`, subgroups by `order`, signals by `order`, each compared bytewise with the name as tie-breaker (signals: kind
before name). Groups and subgroups without signals (`tiles`, `effects` for the default picker) are omitted. A subgroup or group
with a signal that exists is in the tree whatever its own `modules` say (see "Single-set mode").

## Entity table

`packages/model/data/entities-2.1.25.json` (15 kB) has the 98 prototypes of the game that a circuit wire connects to, whether or not
the editor can do anything with them yet. `@face/model` reads it (`STANDARD_ENTITY_TABLE`, `parseEntityTable`); the ten prototypes the
editor has take their size, rotation and wire reach from it. Built by `tools/catalog/lib/entities.mjs`; the facts behind the rules are in
`docs/factorio-audit.md` 13.

```
{
  "schema": 1,
  "game": {"version":"2.1.25","build":88022},
  "generator": "tools/catalog/generate.mjs",
  "runtimeChecked": true,
  "defaults": {"width":1,"height":1,"directions":1,"wireReach":9,"modules":["base"]},
  "entities": [
    {"name":"accumulator","type":"accumulator","displayName":"Accumulator","width":2,"height":2,"signals":{"output":"virtual:signal-A"}},
    ...
```

One record per line, sorted by name, fields in one order, no timestamp. A field at its default is left out:

| Field | Meaning | From | Left out when |
| --- | --- | --- | --- |
| `name`, `type` | prototype name and prototype type | `data.raw` | never |
| `displayName` | the game's English name | locale dump | never |
| `width`, `height` | tiles covered facing north | `tile_width` / `tile_height`, else the size of `collision_box` rounded up | 1 |
| `directions` | 1 (cannot be turned), 2 (north and east: `two_direction_only`), 4, 8 or 16 (`building-direction-8-way`, `-16-way`) | whether it turns at all: the entity the runtime dump's scenario built, else the rule by prototype type; how many ways: `data.raw` | 1 |
| `wireReach` | reach of a circuit wire in tiles, normal quality | `circuit_wire_max_distance`; `maximum_wire_distance` of an electric pole; `wire_max_distance` of a power switch | 9 |
| `hidden` | not offered for building | runtime dump (`hidden`), which must agree with `data.raw` | false |
| `offGrid` | flag `placeable-off-grid` | `data.raw` | false |
| `selectionBox` | the game's selection box, `[left, top, right, bottom]` in tiles around the center, facing north: what the reach of a wire is measured between | `selection_box` of `data.raw`, cut off to the game's 1/256 of a tile; the runtime dump must have the same | it is the tiles the prototype covers (all but 18) |
| `placedBy` | items that build it; `[]` when there is none | runtime dump (`items_to_place_this`) | it is the one item of the entity's name |
| `signals` | the `default_<key>_signal` fields as `{ key: "kind:name" }`, keys sorted | `data.raw` | there are none |
| `modules`, `removedBy` | as in the catalog ("Provenance rules") | presence in the eight dumps | `["base"]`; absent |

Selection is by rule, there is no list of names: a prototype is in the table when its `circuit_wire_max_distance` is above 0, or it is an
`electric-pole` with a `maximum_wire_distance` above 0, or a `power-switch` with a `wire_max_distance` above 0. That gives 79 prototypes
with `base` alone, 80 with the recycler and 98 with Space Age, in 48 prototype types.

The table has no variants. Every module set that has a prototype must give the same record for it, field by field; the build fails
naming the prototype, the fields and the two sets otherwise. In 2.1.25 all eight agree.

### What the run against the game checks

`make catalog` (the full run, which starts the game) has `circuit_entities` in every runtime dump and compares, for each of the 98 in
each of the eight module sets:

- the selection: the prototypes with `get_max_circuit_wire_distance() > 0` or `get_max_wire_distance() > 0` are exactly those the rule on
  `data.raw` selects;
- `type`, `tile_width` x `tile_height` against `width` x `height`, `selection_box` against `selectionBox` (or the tiles), the reach at
  normal quality against `wireReach` (for a pole, and for a prototype without a circuit distance, `get_max_wire_distance`; else
  `get_max_circuit_wire_distance`);
- whether it can be turned against the rule by prototype type, the flags `placeable-off-grid`, `building-direction-8-way` and
  `-16-way`, and `two_direction_only` where a script can read it;
- every `default_*_signal` the game answers with against `signals`: another signal, or one where `data.raw` has none (a default of
  the engine's own). A field the game gives no answer for is not compared: a script cannot read every such field of every type.

Whether a prototype can be turned is not in `data.raw`, and the game says it in two places that differ (`docs/factorio-audit.md` 13.4):
`LuaEntityPrototype.supports_direction` is true for every crafting machine, `LuaEntity.supports_direction` only for a machine whose
fluid boxes are in use or that is not square. The scenario records both: it builds every prototype once on an empty surface (`built`)
and gives an assembling machine without a direction the recipes with a fluid until it has one (`fluid_recipe`). The table follows the
entity. Of a prototype the scenario cannot build (`space-platform-hub`) there is only the prototype's word that an entity could have a
direction; where it says yes, the rule of the type decides. `ROTATION_BY_TYPE` in
`tools/catalog/lib/entities.mjs` has the same as a rule, one entry per prototype type: yes, no, for the crafting machines
(`assembling-machine`, `furnace`) "has fluid boxes or is not square", for an ammo turret "is built in eight directions". The generator
builds the table from it for dumps that predate `circuit_entities` (the file then says `"runtimeChecked": false` and the generator
prints a note), and cross-checks it otherwise.

Any difference stops the generator after the dumps and before it writes the catalog or a table, with one line per point ("gun-turret:
the entity as built has no direction at run time, the rotation table says true for type ammo-turret"). The fix is then in
`entities.mjs`: correct the entry, or the rule that derived the value; `--reuse-dumps` builds again without another run of the game.
The runs of 2026-11-14 against 2.1.24 and of 2026-11-17 against 2.1.25 ended without a difference, and the file says `"runtimeChecked": true`. The scenario also
records both wire distances for every quality; the generator prints how many prototypes reach further at higher quality, the table keeps
the reach at normal quality (the editor has no entity quality).

## Single-set mode

`tools/catalog/lib/single.ts` builds the same three tables from one dump instead of eight: the game as one user has it, mods
included. The app uses it for the data it reads from the installed game on request (`apps/desktop/src/gameData`); the generator's
own run does not. `buildSingleSet` takes the parsed `data-raw-dump.json` and `face-runtime-dump.json`, the names of the dumped locale
files (`singleSetLocale`) and the head (`singleSetModules`), and calls `buildCatalog` and `buildEntityTable` with that one set.

What differs from the standard tables, because one dump cannot say what a record would be with fewer mods:

- No record has `removedBy` or `variants`: each is as it is with everything loaded. Its `modules` begins with the mod that created its
  prototype, by the game's own account (`created` of the runtime dump), and for all but the recipes and a few items of the next point
  that is all of it: signals of every kind, groups, subgroups, qualities, speakers,
  rocket silos and the records of the entity table (a speaker, a silo and a wired entity by their entity prototype; in the entity
  table `base` is the table's default and is not written). `core`, which is no module of the catalog and which no game is without,
  counts as `base`. A record whose creator is not among what the game had loaded (the game named none, or a game without `base`)
  has `modules: []` and is named in `untagged`: it is there whatever is enabled. With the standard game the creator is not always the
  module the standard catalog names, which is the smallest module set that has the record: the recycler creates the recycling recipes
  of every module's items (89 of them exist only with another module), `base` creates the barrels of Space Age's fluids (6), and the
  satellite is removed by Space Age. The next point is about the first two. And a record can sit in a subgroup or group that another module created: with the five modules,
  43 signals of `base` are in subgroups of Space Age and one subgroup of `base` is in a group of Space Age. A consumer that
  enables fewer modules than the game had loaded has to expect both. `pickerTree` does: a subgroup is in the tree whenever a
  signal that exists sits in it, and a group whenever such a subgroup sits in it, whichever module created the subgroup or the
  group (their own `modules` say who created them, not when they are there). So no set of modules makes it throw; it throws only
  for data with a signal whose subgroup, or a subgroup whose group, is in no record at all.
- A record may name several modules: it exists when all of them are enabled (`isAvailable`), as in the standard catalog. Two
  kinds of record do, each with its creator first:
  - A recipe names the modules of every item and fluid among its `ingredients` and `products` (`recipeModules`): the recycling
    recipe of a mod's item is `["recycler", "<mod>"]`, the barrel recipes of a mod's fluid `["base", "<mod>"]`. `base` is never
    added. Neither is a mod that changed the recipe after its creation (`changed`): one dump does not say what the recipe was
    before, and a recipe of `base` that Space Age gives an ingredient of its own is there without Space Age (48 recipes of `base`
    in the full standard set, ten of them with a part of Space Age).
  - An item names the modules that every recipe of its own creator needs which has the item among its products (`itemModules`):
    the barrel that `base` makes of a mod's fluid is `["base", "<mod>"]`. Recipes of other mods say nothing about an item (the
    recycler has one for every item), and an item without a recipe of its creator keeps its creator alone. The recipes are then
    derived once more, so that the recycling recipe of such a barrel needs the mod too.

  Against the committed catalog, over the eight standard sets: all 95 records agree but ten recycling recipes in the sets with
  Space Age (nine without Quality): `artillery-shell-recycling` and the like, made from a recipe that Space Age changed. Their
  products are Space Age's, so they name it, although without Space Age they exist with other products. A recipe of a dump
  without the three fields keeps its creator alone. The rules are as good as the mods' dependencies: a recipe or an item that a
  mod makes with another mod's things only when that mod is there names both, and is taken for absent without the other.
- `modules` in the head of the catalog lists what the game had loaded by its own account (`active_mods` of the runtime dump): its own
  modules as their `info.json` has them, and each mod as its own `info.json` describes it (`singleSetModules(dataDir, mods,
  modInfos)`; the caller reads the files, the app from the user's mod directory): the title, cleaned of control characters and cut
  to 200 characters, the feature flags, and of its dependencies the hard ones as `requires` and "+" ones as `recommends`, each
  restricted to what the game had loaded and without the mod itself (optional and incompatible dependencies are in neither). The
  mapping is `moduleInfo` of `commands.ts`, the one the generator reads the game's own modules with. A mod without a usable
  `info.json` is there by name and version alone and is named in `unread`. `provenance.modSets` has the one set; the entity table has
  `mods` (name to version) in its head. The icon table's head has no place for them.
- An icon that is not made of image files of the game's own modules (a mod's) is left out of the icon table and counted; the table is
  checked one icon at a time with `parseIconTable`.
- The entity table is built leniently (`buildEntityTable(input, { lenient: true })`): a wired prototype that cannot be derived, or that
  the game contradicts, is left out and named in the notes instead of failing the build. The standard build stays strict.
- Every record of the entity table is then read with the model's own reader (`parseEntityTable`), one at a time like the icons: one
  it refuses (a default signal whose name the editor's signal keys cannot hold, such as one with a blank) is left out and named too.
- A name the dump lacks is the prototype's name: the quality `normal` is "normal" without the quality module, where the standard
  catalog borrows "Normal" from a larger set.

`tools/catalog/lib/single.test.ts` builds the `base` set and the full set from the generator's dumps this way and compares signals,
picker groups, qualities, speaker, constants, icons and wired entities with what the standard tables say for those modules, with all
loaded modules enabled; every record there is of loaded modules. For each of the eight sets it also compares the `modules` of every
signal, with what they require, to those of the standard catalog: the ten recipes above are the only difference.

How the app uses the result (the confirmation before the game is run, the cache file, the switch at the next load of the window,
the record of the mods in the project file) is in `docs/adr/0001-architecture.md`, item 15. Checked once against the real game
(Factorio 2.1.24 with its five modules and no mods, read by the app on 2026-11-14 in 5.9 s: 2.5 s data, 0.8 s locale, 2.2 s runtime,
0.1 s build): all 2249 signals, the groups, subgroups, qualities, the speaker and the rocket silo are what the standard catalog says
for the five modules enabled, the 98 wired entities are the same records, and the icon table has 1135 of the 1138 ids (the other
three belong to other module sets); the one difference is the id of an icon that the standard catalog keeps as a variant
(`entity/factorio-logo-11tiles~space-age`).

What a dump run is made of (the three commands and their output files, the private `config.ini`, the environment, the sandbox
profile, `info.json` reading, the version line) is in `tools/catalog/lib/commands.ts`, shared by `dump.mjs` and the app's runner.
`build.d.mts`, `entities.d.mts` and `locale.d.mts` type the `.mjs` libraries for the TypeScript that imports them.

## Data format

`data/icons-2.1.25.json` (147 kB, 1139 icons): `{ "schema": 1, "game": { "version", "build" }, "icons": { "<icon id>": ... } }`, one icon
per line and sorted by id, so a changed icon is a changed line. An icon is its list of layers, bottom first, or
`{ "expected": 128, "layers": [...] }` when the prototype expects another icon size than 64 (the item groups). A layer is its path
(`"__base__/graphics/icons/small-lamp.png"`) when its first mip level is 64 px and nothing modifies it, otherwise
`{ "icon", "size", "scale"?, "shift"?: [x, y], "tint"?: [r, g, b, a] in 0..1, "floating"?: true }`. `parseIconTable` validates every
field and is the only reader; `iconTableFile` writes this form. `test/standardIconTable.test.ts` checks the committed table against the
catalog, and `tools/catalog/lib/lib.test.ts` against what the generator builds from the dumps, where they exist.

`data/catalog-2.1.25.json` (485 kB): `schema`, `game`, `provenance` (generator, date, command templates, module sets), `modules`
(dependencies, feature flags), `constants` (default item weight, rocket lift weight, rocket silos), `groups`, `subgroups`, `qualities`
`speakers` and `signals` per kind, one record per line, sorted by name. Defaults are omitted: false flags, `visibility: "normal"`, the prototype
type when it equals the kind, and `icon` when it equals `<kind>/<name>` (`group/<name>` for groups). `createCatalog` restores them.

Per signal: `name`, `displayName`, `order`, `subgroup`, `prototype`, `hidden`, `parameter`, `special`, `wildcard`, `visibility`,
`hideFromSignalGui`, `placedBy`, `itemAlias`, `stackSize` and `weight` (items), `level`, `color`, `next` (qualities), `icon`, `modules`,
`removedBy`, `variants`. Rocket capacity for the selector combinator is `constants.rocketLiftWeight / weight` (1,000,000 / weight).

Per speaker prototype (the game has one, `programmable-speaker`): `maximumPolyphony` and `instruments`, one per line and in the
prototype's order, each with `name`, `displayName` and `notes` (names in order); `noteNames` has the display names that differ from the
name. The order is data: a blueprint names a sound by position (`instrument_id`, `note_id`, from 0), and "signal value is pitch" picks the
note at position value - 1. Instruments and notes come from `data.raw["programmable-speaker"]` of the dump. Their display names are not
prototype names, so `--dump-prototype-locale` does not have them: the generator reads the sections `programmable-speaker-instrument` and
`programmable-speaker-note` from the modules' own `locale/en/*.cfg` (`tools/catalog/lib/locale.mjs`), core first and then the enabled
modules in order. Like every record a speaker carries `modules` and, where a module set differs, `variants`; in 2.1.25 it is the same in
all eight sets.

## API

```ts
import { loadStandardCatalog, currentCatalog, setCatalog, createCatalog, findSignal, availableSignals, pickerTree, resolveModules, enableModule, disableModule, dependentModules, listedModules, namedModules, iconPath } from "@face/catalog";

const catalog = loadStandardCatalog();                       // the catalog that comes with the build
currentCatalog();                                            // the catalog the editor works with: the standard one unless another was set
setCatalog(createCatalog(data));                             // another one, read from the user's game; setCatalog(undefined) goes back
findSignal(catalog, "item:iron-plate@legendary");            // by key or SignalId; quality is ignored
findSignal(catalog, { kind: "item", name: "satellite" }, enabled);  // undefined when absent for these modules; variants applied
availableSignals(catalog, enabled, { kinds, visibility });   // everything that exists, hidden signals included
pickerTree(catalog, enabled, { wildcards, parameters, hidden, kinds });  // group -> subgroup -> signals in game order
availableQualities(catalog, enabled);                        // QualityInfo[] lowest first
resolveModules(catalog.modules, enabled);                    // { enabled, unknown, missing, recommended, valid }
enableModule(catalog.modules, enabled, "space-age");         // adds hard dependencies ({ withRecommended: true } adds quality)
dependentModules(catalog.modules, enabled, "recycler");      // ["quality", "space-age"]
disableModule(catalog.modules, enabled, "recycler");         // removes the module and its dependents
namedModules(catalog.signals);                               // Set of the module names the records name as theirs
listedModules(catalog.modules, namedModules(catalog.signals));  // the modules a project switches, see below
isGameModule("space-age"); BASE_MODULE;                      // one of the game's own five; "base", which is always on
iconPath(signal, iconRoot);                                  // "<iconRoot>/item/iron-plate.png"
speakerInstruments(catalog, enabled);                        // SpeakerInstrumentInfo[]: instruments with notes, names and display names
speakerInstrumentNames(catalog, enabled);                    // the names only: what the language and the simulation environment take
```

The icon table is not part of the main entry:

```ts
import { parseIconTable, iconTableFile, iconFileLocation, type IconTable, type IconEntry, type IconLayer } from "@face/catalog/icons";
import { loadStandardIconTable } from "@face/catalog/icons/standard";   // imports data/icons-2.1.25.json

const table = loadStandardIconTable();                       // { game: { version, build }, icons: ReadonlyMap<id, { expected, layers }> }
table.icons.get(signal.icon);                                // the layers of a catalog icon; undefined for anything else
iconFileLocation("__base__/graphics/icons/small-lamp.png");  // { module: "base", segments: ["graphics", "icons", "small-lamp.png"] }
```

Types: `Catalog`, `CatalogSignal`, `CatalogGroup`, `CatalogSubgroup`, `ModuleInfo`, `QualityInfo`, `CatalogData` (the JSON shape),
`SignalVisibility`, `ModuleResolution`, `PickerGroup`, `SpeakerInfo`, `SpeakerInstrumentInfo`, `SpeakerNote`. Every entry has `origin: "standard" | "custom"`; only `"standard"` is generated.
Custom signals and groups are out of scope here; `createCatalog` and the functions do not assume the standard module names.

`listedModules(modules, contributing)` is the module list for a catalog read from a game with mods: the game's own modules, and
of the mods those that `contributing` names, which the caller collects from the records (`namedModules` over the signals and
over the records of the entity table). A mod that adds nothing is left out, and the dependencies see through it: `requires` of a
listed module is everything listed that it needs directly or through any chain of modules, `recommends` what it recommends
itself and is listed. `resolveModules`, `enableModule`, `disableModule` and `dependentModules` work on the result as on any module
list. A dependency that names no module, the module itself or a circle is passed over. For the standard catalog the result is its
five modules as they are.

`currentCatalog()` and `setCatalog()` are for the renderer, in the style of `entityTable()` and `setEntityTable()` of `@face/model`:
at start it installs the catalog and the entity table the main process hands it (the ones read from the user's game, when there are
any) before a circuit is read, and everything that needs "the" catalog asks `currentCatalog()`. What was made from the catalog
before a `setCatalog` does not follow, so it is called once, before the session exists.

## Counts (Factorio 2.1.25)

Signals by kind and introducing module:

| Kind | base | elevated-rails | recycler | quality | space-age | elevated-rails + recycler | Total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| item | 252 | 2 | 1 | 3 | 85 | 0 | 343 |
| fluid | 19 | 0 | 0 | 0 | 14 | 0 | 33 |
| virtual | 154 | 0 | 0 | 1 | 0 | 0 | 155 |
| entity | 572 | 14 | 3 | 0 | 440 | 0 | 1029 |
| recipe | 217 | 2 | 225 | 6 | 212 | 2 | 664 |
| space-location | 2 | 0 | 0 | 0 | 6 | 0 | 8 |
| asteroid-chunk | 1 | 0 | 0 | 0 | 14 | 0 | 15 |
| quality | 2 | 0 | 0 | 4 | 0 | 0 | 6 |
| Total | 1219 | 18 | 229 | 14 | 771 | 2 | 2253 |

Signals per module set (all / offered by the default picker, i.e. `normal` and `wildcard`):

| Module set | All | Picker |
| --- | ---: | ---: |
| base | 1219 | 579 |
| base + elevated-rails | 1237 | 584 |
| base + recycler | 1448 | 581 |
| base + elevated-rails + recycler | 1468 | 586 |
| base + recycler + quality | 1462 | 590 |
| base + elevated-rails + recycler + quality | 1482 | 595 |
| base + elevated-rails + recycler + space-age | 2236 | 874 |
| all five | 2250 | 883 |

12 item groups, 136 subgroups, 6 quality prototypes (levels 0, 1, 2, 3, 5 and the hidden `quality-unknown`).

## Known limitations

- The entity rule of the signal picker is inferred (see above). `signal-any-quality` is classified `normal` because the engine does not
  mark it special; whether the game offers it in every signal slot is unverified.
- 174 hidden prototypes have no English name in the game (172 entities such as explosions, `space-location-unknown`,
  `asteroid-chunk-unknown`); their `displayName` is the prototype name.
- Only the English locale is extracted.
- Icons are our rendering, validated against the game for the `base` set only. Layered recycling icons (scale 0.4) follow the same code
  path as the validated barrel icons but have no game reference. Icon outlines/shadows (`draw_background`) are GUI effects and not drawn.
  The "shrink to fit the slot" rule for oversized layers is implemented but not exercised: no standard icon exceeds its slot.
- 262 entities (all hidden) have no icon of their own; they use the icon of the item that places them, else the generic "unknown" icon.
- Ties in the picker order (same subgroup and order string, different kind) are broken by kind, then name; the engine's tie-break is unknown.
- Item weights are the engine's float values (`raw-fish` is 3333.3333282470703).
- The generator's defaults and the sandbox are macOS-specific; other platforms need `FACTORIO_BIN`, `FACTORIO_DATA` and `--no-sandbox`.
- The catalog is tied to one game version; `src/standard.ts` imports `catalog-2.1.25.json` statically, `src/standardIconTable.ts`
  `icons-2.1.25.json`.

# Factorio 2.1.24 circuit audit and support matrix

Audit date: 2026-11-11. Scope: constant, arithmetic, decider and selector combinators, lamps, circuit wires, signals and the blueprint string format.
Added 2026-11-12: electric poles (3.9, 6.9, 9.9) and the programmable speaker (3.10, 6.10, 9.10). Where an older section says "the five entities" it means the four combinators and the lamp; what holds for the two additions is said in their own sections.
Added 2026-11-14: section 12, the blueprint format as `packages/blueprints` reads and writes it, with what that work added to or corrected in sections 3 to 5 and 9.
Added 2026-11-14: section 13, all 98 prototypes a circuit wire connects to: how they are selected, their footprints, reaches and directions, and which of that is the game's own word. The editor still has the ten prototypes of 3.1.
Added 2026-11-15: section 15, which mod created a prototype, as the game says it at run time.
Moved 2026-11-17 to Factorio 2.1.25 (build 88022, released 16. 11. 2026): the catalog, icon and entity tables were generated again and the fixtures F-01, F-24 and F-29 recorded again. The 2.1.25 changelog has no entry on circuit networks, combinators, wires, signals or the blueprint format. Re-verified with 2.1.25 [game]: F-24 and F-29 are the recordings of 2.1.24 but for the version they name; F-01 is too but for the `version` of every blueprint the game writes, now 2.1.25.10 (562954250027018, it was 2.1.24.1), and the game takes the exporter's 2.1.25.0 as it took 2.1.24.0; the 98 wired entities of section 13 are the same records. New in the data [data: dump]: one entity prototype, `depleted-mining-drill-proxy` (type `entity-ghost`, "Entity with no minable resources", the deconstruction planner's new filter), which is a signal like `entity-ghost`; and `entity-ghost`, `item-on-ground`, `item-request-proxy` and `tile-ghost` have the `order` strings a, b, c, d where they had none. No other signal, group, subgroup, quality, speaker instrument or note, icon or constant differs. Statements below that name 2.1.24 were checked with that release and were not checked again unless they name one of the three fixtures or the tables.
This document drives the model types, the DSL, the blueprint importer/exporter and the simulator of "face".

## 0. How to read this document

Every statement carries a provenance tag:

| Tag | Meaning |
| --- | --- |
| [api] | `/Users/henning/factorio/factorio-data/runtime-api.json` (machine-readable runtime API) |
| [data: file] | Lua prototypes, locale or embedded blueprint strings under `factorio-data` / `factorio-install`; path is relative to that root |
| [changelog] | `factorio-data/changelog.txt` (identical copy in `factorio-install`), version quoted |
| [web: url] | Web lookup on 2026-11-11 |
| [game: fixture] | Asked from the running game (headless, sandboxed) and recorded as the named fixture of section 6.8 under `tests/fixtures/game`; a test compares the editor with it |
| [unverified] | From memory or inference. Must be confirmed by a game-driven conformance fixture before the simulator relies on it |

Rules used when tags conflict: [data] and [changelog] beat [api] (the API file is one patch older, see 1.1); [api] beats [web]; the wiki is frequently stale for 2.1.
A combined tag such as "[api] [unverified]" means the field exists per the API but the described behavior is not confirmed.

The game executable was not run for this audit. No statement here is validated against a running game, except the few that carry a [game] tag, which were added later.

## 1. Provenance

### 1.1 Versions found

| Source | Version | Provenance |
| --- | --- | --- |
| `runtime-api.json` `application_version` | 2.1.23 | [api] |
| `runtime-api.json` `api_version` | 6 | [api] |
| `runtime-api.json` `stage` / sizes | runtime; 157 classes, 229 events, 496 concepts, 62 defines | [api] |
| `core/info.json` | no `version` field | [data: core/info.json] |
| `base/info.json` | 2.1.24 | [data: base/info.json] |
| `space-age/info.json` | 2.1.24, `factorio_version` 2.1 | [data: space-age/info.json] |
| `quality/info.json` | 2.1.24, `factorio_version` 2.1 | [data: quality/info.json] |
| `recycler/info.json` | 2.1.24, `factorio_version` 2.1 | [data: recycler/info.json] |
| `elevated-rails/info.json` | 2.1.24, `factorio_version` 2.1 | [data: elevated-rails/info.json] |
| `changelog.txt` newest entry | 2.1.24, dated 27. 10. 2026 | [changelog] |
| `factorio-data` git head | "added version 2.1.24" | [data: .git] |
| lua-api.factorio.com/latest | header says 2.1.24 | [web: https://lua-api.factorio.com/latest/concepts/BlueprintEntity.html] |

The API file lags the module data by one patch (2.1.23 versus 2.1.24). The 2.1.24 changelog lists only `LuaBootstrap::finish_test()` and `LuaBootstrap::test_arg` under Scripting, so no circuit-relevant
API difference is expected [changelog 2.1.24]. The online 2.1.24 `BlueprintEntity` page lists the same base fields and the same variant fields for the five entity types as the local 2.1.23 file [web, as above].

The Lua trees of `factorio-data` and `factorio-install` are identical for all six modules (recursive diff over non-asset files shows no difference). The install additionally carries `locale`, `graphics`,
`sound`, `scenarios`, `campaigns`, `menu-simulations`. The English locale files in the install are used below as [data] because they contain the in-game GUI explanations for 2.1.24.

### 1.2 Module dependency graph

| Module | Dependencies (verbatim) | Feature flags required | Provenance |
| --- | --- | --- | --- |
| core | `[]` | none | [data: core/info.json] |
| base | `[]` | none | [data: base/info.json] |
| elevated-rails | `base >= 2.1.0` | `expansion_required`, `rail_bridges_required` | [data: elevated-rails/info.json] |
| recycler | `base >= 2.1.0` | `expansion_required` | [data: recycler/info.json] |
| quality | `base >= 2.1.0`, `recycler >= 2.1.0` | `expansion_required`, `quality_required` | [data: quality/info.json] |
| space-age | `base >= 2.1.0`, `elevated-rails >= 2.1.0`, `+ quality >= 2.1.0`, `recycler >= 2.1.0` | `expansion_required`, `space_travel_required`, `spoiling_required`, `freezing_required`, `segmented_units_required`, `expansion_shaders_required` | [data: space-age/info.json] |

```
core (implicit, always loaded)
base
 +-- elevated-rails
 +-- recycler
 |    +-- quality
 +-- space-age  --> elevated-rails (hard), recycler (hard), quality (recommended, "+")
```

Dependency markers present: only `+` on space-age -> quality. No `?`, `(?)`, `!` or `~` markers occur in the six info.json files [data].
`+` is new in 2.1: "Added mod dependency modifier "+", which marks the mod as optional but recommended. Mod gets enabled by default but can be turned off." [changelog 2.1.7].
Consequence: Space Age can run without the quality mod ("the quality mod can be disabled while keeping the space age mod enabled") [changelog 2.1.7]. Valid mod sets therefore include
base; base+recycler; base+recycler+quality; base+elevated-rails; base+elevated-rails+recycler+space-age (no quality); and the full set. The signal catalog must be keyed by active mod set.

Runtime feature flags that exist: `expansion`, `quality`, `rail_bridges`, `space_travel`, `spoiling`, `freezing`, `segmented_units`, `expansion_shaders` [api: LuaBootstrap.feature_flags].

### 1.3 Contents of the top-level `recycler` module

New in 2.1: "[space-age] Added separate recycler mod." [changelog 2.1.7]. Files: `info.json`, `data.lua`, `data-updates.lua`, `recycling.lua`, `recycler-pictures.lua` (plus graphics/locale/sound in the install)
[data: recycler/].

| Prototype | Type | Provenance |
| --- | --- | --- |
| `recycling` | recipe-category | [data: recycler/data.lua] |
| `recycler` | item, recipe, entity of type `furnace` | [data: recycler/data.lua] |
| `recycling` | technology | [data: recycler/data.lua] |
| `recycler-explosion`, `recycler-remnants` | explosion, corpse | [data: recycler/data.lua] |
| `<recipe>-recycling`, `<item>-recycling` | generated recipes, `hidden = true`, one per recipe plus self-recycling per item (skips `parameter` items, `auto_recycle = false`, barrels) | [data: recycler/data-updates.lua, recycler/recycling.lua] |

No combinators, lamps, virtual signals or qualities are defined in `recycler`. Its only circuit relevance: it adds many hidden recipe prototypes (recipe-kind signals) and the `recycler` item/entity/recipe signals.

## 2. Signal identity

### 2.1 SignalID

| Field | Type | Default | Notes | Provenance |
| --- | --- | --- | --- | --- |
| `type` | SignalIDType | `"item"` | "If the type is "item", this will be nil when reading." Exported JSON omits `type` for items | [api: SignalID]; omission seen in [data: base/prototypes/factoriopedia-simulations.lua embedded string] |
| `name` | string | none | Prototype name. Optional in the API type; a SignalID without `name` is an empty slot | [api: SignalID] |
| `quality` | QualityID (string in JSON) | `"normal"` | "The prototype name of the signal's quality. Defaults to normal." | [api: SignalID] |

Signal identity is the triple (type, name, quality). The same prototype at two qualities is two distinct signals on a network [api: SignalID.quality] [web: https://wiki.factorio.com/Selector_combinator, quality select text].
Signals of any kind can carry a quality when emitted by a constant combinator, including fluids and virtual signals [web: https://wiki.factorio.com/Selector_combinator].
`SignalIDBase` is the quality-less form (`type`, `name`) and is used for `quality_source_signal` of the selector [api: SignalIDBase].
A signal value is int32: `Signal = {signal: SignalID, count: int32}` [api: Signal]. Range -2147483648..2147483647 [data: base/locale/en/base.cfg `circuit-network` tip].

### 2.2 Signal kinds

`SignalIDType` has exactly eight literals [api: SignalIDType]:

| `type` | Prototype types that become signals of this kind | Provenance |
| --- | --- | --- |
| `item` (default, omitted) | `item` and all subtypes: ammo, capsule, gun, item-with-entity-data, item-with-label, item-with-inventory, blueprint-book, item-with-tags, selection-tool, blueprint, copy-paste-tool, deconstruction-item, spidertron-remote, upgrade-item, module, rail-planner, space-platform-starter-pack, tool, armor, repair-tool | [data: core/lualib/prototype-hierarchy.lua]; mapping to the kind [unverified] |
| `fluid` | `fluid` | [data: core/lualib/prototype-hierarchy.lua] |
| `virtual` | `virtual-signal` | [data: base/prototypes/signal.lua] |
| `entity` | every entity prototype type (example signals seen: `behemoth-biter`, `character`, `entity-ghost`) | [data: base/prototypes/factoriopedia-simulations.lua embedded string] |
| `recipe` | `recipe` (example seen: `empty-heavy-oil-barrel`) | same embedded string |
| `space-location` | `space-location` and subtype `planet` | [data: core/lualib/prototype-hierarchy.lua] |
| `asteroid-chunk` | `asteroid-chunk` | [data: core/lualib/prototype-hierarchy.lua] |
| `quality` | `quality` | [api: SignalIDType] |

2.0 knowledge check: `entity`, `recipe`, `space-location`, `asteroid-chunk` and `quality` are real signal kinds; the 1.1 set was only item/fluid/virtual.

### 2.3 Flags that hide or exclude prototypes

| Flag / property | Effect | Provenance |
| --- | --- | --- |
| `hidden = true` (PrototypeBase) | Hidden from selection GUIs. Unobtainable prototypes are still valid signals: the base game ships a constant combinator emitting `green-wire` (item flags only-in-cursor, spawnable) and the entity signal `entity-ghost` | flag [web: https://lua-api.factorio.com/latest/prototypes/VirtualSignalPrototype.html]; example [data: base/prototypes/factoriopedia-simulations.lua]; whether a `hidden = true` prototype is accepted as a signal on import [unverified] |
| `hidden_in_factoriopedia` | Factoriopedia only | [web: same page] |
| `parameter = true` | "Whether the prototype is a special type which can be used to parametrize blueprints and doesn't have other function." | [web: same page] |
| `special` (runtime, read-only) | "The everything, anything, each, and unknown signals are considered special." Hard-coded by name, no prototype flag in Lua | [api: LuaVirtualSignalPrototype.special]; absence of a Lua flag [data: base/prototypes/signal.lua] |
| quality `normal`: `hidden = true` in base, set to `hidden = false` by the quality mod | Quality pickers are hidden without the quality mod | [data: base/prototypes/categories/quality.lua, quality/data-updates.lua] |
| Item flag `always-show` on parameter items | Shown although otherwise filtered | [data: base/prototypes/item.lua] |

The exact picker filter (which hidden prototypes are offered) is not derivable from Lua; 2.1.20 "Fixed that several environmental entities did not show in the signals list" shows it is engine logic [changelog 2.1.20].
Proposal: the catalog keeps every prototype with a `hidden` attribute; the importer accepts any known prototype name; only the picker/autocomplete filters hidden ones.

### 2.4 Special, wildcard and parameter signals

| Signal | Kind | Module | `special` | Meaning | Provenance |
| --- | --- | --- | --- | --- | --- |
| `signal-everything` | virtual | base | yes | "If all input signals meet the condition, it will pass. It is true when there are no inputs. Output all input signals." | [data: base/prototypes/signal.lua, base/locale/en/base.cfg] [api] |
| `signal-anything` | virtual | base | yes | "If any of the input signals meet the condition, it will pass. It is false when there are no inputs. Output the first input signal, or the first signal that passed all conditions, respecting signal order in both cases." | same |
| `signal-each` | virtual | base | yes | "Evaluates the condition for each input signal individually. To pass completely, a signal has to pass all conditions. Output every signal that passed all conditions." | same |
| `signal-unknown` | virtual | core | yes | Placeholder for a signal whose prototype no longer exists; `hidden = true`. Siblings: `item-unknown`, `fluid-unknown`, `recipe-unknown`, `entity-unknown`, `quality-unknown` (level 0, hidden) | [data: core/prototypes/unknown.lua] [api] |
| `signal-any-quality` | virtual | quality | no | "Any quality". Subgroup `qualities`. Used as the "any quality" marker in quality pickers | [data: quality/prototypes/signal.lua, quality/locale/en/quality.cfg]; usage [unverified] |
| `signal-item-parameter`, `signal-fuel-parameter`, `signal-fluid-parameter`, `signal-signal-parameter` | virtual | base | no | "Special Wildcard signal. When used in schedule interrupt, it will match the first item/fuel/fluid/signal that passes all wait conditions..." Train-interrupt wildcards, subgroup `parameters`, no `parameter` flag | [data: base/prototypes/signal.lua, base/locale/en/base.cfg] |
| `parameter-0` .. `parameter-9` | item | base | no | Blueprint parametrisation placeholders, `parameter = true`, subgroup `parameters` | [data: base/prototypes/item.lua] |
| `parameter-0` .. `parameter-9` | fluid | base | no | same | [data: base/prototypes/fluid.lua] |
| `parameter-0` .. `parameter-9` | recipe | base | no | same | [data: base/prototypes/recipe.lua] |
| `parameter-0` .. `parameter-9` | entity (`simple-entity`) | base | no | same | [data: base/prototypes/entity/entities.lua] |
| `parameter-0` .. `parameter-9` | asteroid-chunk | space-age | no | same | [data: space-age/prototypes/entity/asteroid.lua] |

There is no virtual signal named `signal-parameter-N` in 2.1.24. Parameters are prototypes named `parameter-N` in five prototype categories (fifty prototypes with the full mod set) [data, files above].
Legacy names migrated by the game: `signal-any-item` -> `signal-item-parameter`, `signal-any-fuel` -> `signal-fuel-parameter`, `signal-any-fluid` -> `signal-fluid-parameter`,
`signal-any-signal` -> `signal-signal-parameter` [data: base/migrations/2.0.0-internal.json].

Where the wildcards are legal:

| Position | everything | anything | each | Provenance |
| --- | --- | --- | --- | --- |
| Arithmetic `first_signal` / `second_signal` | no | no | yes, on either or both operands ("perform Each-Each operations") | [changelog 2.0.7]; exclusion of everything/anything [unverified] |
| Arithmetic `output_signal` | no | no | yes, only if an operand is each | [web: https://wiki.factorio.com/Arithmetic_combinator] |
| Decider condition `first_signal` | yes | yes | yes | [data: base/locale/en/base.cfg] |
| Decider condition `second_signal` | restricted | restricted | [unverified] | "Fixed decider would not reject some of the special signals on the right side of conditions." [changelog 2.1.7]; the exact allowed set is [unverified] |
| Decider `outputs[].signal`, `else_outputs[].signal` | yes, not together with each in conditions | yes | yes, only with each in conditions | [web: https://wiki.factorio.com/Decider_combinator, output table] |
| Enable condition (`circuit_condition`) `first_signal` (lamp) | yes | yes | no | [unverified] |
| Selector signal slots (`index_signal`, `count_signal`, time signals) | no | no | no | [unverified] |
| Selector `quality_destination_signal` | no | no | [unverified], believed yes | [unverified] |
| Constant combinator filter | no | no | no | [unverified] |
| On a wire (as a transmitted signal) | never | never | never | "Logic signals ... cannot be sent over the circuit network" [web: https://wiki.factorio.com/Tutorial:Combinator_tutorial] |

### 2.5 Virtual signal counts from Lua sources

| Module | Count | Detail | Provenance |
| --- | --- | --- | --- |
| core | 1 | `signal-unknown` (hidden) | [data: core/prototypes/unknown.lua] |
| base | 153 | by subgroup: virtual-signal-special 3, virtual-signal-number 10, virtual-signal-letter 30 (A-Z plus comma, letter-dot, exclamation-mark, question-mark), virtual-signal-punctuation 8, virtual-signal-math 14, virtual-signal-color 9, virtual-signal 7, shapes 20 (includes `signal-dot`), arrows 8, arrows-misc 9, parameters 4, pictographs 31 | [data: base/prototypes/signal.lua] |
| quality | 1 | `signal-any-quality` | [data: quality/prototypes/signal.lua] |
| space-age, elevated-rails, recycler | 0 | no `virtual-signal` definitions | [data] |

Counts are literal `type = "virtual-signal"` tables in the Lua sources; no virtual signal is generated in a loop. None of the 153 base signals sets `hidden` or `parameter` [data: base/prototypes/signal.lua].
The nine color signals are `signal-red`, `-green`, `-blue`, `-yellow`, `-pink`, `-cyan`, `-white`, `-grey`, `-black` [data: base/prototypes/signal.lua].
Resolved totals per mod set come from the separate data-dump task.

### 2.6 Qualities

| Name | Level | Module | Hidden | `next` | Provenance |
| --- | --- | --- | --- | --- | --- |
| `normal` | 0 | base | true in base, false with quality mod | `uncommon` (set by the quality mod) | [data: base/prototypes/categories/quality.lua, quality/data-updates.lua, quality/prototypes/base-data-updates.lua] |
| `uncommon` | 1 | quality | no | `rare` | [data: quality/prototypes/quality.lua] |
| `rare` | 2 | quality | no | `epic` | same |
| `epic` | 3 | quality | no | `legendary` | same |
| `legendary` | 5 | quality | no | none | same |
| `quality-unknown` | 0 | core | yes | none | [data: core/prototypes/unknown.lua] |

Note the level gap: legendary is 5, not 4 [data]. Quality comparisons (`<`, `>`, ...) are assumed to compare `level` [unverified].
2.1 adds a `previous` link and downgrade probabilities on quality prototypes [api: LuaQualityPrototype.previous] [changelog 2.1.7]; not circuit relevant.

## 3. Entities in scope

### 3.1 Prototypes

Complete list across core, base, space-age, quality, recycler, elevated-rails. For the four combinators and the lamp there is exactly one prototype per type; no module adds variants or copies [data: grep over all six modules].
The type `electric-pole` has four prototypes and `programmable-speaker` one, all from base and the same in all eight module sets [data: dump, `data-raw-dump.json` of every set]. The editor reads size, rotation and wire reach of these ten from the entity table the catalog generator writes from the game's dumps (section 13; `PROTOTYPES` in `packages/model/src/prototypes.ts` adds the kind of each).

| Name | Type | Module | Collision box | Tile size (north) | Rotatable | Power | Wire reach | Provenance |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `constant-combinator` | constant-combinator | base | +-0.35 x +-0.35 | 1 x 1 | 4-way sprites | none | 9 | [data: base/prototypes/entity/circuit-network.lua, combinator-pictures.lua] |
| `arithmetic-combinator` | arithmetic-combinator | base | +-0.35 x +-0.65 | 1 wide x 2 tall | 4-way | electric, primary-input, 1 kW | 9 | same |
| `decider-combinator` | decider-combinator | base | +-0.35 x +-0.65 | 1 wide x 2 tall | 4-way | electric, primary-input, 1 kW | 9 | same |
| `selector-combinator` | selector-combinator | base | +-0.35 x +-0.65 | 1 wide x 2 tall | 4-way | electric, primary-input, 1 kW | 9 | same |
| `small-lamp` | lamp | base | +-0.15 x +-0.15 | 1 x 1 | no | electric, usage priority `lamp`, 5 kW | 9 | [data: base/prototypes/entity/entities.lua] |
| `small-electric-pole` | electric-pole | base | +-0.15 x +-0.15 | 1 x 1 | no | carries power | 7.5 | [data: base/prototypes/entity/entities.lua `maximum_wire_distance`] [data: dump] [game: fixture F-24] |
| `medium-electric-pole` | electric-pole | base | +-0.15 x +-0.15 | 1 x 1 | no | carries power | 9 | same |
| `big-electric-pole` | electric-pole | base | +-0.65 x +-0.65 | 2 x 2 | no | carries power | 32 | same |
| `substation` | electric-pole | base | +-0.7 x +-0.7 | 2 x 2 | no | carries power | 18 | [data: entities.lua] [data: dump]; not in the recording F-24 yet |
| `programmable-speaker` | programmable-speaker | base | +-0.3 x +-0.3 | 1 x 1 | no | electric, secondary-input, 2 kW | 9 | [data: base/prototypes/entity/circuit-network.lua] [data: dump `circuit_wire_max_distance`] |

Module-specific modifications: space-age only adds `heating_energy` (50 kW arithmetic and decider, 100 kW selector), so these three freeze on cold surfaces; constant combinator and lamp use the
unheated collision default [data: space-age/base-data-updates.lua, core/lualib/collision-mask-defaults.lua]. Not simulated; see section 9.
"Variants" in the sense of the brief: none at prototype level. Any entity may carry an entity `quality` in a blueprint [api: BlueprintEntity.quality]; quality does not change circuit behavior [unverified].
The selector combinator prototype defines default time signals: game tick `signal-T`, day tick `signal-D`, day length `signal-L` [data: base/prototypes/entity/circuit-network.lua].
The vanilla constant combinator does not set `pulse_duration` (a prototype feature: "When not zero, toggle entity will enable constant combinator for that amount of ticks and then turn it off")
[data] [web: https://lua-api.factorio.com/latest/prototypes/ConstantCombinatorPrototype.html].
The item that places each entity has the same name as the entity [data: `minable.result`].

Orientation of the 2x1 combinators: for direction north the prototype declares `input_connection_bounding_box = {{-0.5, 0}, {0.5, 1}}` and `output_connection_bounding_box = {{-0.5, -1}, {0.5, 0}}`
[data: base/prototypes/entity/circuit-network.lua]. With y growing southward, a north-facing combinator has its input half on the south tile and its output half on the north tile: `direction` points from input to output.

### 3.2 Common entity record (`blueprint.entities[]`)

| Field | Type | Required | Default / omitted when | Provenance |
| --- | --- | --- | --- | --- |
| `entity_number` | uint32 | yes | 1-based, unique within the blueprint | [api: BlueprintEntity] [web: https://wiki.factorio.com/Blueprint_string_format] |
| `name` | string | yes | prototype name | [api] |
| `position` | `{x, y}` double | yes | entity center, see 5.4 | [api: MapPosition] |
| `direction` | defines.direction (number) | no | "Only present for entities that can face in different directions and when the entity is not facing north." | [api] |
| `mirror` | boolean | no | omitted when false | [api]; omission [unverified] |
| `quality` | string | no | omitted when `normal` | [api]; seen `"quality": "legendary"` on a substation [data: embedded string] |
| `items` | array of BlueprintInsertPlan | no | item requests; not expected on the five entities | [api] |
| `tags` | dictionary | no | mod data | [api] |
| `burner_fuel_inventory` | BlueprintInventoryWithFilters | no | not applicable | [api] |
| `wires` | array of BlueprintWire | no | Present in the runtime `BlueprintEntity` concept. In exported strings wires live in the blueprint-level `wires` array instead (section 4) | [api]; root-level placement [data: embedded strings] |
| `player_description` | string | no | combinators only (all four types) | [api: BlueprintEntity variants] |
| `control_behavior` | object | no | type-specific, omitted when everything is default | [api]; lamps without it [data: embedded strings] |

`player_description` is the free-text combinator description: "Added editable description to combinator entities" [changelog 2.0.7]; "It is stored in blueprints" [web: https://www.factorio.com/blog/post/fff-384];
runtime name `LuaEntity.combinator_description` [api]. Lamps have no description field [api].

General serialization rules for the importer and exporter:

- Absent field means default. The API marks nearly every control-behavior field optional with a documented default [api].
- The game's exporter does not always omit defaults: constant combinator filters carry `"quality": "normal", "comparator": "="` explicitly, and a pre-release string carries `"select_max": true, "index_constant": 0`
  in random mode [data: base/prototypes/factoriopedia-simulations.lua embedded string]. Byte-exact round-trips against game exports are therefore not a goal; semantic round-trips are.
- Comparators are written with the Unicode forms `≥`, `≤`, `≠`: "While the API accepts both versions ... it'll always return ≥, ≤ or ≠ respectively when reading them back" [api: ComparatorString].
  The importer must accept `>=`, `<=`, `!=` as well.
- Unknown fields must be preserved verbatim (proposal), because the API schema is one patch behind the data.

### 3.3 Shared sub-objects

`CircuitNetworkSelection` [api]:

| Field | Type | Default |
| --- | --- | --- |
| `red` | boolean | true |
| `green` | boolean | true |

Exported shape when not default (both keys versus only the false key) is [unverified]; accept both.

`ComparatorString` [api]: `=`, `>`, `<`, `≥` (alias `>=`), `≤` (alias `<=`), `≠` (alias `!=`). Default where a comparator is optional: `<` for conditions [api: CircuitCondition, DeciderCombinatorCondition].

`CircuitCondition` (lamp enable and logistic condition) [api]:

| Field | Type | Default |
| --- | --- | --- |
| `first_signal` | SignalID | blank |
| `comparator` | ComparatorString | `<` |
| `second_signal` | SignalID | none; when set, `constant` has no effect |
| `constant` | int32 | 0 when neither `second_signal` nor `constant` is given |

`QualityCondition` [api]: either a quality name string, or `{quality?: string, comparator?: ComparatorString}`.

### 3.4 Constant combinator

Entity fields: common fields plus `player_description`, `control_behavior: ConstantCombinatorBlueprintControlBehavior` [api].

| Path | Type | Default | Notes | Provenance |
| --- | --- | --- | --- | --- |
| `control_behavior.is_on` | boolean | true | the On/Off switch; runtime name `enabled` | [api: ConstantCombinatorBlueprintControlBehavior, LuaConstantCombinatorControlBehavior.enabled] [data: core/locale/en/core.cfg gui-constant] |
| `control_behavior.sections` | LogisticSections | required by the API type | wrapper object, note the double nesting `sections.sections` | [api]; nesting confirmed [data: embedded string] |
| `sections.sections` | array of LogisticSection | empty | | [api: LogisticSections] |
| `sections.trash_not_requested` | boolean | false | logistic-only, meaningless for constant combinators | [api] |
| `sections.sections[].index` | uint8 | required | 1-based section position | [api: LogisticSection, LogisticSectionIndex] |
| `sections.sections[].filters` | array of BlueprintLogisticFilter | empty | | [api] |
| `sections.sections[].group` | string | none (no group) | logistic group name; empty string at runtime means no group | [api: LogisticSection, LuaLogisticSection.group] |
| `sections.sections[].multiplier` | float | 1 | "Multiplier applied to all filters before they are used by game." Negative allowed | [api] [changelog 2.0.18] |
| `sections.sections[].active` | boolean | true | per-section checkbox | [api]; "Fixed logistic section active state was not preserved in a blueprint string" [changelog 2.0.10] |
| `filters[].index` | uint16 | required | 1-based slot within the section; gaps allowed [unverified] | [api: BlueprintLogisticFilter, LogisticFilterIndex] |
| `filters[].type` | SignalIDType | `item` (omitted) | | [api]; omission confirmed [data: embedded string] |
| `filters[].name` | string | none | prototype name | [api] |
| `filters[].quality` | string | "nil for any quality" | For a non-zero count a concrete quality is mandatory. Exported explicitly even for `normal` | [api: BlueprintLogisticFilter, SignalFilter]; [data: embedded string] |
| `filters[].comparator` | ComparatorString | "nil if any quality" | Must be `=` when count is non-zero. Exported explicitly | [api: SignalFilter]; [data: embedded string] |
| `filters[].count` | int32 | required | the signal value | [api] |
| `filters[].max_count` | uint32 | none | logistic-only | [api] |
| `filters[].minimum_delivery_count` | uint32 | 0 | space-platform logistic-only | [api] |
| `filters[].import_from` | string | none | space-platform logistic-only | [api] |
| `filters[].request_from` | `planet` / `platforms` / `all` | `planet` | space-platform logistic-only, new in 2.1 | [api] [changelog 2.1.7] |

Limits: `max_logistic_filter_count = 1000` [data: core/prototypes/utility-constants.lua]; section index is uint8 [api]; a per-entity section cap of 100 is commonly cited [unverified].

Terminals: one connection point with a red and a green connector (`circuit_red` = 1, `circuit_green` = 2). It is an output-only device [data: combinator-pictures.lua `circuit_wire_connection_points`]
[web: https://wiki.factorio.com/Constant_combinator]. It outputs "to all connected wire networks" and cannot choose a color [web: same].

Player-facing settings: On/Off switch, sections (add, remove, reorder, per-section active checkbox, group name, multiplier), signal slots with count and quality, description
[data: core/locale/en/core.cfg: gui-constant, AddLogisticSection, RemoveLogisticSection, ReorderLogisticSection, SetLogisticSectionActive, multiplier-tooltip, player-description].

Minimal example, shape taken from a string shipped with the game (trimmed) [data: base/prototypes/factoriopedia-simulations.lua]:

```json
{
  "entity_number": 1,
  "name": "constant-combinator",
  "position": {"x": 6.5, "y": -22.5},
  "control_behavior": {
    "sections": {
      "sections": [
        {
          "index": 1,
          "filters": [
            {"index": 1, "name": "iron-ore", "quality": "normal", "comparator": "=", "count": 1},
            {"index": 2, "type": "fluid", "name": "water", "quality": "normal", "comparator": "=", "count": 1},
            {"index": 3, "type": "virtual", "name": "signal-check", "quality": "normal", "comparator": "=", "count": 1}
          ]
        }
      ]
    }
  }
}
```

Fuller example built from the API schema; exported key order and default omission are [unverified]:

```json
{
  "entity_number": 2,
  "name": "constant-combinator",
  "position": {"x": 0.5, "y": 0.5},
  "direction": 4,
  "player_description": "setpoints",
  "control_behavior": {
    "is_on": false,
    "sections": {
      "sections": [
        {"index": 1, "group": "setpoints", "multiplier": 2, "filters": [{"index": 1, "type": "virtual", "name": "signal-A", "quality": "normal", "comparator": "=", "count": 10}]},
        {"index": 2, "active": false, "filters": [{"index": 1, "name": "iron-plate", "quality": "rare", "comparator": "=", "count": -5}]}
      ]
    }
  }
}
```

### 3.5 Arithmetic combinator

Entity fields: common fields plus `player_description`, `control_behavior: {arithmetic_conditions: ArithmeticCombinatorParameters}` [api].

| Path under `control_behavior.arithmetic_conditions` | Type | Default | Notes | Provenance |
| --- | --- | --- | --- | --- |
| `first_signal` | SignalID | none | if absent, the first operand is `first_constant` | [api] |
| `first_signal_networks` | CircuitNetworkSelection | both | "Which circuit networks (red/green) to read first_signal from." | [api] |
| `first_constant` | int32 | 0 | "Has no effect when first_signal is set." | [api] |
| `operation` | enum | `*` | `*`, `/`, `+`, `-`, `%`, `^`, `<<`, `>>`, `AND`, `OR`, `XOR` | [api: ArithmeticCombinatorParameterOperation]; eleven symbol sprite sets confirm the count [data: combinator-pictures.lua] |
| `second_signal` | SignalID | none | if absent, the second operand is `second_constant` | [api] |
| `second_signal_networks` | CircuitNetworkSelection | both | | [api] |
| `second_constant` | int32 | 0 | | [api] |
| `output_signal` | SignalID | none | no output when absent [unverified]. A combinator as placed has none (12.2), so the state itself is the game's; the editor has it with any operands (9.4) | [api] |

Note the default operation is multiplication, not addition [api]. There is no output network selection: the result goes to both output connectors [web: https://wiki.factorio.com/Arithmetic_combinator].

Terminals: `combinator_input_red` = 1, `combinator_input_green` = 2, `combinator_output_red` = 3, `combinator_output_green` = 4 (section 4.2).

Player-facing settings: two operands (signal or constant, each with R/G network toggles), operation, output signal, description
[data: core/locale/en/core.cfg: gui-arithmetic, gui-network-selector, ChangeArithmeticCombinatorParameters].

Example from the API schema [api]; exported form [unverified]:

```json
{
  "entity_number": 3,
  "name": "arithmetic-combinator",
  "position": {"x": 0.5, "y": 0},
  "player_description": "double everything on red",
  "control_behavior": {
    "arithmetic_conditions": {
      "first_signal": {"type": "virtual", "name": "signal-each"},
      "first_signal_networks": {"red": true, "green": false},
      "second_constant": 2,
      "operation": "*",
      "output_signal": {"type": "virtual", "name": "signal-each"}
    }
  }
}
```

### 3.6 Decider combinator

Entity fields: common fields plus `player_description`, `control_behavior: {decider_conditions: DeciderCombinatorParameters}` [api].

| Path under `control_behavior.decider_conditions` | Type | Default | Notes | Provenance |
| --- | --- | --- | --- | --- |
| `conditions` | array of DeciderCombinatorCondition | non-optional in the API type | may be missing or empty in real strings | [api]; "malformed blueprint if it contained decider combinator with empty conditions or empty output" was a 2.0.25 export bug [changelog 2.0.25] |
| `conditions[].first_signal` | SignalID | blank | | [api] |
| `conditions[].first_signal_networks` | CircuitNetworkSelection | both | | [api] |
| `conditions[].comparator` | ComparatorString | `<` | | [api] |
| `conditions[].second_signal` | SignalID | none | when set, `constant` has no effect | [api] |
| `conditions[].second_signal_networks` | CircuitNetworkSelection | both | | [api] |
| `conditions[].constant` | int32 | 0 | | [api] |
| `conditions[].compare_type` | `and` / `or` | `or` | "Tells how this condition is compared with the preceding conditions". Ignored on the first condition [unverified] | [api] |
| `outputs` | array of DeciderCombinatorOutput | non-optional in the API type | | [api] |
| `else_outputs` | array of DeciderCombinatorOutput | non-optional in the API type | new in 2.1.9; absent in all 2.0 strings | [api] [changelog 2.1.9] |
| `outputs[].signal`, `else_outputs[].signal` | SignalID | required | | [api: DeciderCombinatorOutput] |
| `...[].copy_count_from_input` | boolean | true | "When false, will output the value from constant for the given output_signal." | [api] |
| `...[].constant` | int32 | 1 | editable since 2.0.36 | [api] [changelog 2.0.36] |
| `...[].networks` | CircuitNetworkSelection | both | "which input network to read the value of signal from if copy_count_from_input is true" | [api] |

Terminals: as arithmetic (1, 2 input; 3, 4 output).

Player-facing settings: condition list (add, remove, reorder [unverified]), AND/OR toggle per adjacent pair, R/G toggles per operand, output list and else-output list ("Else outputs: Output signals that are being sent
when conditions evaluate to false"), per output "1" versus "Input count" plus editable constant and R/G toggles, description [data: core/locale/en/core.cfg: gui-decider].
Runtime accessors: `add_condition`, `add_output`, `add_else_output`, `get_*`, `set_*`, `remove_*` [api: LuaDeciderCombinatorControlBehavior].

Example from the API schema [api]; exported form [unverified]:

```json
{
  "entity_number": 4,
  "name": "decider-combinator",
  "position": {"x": 2.5, "y": 0},
  "control_behavior": {
    "decider_conditions": {
      "conditions": [
        {"first_signal": {"type": "virtual", "name": "signal-A"}, "constant": 10, "comparator": ">"},
        {"first_signal": {"name": "iron-plate"}, "first_signal_networks": {"red": true, "green": false},
         "second_signal": {"name": "copper-plate"}, "comparator": "≤", "compare_type": "and"},
        {"first_signal": {"type": "virtual", "name": "signal-B"}, "comparator": "≠", "compare_type": "or"}
      ],
      "outputs": [
        {"signal": {"type": "virtual", "name": "signal-C"}, "copy_count_from_input": false, "constant": 5},
        {"signal": {"name": "iron-plate", "quality": "rare"}, "networks": {"red": false, "green": true}}
      ],
      "else_outputs": [
        {"signal": {"type": "virtual", "name": "signal-D"}, "copy_count_from_input": false}
      ]
    }
  }
}
```

This example reads as `(A > 10 AND iron-plate[red] <= copper-plate) OR B != 0`.

### 3.7 Selector combinator

Entity fields: common fields plus `player_description`, `control_behavior: SelectorCombinatorParameters` [api].
Unlike arithmetic and decider there is no wrapper key in the API schema: the parameters sit directly in `control_behavior` [api: BlueprintEntity variant selector-combinator].

Warning: a blueprint string shipped inside the 2.1.24 game data (created with pre-release version 1.2.10.23) uses a wrapper:
`"control_behavior": {"selector_conditions": {"operation": "random", "select_max": true, "index_constant": 0, "random_update_interval": 15}}`
[data: base/prototypes/factoriopedia-simulations.lua]. The game loads that string, so the wrapped form is at least accepted on import. Which form 2.1.24 writes is [unverified] and is conformance fixture F-01.
The importer should accept both forms; the exporter should follow the fixture result.

| Field | Used by `operation` | Type | Default | Notes | Provenance |
| --- | --- | --- | --- | --- | --- |
| `operation` | all | enum | `select` | `select`, `count`, `random`, `stack-size`, `rocket-capacity`, `quality-filter`, `quality-transfer`, `time`, `quality-select` | [api: SelectorCombinatorParameterOperation] |
| `select_max` | select | boolean | true | true = "Sort descending", false = "Sort ascending" | [api] [data: core/locale/en/core.cfg gui-selector] |
| `index_signal` | select | SignalID | none | "The signal to use, if any." | [api] |
| `index_constant` | select | int32 | 0 | "The signal index to use if not using a specific index_signal." | [api] |
| `index_comparator` | select | ComparatorString | `=` | new in 2.1.21: "Allows for selection of N highest or N lowest signals." | [api] [changelog 2.1.21] |
| `count_signal` | count | SignalID | none | "The signal to emit." | [api] |
| `random_update_interval` | random | uint32 | 0 | ticks | [api] |
| `quality_filter` | quality-filter | QualityCondition | null | | [api] |
| `select_quality_from_signal` | quality-transfer | boolean | false | false = "Direct selection", true = "Select from signal" | [api] [data: core/locale/en/core.cfg] |
| `quality_source_static` | quality-transfer | `{name?: string}` (BlueprintQualityID) | name `normal` | used when `select_quality_from_signal` is false | [api] |
| `quality_source_signal` | quality-transfer | SignalIDBase (no quality) | none | used when `select_quality_from_signal` is true | [api] |
| `quality_destination_signal` | quality-transfer | SignalID | required in the API type | "Target signal" | [api] |
| `game_tick_signal` | time | SignalID | none; prototype default `signal-T` | new in 2.1.7 | [api] [data: circuit-network.lua] [changelog 2.1.7] |
| `day_tick_signal` | time | SignalID | none; prototype default `signal-D` | | same |
| `day_length_signal` | time | SignalID | none; prototype default `signal-L` | | same |
| `select_highest_quality` | quality-select | boolean | true | new in 2.1.21 | [api] [changelog 2.1.21] |

`stack-size` and `rocket-capacity` have no parameters [api]. There is no per-signal red/green selection anywhere in the selector parameters [api].
Mode availability: quality modes need the `quality` feature flag (quality mod), `rocket-capacity` needs `space_travel` (space-age); the GUI marks unavailable modes "[Disabled]" with
"Feature required for this operation is not enabled, so this option is useless." [data: core/locale/en/core.cfg gui-selector] [changelog 2.1.21 "[space-age] Added quality select mode"].
The wiki says five modes without Space Age and nine with it [web: https://wiki.factorio.com/Selector_combinator].

Terminals: as arithmetic (1, 2 input; 3, 4 output).

Examples from the API schema [api]; exported form [unverified]:

```json
{"entity_number": 5, "name": "selector-combinator", "position": {"x": 4.5, "y": 0},
 "control_behavior": {"operation": "select", "select_max": false, "index_constant": 2, "index_comparator": "<"}}
```

```json
{"entity_number": 6, "name": "selector-combinator", "position": {"x": 6.5, "y": 0}, "direction": 8,
 "control_behavior": {"operation": "quality-transfer", "select_quality_from_signal": true,
  "quality_source_signal": {"name": "iron-plate"}, "quality_destination_signal": {"type": "virtual", "name": "signal-A"}}}
```

### 3.8 Lamp (`small-lamp`)

Entity fields: common fields plus [api: BlueprintEntity variant lamp]:

| Field | Type | Default | Notes | Provenance |
| --- | --- | --- | --- | --- |
| `always_on` | boolean | false | "Lamp will be always on (unless disabled by control behavior)." | [api] [data: core/locale/en/core.cfg gui-lamp]; `"always_on": true` seen in 16 shipped lamps [data: embedded strings] |
| `color` | Color `{r, g, b, a}` | none (white light) | manual color: "Allowed lamps color to be configured manually." Floats 0..1, or 0..255 if any value > 1 | [api: Color] [changelog 2.0.7] |
| `control_behavior` | LampBlueprintControlBehavior | none | | [api] |

| Path under `control_behavior` | Type | Default | Notes | Provenance |
| --- | --- | --- | --- | --- |
| `input_networks` | CircuitNetworkSelection | both | new in 2.1.7: which wires the lamp reads | [api] [changelog 2.1.7] |
| `circuit_enabled` | boolean | false | "Enable if" checkbox; the condition only applies when true | [api]; semantics [unverified] |
| `circuit_condition` | CircuitCondition | none | | [api] |
| `use_colors` | boolean | false | "Use colors" | [api] |
| `color_mode` | defines.control_behavior.lamp.color_mode (number) | `color_mapping` | members in API order: `color_mapping`, `components`, `packed_rgb`; numeric values 0, 1, 2 assumed | [api]; numbers [unverified] |
| `red_signal` | SignalID | prototype default `signal-red` | components mode | [api] [data: entities.lua `default_red_signal`] |
| `green_signal` | SignalID | prototype default `signal-green` | components mode | same |
| `blue_signal` | SignalID | prototype default `signal-blue` | components mode | same |
| `rgb_signal` | SignalID | prototype default `signal-white` | packed RGB mode | same |
| `connect_to_logistic_network` | boolean | false | | [api] |
| `logistic_condition` | CircuitCondition | none | | [api] |

Terminals: a single connection point, `circuit_red` = 1 and `circuit_green` = 2 [data: core/lualib/circuit-connector-generated-definitions.lua `lamp`]. The lamp is input-only; it has no `output_networks` [api].
No `direction`: the lamp is not rotatable [data: no directional sprites].

Player-facing settings: Always on, manual color, circuit connection with "Enable if" condition, "Use colors" with mode (Color mapping, Color components, Packed RGB) and signal slots (Red, Green, Blue, RGB),
input wire selection, logistic connection with condition [data: core/locale/en/core.cfg: gui-lamp, gui-control-behavior-modes, lamp-red/green/blue/rgb].

Shipped examples [data: base/prototypes/tips-and-tricks-simulations.lua embedded strings]:

```json
{"entity_number": 22, "name": "small-lamp", "position": {"x": -14.5, "y": 10.5}}
```

```json
{"entity_number": 1, "name": "small-lamp", "position": {"x": 193.5, "y": 35.5}, "always_on": true}
```

Circuit-controlled example from the API schema [api]; exported form [unverified]:

```json
{
  "entity_number": 7,
  "name": "small-lamp",
  "position": {"x": 8.5, "y": 0.5},
  "color": {"r": 1, "g": 0.5, "b": 0, "a": 1},
  "control_behavior": {
    "input_networks": {"red": true, "green": false},
    "circuit_enabled": true,
    "circuit_condition": {"first_signal": {"type": "virtual", "name": "signal-A"}, "constant": 0, "comparator": ">"},
    "use_colors": true,
    "color_mode": 2,
    "rgb_signal": {"type": "virtual", "name": "signal-white"}
  }
}
```

### 3.9 Electric poles

Four prototypes of the type `electric-pole`: `small-electric-pole`, `medium-electric-pole`, `big-electric-pole`, `substation` (table in 3.1).

| Fact | Value | Provenance |
| --- | --- | --- |
| Wire reach | `maximum_wire_distance`: 7.5, 9, 32, 18. A pole has no `circuit_wire_max_distance`; the one value is the reach for copper and for circuit wires | [data: entities.lua] [data: dump]; for circuit wires [game: fixture F-24] for all four (`get_max_wire_distance`, 7.5 / 9 / 32 / 18) |
| Distance of a wire | between two poles the straight line from center to center; between a pole and any other entity the one between their selection boxes, as for every other pair (5.4). The small pole's box is +-0.4 around its center (102/256 in the game), the others' are their tiles | [game: fixture F-24: seven pairs of poles, ten cases of a pole against another entity] |
| Tile size | small and medium 1 x 1 (collision box +-0.15), big 2 x 2 (+-0.65), substation 2 x 2 (+-0.7) | [data: dump `collision_box`]; big pole 2 x 2 [game: fixture F-24, `tile_width`, `tile_height`] |
| Rotation | none: no `direction` in a blueprint; the picture has four variations for the wire angle only | [data: entities.lua] |
| Connectors | one connection point: `circuit_red` = 1, `circuit_green` = 2, and `pole_copper` = 5 for the power wire. No input and no output | [web: https://wiki.factorio.com/Talk:Blueprint_string_format] (see 4.2) |
| Blueprint record | common fields only (`entity_number`, `name`, `position`, `quality`); no `control_behavior`, no settings | [api: BlueprintEntity has no variant `electric-pole`] |
| Supply area | `supply_area_distance` 2.5, 3.5, 2, 9: power only, not modeled | [data: entities.lua] |
| Quality | "Increases the wire reach at higher qualities" for an entity of higher quality; the editor has no entity quality, so the reach is that of normal quality | [data: core/locale/en/core.cfg `wire-reach`]; 2 tiles per quality level, 10 at legendary [runtime dump: `get_max_wire_distance(quality)`] |

A pole relays circuit signals: every circuit wire of one color attached to it belongs to one network (4.1). It is the game's way to span more than the 9 tiles of the other entities.
In a blueprint a pole also carries copper wires (connector 5), which the editor does not model.

### 3.10 Programmable speaker (`programmable-speaker`)

Entity fields: common fields plus [api: BlueprintEntity variant programmable-speaker]. Defaults are those of a new speaker; the API marks the three objects and their members as not optional and names no defaults.

| Path | Type | Default | Notes | Provenance |
| --- | --- | --- | --- | --- |
| `parameters.playback_volume` | float 0..1 | 1 | "Volume" slider | [api: ProgrammableSpeakerParameters]; default [unverified] |
| `parameters.playback_mode` | `"local"` \| `"surface"` \| `"global"` | local | "Sounds ... heard within the audible range of the speaker" / "everywhere on the speaker's surface" / "everywhere". The GUI calls `global` "Universe" since 2.1.10; before 2.0 the field was the boolean `playback_globally` | [api: ProgrammableSpeakerPlaybackMode] [data: core.cfg gui-programmable-speaker] [changelog 2.1.10]; default [unverified] |
| `parameters.allow_polyphony` | boolean | false | "Allow up to 10 sounds to be played at the same time. Disable to only allow one sound at the same time (useful for factory alerts)." 10 is the prototype's `maximum_polyphony` | [api] [data: core.cfg] [data: dump]; default [unverified] |
| `parameters.volume_controlled_by_signal` | boolean | false | "Signal value is volume": "The value of the input circuit network signal determines the volume of the sound played, in percents, in the range between 0 and 100. Values outside of the range are clamped." | [api] [data: core.cfg] [changelog 2.0.36] |
| `parameters.volume_signal_id` | SignalID | none | the signal for it | [api] |
| `alert_parameters.show_alert` | boolean | false | "Show an alert with a message in the GUI when a sound is played." | [api: ProgrammableSpeakerAlertParameters] [data: core.cfg] |
| `alert_parameters.show_on_map` | boolean | true | "Show icon on map" | [api] [data: core.cfg]; default [unverified] |
| `alert_parameters.icon_signal_id` | SignalID | none | icon of the alert | [api] |
| `alert_parameters.alert_message` | string | "" | text of the alert, up to 150 characters; takes part in blueprint parametrisation | [api] [web: https://wiki.factorio.com/Programmable_speaker] [changelog 2.0.x "alert text ... parametrisation"] |
| `control_behavior.circuit_condition` | CircuitCondition | blank | the condition; with `signal_value_is_pitch` its `first_signal` is the pitch signal | [api: ProgrammableSpeakerBlueprintControlBehavior]; pitch signal slot [unverified] |
| `control_behavior.circuit_parameters.signal_value_is_pitch` | boolean | false | "The value of the input circuit network signal determines the musical note that will be played." | [api: ProgrammableSpeakerCircuitParameters] [data: core.cfg] |
| `control_behavior.circuit_parameters.stop_playing_sounds` | boolean | false | "Change of the input circuit network signal will stop currently playing sounds immediately instead of waiting for them to finish." | [api] [data: core.cfg] [changelog 2.0.36] |
| `control_behavior.circuit_parameters.instrument_id` | uint32 | 0 | index into the prototype's `instruments`, from 0 | [api]; base [unverified] (`LuaEntity.play_note` takes the same two numbers) |
| `control_behavior.circuit_parameters.note_id` | uint32 | 0 | index into the instrument's `notes`, from 0 | same |

There is no `circuit_enabled` and no `input_networks`: a wired speaker always evaluates its condition, on the sum of both wires [api: no such fields].
Terminals: a single connection point, `circuit_red` = 1 and `circuit_green` = 2 [data: dump `circuit_connector` with one set of wire points]. The speaker only reads. No `direction` [data: one sprite].

Instruments and notes [data: base/prototypes/entity/circuit-network.lua `instruments`] [data: dump, identical in all eight module sets]: 12 instruments in this order, with the number of notes:
`alarms` 7, `miscellaneous` 24, `drum-kit` 17, `piano` 48 (F3 to E7), `bass` 36 (F2 to E5), `lead` 36, `saw` 36, `square` 36, `celesta` 36 (F5 to E8), `vibraphone` 36, `plucked` 36 (F4 to E7), `steel-drum` 36 (F3 to E6).
Each has a `name`, each note a `name` and a `sound`; the display names are in `base/locale/en/base.cfg`, sections `programmable-speaker-instrument` and `programmable-speaker-note` ("Drumkit", "Sawtooth", "Hi-hat 1", ...).
"Added several new notes to Miscellaneous" [changelog 2.1.10] shows that the lists change between versions, which is why the editor writes names and not positions (`docs/dsl.md`, speaker); the catalog carries the lists in order (`packages/catalog`, `speakers`).
A note may have a `cyclic_sound` [changelog 2.0.36]; no note of 2.1.24 has one [data: dump].

Shipped examples: none found in the embedded blueprint strings [data: grep]. Example from the API schema [api]; exported form [unverified]:

```json
{
  "entity_number": 3,
  "name": "programmable-speaker",
  "position": {"x": 4.5, "y": 0.5},
  "parameters": {"playback_volume": 0.8, "playback_mode": "global", "allow_polyphony": false, "volume_controlled_by_signal": false},
  "alert_parameters": {"show_alert": true, "show_on_map": true, "icon_signal_id": {"name": "iron-plate"}, "alert_message": "Iron is running out"},
  "control_behavior": {
    "circuit_condition": {"first_signal": {"name": "iron-plate"}, "constant": 100, "comparator": "<"},
    "circuit_parameters": {"signal_value_is_pitch": false, "stop_playing_sounds": false, "instrument_id": 0, "note_id": 6}
  }
}
```

## 4. Wires

### 4.1 Encoding in 2.x

Each wire is a 4-tuple `[source_entity_number, source_wire_connector_id, target_entity_number, target_wire_connector_id]` [api: BlueprintWire].
In an exported string the tuples are collected in one array `blueprint.wires` at the blueprint root, not per entity [data: embedded strings, 30 of 89 shipped blueprints have a root `wires` key].
The runtime `BlueprintEntity` concept also has a per-entity `wires` field [api]; that is the Lua table view, not the string layout.

Shipped example [data: base/prototypes/factoriopedia-simulations.lua]:

```json
"wires": [[1, 1, 2, 1], [2, 3, 5, 1]]
```

Entity 1 is a constant combinator, 2 a selector combinator, 5 a display panel: constant red -> selector red input; selector red output -> display panel red.

Observed conventions: the lower entity number comes first in each tuple [web: https://wiki.factorio.com/Talk:Blueprint_string_format]; whether the game requires this on import is [unverified].
A wire always joins two connectors of the same wire type; a combinator may be wired to itself (for example `[n, 3, n, 1]`) [unverified].
A circuit network is the set of connectors joined transitively by wires of one color. Input and output connectors of one combinator are different connectors and only share a network if wired together.

### 4.2 `defines.wire_connector_id`

The API file lists the members without numeric values (`order` 0..8 is display order, not the value) [api]. The online defines page also shows no numbers
[web: https://lua-api.factorio.com/latest/defines.html]. Values below come from the wiki talk page and are partly confirmed by strings shipped with the game.

| Member | Value | Wire type | Used by | Provenance |
| --- | --- | --- | --- | --- |
| `circuit_red` | 1 | red | single-connector entities (constant combinator, lamp, poles, ...) | [web: https://wiki.factorio.com/Talk:Blueprint_string_format]; value 1 confirmed [data: embedded string] |
| `circuit_green` | 2 | green | same | [web: same]; not seen in shipped strings |
| `combinator_input_red` | 1 | red | arithmetic, decider, selector input | [web: same]; value 1 confirmed [data: embedded string] |
| `combinator_input_green` | 2 | green | same | [web: same] |
| `combinator_output_red` | 3 | red | arithmetic, decider, selector output | [web: same]; value 3 confirmed [data: embedded string] |
| `combinator_output_green` | 4 | green | same | [web: same] |
| `pole_copper` | 5 | copper | electric poles | [web: same]; value 5 confirmed [data: 70 shipped pole wires] |
| `power_switch_left_copper` | 5 | copper | power switch | [web: same] |
| `power_switch_right_copper` | 6 | copper | power switch | [web: same] |

The numbers are not unique across members (1, 2 and 5 are shared), so a connector id is only meaningful together with the entity type. For ids 1..4: odd is red, even is green; 1, 2 are the input or only
connection point; 3, 4 are the combinator output.

`defines.wire_type` has `red`, `green`, `copper` [api]; numeric values are not needed for blueprints and are [unverified].
`defines.wire_origin` has `player`, `script`, `radars` [api]; blueprint wires are player wires [unverified].

Connectors available per entity in scope:

| Entity | 1 | 2 | 3 | 4 |
| --- | --- | --- | --- | --- |
| constant-combinator | red (output) | green (output) | - | - |
| arithmetic / decider / selector | red input | green input | red output | green output |
| small-lamp | red (input) | green (input) | - | - |
| programmable-speaker | red (input) | green (input) | - | - |
| electric poles | red | green | - | - |

A pole's connector neither reads nor writes: it only joins the wires on it. The editor names the three roles `in`, `out` and `io` (`TERMINAL_SIDES` in `@face/model`); `io` is written in the circuit language as the bare entity name.

### 4.3 Differences from the 1.1 `connections` format

| Aspect | 1.1 | 2.x | Provenance |
| --- | --- | --- | --- |
| Circuit wires | per entity: `connections: {"1": {"red": [{"entity_id": N, "circuit_id": M}], "green": [...]}, "2": {...}}`; key "1" = first connection point, "2" = second (combinator output); `circuit_id` = connection point on the target | root `wires` array of 4-tuples | [web: https://wiki.factorio.com/Blueprint_string_format] ; [data] |
| Copper wires | `neighbours: [entity_number, ...]` on poles | `wires` tuples with connector 5 / 6 | [web: same]; `neighbours` seen in shipped 1.1.0.x and a few 1.2.0.x strings [data] |
| Connector model | `defines.circuit_connector_id` plus wire color | merged `defines.wire_connector_id` ("Added defines.wire_connector_id") | [changelog 2.0.7] |
| Each wire stored | twice, once on each end [unverified] | once | [unverified] |
| `direction` | 8-way, 0..7 | 16-way, 0..15, values doubled | [web: same] ; [api: defines.direction] |
| SignalID `type` | always present | omitted for items | [web: https://wiki.factorio.com/Talk:Blueprint_string_format] |
| Constant combinator | `control_behavior.filters: [{signal, count, index}]`, `is_on` | `control_behavior.sections.sections[].filters[]` with `name`/`type`/`quality`/`comparator`/`count` | [web: Blueprint_string_format]; [data] |
| Decider | single condition object (`first_signal`, `comparator`, `constant` / `second_signal`, `output_signal`, `copy_count_from_input`) | `conditions[]`, `outputs[]`, `else_outputs[]` | [web: same] [unverified for exact 1.1 keys]; [api] |
| Version number | major 1 | major 2 | [data: shipped strings 1.1.0.14 .. 2.1.10.1] |

Mapping 1.1 -> 2.x connector id: `(connection_point - 1) * 2 + (red ? 1 : 2)` [unverified, follows from 4.2].

The game itself still imports old strings: of the 89 blueprint strings shipped in the 2.1.24 install, 10 have version 1.1.0.x (8 in base/prototypes/tips-and-tricks-simulations.lua, 2 in
base/menu-simulations/menu-simulations.lua), 61 have pre-release versions 1.2.x, 14 are 2.0.x and 4 are 2.1.x; `neighbours` occurs in the 1.1.0.x strings and in some 1.2.0.x strings;
none of the shipped 1.1 strings contains circuit `connections` [data: decoded embedded strings].
Proposal for face: detect format by `version >> 48`. Major 2 is accepted. Major 1 is rejected with an explicit diagnostic ("Factorio 1.x blueprint; re-export from 2.x") in the initial product;
a converter is a possible later addition. Pre-release 2.0 strings report major 1, minor 2 (1.2.x) while already using the 2.x layout (`wires`, sections) [data]; treat `1.2.x` as 2.x-layout with legacy wrinkles
(see 3.7) or reject them together with 1.1; they are only found in game data, not in player exports.

## 5. Blueprint string envelope

### 5.1 Encoding

| Step | Detail | Provenance |
| --- | --- | --- |
| Version character | first character `0` ("currently 0 for all Factorio versions through 2.0") | [web: https://wiki.factorio.com/Blueprint_string_format]; all 89 shipped strings start with `0` [data] |
| Base64 | standard alphabet, of the rest of the string | [web: same] [data] |
| Compression | zlib stream (RFC 1950), deflate level 9; shipped strings start with bytes `78 da`, so the text starts with `0eN` | [web: same] [data] |
| Payload | UTF-8 JSON, one root object | [web: same] |
| Plain JSON | since 2.0 the game also imports uncompressed JSON text directly | [web: same]; [game: fixture F-30, the import "plain JSON": `import_stack` takes the JSON text of a book and returns 0] |

Runtime helpers: `LuaItemStack.export_stack()` / `import_stack(data)` produce and consume the full string; `helpers.encode_string` "Deflates and base64 encodes", `helpers.decode_string`
"Base64 decodes and inflates" (without the version character [unverified]); `helpers.table_to_json` / `json_to_table` [api].
fflate (already installed) covers zlib inflate/deflate for the importer and exporter.

### 5.2 Root objects

The root object has exactly one key [web: https://wiki.factorio.com/Blueprint_string_format]:

| Root key | Content | Provenance |
| --- | --- | --- |
| `blueprint` | a single blueprint | [web] [data: all 89 shipped strings] |
| `blueprint_book` | in the order the game writes them: `blueprints` (a list of objects with one item key, `blueprint`, `blueprint_book`, `upgrade_planner` or `deconstruction_planner`, followed by `index`, the slot of the item counted from 0; left out when the book is empty), `item` (`"blueprint-book"`), `label`, `label_color` (`r`, `g`, `b`, `a`), `description`, `icons` (`signal`, and `index` from 1), `active_index` (from 0, always written), `version`. Books and planners inside a book are items like a blueprint, at any depth (a book three levels deep is read and written back) | [web]; [game: fixture F-30, `book.exported` and the import "three levels"] |
| `upgrade_planner`, `deconstruction_planner` | other exportable items: `settings`, `item` (`"upgrade-planner"`, `"deconstruction-planner"`), `label`, `version`. Description and icons are in `settings`: of an upgrade planner `mappers` (`from`, `to`, and `index` from 0), `description`, `icons`; of a deconstruction planner `entity_filters` (`name`, and `index` from 0), `tile_selection_mode`, `description` | [api: export_stack lists blueprint, blueprint-book, deconstruction-planner, upgrade-planner, item-with-tags]; key names [game: fixture F-30, `book.items`, one planner of each kind with one mapper or filter] |

How the game writes and reads a book, all [game: fixture F-30] (`tests/fixtures/game/F-30-blueprint-book.json`; 6.8). The runtime API counts slots and the active index from 1, the string counts `index` and `active_index` from 0.

| Statement | In the fixture |
| --- | --- |
| A new book has no slots. Its inventory (`get_inventory(defines.inventory.item_main)`) ends at the last slot in use: clearing the last item makes it shorter, clearing one before it leaves an empty slot. A slot beyond the end cannot be written ("Index out of inventory bounds."); `LuaInventory.insert` puts an item into the first empty slot and, when there is none, into a new one at the end | `native.empty`, `native.beyondSize`, `book.inserts`, `book.sizeAfterClear`, `book.added`, `book.sizeAfterClearingLast` |
| Export: the items in the order of their slots, each as `{ "<item key>": { ... }, "index": slot - 1 }`. An empty slot is not written; it shows only as a step in `index` (0, 2, 3, 4, 5). An empty book has no `blueprints` at all: `{"blueprint_book":{"item":"blueprint-book","active_index":0,"version":...}}`. A blueprint nothing was put into is written, as `{"item":"blueprint","version":...}` | `book.exported`, `native.empty`, `native.blankBlueprint` |
| `active_index` is always written. It may be the slot of a planner, of a book or an empty one. Set through the API beyond the last slot it stays what it was, without an error; 0 is refused. `LuaItemCommon.active_index` of an empty book reads 1, not nil as the API reference has it | `book.active`, `native.empty` |
| Import, `index`: the items are read in the order of the list. One with an `index` goes to slot `index` + 1 wherever it stands in the list, and gaps stay (`index` 5000 makes a book of 5001 slots). One without `index` goes to the first slot that is empty at that moment. One whose slot is taken is dropped, so the first of two with the same `index` stays, also when the first got the slot for having no `index`; `import_stack` returns 0 all the same. A fraction is cut off (1.5 is 1) | imports "out of order", "gap", "first index 1", "far index", "appended after a gap", "no index", "index on some", "duplicate index", "duplicate index, last", "no index, then index 0", "index 1.5" |
| Slot limit: a book has at most 65535 slots, `index` 0 to 65534. `index` 65535 is read like no `index` (first empty slot). With 65536 or more, or a negative one, the item is dropped and `import_stack` returns -1 (imported with errors). Of 70000 items without `index` the first 65535 are kept and the rest dropped, with the result 0; `LuaInventory.insert` takes 65535 blueprints and no more | imports "index 65534", "index 65535", "index 65536", "index 100000", "index -1"; `limits` |
| Import, `active_index`: taken as written, also when it names an empty slot. One beyond the last slot is ignored. Where it is absent or ignored the active slot is that of the first item of the list, which is not always the first slot (slot 3 for a list that starts with `index` 2) | imports "active_index 1", "active_index on a gap", "active_index beyond", "active_index beyond, first index 1", "active_index absent", "out of order", "index on some" |
| `item` and `version` of a book may be missing, and so may `blueprints`, which may also be empty; a blueprint without entities is an item like any other | imports "book without item and version", "no blueprints", "empty blueprints", "blueprint without entities" |
| The game reads the string it exported to the same book and exports the same string again | `book.reimport` |

For a tool that adds a blueprint to a book the game wrote this means: give it an `index` no other item of the list has, the highest + 1 or that of an empty slot, and at most 65534; to replace a blueprint keep its `index`. `packages/blueprints/test/bookFixture.test.ts` holds the reading of books (`inspectBlueprint`, `importBlueprint` with `select`) against the fixture; a path there is a position in the `blueprints` list, not an `index`.

Blueprint object fields:

| Field | Type | Notes | Provenance |
| --- | --- | --- | --- |
| `item` | string | `"blueprint"` | [web] [data] |
| `label` | string | optional name | [web] [data: 3 shipped strings] |
| `label_color` | Color | optional | [web] [api: LuaItemCommon.label_color] |
| `description` | string | optional | [web] [api: LuaItemCommon.blueprint_description] |
| `icons` | array of `{signal: SignalID, index}` | index 1..4 | [api: BlueprintSignalIcon] [data] |
| `entities` | array | section 3 | [data] |
| `wires` | array of BlueprintWire | section 4 | [data] |
| `tiles` | array of `{name, position}` | | [web] [data] |
| `schedules` | array | trains | [web] [data] |
| `stock_connections` | array | rolling stock couplings, 2.x | [web: https://wiki.factorio.com/Talk:Blueprint_string_format] [data] |
| `snap-to-grid` | position | "The dimensions of the grid to use for snapping." Note the hyphenated key | [web] [api: blueprint_snap_to_grid] |
| `absolute-snapping` | boolean | | [web] [api: blueprint_absolute_snapping] |
| `position-relative-to-grid` | position | offset for absolute snapping | [web] [api: blueprint_position_relative_to_grid] |
| `parameters` | array | blueprint parametrisation data; key name and schema not in local data | [unverified] |
| `version` | integer | see 5.3 | [web] [data] |
| `branch_version` | integer | seen once (value 1) in a pre-release string; meaning unknown | [data: base/prototypes/tips-and-tricks-simulations.lua] |

Minimal blueprint (two wired entities) assembled from the shapes above:

```json
{
  "blueprint": {
    "icons": [{"signal": {"name": "constant-combinator"}, "index": 1}],
    "entities": [
      {"entity_number": 1, "name": "constant-combinator", "position": {"x": 0.5, "y": 0.5},
       "control_behavior": {"sections": {"sections": [{"index": 1, "filters": [
         {"index": 1, "type": "virtual", "name": "signal-A", "quality": "normal", "comparator": "=", "count": 1}]}]}}},
      {"entity_number": 2, "name": "small-lamp", "position": {"x": 1.5, "y": 0.5},
       "control_behavior": {"circuit_enabled": true,
         "circuit_condition": {"first_signal": {"type": "virtual", "name": "signal-A"}, "constant": 0, "comparator": ">"}}}
    ],
    "wires": [[1, 1, 2, 1]],
    "item": "blueprint",
    "version": 562954249961472
  }
}
```

### 5.3 Version number

`version` packs four unsigned 16-bit fields: `major << 48 | minor << 32 | patch << 16 | developer_build` [web: https://wiki.factorio.com/Version_string_format]; confirmed by decoding the shipped strings,
for example 562954249043969 = 2.1.10.1 and 562954248388627 = 2.1.0.19 [data: space-age/prototypes/tips-and-tricks-simulations.lua].

| Version | Value |
| --- | --- |
| 2.0.0.0 | 562949953421312 (2^49) |
| 2.1.0.0 | 562954248388608 |
| 2.1.24.0 | 562954249961472 |
| 2.1.24.b | 562954249961472 + b |

The developer build number of the released 2.1.24 binary is not in the local data [unverified]; exporting with build 0 is expected to be accepted [unverified].
The value exceeds 2^32 but stays below 2^53, so a JavaScript number holds it exactly; do not use 32-bit bit operators on it (use BigInt or division).

### 5.4 Positions, directions, grid

| Topic | Rule | Provenance |
| --- | --- | --- |
| Position | center of the entity, in tiles, relative to an arbitrary blueprint origin; fixed-point with 1/256 tile resolution | [api: MapPosition]; "0 is the center" [web: Blueprint_string_format] |
| 1x1 entity (constant combinator, lamp, speaker, small and medium pole) | both coordinates end in .5 | [data: shipped lamps and constant combinator]; the others by the same rule |
| 2x2 entity (big pole, substation) | both coordinates are integers (the center is the corner the four tiles share) | [game: fixture F-24: the probe places a big pole on a center of whole numbers and the game leaves it there]; substation [unverified], same size |
| 2x1 combinator facing north or south (0, 8) | x ends in .5, y is an integer (center lies on the tile boundary) | [data: shipped selector at (6.5, -21), direction 8] |
| 2x1 combinator facing east or west (4, 12) | x is an integer, y ends in .5 | [unverified], follows from rotation |
| Tiles occupied, north-facing, center (x, y) | output half: tile containing (x, y - 0.5); input half: tile containing (x, y + 0.5) | [data: connection bounding boxes, see 3.1] |
| `direction` | 16-way in 2.x: north 0, northnortheast 1, northeast 2, eastnortheast 3, east 4, ..., south 8, ..., west 12, ..., northnorthwest 15; omitted when north | [api: defines.direction member order]; values 4, 8, 12 dominate shipped strings [data] |
| Combinator directions | only 0, 4, 8, 12 are meaningful (4-way sprites) | [data: combinator-pictures.lua] |
| Rotation semantics | direction 0: output north, input south. 4: output east. 8: output south. 12: output west | [data: bounding boxes] for 0; others [unverified] |
| `snap-to-grid` etc. | blueprint-level, do not change entity coordinates' meaning | [web] |

The exporter must emit positions that respect tile alignment, otherwise the game re-snaps or rejects; `set_blueprint_entities` has a `fix_positions` option at runtime [api].
Wire reach is 9 tiles for the four combinators, the lamp and the speaker [data: core/lualib/circuit-connector-sprites.lua: `default_circuit_wire_max_distance = 9` and every `*_circuit_wire_max_distance` there is 9]; an electric pole has its own (3.9),
and so have two entities the editor does not have yet, the power switch (10) and the agricultural tower (30) (13.3); a layout generator must keep wired entities within reach (the game drops or refuses over-long wires [unverified]).
How the game measures [game: fixture F-24, 2.1.25, `LuaWireConnector.can_wire_reach` and `connect_to` with the reach check, which agree; recorded 2026-11-14 with 2.1.24 and again 2026-11-17 with 2.1.25, the same placement for placement: 68 cases, 79,628 placements, no mismatch]:

- Between two electric poles the distance of a wire is the straight line between their centers (their positions).
- For every other pair, a pole and another entity included, it is the straight line between the nearest points of the two entities' selection boxes: per axis the gap between the boxes in tiles, 0 where they overlap on that axis, then the hypotenuse
  of the two gaps. The wire connects when that distance is less than or equal to the reach; exactly the reach connects.
- The selection box is `selection_box` of the prototype around the position of the entity, turned with the entity by quarter turns. The game has it in 1/256 of a tile, cut off towards 0: 0.4 is 102/256 = 0.3984375
  [runtime dump: `LuaEntityPrototype.selection_box` of all 98 prototypes is the cut-off value of `data.raw`]. For 80 of the 98 prototypes it is the tiles the entity covers, so that two adjacent entities have the distance 0; the 18 others are in 13.2.
- With reach 9 and 1x1 entities whose boxes are their tiles: nine empty tiles between them in a row connect, ten do not; 6 empty tiles horizontally and 6 vertically connect (8.49), 7 and 7 do not (9.90).
  Two small poles (7.5) in a column connect with their centers seven tiles apart and not with eight, although only seven tiles are empty between them then.
- What does not matter: the connector that is wired (input or output of a combinator), the collision box (a lamp, +-0.15, behaves like a constant combinator, +-0.35), and the tile footprint where the selection box is another.
- An entity that has no direction in the game does not turn its box: a stone furnace built facing east faces north (13.4), and its box of 1.6 x 2 tiles stays upright.
- `LuaEntity.selection_box` of a rail signal that faces east or west is not the turned box of its prototype: the game moves it along the rail (facing east y from -0.199 to 0.699 instead of +-0.449) [game: scenario of 2026-11-14, not kept].
  The reach check does not use the moved box: "rail signal east - constant" of F-24 fits the turned prototype box on every placement and the moved one not on 13. Rail signals in the twelve directions between the quarter turns are not recorded [unverified]; the editor has four directions.
- The reach of a wire is the smaller of the two entities' reaches: a constant combinator (9) and a small electric pole (7.5) connect up to 7.5, a constant combinator and a big electric pole (32) up to 9.

Other measures against the same recording, with the number of placements on which they give another verdict than the game:

| Measure | Mismatches | Where |
| --- | --- | --- |
| Selection boxes, turned; between two poles the centers | 0 | |
| The same with the boxes as `data.raw` has them, not cut off to 1/256 | 4 | a small pole and a splitter 7 tiles by 2 apart: exactly 7.5 with 0.4 and 0.9, 7.503 in the game |
| The same with the boxes not turned | 326 | 16 cases of an entity facing east, south or west |
| Selection boxes, also between two poles | 1,504 | all seven pairs of poles |
| A pole as its center against the box of the other entity | 748 | all ten cases of a pole against another entity |
| Tile footprints (the editor's rule until 2026-11-14) | 1,962 | all seven pairs of poles, and 27 cases with a box that is not the tiles (train stop, offshore pump, rail signal, splitter, recycler, inserter, display panel, stone furnace) |
| Collision boxes | 3,389 | every case |
| Centers | 7,837 | every case but the pairs of poles |

The first recordings (2026-11-12, 16 cases) had only entities whose selection box is their tiles, against a constant combinator: there the footprints give the same verdicts.

The editor implements this in `packages/model/src/wireReach.ts` (`wireSpan`, `wireMeasure`) with the box of `selectionBox` (`footprint.ts`), which is the footprint unless the entity table has a `selectionBox` for the prototype (13.2). A pole has the reach of its prototype
(`PROTOTYPES`; the rule for all prototypes is `hasOwnWireReach`, 13.3), every other entity the reach of the project (a setting, 9 by default, 0 for unlimited), and a wire may span the smaller of the two; an unlimited end does not limit.
`packages/model/test/wireReachGame.test.ts` checks this against every placement of the recording, by the rule alone from what the recording says of the two entities and with the editor's own entities.

## 6. Simulation semantics

### 6.1 Reference model (proposal)

State per combinator: its output signal set. Per tick t:

1. Network content N(t) for each network = sum of the outputs currently held by all emitters connected to it.
2. Every arithmetic, decider and selector combinator reads its inputs from N(t) and computes a new output.
3. All new outputs are committed simultaneously and are first visible in N(t+1).

| Statement | Provenance |
| --- | --- |
| "With both the arithmetic and decider combinator, there is one tick (60th of a second) of latency before the output signal is ready to be used as an input into a circuit network." | [web: https://wiki.factorio.com/Decider_combinator] |
| "each update tick is separated into two steps ... the outputs are not recognized by the circuit network until the following step" | [web: https://wiki.factorio.com/Tutorial:Combinator_tutorial] |
| Update is order-independent (simultaneous); circuit logic is multithreaded in 2.0 ("Improved circuit network logic by making it fully multithreaded") | [changelog 2.0.7]; order independence [unverified] |
| Selector combinator has the same 1-tick latency | [unverified] |
| Constant combinator: its configured signals are present on the network without a combinator delay | [unverified] |
| When a constant combinator is toggled or edited, the tick at which the network changes relative to the edit | [unverified] |
| `LuaCircuitNetwork.signals` is documented as "The circuit network signals last tick"; `LuaCombinatorControlBehavior.signals_last_tick` as "signals sent by this combinator last tick" | [api] |
| Lamp: evaluates its condition and color from the current network content; it emits nothing | [unverified] |
| Lamp state changes one tick after the network change or in the same tick | [unverified] |
| Power: arithmetic, decider, selector need electricity (1 kW, primary-input, enlarged buffer); the constant combinator needs none; behavior when unpowered is not modeled | [data] [changelog 2.0.72] [web: https://wiki.factorio.com/Constant_combinator] |

The simulator assumes all combinators and lamps are always powered and not frozen (proposal).

### 6.2 Networks and values

| Statement | Provenance |
| --- | --- |
| Values are signed 32-bit, -2147483648..2147483647 | [data: base/locale/en/base.cfg] [api: Signal.count int32] |
| "The numbers wrap around on overflow, so e.g. 2147483647 + 10 becomes -2147483639." | [web: https://wiki.factorio.com/Circuit_network] |
| Same-color wires form one network whose members' outputs are summed per signal | [web: same] |
| Red and green are separate networks; an entity connected to both sees the sum unless a network selection says otherwise ("Receiving devices sum all signals from each wire connected to them, even red and green wires") | [web: same] |
| For an operand with both networks selected, "the inputs are summed" | [web: https://wiki.factorio.com/Arithmetic_combinator] |
| Summation of red + green wraps like any other addition | [unverified] |
| A combinator "sends its output to both output connections" (red and green carry the same values) | [web: https://wiki.factorio.com/Arithmetic_combinator] |
| A zero-valued signal does not exist: "A signal is present if it is nonzero"; "All unused channels have the value zero" | [web: https://wiki.factorio.com/Circuit_network] |
| Wildcards iterate only over non-zero signals: "Each as an input will only be processed on signals that have a non-zero value" | [web: same] |
| If red has +3 and green has -3 for a signal and both are selected, the signal is absent (sum 0) for wildcard iteration | [unverified] |
| Own output wired to own input: legal; the combinator reads its own previous-tick output (basis of clocks, counters, memory cells) | [web: https://wiki.factorio.com/Tutorial:Combinator_tutorial] |
| Wiring red output and green output of one combinator into both inputs of a consumer doubles the value there | [unverified], follows from the two rules above |

### 6.3 Arithmetic combinator

Operand resolution: `first` = value of `first_signal` on `first_signal_networks` if set, else `first_constant`; likewise `second` [api]. A missing specific signal reads as 0 [web: Circuit_network].

| Operation | Semantics | Provenance | Edge cases needing fixtures |
| --- | --- | --- | --- |
| `+`, `-`, `*` | two's-complement wrap to int32 | wrap [web: https://wiki.factorio.com/Circuit_network]; applied to `*` [unverified] | `2147483647 + 1`, `-2147483648 - 1`, `65536 * 65536`, `-2147483648 * -1` |
| `/` | truncates toward zero: 21/10 = 2, -21/10 = -2, 19/-10 = -1, -21/-10 = 2 | [web: https://wiki.factorio.com/Arithmetic_combinator] | `x / 0` (expected 0), `-2147483648 / -1` (expected -2147483648) [unverified] |
| `%` | remainder with the sign of the left operand: 13 % 3 = 1, 13 % -3 = 1, -13 % 3 = -1 | [web: same] | `x % 0` (expected 0), `-2147483648 % -1` (expected 0) [unverified] |
| `^` | integer power with int32 wrap | operation exists [api]; semantics [unverified] | negative exponent (expected 0 for all bases; alternative hypothesis: truncated real result, giving 1 for base 1 and +-1 for base -1), `0 ^ 0` (expected 1), `2 ^ 31`, `2 ^ 32`, `3 ^ 100`, `(-2) ^ 31`, `0 ^ -1` |
| `<<` | left shift, zero fill | [web: same] | shift amounts 31, 32, 33, -1; hypothesis: amount is masked to 5 bits [unverified] |
| `>>` | arithmetic right shift ("preserves the sign bit") | [web: same] | `-8 >> 1` = -4; amounts 32, 33, -1 [unverified] |
| `AND`, `OR`, `XOR` | bitwise on the 32-bit two's-complement pattern | operations exist [api]; semantics [unverified] | `-1 AND 255`, `-1 XOR -2147483648` |

Each semantics:

| Case | Behavior | Provenance |
| --- | --- | --- |
| each as one operand, each as output | "the operation is performed individually on the value of each input signal"; "each result is sent to the output on the same signal" | [web: https://wiki.factorio.com/Arithmetic_combinator] |
| each as one operand, specific output | "the individual results are all added together, and that result is sent to the output on the specified signal" (wrapping sum [unverified]) | [web: same] |
| each iterates over | non-zero signals of the networks selected for that operand | [web: Circuit_network]; network scoping [unverified] |
| each on both operands (2.0+) | allowed: "perform Each-Each operations". Presumed: for every signal present in either operand's selection, compute `first[s] op second[s]` with absent = 0 | [changelog 2.0.7]; iteration set [unverified]. The wiki still says "Up to one of the operands can be the each virtual signal" and is stale |
| each output without each operand | invalid: "If neither operand is the each signal, the output must be a single signal." | [web: same] |
| other operand is a specific signal | the specific signal's own value is read normally; whether that signal is excluded from the each iteration | [unverified] |
| result 0 | not emitted | [web: Circuit_network] |
| quality | each preserves the full identity including quality | [unverified] |

### 6.4 Decider combinator

Condition expression:

| Statement | Provenance |
| --- | --- |
| A condition compares `first_signal` with `second_signal` or `constant` using one of six comparators | [api] |
| "Each of these operators can be toggled between AND and OR with AND having higher order of precedence." | [web: https://wiki.factorio.com/Decider_combinator] |
| There is no explicit grouping; the flat list with `compare_type` is the whole expression. Equivalent form: a disjunction of AND-groups, a new group starting at every condition whose `compare_type` is `or` (the default) | [api] + [web: same]; equivalence is a direct consequence |
| Each operand has its own red/green selection; "If both red and green are checked, the input values are summed." | [web: same] [api] |
| Empty condition list: the conditions do not hold, the else outputs are sent | [game: fixture F-29] |
| A condition with blank `first_signal`: the blank signal reads as 0. The default `< 0` does not hold; `= 0`, `> -1` and `< signal` with that signal at 1 hold | [game: fixture F-29]. Unlike the condition of an entity (6.7), which is never fulfilled without a first signal. The simulation does the same (rule D-BLANK of `packages/simulation/CONFORMANCE.md`) |

Wildcards in conditions (no each present):

| Signal | Behavior | Provenance |
| --- | --- | --- |
| everything | true if all (non-zero) input signals on the operand's networks satisfy the comparison; true with no inputs | [data: base/locale/en/base.cfg] [web: https://wiki.factorio.com/Circuit_network] |
| anything | true if at least one input signal satisfies it; false with no inputs | same |
| everything / anything versus a second signal | "it is implicitly excluded from the set of signals that everything checks" (claim for the right-hand signal) | [web: https://wiki.factorio.com/Circuit_network]; needs a fixture |
| Several anything conditions joined by AND | whether the same signal must satisfy all of them. The tooltip "the first signal that passed all conditions" suggests per-signal evaluation | [data: base/locale/en/base.cfg]; [unverified] |

Each in conditions:

| Statement | Provenance |
| --- | --- |
| "If an Each is present in any of the conditions, the decider combinator evaluates the conditions for every input signal, resulting in each signal activating either the normal or else outputs." | [web: https://wiki.factorio.com/Decider_combinator] |
| "To pass completely, a signal has to pass all conditions." (the whole AND/OR expression is evaluated with each bound to that signal) | [data: base/locale/en/base.cfg]; interpretation with OR groups [unverified] |
| Iteration set when several each operands use different network selections | [unverified] (assumed union of non-zero signals) |
| each on the right-hand side | [unverified] |
| Mixing each with anything/everything in one expression | [unverified] |

Outputs (table condensed from [web: https://wiki.factorio.com/Decider_combinator]):

| Output signal | No each in conditions | Each in conditions |
| --- | --- | --- |
| everything | every signal with a non-zero sum on the output's selected wires | not defined |
| anything | one signal with a non-zero sum on the selected wires | one signal that activates this output |
| each | not defined | each signal that activates this output |
| specific signal | the specified signal | evaluated for each activating signal, results emitted on the specified signal (summed) |

| Statement | Provenance |
| --- | --- |
| `copy_count_from_input` true: value is the signal's input count on `outputs[].networks`; false: `constant` (default 1) | [api] [data: core/locale/en/core.cfg gui-decider] |
| Wire selection is available on an output even when it uses a constant (it then defines the candidate set for everything/anything) | [web: https://wiki.factorio.com/Decider_combinator footnote] |
| anything output picks "the first input signal, or the first signal that passed all conditions, respecting signal order in both cases" | [data: base/locale/en/base.cfg] |
| "Signal order" is the Factoriopedia / GUI order | [web: https://wiki.factorio.com/Circuit_network]; exact comparator (kind, group, subgroup, `order`, name, quality) [unverified] |
| Several outputs naming the same signal add up; outputs wrap to int32 | [unverified] |
| Specific-signal output with each and `copy_count_from_input`: sum of the activating signals' input values; with a constant: constant times the number of activating signals | [unverified] reading of the table |
| Normal outputs fire when the expression is true, else outputs when it is false ("Output signals that are being sent when conditions evaluate to false") | [data: core/locale/en/core.cfg] [changelog 2.1.9] |
| With each, a signal that fails activates the else outputs; each in `else_outputs` means each failing signal | [web: same]; details [unverified] |
| everything / anything in `else_outputs` | [unverified] |
| A copied value of 0 is not emitted; a constant 0 output emits nothing | [unverified] |

### 6.5 Selector combinator

Input is the sum of red and green (no selection fields exist) [api]; latency one tick [unverified].

| Operation | Semantics | Provenance | Open points |
| --- | --- | --- | --- |
| `select` | "sorts its input signals by value and outputs one of them at the same value." Descending: "The signal with the highest value is selected." Ascending: "The signal with the lowest non-zero value is selected." Index starts at 0 | [web: https://wiki.factorio.com/Selector_combinator] [data: core.cfg "Sort input signals by count ascending/descending, before applying index."] | tie order among equal values; negative values in the sort; quality variants |
| `select` out of range | "If multiple signals are provided and index is out of bounds, then no signal is passed through." "If a single input signal is provided, it is always passed through even if the index is out of bounds." | [web: same] | negative index; the single-signal rule is surprising and needs a fixture |
| `select` with `index_signal` | index is the value of that signal on the input | [api] | whether the index signal takes part in the sort |
| `select` with `index_comparator` | not `=`: outputs the range of sorted positions satisfying `position <comparator> index`, for example `<` 3 with descending sort gives the top three | [changelog 2.1.21] [web: same] | exact comparator set and bounds |
| `count` | "Outputs the number of distinct input signals" on `count_signal`; values are ignored | [data: core.cfg] [web: same] | different qualities of one prototype count separately [unverified]; no input: nothing emitted |
| `random` | "pass through a random input signal every certain number of game ticks"; interval `random_update_interval` | [web: same] [api] | RNG is not reproducible; value passed through unchanged [unverified]; interval 0 versus 1; "If there is only one input signal, it will be output after this threshold is met" |
| `stack-size` | "output the stack sizes of the input items"; no fluid or virtual signals; input values ignored | [web: same] | quality retained on the output signal; non-item kinds dropped |
| `rocket-capacity` | "output the rocket capacity of the input signals"; no fluids, virtual signals or items too heavy for a rocket; needs space-age | [web: same] | capacity = rocket lift weight / item weight [unverified]; `default_rocket_lift_weight = 1000000`, `default_item_weight = 100` [data: core/prototypes/utility-constants.lua]; many item prototypes set no `weight` in Lua (91 assignments in base/prototypes/item.lua), the engine derives the missing ones at load time [unverified], so they are not in the Lua data |
| `quality-filter` | "pass through any input signals that meet a conditional against a certain quality grade"; with "any quality" only `=` is valid | [web: same] [api: quality_filter] | comparison by level |
| `quality-transfer` | "Outputs the target signal with the specified quality and its original value." Direct selection: fixed quality, "only if that target signal is among the inputs". From signal: "Searches specified signal in the inputs, and picks highest quality of found signals." | [data: core.cfg] [web: same] | which input quality of the target is read; each as target |
| `time` | outputs game tick, day tick and day length on three signals (defaults T, D, L). Game tick "count up by 1 every tick, starting when the world is created"; day tick resets at day length; Nauvis day length 25000 | [web: same] [data: circuit-network.lua, core.cfg] [changelog 2.1.7] | int32 wrap of the game tick; unset signal slots; needs a simulated clock origin |
| `quality-select` | "For each input signal, only the highest or lowest quality one is passed through." "If passed through, a signal keeps its value." | [data: core.cfg] [web: same] [changelog 2.1.21] | grouping key is (type, name) |

2.0.13 "Fixed selector combinator could sometimes fail to select correct signal" and 2.1.21 "Fixed selector combinators quality selection flickering" indicate these paths were recently touched [changelog].

### 6.6 Constant combinator

| Statement | Provenance |
| --- | --- |
| Output = for every active section, each filter's `count` times the section `multiplier`, summed per signal over all sections, if `is_on` | [api: LogisticSection.multiplier "applied to all filters before they are used by game"]; summation across sections [web: https://wiki.factorio.com/Circuit_network "using two slots to broadcast values on the same channel is the same as broadcasting the sum"] |
| The sum wraps: "Fixed constant combinators were clamping total values from logistic sections when they should wrap around." | [changelog 2.0.45] |
| Multiplier is a float; negative allowed | [api] [changelog 2.0.18] |
| Rounding of `count * multiplier` | [unverified]. Recent fixes: "Fixed logistic section multiplier floating point math caused numbers to be 1 smaller in some cases" [changelog 2.1.21]; "Fixed small logistic group multiplier values were inconsistently applied and displayed" [changelog 2.1.8] |
| The multiplier belongs to grouped sections ("Multiplies the requests of this logistic group") | [data: core/locale/en/core.cfg]; whether an ungrouped section can carry a multiplier other than 1 [unverified] |
| `is_on` false: no output | [api: enabled "Turns this constant combinator on and off"] |
| `active` false on a section: that section contributes nothing | [api] |
| Duplicate signal inside one section is rejected by the GUI | [changelog 2.1.7 "Fixed that the constant combinator GUI didn't properly reject duplicate entries"] |
| Groups: sections with the same `group` name share one filter list per force at runtime (`LogisticGroup = {members, filters}`); a blueprint carries a copy of the filters | [api: LogisticGroup]; conflict rule when a pasted group already exists with other contents [unverified] |
| Quality: every filter has a concrete quality; the emitted signal carries it | [api: SignalFilter] |
| No input; the same values go to red and green | [web: https://wiki.factorio.com/Constant_combinator] |
| A filter with count 0 emits nothing | [unverified] |

### 6.7 Lamp

| Statement | Provenance |
| --- | --- |
| Without circuit control the lamp lights by darkness (all lamps on at darkness 0.5, off at 0.3) or permanently with `always_on` | [data: base/prototypes/entity/entities.lua] [data: core.cfg gui-lamp] |
| "Lamp will be always on (unless disabled by control behavior)." | [data: core.cfg] |
| "Enable if: Turn this entity on only when the condition is true." Applies only when `circuit_enabled` is true and a wire is connected | [data: core.cfg]; gating by `circuit_enabled` [api default false] and by the wire [game: fixture F-29: with the flag off, or without a wire, a condition that does not hold disables nothing] |
| Default condition (blank signal `<` 0) is false: a wired lamp with `circuit_enabled` and no condition is disabled (`disabled`, status "disabled by control behavior"). A condition without a first signal is never fulfilled, also as `= 0`. The same for all 20 prototypes with an enable condition that were asked (belt, inserter, pump, mining drill, train stop, power switch, assembling machine and others), built from a blueprint or set through the API; the game writes the state as `circuit_enabled: true` without `circuit_condition` | [api defaults]; [game: fixture F-29] |
| A circuit-enabled lamp with a true condition lights regardless of daylight | [unverified] |
| `input_networks` selects which wires feed condition and color | [api] [changelog 2.1.7]; whether it also scopes color signals [unverified] |
| Use colors: "Sets the color of the lamp based on color signals. If a color signal has a value greater than 0, the lamp will show that color. If multiple colors are present, only one of them will be used." | [data: core.cfg] |
| Color mapping mode: table `signal_to_color_mapping` in this order: red (1,0,0), green (0,1,0), blue (0,0,1), yellow (1,1,0), pink (1,0,1), cyan (0,1,1), white (1,1,1), grey (0.5,0.5,0.5), black (0,0,0) | [data: base/prototypes/entity/entities.lua] |
| Priority among several positive color signals follows the mapping order (red first) | [unverified]; supported by "if red and green are received, the lamp will light red" [web: https://wiki.factorio.com/Lamp] and "Fixed color signal order in GUI to match order in color signal mapping" [changelog 2.1.18] |
| Components mode: "Color can be specified by red, green and blue signals separately. Their value should be from 0 to 255." Signals configurable, defaults signal-red/green/blue | [data: core.cfg, entities.lua] [api] |
| Components out of range (negative, above 255): clamp or wrap | [unverified] |
| Packed RGB mode: "Color is provided by a single hex encoded RGB color. Value should be from 0 to 16777215." on `rgb_signal` (default signal-white) | [data: core.cfg, entities.lua] |
| Bit layout `0xRRGGBB` (red = bits 16..23) | [unverified] |
| Packed value 0, negative or above 16777215 | [unverified] |
| No color signal present while `use_colors` is on: lamp uses its manual `color` or white | [unverified] |
| Color signals at quality other than normal | [unverified] |
| Runtime read-back for fixtures: `LuaLampControlBehavior.color` ("The color the lamp is showing, if any"), `LuaGenericOnOffControlBehavior.disabled` | [api] |
| Fixed bugs showing intended behavior: "Fixed lamp would keep using color when circuit wire was disconnected" (2.0.12); "Fixed that some color signals were not given lamp color" (2.0.15); "Fixed lamps with color set by control behavior would not use color for one tick after loading a save" (2.0.42) | [changelog] |

### 6.8 Conformance fixtures required

Game-driven fixtures can use the 2.1.24 command line options `--test-save`, `--test-scenario`, `--test-ticks`, `--test-arg` with `LuaBootstrap::finish_test()` and `test_arg` [changelog 2.1.24],
reading results through `LuaCombinatorControlBehavior.signals_last_tick`, `LuaEntity.get_signals(wire_connector_id)`, `LuaLampControlBehavior.color` / `.disabled`, and exporting with `export_stack()` [api].

| Id | Fixture | Resolves |
| --- | --- | --- |
| F-01 | Export one of each entity type with non-default settings via `export_stack()`; record the exact JSON. Probe: `tools/game-probe/blueprints.mjs` (`make probe-blueprints`) builds every sample circuit of `packages/blueprints/test/samples.ts` through the runtime API and exports it, and exports every supported entity as placed; it records `tests/fixtures/game/F-01-blueprints.json`, which `packages/blueprints/test/game.test.ts` checks. Recorded from Factorio 2.1.24 on 2026-11-14 (12.5) and again from 2.1.25 on 2026-11-17, the same but for the version numbers: 23 cases, every prototype as placed (the hub on a space platform the probe makes), and per prototype the defaults of its control behaviour and what becomes of each of the sixteen directions | selector `control_behavior` shape (flat), default omission, key order, `first_signal_networks` shape, `color_mode` numbers, build number in `version` (0 is taken); all in 12.2 and 12.3 |
| F-02 | `print` every `defines.wire_connector_id`, `defines.wire_type`, `defines.direction`, `defines.control_behavior.lamp.color_mode` value. Part of the recording of F-01 (`defines`), recorded with it, with the seven defines of the modes of the generic entities (14.2) | 4.2, 3.8 numeric values: as assumed (connectors 1 to 6, directions 0 to 15 in sixteen steps, color modes 0, 1, 2). `wire_type` is copper 1, red 2, green 3. Of the modes only the radar's differs from a count from 0: surface 1, universe 2 |
| F-03 | Chain constant -> arithmetic -> arithmetic -> decider; log outputs per tick from tick 0 | latency per stage, constant timing, simultaneous update |
| F-04 | Toggle a constant combinator at a known tick; log the network | constant combinator edit timing |
| F-05 | Self-wired arithmetic (`A + 1 -> A`), self-wired decider clock | feedback, counter start value, int32 wrap of a counter at 2^31 - 1 |
| F-06 | Arithmetic operator table over operand pairs {0, 1, -1, 2, -2, 31, 32, 33, 2^31 - 1, -2^31} for all eleven operations | every edge case of 6.3 |
| F-07 | Red +3 and green -3 on the same signal into each / anything / everything / count | zero-sum handling |
| F-08 | Arithmetic each-each with different red/green selections and disjoint signal sets | each-each iteration set |
| F-09 | Arithmetic each op specific signal where that signal is also an input | exclusion of the specific operand |
| F-10 | Decider `A > 0 AND B > 0 OR C > 0` truth table, plus per-operand red/green selection | precedence, grouping, network selection |
| F-11 | Decider everything / anything with no input, one input, mixed inputs; second operand a signal that is itself an input | wildcard truth values, right-hand exclusion claim |
| F-12 | Decider with each in conditions: outputs each, anything, specific (input count and constant), everything | output table of 6.4 |
| F-13 | Decider anything output with several candidates of different kinds and qualities | signal order |
| F-14 | Decider else outputs: plain, with each, with everything / anything; same signal in two outputs | else semantics, summation |
| F-15 | Decider with empty conditions, blank first signal, output constant 0 | degenerate configurations |
| F-16 | Selector select: equal values, negative values, ascending / descending, index out of range, single input, index signal, every `index_comparator` | 6.5 select |
| F-17 | Selector count with quality variants; stack-size and rocket-capacity over items, fluids, virtuals and quality variants | 6.5 count and lookups |
| F-18 | Selector quality-filter (every comparator, any quality), quality-transfer (static, from signal, each target), quality-select (highest / lowest) | 6.5 quality modes |
| F-19 | Selector time over several ticks; random with intervals 0, 1, 60 and one or many inputs | time origin and wrap, random cadence |
| F-20 | Constant combinator: two sections with the same signal, multipliers 0.5, 1.5, -1, 0.1 on odd counts, values near int32 limits, inactive section, `is_on` false | multiplier rounding, wrap |
| F-21 | Lamp: condition true / false / default, `circuit_enabled` false with wire, `always_on`, daylight | lighting rules |
| F-22 | Lamp colors: several mapping signals at once; components and packed RGB with 0, 255, 256, -1, 0xFFFFFF, 0x1000000; `input_networks` selection | color rules |
| F-23 | Import round-trip: face export -> `import_stack` -> `export_stack` for each entity type, including 2x1 entities in all four directions and self-wires. Part of the recording of F-01 (`reexported`, and `rebuilt`: the blueprint built, the ghosts revived, a new blueprint made), recorded with it. Every sample comes back as the circuit that was sent; three prototypes are not built on the plain ground of the probe (offshore pump, mining drill, asteroid collector), and four the game has in no blueprint (12.2) | exporter correctness, position rules, wire normalization: the game's order of the wire list is by the first end (entity, connector), then the second |
| F-25 | Programmable speaker: condition true / false / blank and held for many ticks (how often the sound starts again, with and without polyphony), no wire, `signal_value_is_pitch` with the values 0, 1, the last note and one beyond, both wires, a wildcard in the condition, volume from a signal below 0 and above 100, alert on and off; read back through `LuaEntity.parameters`, `alert_parameters`, the control behavior and the alerts of the force | every rule SP-* of `packages/simulation/CONFORMANCE.md`, the defaults of 3.10 |
| F-26 | Electric pole relay: constant -> pole -> pole -> lamp with red and green on the same poles, a combinator behind a pole; `LuaEntity.get_signals` on the pole | one network per color through a pole, no tick added (6.9) |
| F-27 | Generic entities: an inserter, a belt, a splitter (input and output side), an agricultural tower (harvest, plant), a turret (ignore unlisted targets), a rail signal (close) and a wall (open gate) with a circuit condition each, fed by a constant combinator over red, green and both with `input_networks` set; `LuaGenericOnOffControlBehavior.disabled` and the entity's state per tick; the same without a wire; a logistic condition next to a circuit condition. Authored: `tests/fixtures/conformance/F-27-entity-conditions.json` (assumed) | conditions of the generic entities (14.4), rules G-* of `packages/simulation/CONFORMANCE.md` |
| F-28 | Radar: two radars in surface mode, one wired to a constant combinator and one to a lamp; a third in universe mode with a channel, a fourth with the same channel, a fifth with another; `LuaEntity.get_signals` on each. Authored: `tests/fixtures/conformance/F-28-radar-networks.json` (assumed) | wireless networks of the radar (13.7, 14.4), rules G-RADAR* |
| F-24 | Wire reach: an entity B on every tile of a 29 x 29 grid (73 x 73 for the long reaches) around an entity A, asking `can_wire_reach` and `connect_to`: the combinators in all four directions and with both connectors, lamp, speaker, steel chest, the four electric poles against each other and against other entities, the power switch, the agricultural tower, and every selection box of the entity table that is not the tiles of its prototype, the three that are not the same on all sides in all four directions. With every entity the selection box of its prototype and the direction it has once it stands. Recorded: `tests/fixtures/game/F-24-wire-reach.json` by `tools/game-probe/wire-reach.mjs` (`make probe-wire-reach`, 68 cases on 2026-11-14), checked by `packages/model/test/wireReachGame.test.ts` | the measure of wire reach (5.4): from where, inclusive or not, which of two reaches |
| F-29 | Blank condition: 23 prototypes with a circuit condition (belt, inserter, lamp, pump, offshore pump, both mining drills, train stop, power switch, assembling machine, furnace, boiler, turrets, land mine, loader, agricultural tower, asteroid collector, speaker, wall next to a gate, rail signal), each next to a constant combinator in seven states: flag on with no condition (wired, unwired), a condition that holds, one that does not (wired, unwired), flag off, no first signal with `= 0`; each built from a blueprint string and through the runtime API. After 60 ticks: flag, condition and its `fulfilled`, `LuaGenericOnOffControlBehavior.disabled`, `LuaEntity.status`, the item on a belt, the power switch, the gate, the rail signal, and the `control_behavior` the game writes into a blueprint. Eight decider combinators: no condition, blank conditions that 0 passes and does not pass. Recorded: `tests/fixtures/game/F-29-blank-condition.json` by `tools/game-probe/blank-condition.mjs` (`make probe-blank-condition`, on 2026-11-15), checked by `packages/simulation/test/blankConditionGame.test.ts` | a condition in use without a first signal (6.4, 6.7, 6.10, 14.4): never fulfilled in an entity, so a wired entity is disabled; without a wire no condition disables; in a decider the blank signal reads as 0; rules L-BLANK, L-UNWIRED, SP-BLANK, G-UNWIRED, D-EMPTY, D-BLANK |
| F-30 | Blueprint book: through the runtime API an empty book and a book with a blueprint, an empty slot, a blueprint, a book with a blueprint, an upgrade planner and a deconstruction planner, with label, label color, description, icons and active index, exported whole and item by item, read back by the game, and two blueprints added; 28 books written by hand (items without `index`, with the same one, out of order, with gaps, far apart, at and beyond 65535, negative, a fraction; `active_index` on an item, on a gap, beyond the end, absent; three levels deep; no items; as plain JSON), each imported with `import_stack`, read slot by slot and exported again; 70000 blueprints inserted one by one and imported in one book. Recorded: `tests/fixtures/game/F-30-blueprint-book.json` by `tools/game-probe/blueprint-book.mjs` (`make probe-blueprint-book`, on 2026-11-19, Factorio 2.1.25), checked by `packages/blueprints/test/bookFixture.test.ts` | the keys of a book and of the planners, `index` and `active_index` (from 0, gaps, duplicates, missing), the slot limit of 65535, plain JSON on import; all in 5.2 |

### 6.9 Electric poles

| Statement | Provenance |
| --- | --- |
| A pole has one circuit connector per color; all circuit wires of one color on it are one network (the network is the set of connectors joined by wires, 4.1) | [api: `defines.wire_connector_id.circuit_red`, `circuit_green` on a pole] [web: https://wiki.factorio.com/Circuit_network] |
| Red and green stay separate networks on a pole | follows from 4.1 |
| A pole adds no latency: only combinators have the one tick of 6.1 | follows from 6.1; [unverified] against the game (F-26) |
| A pole reads and emits nothing | [api: no control behavior for electric-pole] |
| The copper wire and the power a pole carries have no effect on signals | [unverified] |

The simulator treats a pole as a connection point without behaviour (rule P-RELAY). Its snapshot shows what is on the red and on the green network it joins.

### 6.10 Programmable speaker

| Statement | Provenance |
| --- | --- |
| "it shows alerts and plays sounds based on circuit network signals" | [changelog 0.15.0] |
| Without a circuit wire the speaker makes no sound: "Fixed programmable speaker continuing to make sounds without a wire connected" | [changelog 0.15.x] |
| The speaker plays when its circuit condition is true; it emits nothing | [web: https://wiki.factorio.com/Programmable_speaker]; evaluated from the current tick like a lamp [unverified] |
| A blank condition (no first signal) is false | [game: fixture F-29: `fulfilled` of the condition as the control behaviour gives it back, also for `= 0`; the sound itself was not observed] |
| While the condition stays true the sound is started again and again: "sounds will repeat extremely rapidly (10 per second or so)" with polyphony, about one every half second without | [web: same page]; the exact rule (per tick, per sample length) [unverified] |
| "Allow polyphony": up to `maximum_polyphony` = 10 sounds at once; without it one sound at a time | [data: core.cfg] [data: dump]; what happens to a trigger while a sound plays [unverified] |
| "Stop playing sounds": a change of the input signal stops the playing sounds instead of letting them finish | [data: core.cfg] [changelog 2.0.36] |
| "Signal value is pitch": the value of the (first) signal picks the note of the instrument | [data: core.cfg]; that the value 1 is the first note and that 0 or a value beyond the list is silent [unverified] |
| With "signal value is pitch" the comparator and the right side of the condition are not used | [unverified] |
| "Signal value is volume": the signal value is the volume in percent, clamped to 0..100 | [data: core.cfg]; that it replaces the slider instead of scaling it [unverified] |
| The alert is shown "when a sound is played", with icon and message, optionally on the map | [data: core.cfg]; for how long [unverified] |
| Playback mode decides where the sound is heard, not whether it plays; global and surface sounds are per force since 2.1.7 | [api] [changelog 2.1.7] |
| everything / anything in the condition | [unverified], as for the lamp |
| Runtime read-back for fixtures: `LuaEntity.parameters`, `LuaEntity.alert_parameters`, `LuaProgrammableSpeakerControlBehavior.circuit_condition` (with `fulfilled`) and `.circuit_parameters`, `LuaEntity.play_note` ("The sound may or may not be played depending on polyphony settings") | [api] |

The simulator produces no sound and has no time within a sound. It reports per tick whether the speaker is triggered (condition true, or a pitch value with a note), with which instrument, note and volume, and whether the alert shows;
polyphony, stop-playing-sounds and the playback mode are kept in the model and do not change that report (rules SP-* in `packages/simulation/CONFORMANCE.md`, all pending F-25).

## 7. Changes between 2.0 and 2.1 affecting circuits, signals and blueprints

2.1.7 (23. 06. 2026) is the first 2.1 entry in the changelog; entries run through 2.1.24 [changelog].

| Version | Change (quoted or condensed) | Impact on face |
| --- | --- | --- |
| 2.1.7 | "Added option to select which wires (red, green or both) should be used by a circuit connectable entity for input, and separately for output." `LuaControlBehavior::input_networks` and `output_networks` added | Lamp gains `control_behavior.input_networks`. Nearly every other control behavior gains `input_networks` / `output_networks` [api] |
| 2.1.7 | "Circuit connectable entities with control gui on side now have settings groupped into Input and Output section." | GUI reference only |
| 2.1.7 | "Added Time mode to selector combinator. It allows to read game tick, time of day and duration of a day." Prototype fields `default_game_tick_output_signal`, `default_day_tick_output_signal`, `default_day_length_output_signal`, `time_symbol_sprites` | New selector operation `time` |
| 2.1.7 | "Fixed decider would not reject some of the special signals on the right side of conditions." | Validation of `second_signal` |
| 2.1.7 | "Fixed that the constant combinator GUI didn't properly reject duplicate entries." | Duplicate signals within a section are invalid |
| 2.1.7 | "Logistic section name can be parametrised." | `group` may contain parameters |
| 2.1.7 | "Added SignalIDConnector::quality." | Prototype-stage signal references can carry quality |
| 2.1.7 | "Several number inputs now clamp their values properly instead of wrapping around or ignoring numbers past their limits." | Editor input behavior |
| 2.1.7 | "Added outlines to virtual signals for better visibility on bright backgrounds." | Icon assets differ from 2.0 |
| 2.1.7 | "Assemblers no longer ignore their own circuit output when selecting recipe to craft from circuit network."; asteroid collector likewise | Out of scope entities; shows a general "own output is visible" rule |
| 2.1.7 | New circuit-connectable entities: pipes, pipes to ground, boilers, heat exchangers, labs, land mines, heat pipes; storage tank reads; radar "universe" mode; platform hub set requests; agricultural tower conditions | Out of scope; importer must tolerate their control behaviors |
| 2.1.7 | Logistic containers: `set_requests` and `read_contents` no longer exclusive; removed `circuit_exclusive_mode_of_operation` and `defines.control_behavior.logistic_container.exclusive_mode`; same for cargo landing pad | Out of scope; format change for chests |
| 2.1.7 | Display panel control behavior reworked (records instead of messages) | Out of scope |
| 2.1.7 | `defines.control_behavior.type.storage_tank` renamed `single_fluid_box`; added `.lab`, `.boiler`, `.land_mine`, `.heat_pipe` | Enum names |
| 2.1.7 | "[space-age] Added separate recycler mod." "Converted space age mod's dependency on the quality mod to a recommendation." "Added mod dependency modifier +" | Mod-set handling, section 1.2 |
| 2.1.7 | Quality rework (probabilities, `previous`, per-quality multipliers) | Not circuit relevant |
| 2.1.7 | Added the `on_blueprint_settings_pasted` event; "Added a hotkey to toggle snap-to-grid on the currently held blueprint."; "Inserters can be flipped to make blueprint flipping reliable." | Blueprint handling, `mirror` more common |
| 2.1.9 | "Decider combinator supports else-output." `add_else_output`, `get_else_output`, ... | New `else_outputs` array |
| 2.1.9 | "Fixed that fast-replacing combinators would not copy the description." | none |
| 2.1.8 | "Fixed small logistic group multiplier values were inconsistently applied and displayed." | Multiplier rounding changed within 2.1 |
| 2.1.10 | "Fixed that decider combinators wouldn't show some signals in the GUI." "Fixed that the logistic item condition GUI would let you set non-item signals." | none |
| 2.1.13 | "Fixed that clicking outside of the combinator description edit would close the GUI." | none |
| 2.1.15 | "Fixed upgrading lamps would not preserve color." | none |
| 2.1.17 | "Fixed unreliable performance of control behavior update." | none |
| 2.1.18 | "Fixed color signal order in GUI to match order in color signal mapping." | Color order is the mapping order |
| 2.1.20 | "Fixed that several environmental entities did not show in the signals list." "Fixed that un-checking the parameter checkbox would forget the quality of the parameter." | Picker contents changed within 2.1 |
| 2.1.21 | "Added index comparator to selector combinator. Allows for selection of N highest or N lowest signals." | New `index_comparator` |
| 2.1.21 | "[space-age] Added quality select mode to selector combinator." | New operation `quality-select`, `select_highest_quality` |
| 2.1.21 | "Fixed logistic section multiplier floating point math caused numbers to be 1 smaller in some cases." | Multiplier rounding changed again |
| 2.1.21 | "Fixed decider combinator gui would highlight conditions and outputs when hovered signal was not a valid signal-each substitute due to all instances of signal-each in conditions being 0." | Hint (inference, [unverified]): a signal is an each candidate only if it is non-zero for some each operand |
| 2.1.21 | "Added LuaEntity::get_signals_changed()." "Read empty slots" and "Read launched" options on other entities | Fixture tooling; out of scope entities |
| 2.1.22 | "Fixed selector combinator's quality select switch wrong initial state." | GUI fix; treat an absent `select_highest_quality` as true per API |
| 2.1.23 | "Fixed that select from cursor signal did not work in the selector combinator quality transfer GUI." | none |
| 2.1.24 | "When holding a wire, only entities connectable with it are selectable." "Added --test-save, --test-scenario, --test-ticks and --test-arg command line options." | Fixture tooling |

2.0.x changes worth knowing because older references predate them [changelog]:

| Version | Change |
| --- | --- |
| 2.0.7 | Selector combinator, combinator descriptions, multi-condition deciders, red/green selection, arithmetic each-each, logistic groups for constant combinators, manual lamp color, `defines.wire_connector_id`, removed `ConstantCombinatorPrototype::item_slot_count` |
| 2.0.10 | "Fixed logistic section active state was not preserved in a blueprint string." |
| 2.0.18 | "Allowed negative multiplier of logistic (and constant combinator) groups." |
| 2.0.25 | "Fixed blueprint export to string would create malformed blueprint if it contained decider combinator with empty conditions or empty output." |
| 2.0.36 | "Decider combinator output constant can be changed." "Restored signal-ghost virtual signal." |
| 2.0.44 | "Decider combinator condition which contains parameter evaluated to nothing ... when building blueprint is deleted instead of kept empty." |
| 2.0.45 | "Fixed constant combinators were clamping total values from logistic sections when they should wrap around." |
| 2.0.72 | "Decider combinator, arithmetic combinator and selector combinator are now primary energy consumers and have buffer size increased"; selector energy 5 kW -> 1 kW |

## 8. CircuitMaker reference

Repository: https://github.com/idanz/CircuitMaker, inspected at commit 2c32e52 (2026-11-10), six commits, first commit 2026-11-08 [web: https://github.com/idanz/CircuitMaker].

### 8.1 What it is

| Aspect | Finding |
| --- | --- |
| Purpose | Browser tool: write combinator circuits as Python or TypeScript scripts, inspect wiring, simulate, export blueprint strings |
| Stack | Vite, Monaco editor, Pyodide (Python 3.13), TypeScript, fflate; scripts run in a sandboxed worker inside an opaque-origin iframe |
| Authoring model | Imperative builder API in both languages (`Decider`, `Arithmetic`, `Constant`, `wire(a, b, color=...)`, `Blueprint`, `Simulation`, `Driver`), typed signal catalog generated from a 2.1.23 data dump |
| Entities | Arithmetic, decider, constant. No selector, no lamp, no `else_outputs`, no section multiplier or group, no `direction`, no `player_description` (names go into the blueprint `description`) |
| Simulation | One shared engine, `src/simulation-engine.js` (199 lines): union-find over (entity, connector) to build networks, int32 signal maps, simultaneous update |
| Timing convention | "Tick 0 contains initial Constant and Driver signals and zero combinator outputs. Each update reads all current network values before committing any new outputs. Arithmetic and Decider outputs arrive one tick later." |
| Test driver | `Driver` pseudo-entity with held values, `.at(tick, ...)` updates and `.pulse(tick, ..., duration)`; omitted from exports |
| Assertions | `.expect(tick, entity, signals, color?, port?)` checked automatically; `value()` and `network_value()` readers |
| Export | Root `blueprint` with `item`, `label`, `version`, `description`, `entities`, `wires`; `"0" + base64(zlib level 9)`; constant combinators use `sections.sections[0].filters`; the version constant encodes 2.0.36.0 although the catalog is 2.1.23 |
| Stated accuracy | "it has not yet been checked against recorded in-game traces"; "Automated tests ... do not establish in-game accuracy" |

Known gaps and choices in its engine (useful as a checklist, not as truth):

| Topic | CircuitMaker behavior |
| --- | --- |
| Shifts | throws unless the amount is 0..31 |
| Negative exponent | truncated real result (`1 ^ -1 = 1`, `2 ^ -1 = 0`) |
| Division, modulo by zero | 0 |
| Arithmetic each on both operands | rejected |
| Anything output with more than one candidate | rejected ("needs Factorio signal ordering") |
| Everything / anything as second operand | rejected |
| Everything output together with each conditions | rejected |
| Specific output with each | sums the activating signals' input counts, or constant per activating signal |
| Right-hand-signal exclusion for everything / anything | not implemented |
| Constant combinator | sums filters of active sections; ignores `multiplier` |

### 8.2 Tests

`pnpm test` runs `node --test tests/*.test.mjs` (21 test files). Relevant ones:

| File | Content |
| --- | --- |
| `tests/simulation.test.mjs` | one-tick stages and feedback, order independence (same result with reversed entity order), red/green separation, quality as identity, AND/OR groups, int32 overflow, truncating division, modular power, empty-input anything / everything, each filter and reduction, driver schedule rules |
| `tests/simulation-assertions.test.mjs` | expectation API, error messages, both language front ends |
| `tests/cookbook.test.mjs` | 31 cookbook circuits (taken from the wiki combinator tutorial) built in both languages; structural checks on the export (connector ids 1..4, constants only on 1..2, wire length <= 9, x ends in .5, y ends in .5 for 1x1 and 0 for 2x1) and behavior checks at fixed ticks (clocks of period 30 and 60, pulse generator, edge detectors, latch truth table, memory cells, counters, scalar and vector product, dictionary, array lookup) |
| `tests/exports.test.mjs`, `tests/runtime.test.mjs`, `tests/comparison.test.mjs` | Python / TypeScript parity, export structure, sandbox behavior |

### 8.3 Reusable as test ideas

- The cookbook list as a ready-made scenario suite: everything / anything / each filters, each count and sum, insulator, gate, SR latch with bias, memory cells (positive, signed, runaway), clocks (30, 60, one-shot),
  pulse and edge detectors, event counter, scalar and vector product, dictionary and array lookup, anything output.
- The Driver concept (scripted input source with hold, update and pulse semantics) and tick-indexed expectations with "listed signals only, 0 means absent".
- Order-independence test: simulate with the entity list reversed and require identical timelines.
- Structural export assertions (connector ids, reach, position parity).
- Its list of rejected configurations is a list of exactly the semantics that need game fixtures (F-06, F-08, F-11, F-12, F-13).
- Network identification in traces: (entity, port, color) triples naming a network.

Not reusable as ground truth: every numeric expectation is self-consistent only, never compared with the game.

### 8.4 License

MIT License, "Copyright (c) 2026 Idan Zalzberg" (file `LICENSE`, added in commit d48fd7c on 2026-11-09). It permits use, copy, modification, merging, publishing, distribution, sublicensing and sale,
on condition that the copyright notice and permission notice are included in all copies or substantial portions; no warranty.
The README adds: "Dependencies and bundled game assets retain their respective terms." The repository bundles Factorio icons (`public/signals`, about 770 PNG files) and GUI screenshots (`public/inspector`),
which belong to Wube Software and are not covered by the MIT grant.
Proposal: reuse ideas and re-express test scenarios independently; if any source text is copied, carry the MIT notice; never copy the bundled game assets.

## 9. Support matrix (proposal)

Status values: supported (modeled, editable in the DSL, simulated, round-tripped); preserved-on-roundtrip-only (kept verbatim through import and export, not interpreted); unsupported-with-diagnostic
(import reports a diagnostic; the item is dropped or the import is refused as noted). These are proposals for the coordinator to decide. "pending F-nn" marks behavior that needs the named fixture
before it can be called conformant.

Decided 2026-11-14 for blueprints: nothing is "preserved-on-roundtrip-only". The editor is a circuit editor; what it does not model is dropped at import and reported (entities of other prototypes with their wires, copper wires,
entity quality, tags, the blueprint's description, icons, snapping and tiles). Where a row below says preserved, read dropped and reported; 12.4 has the list and `packages/blueprints/README.md` the report.

### 9.1 Blueprint level

| Item | Proposed status | Reason when not supported |
| --- | --- | --- |
| Envelope `0` + base64 + zlib, plain JSON input | supported | |
| Root `blueprint` | supported | |
| Root `blueprint_book` | unsupported-with-diagnostic (offer to pick one contained blueprint) | A book is a container; the editor works on one circuit. The listing and the pick are held against books the game wrote, a book inside a book and both planners among the items (5.2, fixture F-30) |
| Root `upgrade_planner`, `deconstruction_planner` | unsupported-with-diagnostic | Not circuits |
| `version` major 2 (2.0.x, 2.1.x) | supported; exporter writes 2.1.25.0 (pending F-01) | |
| `version` major 1 (1.1 and 1.2.x pre-release) | unsupported-with-diagnostic | Different wire and control-behavior format; converter deferred |
| `version` newer than 2.1.24 | supported with a warning | Unknown fields may appear |
| `label`, `description` | supported | |
| `label_color`, `icons`, `snap-to-grid`, `absolute-snapping`, `position-relative-to-grid` | preserved-on-roundtrip-only | No effect on circuit behavior |
| `tiles`, `schedules`, `stock_connections`, `parameters`, `branch_version`, unknown root keys | preserved-on-roundtrip-only | Out of scope; dropping them would damage user blueprints |
| Blueprint parameters (`parameter-N` signals, parametrised numbers) | preserved-on-roundtrip-only; simulated as ordinary signals with a warning | Parameter substitution happens at build time in game |
| Entities other than the five types, electric poles and the programmable speaker | preserved-on-roundtrip-only with a diagnostic; not simulated (their connectors emit nothing) | Out of scope; keeping them lets mixed blueprints survive an edit |
| Wires with connector 1..4 between supported entities | supported | |
| Wires with connector 1 or 2 on an electric pole or a speaker | supported | |
| Wires touching a preserved entity; copper wires (5, 6), also those between two poles | preserved-on-roundtrip-only with a diagnostic | Other end is not simulated; power is not modeled |
| Wires referencing a missing entity number or an invalid connector for the entity type | unsupported-with-diagnostic (wire dropped) | Malformed input |

### 9.2 Common entity fields

| Entity | Setting | Proposed status | Reason when not supported |
| --- | --- | --- | --- |
| all five | `entity_number`, `name`, `position` | supported | |
| combinators | `direction` 0, 4, 8, 12 | supported | |
| combinators | `direction` other values | unsupported-with-diagnostic (snap to nearest of four) | Not producible in game |
| small-lamp, electric poles, programmable-speaker | `direction` | preserved-on-roundtrip-only | Not rotatable |
| electric poles, programmable-speaker | `entity_number`, `name`, `position`, signals as for the five | supported | |
| all five | `quality` (entity quality) | preserved-on-roundtrip-only | No circuit effect |
| all five | `mirror`, `tags`, `items`, unknown entity keys | preserved-on-roundtrip-only | No circuit effect |
| combinators | `player_description` | supported | |
| all five | Signal `quality` on any SignalID | supported | |
| all five | Signals of kind item, fluid, virtual | supported | |
| all five | Signals of kind entity, recipe, space-location, asteroid-chunk, quality | supported (catalog from the data dump) | |
| all five | Signal name unknown to the active catalog | supported with a diagnostic (kept as opaque identity) | Mod or version mismatch must not destroy data |

### 9.3 Constant combinator

| Setting | Proposed status | Reason when not supported |
| --- | --- | --- |
| `is_on` | supported | |
| Sections: `index`, order, `active` | supported | |
| Filters: `index`, `type`, `name`, `quality`, `count` | supported | |
| Filter `comparator` `=` | supported | |
| Filter `comparator` other than `=`, or missing `quality` (any-quality filter) | unsupported-with-diagnostic (kept, emits nothing) | Not a valid constant combinator signal per API |
| `multiplier` | supported, rounding pending F-20 | |
| `group` name | supported as a named section; identical names with different contents in one blueprint get a diagnostic | Global group sharing across a save is not modeled |
| `max_count`, `minimum_delivery_count`, `import_from` of a filter, `trash_not_requested` | dropped without a note (user, 2026-11-15) | Request fields that a logistic group shared with a requester or a platform hub brings along; without meaning for a constant combinator |
| `request_from` | preserved-on-roundtrip-only | Logistic-request fields without meaning for a constant combinator |
| Wildcard signals in filters | unsupported-with-diagnostic | Cannot be transmitted |
| More than 1000 filters per section | unsupported-with-diagnostic | Exceeds `max_logistic_filter_count` |

### 9.4 Arithmetic combinator

| Setting | Proposed status | Reason when not supported |
| --- | --- | --- |
| `first_signal`, `second_signal`, `first_constant`, `second_constant`, `output_signal` | supported | |
| `first_signal_networks`, `second_signal_networks` | supported | |
| Operations `+`, `-`, `*`, `/`, `%`, `AND`, `OR`, `XOR` | supported, edge cases pending F-06 | |
| Operations `^`, `<<`, `>>` | supported, edge cases pending F-06 | |
| each on one operand, each or specific output | supported | |
| each on both operands | supported, pending F-08 | |
| No `output_signal` | supported: the simulation emits nothing (rule A-NOOUT of `packages/simulation/CONFORMANCE.md`, assumed: 3.5 has it as unverified), the language writes the right side alone (`each * 2`), a blueprint keeps operands, operation and network selections both ways | |
| everything / anything in any slot; each output without each operand | unsupported-with-diagnostic | Invalid configuration |

### 9.5 Decider combinator

| Setting | Proposed status | Reason when not supported |
| --- | --- | --- |
| `conditions[]` with `first_signal`, `second_signal`, `constant`, `comparator` (all six, both spellings) | supported | |
| `compare_type` and / or with AND precedence | supported, pending F-10 | |
| Per-operand `first_signal_networks`, `second_signal_networks` | supported | |
| A condition with blank `first_signal` | supported: the simulation reads the left side as 0 (rule D-BLANK, held against F-29), the language writes `when 0 < S`, a blueprint keeps it both ways | |
| everything / anything as first signal | supported, pending F-11 | |
| each in conditions | supported, pending F-12 | |
| Special signals as second signal | unsupported-with-diagnostic until F-11 / F-12 define the legal set | Game rejects some combinations (2.1.7 fix) |
| `outputs[]` with `signal`, `copy_count_from_input`, `constant`, `networks` | supported | |
| Output signal each / everything | supported, pending F-12 | |
| Output signal anything | supported; needs signal order from the data dump, pending F-13 | |
| `else_outputs[]` | supported, pending F-14 | |
| Missing or empty `conditions` / `outputs` / `else_outputs` | supported (treated as empty) | |
| Grouping beyond AND-over-OR (parentheses) | unsupported-with-diagnostic at DSL level (must be rewritten as OR of ANDs) | The game has no grouping |

### 9.6 Selector combinator

| Setting | Proposed status | Reason when not supported |
| --- | --- | --- |
| Flat `control_behavior` and legacy `selector_conditions` wrapper on import | supported (both accepted); export shape pending F-01 | |
| `select`: `select_max`, `index_constant`, `index_signal` | supported, tie order pending F-16 | |
| `select`: `index_comparator` | supported, pending F-16 | |
| `count`: `count_signal` | supported | |
| `random`: `random_update_interval` | supported with a seeded generator and a diagnostic that sequences differ from the game | The game RNG cannot be reproduced |
| `stack-size` | supported (stack sizes from the data dump) | |
| `rocket-capacity` | preserved-on-roundtrip-only with a diagnostic (outputs nothing in simulation) | Needs engine-computed item weights that are not in the Lua data; space-age only |
| `quality-filter`: `quality_filter` | supported, pending F-18 | |
| `quality-transfer`: all four fields | supported, pending F-18 | |
| `quality-select`: `select_highest_quality` | supported, pending F-18 | |
| `time`: three signal slots | supported with a configurable start tick and day length (default 25000) | Simulated clock, not a game world |
| Quality modes when the catalog has no quality mod | supported with a diagnostic | Feature disabled in such a game |

### 9.7 Lamp

| Setting | Proposed status | Reason when not supported |
| --- | --- | --- |
| `always_on` | supported | |
| `color` (manual color) | supported (display) | |
| `circuit_enabled`, `circuit_condition` | supported, pending F-21 | |
| everything / anything in the condition | supported, pending F-21 | |
| `input_networks` | supported, pending F-22 | |
| `use_colors`, `color_mode` color mapping | supported, priority pending F-22 | |
| `color_mode` components with `red_signal`, `green_signal`, `blue_signal` | supported, clamping pending F-22 | |
| `color_mode` packed RGB with `rgb_signal` | supported, bit layout pending F-22 | |
| `connect_to_logistic_network`, `logistic_condition` | preserved-on-roundtrip-only | No logistic network in the simulator |

### 9.8 Cross-cutting

Sections 9.9 and 9.10 follow the cross-cutting table.

| Item | Proposed status | Reason when not supported |
| --- | --- | --- |
| int32 wrap on every sum and product | supported | |
| Zero-valued signals absent | supported | |
| One-tick latency, simultaneous update | supported, pending F-03 .. F-05 | |
| Mod sets: base; base+quality; full Space Age | supported through per-set catalogs from the data dump | |
| Third-party mods | unsupported-with-diagnostic (unknown names kept as opaque signals) | No catalog |
| Byte-identical re-export of a game-exported string | unsupported-with-diagnostic is not applicable; documented non-goal (semantic equality only) | Exporter key order and default omission are not specified |

Simulation assumptions that have no blueprint representation and therefore no status (proposal): every entity is powered and not frozen; entity health and quality have no effect; there is no day/night cycle,
so a lamp without circuit control is displayed as "ambient" (lit only if `always_on`); the game tick and day length used by the selector `time` mode are simulation settings.

### 9.9 Electric poles

| Setting | Proposed status | Reason when not supported |
| --- | --- | --- |
| `name`: `small-electric-pole`, `medium-electric-pole`, `big-electric-pole`, `substation` | supported (`pole` with `prototype`) | |
| Circuit wires on the one connection point (connectors 1, 2) | supported, relay pending F-26 | |
| Tile size 1 x 1 / 2 x 2, no rotation | supported | |
| Own wire reach 7.5 / 9 / 32 / 18 | supported (warning `wire-too-long`); between two poles measured from center to center (5.4) | |
| Copper wires (connector 5), supply area, power | preserved-on-roundtrip-only | No power network in the simulator |
| Entity `quality` raising the wire reach | preserved-on-roundtrip-only; the reach of normal quality is used | No entity quality in the editor |
| Poles of other modules or mods | unsupported-with-diagnostic (kept as a preserved entity) | No reach and size in the prototype table |

### 9.10 Programmable speaker

| Setting | Proposed status | Reason when not supported |
| --- | --- | --- |
| `circuit_condition` | supported, pending F-25 | |
| everything / anything in the condition | supported, pending F-25 | |
| `signal_value_is_pitch` with the pitch signal | supported, value-to-note mapping pending F-25 | |
| A comparator and right side kept next to `signal_value_is_pitch` | unsupported-with-diagnostic (dropped) | Without effect in that mode [unverified]; the language has one of `when` and `pitch` |
| `instrument_id`, `note_id` | supported as names through the catalog's lists | |
| An id beyond the catalog's lists (mod, other version) | unsupported-with-diagnostic | No name for it |
| `playback_volume`, `volume_controlled_by_signal`, `volume_signal_id` | supported, pending F-25 | |
| `volume_controlled_by_signal` true without a signal, or a signal kept while it is false | unsupported-with-diagnostic (normalized) | The language marks the mode by the presence of `volume-signal` |
| `playback_mode`, `allow_polyphony`, `stop_playing_sounds` | supported in the model and the language; no effect in the simulator | No sound and no time within a sound |
| `show_alert` | supported (reported while playing), pending F-25 | |
| `show_on_map`, `icon_signal_id`, `alert_message` | supported in the model and the language; not part of a snapshot | Display only |
| Sound itself | unsupported (non-goal) | The editor plays no audio |

## 10. Open questions for the coordinator

1. Selector `control_behavior` wire format (flat per API versus `selector_conditions` wrapper seen in game data) blocks the exporter until F-01 is run. Since 2026-11-14 the exporter writes the flat form of the API and the importer reads both; the probe for F-01 exists and decides it when it has run (12.5).
2. Signal order for anything outputs and selector ties needs the data dump to carry group order, subgroup order, `order` strings and quality levels, plus F-13 / F-16 to confirm the comparator.
3. Rocket capacity needs runtime item weights (`LuaItemPrototype` at runtime), which a `--dump-data-raw` style dump does not contain. Either extend the dump task or keep the mode non-simulated.
4. Whether 1.x strings should be converted rather than rejected: the game still imports them, so users may hold such strings.
5. The DSL needs a way to say "group" as OR-of-ANDs only; a richer boolean syntax must be normalized or rejected.
6. Programmable speaker: everything the simulator reports rests on F-25 (6.10). The probe needs a scenario that holds a condition for many ticks and reads back what the game plays; whether the game exposes "is playing" to Lua at all is open.

## 11. Errata from the engine data dump (2026-11-11)

The catalog generator (`tools/catalog`, see `packages/catalog/README.md`) dumped the engine's finalised prototypes for all eight dependency-closed module sets. Where it disagrees with the sections above, the dump wins:

- Section 2.4: the engine marks eight virtual signals as `special`, not four: everything, anything, each, `signal-unknown` and the four train-interrupt parameters (`signal-item-parameter`, `signal-fuel-parameter`, `signal-fluid-parameter`, `signal-signal-parameter`). Only everything, anything and each are wildcards for combinators.
- Section 2.3: asteroid chunks are hidden signals with `hide_from_signal_gui = true` and an `item_signal_alias` to the same-named item; `hide_from_signal_gui` is false for hidden recipes, so `hidden` must be checked first.
- Section 6.5 and open question 3: rocket capacity is computable. Every item has an engine-computed `weight` in the catalog and the rocket lift weight is in the dump (1,000,000 with Space Age; effectively unlimited without it).
- Section 1.2: because Space Age only recommends Quality (`+` marker), there are eight valid module sets, not five; the catalog records per-set variants (for example `space-science-pack` stack size 2000 versus 200 with Space Age).
- Open question 2: group, subgroup and order strings and quality levels are in the catalog; the comparator itself still needs fixtures F-13 and F-16.

## 12. Blueprint import and export as built (2026-11-14)

`packages/blueprints` implements sections 3 to 5. This section records what that work found out about the format beyond the sections above, with the same provenance tags.
It was written without the game; on the same day the probe of 12.5 ran against Factorio 2.1.24 for the first time. "[game]" marks what its recording (fixture F-01) shows; where it contradicts the sections above or the API reference (2.1.23), the game wins, and 12.2 has the difference.

### 12.1 Added facts

| Fact | Provenance |
| --- | --- |
| The API file gives no number for any define: `defines.direction`, `wire_connector_id`, `wire_type` and `control_behavior.lamp.color_mode` have `order` only (the position in the documentation, alphabetical for `direction`). The numbers of 4.2 and 5.4 are from the web and from the shipped strings, those of the lamp's color mode from nowhere | [api: defines] |
| `LuaItemStack.import_stack` returns 0 "if the import succeeded with no errors", -1 "if the import succeeded with errors", 1 "if the import failed" | [api: LuaItemStack.import_stack] |
| A game-written root object has its keys in the order `icons`, `entities`, `schedules`, `stock_connections`, `wires`, `tiles`, `item`, `label`, `version`, `branch_version`, each only when it has something | [data: the 89 embedded strings; `label` in three 2.0.7.0 strings of space-age/menu-simulations] |
| An entity record is written `entity_number`, `name`, `position`, `direction`, then its own fields (`control_behavior`, `always_on`, `quality`, ...) | [data: embedded strings] |
| Of the 89 shipped strings exactly one has circuit wires and control behaviours of the entities in scope (constant combinator, selector combinator; `base/prototypes/factoriopedia-simulations.lua`, version 1.2.10.23). Lamps occur in two strings, always without `control_behavior` (19 lamps, 16 of them `always_on`). No arithmetic or decider combinator and no speaker occurs in any | [data: decoded embedded strings] |
| Strings with version 1.2.x (the pre-release of 2.0) have the 2.x layout: root `wires`, `sections`, connector ids. `neighbours` on poles occurs in three strings (1.1.0.14, 1.1.0.22 and the early pre-release 1.2.0.84), circuit `connections` in none | [data: decoded embedded strings] |
| 2 x 2 poles have whole coordinates in strings the game wrote: a big pole at (-12, 224), a substation at (-8, 232) and (8, -21). This confirms the substation row of 5.4 | [data: space-age/menu-simulations/menu-simulation-vulcanus-punishment.lua, base/prototypes/factoriopedia-simulations.lua] |
| `quality_filter` (QualityCondition) is either a quality name as a string or `{ quality?, comparator? }`; `quality_source_static` is `{ name? }`, name defaulting to normal; `quality_source_signal` is a SignalIDBase, a signal without quality | [api: QualityCondition, BlueprintQualityID, SignalIDBase] |
| The runtime type of a speaker's `parameters`, `alert_parameters` and of `control_behavior.circuit_condition` and `circuit_parameters` marks every member as required, `volume_signal_id` and `icon_signal_id` included; a blueprint may still come without them (empty slots) | [api: ProgrammableSpeakerParameters, ProgrammableSpeakerAlertParameters, ProgrammableSpeakerBlueprintControlBehavior]; that they may be absent [assumed] |
| A lamp's network selection is settable at run time as `LuaControlBehavior.input_networks` ("nil if this control behavior does not allow selecting the input networks"); the speaker has no such selection in its blueprint type | [api: LuaControlBehavior.input_networks, LampBlueprintControlBehavior, ProgrammableSpeakerBlueprintControlBehavior] |
| Before 2.0 the speaker's playback mode was the boolean `playback_globally` (3.10); the importer reads it when `playback_mode` is absent | [changelog, as 3.10]; the field name in a 1.x string [unverified] |
| A constant combinator's section is addressed at run time by `LuaConstantCombinatorControlBehavior.add_section(group?)`, `remove_section(index)` and `LuaLogisticSection.set_slot(index, { value = SignalFilter, min = count })`; an untouched combinator may already have a section (`sections_count`) | [api]. It has one, empty: `sections: { sections: [{ index: 1 }] }`; with every section removed the game writes `sections: null` [game] |

### 12.2 Corrections

| Section | Was | Is |
| --- | --- | --- |
| 4.3, 9.1 | "Major 1 is rejected", with 1.2.x left open | 1.1 and older are refused; 1.2.x is imported with a warning. The only real circuit string at hand is 1.2.10.23 and has the 2.x layout [data] |
| 5.3 | "exporting with build 0 is expected to be accepted" | unchanged and still [unverified]; the exporter writes 2.1.25.0 (562954250027008) |
| 3.2 | "Unknown fields must be preserved verbatim (proposal)" | not done: unknown fields are dropped and reported (decision of 2026-11-14, section 9) |
| 9 | "preserved-on-roundtrip-only" for entities out of scope, copper wires, entity quality, tags and the blueprint's own extras | dropped and reported (same decision) |
| 3.7 | "The importer should accept both forms; the exporter should follow the fixture result" | the importer accepts both; 2.1.24 writes the flat form of the API, and so does the exporter [game] |

What the recording of the game corrected, all [game: F-01]. "Assumed" is what `packages/blueprints` did before it, from the API reference or from nothing:

| Topic | Assumed | The game |
| --- | --- | --- |
| An entity as placed | no `control_behavior` for any combinator | a constant, an arithmetic, a decider and a selector combinator always have one (12.3). A lamp, a speaker and every generic entity have none, also after their control behaviour was created (a display panel then has its one empty message, `parameters: [{}]`) |
| Constant combinator, 3.4 | no `sections` without sections; `is_on` before `sections` | one empty section in a new one, `[{ index: 1 }]`; `sections` before `is_on`. With every section removed: `sections: null` |
| Arithmetic combinator, 3.5 | nothing for one that is not configured; the network selection of a side next to its signal | a new one is `{ second_constant: 0, operation: "*" }`: nothing on the left, which is not the constant 0. The game reads a blueprint without a first side as `first_constant: 0` and writes that from then on, so its own blueprint of a new combinator is not what it writes after reading it. Both selections come last, after `output_signal` |
| Decider combinator, 3.6 | empty lists left out; `constant` and `comparator` in every condition | all three lists always, `[]` when empty. A new one has a blank condition and a blank output: `conditions: [{}]`, `outputs: [{}]`, `else_outputs: []`. In a condition a `constant` of 0 and the `comparator` `<` are left out, which no other condition of the game does; order `first_signal`, `second_signal`, `constant`, `comparator`, `first_signal_networks`, `second_signal_networks`, `compare_type` |
| Selector combinator, 3.7 | nothing for one as placed; `random_update_interval` always; `select_highest_quality` only when false; `quality_source_static: { name: "normal" }` | as placed `{ operation: "select", select_max: true, index_constant: 0 }`; `random_update_interval` left out at 0; `select_highest_quality` always in that mode; no `quality_source_static` for normal; the time signals in the order game tick, day tick, day length |
| Lamp, 3.8 | `color_mode` before the color signals, `always_on` before `color` | after them; `color` before `always_on`. Everything else as assumed, the numbers 0, 1, 2 of the modes included |
| Speaker, 3.10 | `control_behavior` always and last, with a blank condition as `{ constant: 0, comparator: "<" }` | `control_behavior` first, without `circuit_condition` when there is no condition, and not at all when the circuit does not concern the speaker (no condition, no pitch, instrument 0, note 0, nothing to stop). `circuit_parameters`, `parameters` and `alert_parameters` in full |
| Floats | the shortest decimal | the float written out: `0.800000011920928955078125` for 0.8, `0.501960813999176025390625` for 128 / 255. Read back as the same float |
| Wires, 4.1 | the list sorted by the two entity numbers, then the connectors | by the first end, entity then connector, then by the second |
| Directions, 5.4 | a direction between two of those an entity is built in is the nearest | the one before it: on an entity of four directions 1, 2, 3 are north; on one of eight the odd ones are the even one before; a storage tank has 0 and 4 only (8 is 0, 12 is 4). `fresh` and `directions` of F-01 |
| Space platform hub | a position like any other | a blueprint with the hub is built with its positions as they are, the hub being the one at (0, 0) of the platform, whatever position `build_blueprint` is given; `import_stack` moves the hub of a blueprint to (0, 0) and nothing else. The exporter writes such a circuit around its hub |
| Entities no item builds | exported like any other | `import_stack` leaves `blue-chest`, `red-chest`, `crash-site-chest-1` and `-2` and their wires out and returns -1 ("succeeded with errors"); `set_blueprint_entities` does not take them, and a blueprint made of them where they stand is without them. The exporter warns |
| Modes of the generic entities, 14.2 | every define counts from 0 | so they do, but `defines.control_behavior.radar.mode`: surface 1, universe 2 |
| Defaults of the generic entities, 14.2 | `read_ammo` of an artillery turret off; `include_hands` of an asteroid collector off [api: "Defaults to `false`"] | both on. Every other default of the settings table is the game's (`defaults` of F-01) |
| Wall, 14.2 | `circuit_open_gate` off in a new wall | on, with a blank condition, and written whenever the wall has a control behaviour. A wall has a connection point and a control behaviour only while a gate stands next to it (`get_wire_connector` gives none otherwise, and the control behaviour is gone with the gate); a wall the game builds from a blueprint has its wire and its settings without a gate |
| Splitter, 14.2 | a side that is on without a condition has none | a new splitter has `signal-I < 0` for the left input, `signal-I > 0` for the right, `signal-O` likewise for the output; the game leaves these out of a blueprint and has them where a blueprint switches a side on without naming a condition |
| Field order of a generic `control_behavior` | the order of the reference | `input_networks`, `output_networks`, then per behaviour its own order (`FIELD_ORDER` in `packages/blueprints/src/generic.ts`) |
| `read_fuel`, 14.2 | kept on every machine | kept only where fuel burns: on a biochamber, a stone furnace and a boiler, not on an assembling machine 2, an electric furnace or a lab |

### 12.3 What the game writes, and the exporter with it

All [game: F-01]: the exporter writes every entity of the samples as the game does, field for field and in the order of the fields (`packages/blueprints/test/game.test.ts`). Reading does not depend on any of these: the importer takes every field with or without its default.

| Topic | Written |
| --- | --- |
| Defaults left out | `is_on` true, `active` true, `multiplier` 1, `copy_count_from_input` true, an output `constant` of 1, `compare_type` or, `index_comparator` =, `random_update_interval` 0, `quality_source_static` normal, `circuit_enabled` false, `use_colors` false, `color_mode` 0, `always_on` false, both networks, `direction` 0; in a condition of a decider combinator a `constant` of 0 and the `comparator` `<`; every setting of a generic entity at its default |
| Written although at a default | both constant operands of an arithmetic combinator and its `operation`; `comparator` and `constant` of every condition that is not a decider's; `select_max` and `index_constant` of a selector in select mode; `select_highest_quality` in quality-select mode; all members of a speaker's `parameters`, `alert_parameters` and `circuit_parameters`; `quality` and `comparator` of a constant combinator's filter |
| An entity as placed | constant `{ sections: { sections: [{ index: 1 }] } }`; arithmetic `{ arithmetic_conditions: { second_constant: 0, operation: "*" } }` (the exporter writes `first_constant: 0` as well, 12.2); decider `{ decider_conditions: { conditions: [{}], outputs: [{}], else_outputs: [] } }`; selector `{ operation: "select", select_max: true, index_constant: 0 }`; a lamp nothing; a speaker `parameters` and `alert_parameters` |
| A constant combinator without sections in the editor | the one empty section of a new one, which the importer reads as none |
| Network selection | `{ red, green }`, both keys |
| "Any quality" in a quality filter | no `quality_filter` when the comparator is `=`, `{ comparator }` otherwise (the second not in a sample) |
| Speaker with "signal value is pitch" | the pitch signal as `first_signal` of the condition, with `constant: 0, comparator: "<"` |
| `color` of a lamp | `{ r, g, b, a: 1 }` with 0 to 1 per channel |
| Wires | `[lower entity number, connector, higher, connector]`, a wire of an entity to itself with the lower connector first, the list in the order of 12.2 |
| `icons` | up to four item signals, the most frequent prototypes first; the game takes them |
| `version` | 2.1.25 with build number 0; the game takes it and writes its own, 2.1.25.10 (562954250027018); 2.1.24 wrote 2.1.24.1 (562954249961473) |

### 12.4 What import drops

Entities whose `name` is not one of the ten prototypes of 3.1, with every wire that has an end on one of them; copper wires (both connectors 5 or 6); wires that name an entity number or a connector that does not exist, or that join a red with a green connector.
Of the blueprint: everything but `label`, `entities`, `wires` and `version`. Of a known entity: `quality`, `tags`, `items`, `mirror`, a `direction` on an entity that cannot turn (the game drops it too [game]), a lamp's logistic connection, and every unknown field. The request fields of a filter of a constant combinator (`max_count`, `minimum_delivery_count`, `import_from`) and its `trash_not_requested` are dropped as well, without a report (user, 2026-11-15).
Each is counted or named in the import report (`packages/blueprints/README.md`).

### 12.5 Fixture F-01: recorded on 2026-11-14

`make probe-blueprints` runs `tools/game-probe/blueprints.mjs` against the installed game, headless and sandboxed, in about three seconds; `tests/fixtures/game/F-01-blueprints.json` is its recording of Factorio 2.1.25 with the five standard modules. It holds

- `defines`: the numbers of directions, connectors, wire types, the lamp's color modes and the seven modes of the generic entities;
- `fresh`: every prototype as the game places it, untouched and with its control behaviour created, each as one blueprint, and the hub of a space platform on a platform the probe makes (`create_space_platform`, `apply_starter_pack`);
- `states`: a constant combinator with every section removed;
- `defaults`: per generic prototype what the control behaviour of a new entity says for every field of the settings table (14.2);
- `directions`: per prototype what becomes of each of the sixteen directions in the string of a blueprint that is given it, on the entity built from that, in the string of a blueprint made of that entity, and on an entity created with it;
- `cases`: per sample circuit the blueprint the game makes of ours (`import_stack` then `export_stack`), of what it built from ours, and of the same circuit built through the runtime API.

The statements of sections 3 to 5 that waited for it are settled: 3.7 flat; 3.3 a network selection is written with both keys; 3.8, 4.2 and 5.4 the numbers; 3.4 to 3.8 and 3.10 the defaults and the entities as placed (12.2, 12.3); 3.5, 3.6, 3.10 and the lamp's `control_behavior` as a whole; 5.3 a `version` with build 0 is taken.

Not settled, with the reason:

| Open | Why |
| --- | --- |
| 5.4: what the game does with a wire beyond its reach when it reads a blueprint | no sample has one; the reach is fixture F-24 |
| That the game builds an offshore pump, a mining drill and an asteroid collector from a blueprint of ours | the probe builds on plain ground, without water, ore or space; these three are verified as the game reads our blueprint and as it writes one of an entity it created (`unbuilt` of their cases) |
| The fields a generic entity only keeps (14.3) through the game | the samples carry none |
| The direction of a crafting machine whose recipe uses its fluid boxes (13.4) | the samples have no recipes; without one, six of them face north whatever they are told (`directions`), though `import_stack` kept a direction of 4 on an assembling machine 2 in the first recording |
| That instrument and note ids are the instruments and notes of the catalog | a blueprint has the numbers only |
| Blueprints of 2.0 and older, and of mods | the probe runs the installed game |

## 13. The wired entities: every prototype a circuit wire connects to (2026-11-14)

The editor is to get every entity that can be on a circuit network. This section is the inventory: what the game's dumps say about all of them. The data is in `packages/model/data/entities-2.1.25.json`, written by the catalog generator
(`tools/catalog/lib/entities.mjs`; format in `packages/catalog/README.md`, "Entity table") and read by `@face/model` (`STANDARD_ENTITY_TABLE`). The 88 prototypes beyond 3.1 are one generic kind of the editor, `entity`, since section 14 was written: their control behaviours and what the editor makes of them are there; selector, drawing and inspector for them do not exist yet.
"[data: dump]" here means `data-raw-dump.json` (`--dump-data`) of all eight module sets; "[runtime dump]" the scenario's `face-runtime-dump.json`. The game was not run when this section was written; it was on 2026-11-14 (`make catalog`, `make probe-wire-reach`),
and what that confirmed or corrected is said where it applies: the selection boxes (13.2), the reaches (13.3), the directions (13.4).

### 13.1 Selection

A prototype is selected when `circuit_wire_max_distance > 0`, or it is of type `electric-pole` with `maximum_wire_distance > 0`, or of type `power-switch` with `wire_max_distance > 0` [data: dump]. No list of names is involved.

| Module set | Selected | Prototype types |
| --- | --- | --- |
| `base`, `base+elevated-rails` | 79 | 45 |
| with `recycler` (and with `quality`) | 80: adds `recycler` | 45 |
| with `space-age` (with or without `quality`) | 98: adds 18 | 48 |

Space Age adds `agricultural-tower`, `asteroid-collector`, `big-mining-drill`, `biochamber`, `biolab`, `crusher`, `cryogenic-plant`, `electromagnetic-plant`, `foundry`, `heating-tower`, `railgun-turret`, `rocket-turret`, `space-platform-hub`,
`stack-inserter`, `tesla-turret`, `turbo-loader`, `turbo-splitter`, `turbo-transport-belt`. Elevated Rails and Quality add none.
No prototype has one of the three fields with a value of 0 or below, and none outside the two named types has `maximum_wire_distance` or `wire_max_distance` [data: dump], so the rule has no borderline case in 2.1.24.
The 98 names are exactly the 98 of the user's overview (`/Users/henning/factorio/entity-categorization.md`), which was compiled from the Lua sources and the API by hand.
The engine agrees with the rule: `get_max_circuit_wire_distance() > 0 or get_max_wire_distance() > 0` over all entity prototypes selects the same names in every module set [runtime dump, checked by the generator].

### 13.2 Footprints

Tile size facing north: `tile_width` and `tile_height` where the prototype sets them, else the size of `collision_box` rounded up to whole tiles [api: LuaEntityPrototype.tile_width "Specifies the tiling size of the entity, is used to decide, if the center
should be in the center of the tile (odd tile size dimension) or on the tile border (even tile size dimension)"]; that the default is the collision box rounded up is the prototype documentation as remembered [unverified] and agrees with the three sizes F-24 recorded from the engine (1 x 1, 1 x 2, 2 x 2).
For all 98 the result is the engine's `tile_width` and `tile_height` [runtime dump, checked by the generator].

Thirteen footprints occur [data: dump]:

| Tiles (north) | Count | Prototypes |
| --- | --- | --- |
| 1 x 1 | 41 | chests, inserters, belts, pipes, small and medium pole, lamp, speaker, constant combinator, rail signals, wall, land mine, display panel, heat pipe, offshore pump |
| 1 x 2 | 8 | arithmetic, decider and selector combinator, pump, the four loaders |
| 2 x 1 | 4 | the four splitters |
| 2 x 2 | 10 | accumulator, big pole, substation, power switch, burner mining drill, stone and steel furnace, gun turret, laser turret, train stop |
| 2 x 3 | 2 | crusher, flamethrower turret |
| 2 x 4 | 1 | recycler |
| 3 x 2 | 2 | boiler, heat exchanger |
| 3 x 3 | 17 | assembling machines 1 to 3, chemical plant, centrifuge, biochamber, electric furnace, lab, radar, storage tank, electric mining drill, pumpjack, heating tower, agricultural tower, asteroid collector, artillery turret, rocket turret |
| 3 x 5 | 1 | railgun turret |
| 4 x 4 | 3 | roboport, electromagnetic plant, tesla turret |
| 5 x 5 | 6 | oil refinery, nuclear reactor, foundry, cryogenic plant, biolab, big mining drill |
| 8 x 8 | 2 | cargo landing pad, space platform hub |
| 9 x 9 | 1 | rocket silo |

Eighteen are not square (the rows 1 x 2, 2 x 1, 2 x 3, 2 x 4, 3 x 2, 3 x 5). Exceptions to "the collision box rounded up":

| Prototype | `tile_width` x `tile_height` | Collision box | The box alone would give |
| --- | --- | --- | --- |
| `train-stop` | 2 x 2 | +-0.5 x +-0.5 | 1 x 1 |
| `offshore-pump` | 1 x 1 | x -0.6 to 0.6, y -1.05 to 0.3 | 2 x 2 |
| `railgun-turret` | height 5 (no width) | x +-1.41, y -1.9 to 2.1 | 3 x 4 |
| `asteroid-collector` | 3 x 3 | +-1.2 | 3 x 3: explicit, but no exception |

The collision box decides nothing else: the game measures the reach of a wire between selection boxes (5.4), and the table has no collision box since 2026-11-14.

Selection boxes: `selection_box` of the prototype, which the game holds in 1/256 of a tile, cut off towards 0 [runtime dump: `LuaEntityPrototype.selection_box` equals the cut-off value of `data.raw` for all 98, checked by the generator].
For 80 prototypes it is the tiles the prototype covers, centered. The table has the box of the 18 others (`selectionBox`, facing north, as the game has it):

| Prototypes | Tiles | `selection_box` in `data.raw` (x, y around the center) | Against the tiles |
| --- | --- | --- | --- |
| the six inserters | 1 x 1 | +-0.4, -0.35 to 0.45 | smaller, and not the same north and south |
| `display-panel` | 1 x 1 | +-0.5, -0.65 to 0.5 | 0.15 further north |
| `offshore-pump` | 1 x 1 | +-0.6, -1.49 to 0.49 | wider, and a tile further north |
| `rail-signal` | 1 x 1 | +-0.45, +-0.65 | narrower and longer |
| `small-electric-pole` | 1 x 1 | +-0.4 | smaller |
| the four splitters | 2 x 1 | +-0.9, +-0.5 | narrower |
| `stone-furnace`, `steel-furnace` | 2 x 2 | +-0.8, +-1 | narrower; they do not turn (13.4) |
| `train-stop` | 2 x 2 | +-0.9 | smaller |
| `recycler` | 2 x 4 | +-0.9, +-1.85 | smaller |
`land-mine` has the flag `placeable-off-grid`: its center is anywhere, so it has no tile footprint in the sense of 5.4 (`offGrid`).
`pipe-to-ground` has a box that is not symmetric (y -0.29 to 0.2) and is 1 x 1 by either rule.
Tile size, collision box, flags and reach of every prototype are the same in every module set that has it [data: dump, compared field by field by the generator, which fails otherwise]. The only difference between the sets in these prototypes is the flag `hide-alt-info`, which Space Age adds to `cargo-landing-pad`.

### 13.3 Wire reach

| Reach | Prototypes | Field |
| --- | --- | --- |
| 9 | 93: every one not named below, the medium electric pole among them | `circuit_wire_max_distance`; the pole `maximum_wire_distance` |
| 7.5, 18, 32 | `small-electric-pole`, `substation`, `big-electric-pole` | `maximum_wire_distance` |
| 10 | `power-switch` | `wire_max_distance`; it has no `circuit_wire_max_distance` |
| 30 | `agricultural-tower` | `circuit_wire_max_distance` [data: space-age/prototypes/entity/entities.lua, `circuit_wire_max_distance = 30`] |

[data: dump] for all. This corrects 5.4, which took 9 for every entity that is not a pole.
That the one distance of a pole is also its circuit reach is [game: fixture F-24] for all four poles (3.9), and so are the power switch's `wire_max_distance` of 10 (against itself and against a big pole) and the tower's 30 (against itself and a big pole);
the runtime dump has the same reaches for all 98 [checked by the generator].

The editor's rule (`hasOwnWireReach` in `packages/model/src/entityTable.ts`): a prototype has a reach of its own when it is an electric pole, or when its reach is not the standard 9. Every other prototype has the reach of the project, a setting that defaults to 9.
The first half keeps what the editor did before this section: the medium pole reaches 9 whatever the project says, because the project's setting stands for `default_circuit_wire_max_distance` and a pole's reach never came from that.
Under this rule six of the 98 have their own reach: the four poles, the power switch and the agricultural tower.
Quality: "Increases the wire reach at higher qualities" [data: core locale, as 3.9]. The scenario records `get_max_wire_distance(quality)` and `get_max_circuit_wire_distance(quality)` for every quality: only the four poles grow, by 2 tiles per level
(the small pole 7.5, 9.5, 11.5, 13.5 and 17.5 at legendary) [runtime dump]; the table has the reach at normal quality.

### 13.4 Directions

`data.raw` says in how many ways an entity is built only through flags: `building-direction-8-way` (`flamethrower-turret`, `railgun-turret`) and `building-direction-16-way` (`rail-signal`, `rail-chain-signal`), and through `two_direction_only` (`storage-tank`) [data: dump].
Whether a prototype can be turned at all is the engine's and readable only at run time, in two places that differ:

- `LuaEntityPrototype.supports_direction`, "Whether this entity prototype could possibly ever be rotated" [api]: true for 55 of the 98, every `assembling-machine` and `furnace` among them.
- `LuaEntity.supports_direction` of an entity that stands: true for 44 as they are built, and for 6 more once they have a recipe with a fluid. The 5 others of the 55 never have a direction: built facing east they face north,
  and neither setting `direction` nor `rotate()` changes that.

The table follows the entity: `directions` is 1 for a prototype whose entities have no direction, else 16, 8, 2 or 4 by the flags above. So 48 prototypes have 1, 45 have 4, and 5 the others.
[runtime dump: `built`, since 2026-11-14. The scenario builds every prototype once on an empty surface and gives an assembling machine without a direction the recipes with a fluid until it has one. `space-platform-hub` cannot be built there; its prototype says no.]

| Crafting machines | As built | With a recipe that has a fluid | `directions` |
| --- | --- | --- | --- |
| `chemical-plant`, `oil-refinery` (fluid boxes always in use), `crusher`, `recycler` (not square) | direction | | 4 |
| `assembling-machine-2`, `-3`, `foundry`, `biochamber`, `electromagnetic-plant`, `cryogenic-plant` (`fluid_boxes_off_when_no_fluid_recipe`) | none | direction | 4 |
| `assembling-machine-1`, `centrifuge`, `stone-furnace`, `steel-furnace`, `electric-furnace` (no fluid boxes, square) | none | none | 1 |

This is the rule the changelog suggested, "has fluid boxes, or is not square" ([changelog 2.0.25] "Fixed that assemblers without fluid boxes were incorrectly considered rotatable"; [changelog 2.0.34] "Fixed unrotatable furnaces being rotated when overbuilt with a blueprint").
The first run against the game seemed to contradict it, because the prototype's `supports_direction` is true for all fifteen; the entity decides.
An entity of the middle row has a direction only while its recipe has a fluid; the editor lets it be turned whatever its recipe.

The generator has the rule per prototype type (`ROTATION_BY_TYPE` in `tools/catalog/lib/entities.mjs`): it builds the table from it for dumps without the game's word, and fails where a dump that has the word disagrees.
What the entries were taken from before the game was run, and what the game said on 2026-11-14:

| Entry | Types | Rested on | The game |
| --- | --- | --- | --- |
| yes | the four combinators | the editor's values (3.1, 5.4); a shipped selector has direction 8 [data: embedded strings] | confirmed |
| no | `lamp`, `electric-pole`, `programmable-speaker` | the editor's values (3.1, 3.9, 3.10) | confirmed |
| yes | `inserter`, `transport-belt`, `splitter`, `loader`, `pipe-to-ground`, `pump`, `offshore-pump`, `boiler`, `mining-drill`, `storage-tank`, `train-stop`, `rail-signal`, `rail-chain-signal`, `asteroid-collector` | a `direction` in a blueprint string the game ships [data: 76 embedded blueprint strings of `factorio-data`] | confirmed |
| has fluid boxes, or is not square | `assembling-machine`, `furnace` | the changelog entries above; shipped strings have a `crusher`, a `foundry` and a `chemical-plant` with a direction | confirmed by the entities, see above |
| yes | `fluid-turret` | [changelog 2.1.7] "Flamethrower turrets can now be rotated 8 ways instead of 4" | confirmed |
| yes, corrected to: only with the flag `building-direction-8-way` | `ammo-turret` | [changelog 0.10.1] "Turrets are rotatable when building and their direction is preserved in blueprints" | `railgun-turret` turns; `gun-turret` and `rocket-turret` do not |
| yes, corrected to no | `electric-turret` | the same changelog entry | `laser-turret` and `tesla-turret` do not turn |
| no, corrected to yes | `artillery-turret`, `display-panel` | nothing at hand said they turn | both turn |
| no | every other type: the containers, `accumulator`, `agricultural-tower`, `cargo-landing-pad`, `heat-pipe`, `infinity-pipe`, `lab`, `land-mine`, `pipe`, `power-switch`, `radar`, `reactor`, `roboport`, `rocket-silo`, `space-platform-hub`, `wall` | nothing at hand said they turn | confirmed |

All eighteen prototypes that are not square turn, as they must. For a square prototype the entry decides whether a `direction` is read and written for it, and whether its selection box turns (the two furnaces of 13.2, which do not).
A gun, rocket, laser or tesla turret built facing east answers `direction` with east although `supports_direction` is false for the entity and for its prototype [game: scenario of 2026-11-14, not kept]; whether the game writes that direction into a blueprint is for F-01 (12.5).

How the game writes the direction of an entity with 2, 8 or 16 directions into a blueprint is not covered here; for 4 see 5.4.

### 13.5 Hidden prototypes, placing items, default signals

Thirteen prototypes are `hidden` [data: dump] [runtime dump, identical]: the chests of the game's editor and scenarios (`red-chest`, `blue-chest`, `bottomless-chest`, `infinity-chest`, `linked-chest`, `proxy-container`, `crash-site-chest-1`, `crash-site-chest-2`),
`infinity-pipe` and the four loaders.
Four of them have no item that places them (`items_to_place_this` empty): `red-chest`, `blue-chest` and the two crash site chests. Each of the other 94 is placed by exactly one item, which has the entity's name [runtime dump].
Group, subgroup and order of every entity are in the signal catalog (`packages/catalog`, kind `entity`), which also has the display names; the table repeats the English name (`displayName`) because the model cannot read the catalog.
Two names are not what the prototype name suggests: `small-lamp` is "Lamp", `stone-wall` is "Wall"; both crash site chests are "Chest capsule".

Forty prototypes set one or more `default_*_signal` fields [data: dump]; all are virtual signals:

| Field (`default_..._signal`) | Signal | Prototypes |
| --- | --- | --- |
| `empty_slots` | `signal-E` | 16: every container but the two crash site chests, `cargo-landing-pad`, `space-platform-hub` |
| `stack_control_input` | `signal-S` | the 6 inserters |
| `fluid_temperature` | `signal-T` | `pipe`, `pipe-to-ground`, `infinity-pipe`, `storage-tank` |
| `temperature` | `signal-T` | `heat-pipe`, `nuclear-reactor`, `heating-tower` |
| `technology_level` | `signal-L` | `lab`, `biolab` |
| `output` | `signal-A`; `signal-G` | `accumulator`; `stone-wall` |
| `red`, `green`, `blue`, `rgb` | `signal-red`, `-green`, `-blue`, `-white` | `small-lamp` (3.8) |
| `red_output`, `orange_output`, `green_output`; `blue_output` | `signal-red`, `-yellow`, `-green`; `-blue` | `rail-signal`, `rail-chain-signal`; the chain signal alone |
| `train_stopped`, `trains_count`, `trains_limit`, `priority` | `signal-T`, `-C`, `-L`, `-P` | `train-stop` |
| `available_logistic_output`, `total_logistic_output`, `available_construction_output`, `total_construction_output`, `roboport_count_output` | `signal-X`, `-Y`, `-Z`, `-T`, `-R` | `roboport` |
| `launched` | `signal-R` | `rocket-silo` |
| `speed`, `damage_taken` | `signal-V`, `-D` | `space-platform-hub` |
| `game_tick_output`, `day_tick_output`, `day_length_output` | `signal-T`, `-D`, `-L` | `selector-combinator` (3.1) |

`data.raw` has only what a prototype sets; the API names further fields that no prototype of the game sets (`default_recipe_finished_signal`, `default_working_signal` of the crafting machines [api]). Whether the engine fills in a default of its own for any of them
is asked by the scenario for every such field; a signal it answers with that `data.raw` lacks or has otherwise stops the generator. It answered with none that `data.raw` does not have [runtime dump, `make catalog` of 2026-11-14].

### 13.6 What is from where

| Fact | Source | Checked against the engine |
| --- | --- | --- |
| Which prototypes; type; reach; flags; `two_direction_only`; default signals | [data: dump] | by the generator against `circuit_entities` of the runtime dump, for every module set; a difference stops it |
| Tile size | [data: dump] with the rule of 13.2 | the same (`tile_width`, `tile_height`) |
| Selection box | [data: dump], cut off to 1/256 of a tile | the same (`selection_box`) |
| Can be turned | [runtime dump: the entity the scenario built] (13.4) | it is the engine's; the rule by type must agree |
| `hidden`, placing items | [runtime dump] | already the engine's |
| English name | `--dump-prototype-locale` | already the engine's |
| Modules | presence in the eight dumps | already the engine's |
| How the reach of a wire is measured, and that the reaches 7.5, 9, 10, 18, 30 and 32 are applied | [game: fixture F-24] (5.4) | `node tools/game-probe/wire-reach.mjs --check` asks the game again; `packages/model/test/wireReachGame.test.ts` applies the rule to every placement |

The table says `runtimeChecked: true` since `make catalog` ran against the game on 2026-11-14.
The probe runs the game with its five standard modules (the railgun turret, the recycler and the agricultural tower are not in `base`). A case the game cannot set up, because a script may not place the entity there or the game moves it off the tiles
asked for, is left out of the fixture and named in the tool's output; the tool then exits with an error after writing the others. An entity that belongs on the rail grid (train stop, rail signals) is A of its case and may be moved by whole tiles.
With every entity the fixture has the direction it has in the game, and the one the probe asked for where the game did not give it (`asked`: a stone furnace asked to face east faces north).

### 13.7 What the dumps contradict or qualify in the user's overview

The overview's inventory stands: the same 98 names, 13 of them hidden, none from Elevated Rails or Quality, one from the recycler module. The dumps add or qualify:

- Wire reach is not uniform: besides the poles, the power switch reaches 10 and the agricultural tower 30 (13.3). The overview does not mention reach.
- The radar is listed as a pure relay. Since 2.1.7 it has settings of its own: a mode, `surface` or `universe`, and a universe channel [changelog 2.1.7: "Added "universe" mode of operation to radar circuit connections for transfer of cross-surface signals",
  `LuaRadarControlBehavior::mode, universe_channel`] [api: `defines.control_behavior.radar.mode`, `LuaEntityPrototype.default_universe_channel`]. The dump has no field for it (`radar` sets no `default_universe_channel`); an editor entity for the radar needs these two settings.
- "Quality levels do not create additional entity prototypes" is right, but quality is not without effect on a circuit layout: it changes the wire reach (13.3).
- Four of the hidden prototypes cannot be placed by any item (13.5), so a palette that offers "everything with an item" has 94 entries, 85 of them not hidden.
- Send, receive and relay are not properties of a prototype in the dump; the default signals of 13.5 are the only trace of them there. They agree with the overview where they exist (an accumulator and a wall have an output signal, an inserter a stack size input, a lamp colour inputs),
  and the classification as a whole stays the overview's [api, as stated there].
- Not every wired entity sits on the tile grid or in one of four directions: the land mine is off the grid, the rail signals have 16 directions, two turrets 8, the storage tank 2 (13.2, 13.4).

## 14. Control behaviours of the wired entities (2026-11-14)

What a blueprint says about the circuit connection of the 98 prototypes of section 13, and what the editor makes of it. The ten prototypes of 3.1 have a kind of their own (3.4 to 3.10); this section is about the other 88, the editor's generic kind `entity`
(`docs/dsl.md`, "entity"; `GenericEntity` in `@face/model`). The section was written from the API reference and the game data; the numbers, the defaults and the shapes have since been held against the game (fixture F-01, 12.5), and 14.5 has what that changed.

### 14.1 Sources

| Fact | Source |
| --- | --- |
| Which concept describes the `control_behavior` of an entity type | [api: concept `BlueprintEntity`, "Other attributes may be specified depending on the type of entity", one group per prototype type]. `electric-pole` has none. `infinity-pipe` and `linked-container` have a group without a `control_behavior`: the editor takes the one of the type they derive from (`SingleFluidBoxBlueprintControlBehavior`, `ContainerBlueprintControlBehavior`), which is what the game has [game: F-01, the samples with an infinity pipe and a linked chest]; both prototypes set the default signal that behaviour uses (13.5) |
| The fields of each concept, their types, which are optional, and the defaults the reference states ("Defaults to `false`") | [api: the 38 concepts `*BlueprintControlBehavior` and `SelectorCombinatorParameters`]. Reduced to these facts in `tests/fixtures/game/control-behaviors-2.1.23.json`, which `packages/model/test/entitySettings.test.ts` compares with the reference at hand and with the settings table |
| What a field does, for the labels | [api: the classes `Lua*ControlBehavior`] |
| The default signal of a signal field | [data: dump], `default_*_signal` of the prototype (13.5), in the entity table as `signals` |
| The numbers of the enums (`defines.control_behavior.*`) | [game: F-01, `defines`]. The reference lists the value names in alphabetical order without numbers. Every define counts from 0 in the order of the table (pulse 0, hold 1, entire belt 2; this miner 0, entire patch 1; `none` 0 where a define has it) but the radar's: surface 1, universe 2 |
| The defaults the reference does not state, and whether the stated ones hold | [game: F-01, `defaults`]: the attributes of the control behaviour of a new entity, read through the runtime API for every prototype |
| Blueprint strings of the game data | [data: 73 strings in the Lua files of `factorio-data`, 70 blueprints]. Of the 88 only inserters, belts, one space platform hub (`send_to_platform: false`) and one display panel (`parameters`) have a `control_behavior` there, and the inserters and belts are from before 2.0 with the field names of 1.1 (`circuit_enable_disable`, `circuit_mode_of_operation`). They show that an enum is a number and that no entity has a `control_behavior` without a setting or a wire |

The 38 concepts have 105 distinct fields: 52 booleans, 28 signals, 9 conditions, 7 enums, 2 network selections and 7 structured ones. The 32 concepts of the generic prototype types have 92 distinct fields.

### 14.2 Per control behaviour: the fields and what the editor makes of them

The editor has five field types: boolean, signal, condition, enum and network selection. A row of `ENTITY_SETTINGS` (`packages/model/src/entitySettings.ts`) per prototype type lists the settings of that type; a further type is a further row.
Two kinds of boolean are not settings of their own but part of another one:

- The boolean that says a condition is in use (`circuit_enabled` for `circuit_condition`, `connect_to_logistic_network` for `logistic_condition`, `set_input_side` for the two input conditions of a splitter). The condition is a setting exactly while that boolean is on; one that is on without a first signal is the unset condition of the model (`when unset`), which is never fulfilled (6.7, fixture F-29).
- The checkbox in front of a choice of modes (`circuit_read_hand_contents` before pulse or hold). It is the word `none` of the enum.

In the table, "in use of" names the settings such a boolean belongs to. Every default and every number of a mode is the game's (F-01): "[api]" says that the reference states the same default, "[api: x]" that it states another, "[game]" that it states none;
a signal's default is the prototype's. The game writes no field at its default, and none of them is always written but the open-gate flag of a wall.

<!-- control-behaviors:begin (generated from ENTITY_SETTINGS and tests/fixtures/game/control-behaviors-2.1.23.json; `npx vitest run packages/model/test/auditDocs.test.ts` checks it, UPDATE_DOCS=1 rewrites it) -->
| Control behaviour | Prototype types | Fields: setting (field type; default) |
| --- | --- | --- |
| `Accumulator` | `accumulator` | `output_networks`: `output-networks` (networks; both [api]); `output_signal`: `output-signal` (signal; default `default_output_signal` [data]); `read_charge`: `read-charge` (boolean; default `true` [api]) |
| `AgriculturalTower` | `agricultural-tower` | `circuit_condition`: `when` (condition; blank); `circuit_enabled`: in use of `when`; `connect_to_logistic_network`: in use of `logistic when`; `enable_harvesting_condition`: in use of `harvest when`; `enable_planting_condition`: in use of `plant when`; `harvesting_condition`: `harvest when` (condition; blank); `input_networks`: `networks` (networks; both [api]); `logistic_condition`: `logistic when` (condition; blank); `output_networks`: `output-networks` (networks; both [api]); `planting_condition`: `plant when` (condition; blank); `read_contents`: `read-contents` (boolean; default `false` [api]) |
| `ArtilleryTurret` | `artillery-turret` | `circuit_condition`: `when` (condition; blank); `circuit_enabled`: in use of `when`; `connect_to_logistic_network`: in use of `logistic when`; `input_networks`: `networks` (networks; both [api]); `logistic_condition`: `logistic when` (condition; blank); `output_networks`: `output-networks` (networks; both [api]); `read_ammo`: `read-ammo` (boolean; default `true` [game]) |
| `AssemblingMachine` | `assembling-machine` | `circuit_condition`: `when` (condition; blank); `circuit_enabled`: in use of `when`; `connect_to_logistic_network`: in use of `logistic when`; `include_in_crafting`: `include-in-crafting` (boolean; default `true` [api]); `input_networks`: `networks` (networks; both [api]); `logistic_condition`: `logistic when` (condition; blank); `output_networks`: `output-networks` (networks; both [api]); `read_contents`: `read-contents` (boolean; default `false` [api]); `read_fuel`: `read-fuel` (boolean; default `false` [api]); `read_ingredients`: `read-ingredients` (boolean; default `false` [api]); `read_recipe_finished`: `read-recipe-finished` (boolean; default `false` [api]); `read_working`: `read-working` (boolean; default `false` [api]); `recipe_finished_signal`: `recipe-finished-signal` (signal; no default); `set_recipe`: `set-recipe` (boolean; default `false` [api]); `working_signal`: `working-signal` (signal; no default) |
| `AsteroidCollector` | `asteroid-collector` | `circuit_condition`: `when` (condition; blank); `circuit_enabled`: in use of `when`; `circuit_read_contents`: `read-contents` (boolean; default `false` [api]); `circuit_set_filters`: `set-filters` (boolean; default `false` [api]); `connect_to_logistic_network`: in use of `logistic when`; `include_hands`: `include-hands` (boolean; default `true` [api: `false`]); `input_networks`: `networks` (networks; both [api]); `logistic_condition`: `logistic when` (condition; blank); `output_networks`: `output-networks` (networks; both [api]) |
| `Boiler` | `boiler` | `circuit_condition`: `when` (condition; blank); `circuit_enabled`: in use of `when`; `connect_to_logistic_network`: in use of `logistic when`; `input_networks`: `networks` (networks; both [api]); `logistic_condition`: `logistic when` (condition; blank); `output_networks`: `output-networks` (networks; both [api]); `read_fuel`: `read-fuel` (boolean; default `false` [api]) |
| `CargoLandingPad` | `cargo-landing-pad` | `empty_slots_signal`: `empty-slots-signal` (signal; default `default_empty_slots_signal` [data]); `input_networks`: `networks` (networks; both [api]); `output_networks`: `output-networks` (networks; both [api]); `read_contents`: `read-contents` (boolean; default `true` [api]); `read_empty_slots`: `read-empty-slots` (boolean; default `false` [api]); `set_requests`: `set-requests` (boolean; default `false` [api]) |
| `Container` | `container`, `linked-container` (assumed) | `empty_slots_signal`: `empty-slots-signal` (signal; default `default_empty_slots_signal` [data]); `output_networks`: `output-networks` (networks; both [api]); `read_contents`: `read-contents` (boolean; default `true` [api]); `read_empty_slots`: `read-empty-slots` (boolean; default `false` [api]) |
| `DisplayPanel` | `display-panel` | `parameters`: kept only |
| `Furnace` | `furnace` | `circuit_condition`: `when` (condition; blank); `circuit_enabled`: in use of `when`; `connect_to_logistic_network`: in use of `logistic when`; `include_in_crafting`: `include-in-crafting` (boolean; default `true` [api]); `input_networks`: `networks` (networks; both [api]); `logistic_condition`: `logistic when` (condition; blank); `output_networks`: `output-networks` (networks; both [api]); `read_contents`: `read-contents` (boolean; default `false` [api]); `read_fuel`: `read-fuel` (boolean; default `false` [api]); `read_ingredients`: `read-ingredients` (boolean; default `false` [api]); `read_recipe_finished`: `read-recipe-finished` (boolean; default `false` [api]); `read_working`: `read-working` (boolean; default `false` [api]); `recipe_finished_signal`: `recipe-finished-signal` (signal; no default); `working_signal`: `working-signal` (signal; no default) |
| `GenericOnOff` | `offshore-pump`, `power-switch` | `circuit_condition`: `when` (condition; blank); `circuit_enabled`: in use of `when`; `connect_to_logistic_network`: in use of `logistic when`; `input_networks`: `networks` (networks; both [api]); `logistic_condition`: `logistic when` (condition; blank) |
| `HeatPipe` | `heat-pipe` | `output_networks`: `output-networks` (networks; both [api]); `read_temperature`: `read-temperature` (boolean; default `false` [api]); `temperature_signal`: `temperature-signal` (signal; default `default_temperature_signal` [data]) |
| `Inserter` | `inserter` | `circuit_condition`: `when` (condition; blank); `circuit_enabled`: in use of `when`; `circuit_hand_read_mode`: `read-hand` (enum; default `none` [game]; pulse 0, hold 1 [game]); `circuit_read_hand_contents`: in use of `read-hand`; `circuit_set_filters`: `set-filters` (boolean; default `false` [api]); `circuit_set_stack_size`: `set-stack-size` (boolean; default `false` [api]); `connect_to_logistic_network`: in use of `logistic when`; `input_networks`: `networks` (networks; both [api]); `logistic_condition`: `logistic when` (condition; blank); `output_networks`: `output-networks` (networks; both [api]); `stack_control_input_signal`: `stack-size-signal` (signal; default `default_stack_control_input_signal` [data]) |
| `Lab` | `lab` | `conditions`: kept only; `input_networks`: `networks` (networks; both [api]); `output_networks`: `output-networks` (networks; both [api]); `read_contents`: `read-contents` (boolean; default `false` [game]); `read_fuel`: `read-fuel` (boolean; default `false` [game]); `read_research_cost`: `read-research-cost` (boolean; default `false` [game]); `read_technology_level`: `read-technology-level` (boolean; default `false` [game]); `set_research`: `set-research` (boolean; default `false` [game]); `technology_level_signal`: `technology-level-signal` (signal; default `default_technology_level_signal` [data]) |
| `LandMine` | `land-mine` | `circuit_condition`: `when` (condition; blank); `circuit_enabled`: in use of `when`; `connect_to_logistic_network`: in use of `logistic when`; `input_networks`: `networks` (networks; both [api]); `logistic_condition`: `logistic when` (condition; blank) |
| `Loader` | `loader`, `loader-1x1` | `circuit_condition`: `when` (condition; blank); `circuit_enabled`: in use of `when`; `circuit_read_transfers`: `read-transfers` (boolean; default `false` [api]); `circuit_set_filters`: `set-filters` (boolean; default `false` [api]); `connect_to_logistic_network`: in use of `logistic when`; `input_networks`: `networks` (networks; both [api]); `logistic_condition`: `logistic when` (condition; blank); `output_networks`: `output-networks` (networks; both [api]) |
| `LogisticContainer` | `infinity-container`, `logistic-container` | `circuit_condition`: `when` (condition; blank); `circuit_condition_enabled`: in use of `when`; `empty_slots_signal`: `empty-slots-signal` (signal; default `default_empty_slots_signal` [data]); `input_networks`: `networks` (networks; both [api]); `output_networks`: `output-networks` (networks; both [api]); `read_contents`: `read-contents` (boolean; default `true` [api]); `read_empty_slots`: `read-empty-slots` (boolean; default `false` [api]); `set_requests`: `set-requests` (boolean; default `false` [api]) |
| `MiningDrill` | `mining-drill` | `circuit_condition`: `when` (condition; blank); `circuit_enabled`: in use of `when`; `circuit_read_resources`: in use of `read-resources`; `circuit_resource_read_mode`: `read-resources` (enum; default `this-miner` [game]; this-miner 0, entire-patch 1 [game]); `connect_to_logistic_network`: in use of `logistic when`; `input_networks`: `networks` (networks; both [api]); `logistic_condition`: `logistic when` (condition; blank); `output_networks`: `output-networks` (networks; both [api]) |
| `ProxyContainer` | `proxy-container` | `empty_slots_signal`: `empty-slots-signal` (signal; default `default_empty_slots_signal` [data]); `output_networks`: `output-networks` (networks; both [api]); `read_contents`: `read-contents` (boolean; default `true` [api]); `read_empty_slots`: `read-empty-slots` (boolean; default `false` [api]) |
| `Pump` | `pump` | `circuit_condition`: `when` (condition; blank); `circuit_enabled`: in use of `when`; `connect_to_logistic_network`: in use of `logistic when`; `input_networks`: `networks` (networks; both [api]); `logistic_condition`: `logistic when` (condition; blank); `set_filter`: `set-filter` (boolean; default `false` [api]) |
| `Radar` | `radar` | `mode`: `mode` (enum; default `surface` [api]; surface 1, universe 2 [game]); `universe_channel`: `channel` (signal; no default) |
| `RailSignalBase` | `rail-chain-signal`, `rail-signal` | `blue_output_signal`: `blue-signal` (signal; default `default_blue_output_signal` [data]); `circuit_close_signal`: in use of `close when`; `circuit_condition`: `close when` (condition; blank); `circuit_read_signal`: `read-signal` (boolean; default `true` [game]); `green_output_signal`: `green-signal` (signal; default `default_green_output_signal` [data]); `input_networks`: `networks` (networks; both [api]); `orange_output_signal`: `orange-signal` (signal; default `default_orange_output_signal` [data]); `output_networks`: `output-networks` (networks; both [api]); `red_output_signal`: `red-signal` (signal; default `default_red_output_signal` [data]) |
| `Reactor` | `reactor` | `output_networks`: `output-networks` (networks; both [api]); `read_fuel`: `read-fuel` (boolean; default `false` [api]); `read_temperature`: `read-temperature` (boolean; default `false` [api]); `temperature_signal`: `temperature-signal` (signal; default `default_temperature_signal` [data]) |
| `Roboport` | `roboport` | `available_construction_output_signal`: `available-construction-signal` (signal; default `default_available_construction_output_signal` [data]); `available_logistic_output_signal`: `available-logistic-signal` (signal; default `default_available_logistic_output_signal` [data]); `output_networks`: `output-networks` (networks; both [api]); `read_items_mode`: `read-items` (enum; default `logistics` [game]; none 0, logistics 1, missing-requests 2 [game]); `read_robot_stats`: `read-robot-stats` (boolean; default `false` [game]); `roboport_count_output_signal`: `roboport-count-signal` (signal; default `default_roboport_count_output_signal` [data]); `total_construction_output_signal`: `total-construction-signal` (signal; default `default_total_construction_output_signal` [data]); `total_logistic_output_signal`: `total-logistic-signal` (signal; default `default_total_logistic_output_signal` [data]) |
| `RocketSilo` | `rocket-silo` | `launched_signal`: `launched-signal` (signal; default `default_launched_signal` [data]); `output_networks`: `output-networks` (networks; both [api]); `read_items_mode`: `read-items` (enum; default `logistic-inventory` [api]; none 0, logistic-inventory 1, orbital-requests 2 [game]); `read_launched`: `read-launched` (boolean; default `false` [api]) |
| `SingleFluidBox` | `infinity-pipe` (assumed), `pipe`, `pipe-to-ground`, `storage-tank` | `circuit_mode_of_operation`: `read-contents` (enum; default `contents` [api]; none 0, contents 1, segment-contents 2 [game]); `output_networks`: `output-networks` (networks; both [api]); `read_temperature`: `read-temperature` (boolean; default `false` [api]); `temperature_signal`: `temperature-signal` (signal; default `default_fluid_temperature_signal` [data]) |
| `SpacePlatformHub` | `space-platform-hub` | `damage_taken_signal`: `damage-taken-signal` (signal; default `default_damage_taken_signal` [data]); `empty_slots_signal`: `empty-slots-signal` (signal; default `default_empty_slots_signal` [data]); `input_networks`: `networks` (networks; both [api]); `output_networks`: `output-networks` (networks; both [api]); `read_contents`: `read-contents` (boolean; default `true` [api]); `read_damage_taken`: `read-damage-taken` (boolean; default `false` [api]); `read_empty_slots`: `read-empty-slots` (boolean; default `false` [api]); `read_moving_from`: `read-moving-from` (boolean; default `false` [api]); `read_moving_to`: `read-moving-to` (boolean; default `false` [api]); `read_speed`: `read-speed` (boolean; default `false` [api]); `send_to_platform`: `send-to-platform` (boolean; default `true` [api]); `set_requests`: `set-requests` (boolean; default `false` [api]); `speed_signal`: `speed-signal` (signal; default `default_speed_signal` [data]) |
| `Splitter` | `splitter` | `input_left_condition`: `input-left when` (condition; in a blueprint without it `signal-I < 0` [game]); `input_networks`: `networks` (networks; both [api]); `input_right_condition`: `input-right when` (condition; in a blueprint without it `signal-I > 0` [game]); `output_left_condition`: `output-left when` (condition; in a blueprint without it `signal-O < 0` [game]); `output_right_condition`: `output-right when` (condition; in a blueprint without it `signal-O > 0` [game]); `set_filter`: `set-filter` (boolean; default `false` [api]); `set_input_side`: in use of `input-left when`, `input-right when`; `set_output_side`: in use of `output-left when`, `output-right when` |
| `TrainStop` | `train-stop` | `circuit_condition`: `when` (condition; blank); `circuit_enabled`: in use of `when`; `connect_to_logistic_network`: in use of `logistic when`; `input_networks`: `networks` (networks; both [api]); `logistic_condition`: `logistic when` (condition; blank); `output_networks`: `output-networks` (networks; both [api]); `priority_signal`: `priority-signal` (signal; default `default_priority_signal` [data]); `read_from_train`: `read-from-train` (boolean; default `false` [api]); `read_stopped_train`: `read-stopped-train` (boolean; default `false` [api]); `read_trains_count`: `read-trains-count` (boolean; default `false` [api]); `send_to_train`: `send-to-train` (boolean; default `true` [api]); `set_priority`: `set-priority` (boolean; default `false` [api]); `set_trains_limit`: `set-trains-limit` (boolean; default `false` [api]); `train_stopped_signal`: `train-stopped-signal` (signal; default `default_train_stopped_signal` [data]); `trains_count_signal`: `trains-count-signal` (signal; default `default_trains_count_signal` [data]); `trains_limit_signal`: `trains-limit-signal` (signal; default `default_trains_limit_signal` [data]) |
| `TransportBelt` | `transport-belt` | `circuit_condition`: `when` (condition; blank); `circuit_contents_read_mode`: `read-contents` (enum; default `none` [game]; pulse 0, hold 1, entire-belt-hold 2 [game]); `circuit_enabled`: in use of `when`; `circuit_read_hand_contents`: in use of `read-contents`; `connect_to_logistic_network`: in use of `logistic when`; `input_networks`: `networks` (networks; both [api]); `logistic_condition`: `logistic when` (condition; blank); `output_networks`: `output-networks` (networks; both [api]) |
| `Turret` | `ammo-turret`, `electric-turret`, `fluid-turret` | `circuit_condition`: `when` (condition; blank); `circuit_enabled`: in use of `when`; `connect_to_logistic_network`: in use of `logistic when`; `ignore_unlisted_targets_condition`: `ignore-unlisted when` (condition; blank); `input_networks`: `networks` (networks; both [api]); `logistic_condition`: `logistic when` (condition; blank); `output_networks`: `output-networks` (networks; both [api]); `read_ammo`: `read-ammo` (boolean; default `false` [api]); `set_ignore_unlisted_targets`: in use of `ignore-unlisted when`; `set_priority_list`: `set-priority-list` (boolean; default `false` [api]) |
| `Wall` | `wall` | `circuit_condition`: `open-gate when` (condition; blank, its flag on [game]); `circuit_open_gate`: in use of `open-gate when`; `circuit_read_sensor`: `read-sensor` (boolean; default `false` [game]); `input_networks`: `networks` (networks; both [api]); `output_networks`: `output-networks` (networks; both [api]); `output_signal`: `output-signal` (signal; default `default_output_signal` [data]) |
<!-- control-behaviors:end -->

Of the 92 fields 90 are modelled (77 setting words, some of them the same word for fields of different behaviours). The words are in `docs/dsl.md`.

### 14.3 What is kept only

Everything a blueprint says about an entity that is not in 14.2 is kept verbatim per entity (`blueprintData`, the property `blueprint-data` of the language) and written back on export with the modelled fields over it. That is:

| Kept | Where |
| --- | --- |
| `parameters` of a display panel (its messages: `condition`, `icon`, `text`) and `conditions` of a lab (research conditions: `name`, `count`, `condition`) | the two structured fields of a control behaviour without a field type of the table. The editor shows and simulates neither |
| `blue_output_signal` of a rail signal | a field of the shared concept that only the chain signal uses (13.5) |
| Fields of a control behaviour the reference does not know | a later game version, a mod, the 1.1 names in a string of the 2.0 pre-release |
| Every other field of the entity record: `recipe`, `recipe_quality`, `filters`, `use_filters`, `filter_mode`, `bar`, `request_filters`, `items`, `quality`, `mirror`, `tags`, `station`, `manual_trains_limit`, `priority`, `color`, `switch_state`, `type` of a loader, `text` and `icon` of a display panel, `infinity_settings`, `link_id`, `rail_layer`, `drop_position`, `pickup_position`, `override_stack_size`, `spoil_priority`, `fluid_filter`, `priority-list`, `player_description` | [api: the groups of `BlueprintEntity`]. The reference has `player_description` on the four combinators only, so on a generic entity it is not the editor's description |
| A `direction` that is no quarter turn on a prototype of eight or sixteen directions (a flamethrower turret, a rail signal) | 13.4. The editor faces the entity the nearest quarter turn and reports it on import. A direction on a prototype that does not turn is not kept: the game drops it [game] |

Not kept: `entity_number`, `name` and `position` (the editor has them), `quality: "normal"`, wires inside an entity record (the 1.1 format), and of the modelled fields what means nothing where it stands: a condition while its boolean is off, a mode while its checkbox is off.

### 14.4 What the editor does with the settings

The editor does not simulate what an entity does: a generic entity sends nothing. It evaluates the circuit conditions (every condition of 14.2 but `logistic_condition`) each tick on the networks `input_networks` selects and shows whether they hold; rules G-* of `packages/simulation/CONFORMANCE.md`.
The radar joins networks without wires: [api: `LuaRadarControlBehavior.universe_channel` "Radars on the same force with the same channel in universe mode are connected to each other with hidden radar wires"]; that all radars of one surface in surface mode share one red and one green network is [changelog 2.0: "Radar can now be connected to circuit network, allowing to wirelessly transmit a single channel of red and green signals on each planet/surface"]; that a circuit of the editor is one surface and one force, and that the sharing adds no tick and needs no power, is [unverified] (fixture F-28).

### 14.5 What fixture F-01 settled, and what is open

Settled [game: F-01]:

- The numbers of the seven enums (14.1). The roboport's `read_items_mode` is a number in a blueprint, as its class says, not the boolean of the blueprint concept; the importer reads both.
- The defaults: all as the table had them but `read_ammo` of the artillery turret and `include_hands` of the asteroid collector, which are on (the reference states `false` for the second). The folded checkboxes are off for the inserter and the belt and on for the mining drill (this miner).
- Two defaults are not blank: the open-gate flag of a wall is on, and the four conditions of a splitter are set (12.2). The settings table has them as `flagOnByDefault` and `gameDefault` of the condition. A wall whose blueprint has the flag on without a first signal has `open-gate when unset`; one whose blueprint does not name the flag has no condition in the editor.
- The game writes no setting at its default and reads a missing field as its default; an entity whose settings are all at their defaults has no `control_behavior` (seen without a wire; a display panel has its empty message there).
- An entity without a circuit wire keeps its control behaviour in a blueprint and through a build (lamps and speakers of the samples; the generic samples are all wired).
- `infinity-pipe` and `linked-container` have the behaviours of 14.1.
- Directions (13.4): an entity of two, four, eight or sixteen directions has the last one of them before the direction it is given. The gun, laser, rocket and tesla turrets have a direction as entities (`LuaEntity.direction` follows what they are created with) and none in a blueprint.
- The names of the attributes of the runtime control behaviours (`packages/blueprints/test/gameNames.ts`): the probe set and read every one of them.
- A wall has its control behaviour only next to a gate; the editor has no gates (12.2).
- The game has no value for a few settings on some prototypes of a type: `output_networks` on a heat exchanger and on the laser and tesla turrets, `input_networks` on an infinity chest; and it does not keep `read_fuel` where nothing burns (assembling machine 2, electric furnace, lab). The settings table is per type and offers them all the same.

Open:

- Whether the game takes the kept fields (14.3) back unchanged when modelled fields next to them change: no sample has kept data.
- `read_fuel` of a lab: no lab of the game burns fuel, so the game has nothing to say about the field.
- A control behaviour of a generic entity without a wire through a build: settled by fixture F-29. The entity keeps it, with flag and condition, and the game writes it into a blueprint again; a wall and a speaker whose blueprint says nothing but the default (flag on, no condition) are built without one.

## 15. Which mod created a prototype (2026-11-15)

For data read from a game with mods the editor has to know which mod a signal or an entity comes from. `data.raw` does not say; the game does at run time. "[runtime dump]" here is `face-runtime-dump.json` of all eight module sets from `make catalog` on 2026-11-15, whose scenario asks for every prototype it lists; the type argument was tried out in a scenario of its own on the same day.

| Fact | Detail | Source |
| --- | --- | --- |
| The call | `prototypes.get_history(type, name)` returns `{ created = "<mod name>", changed = { "<mod name>", ... } }`: the mod that created the prototype and the mods that changed it, in that order | [api: LuaPrototypes.get_history, PrototypeHistory] |
| `type` | the prototype's own type, which is `LuaPrototypeBase.type`: `ammo` for the item `firearm-magazine`, `lamp` for `small-lamp`, `planet` for `nauvis`, `virtual-signal`, `recipe`, `fluid`, `quality`, `asteroid-chunk`, `item-group`, `item-subgroup`. The kind a prototype is listed under is refused for the others: `("item", "firearm-magazine")`, `("entity", "small-lamp")` and `("space-location", "nauvis")` raise "No history for the given key" | [runtime dump] |
| A prototype that is not there | raises the same error; the scenario calls through `pcall` and leaves `created` out | [runtime dump] |
| `core` | is a creator although it is no entry of `script.active_mods`: the eight placeholders `item-unknown`, `fluid-unknown`, `signal-unknown`, `entity-unknown`, `recipe-unknown`, `space-location-unknown`, `asteroid-chunk-unknown` and `quality-unknown`. The quality `normal` is created by `base` and changed by `quality` | [runtime dump] |
| Every prototype has a creator | all 2400 signals, groups and subgroups of the eight sets, and the creator of a prototype is the same in every set that has it | [runtime dump] |

The creator is not the module set a prototype exists with, which is what the standard catalog's `modules` say. Of the 2400 records 2297 name their creator as their `modules`, and 8 more do once `core` counts as `base`. The others: the recycler creates the recycling recipe of every item it finds, so 89 recipes created by `recycler` exist only with Space Age (84), Quality (3) or Elevated Rails (2); `base` creates the barrel items and recipes of every fluid, so the 6 of Space Age's fluoroketone are created by `base`; and the satellite with its two recipes, created by `base` and `recycler`, is gone with Space Age (`removedBy`), which a creator cannot say. In the entity table the 98 creators are the table's modules [runtime dump against `packages/catalog/data/catalog-2.1.24.json` and `packages/model/data/entities-2.1.24.json`].

`changed` of the same history names the mods that changed a prototype after its creation, in order; without a change it is an empty list. In the full set 57 recipes have one (51 without Quality, 5 with Quality and without Space Age, none in the four smaller sets): 48 recipes of `base` changed by Space Age alone, 3 of `quality` and 1 of `recycler` changed by Space Age, 3 of `base` changed by Quality and 2 by both (the oil recipes). The history does not say what was changed. Ten of the 57 have an item of the changing mod among their ingredients (`artillery-shell` with `calcite` and `tungsten-plate`, `artillery-turret`, `artillery-wagon`, `cliff-explosives`, `spidertron`, `personal-roboport-mk2-equipment` and the four tier 3 modules); all ten exist without Space Age, with other ingredients [runtime dump of 2026-11-15, which has `ingredients`, `products` and `changed` for every recipe].

How the editor uses this for data read from one game (`tools/catalog/lib/single.ts`; the standard catalog has its exact attribution and needs none of it). A recipe names, after its creator, the modules of its ingredients and products, but not a mod in its `changed`: so the recycling recipe of a Space Age item needs Space Age, and `artillery-shell` of `base` does not. An item names what every producing recipe of its own creator needs: the two fluoroketone barrels, which `base` creates. With both rules, of the 95 records above (89 of `recycler`, 6 of `base`) all 6 of `base` and 79 of `recycler` have the modules the standard catalog names, in each of the eight sets. The other ten are the recycling recipes of the ten items above: the recycler derives them from the changed recipe, their own history is empty, and their products are Space Age's, so they name Space Age although they exist without it with other products. With the creator alone none of the 95 agrees; with the parts and without regard to `changed`, ten recipes of `base` and `quality` would wrongly need Space Age as well.

A module also moves what another created: with the five modules loaded, 43 signals created by `base` are in item subgroups that Space Age created (`rocket-silo`, `cargo-landing-pad`, `rocket-part` among them), and the subgroup `space-related` of `base` is in a group of Space Age [game: read by the app on 2026-11-15]. The same holds for mods, more so: in one game with 44 mods, 1467 signals created by the game's own modules were in subgroups of mods; the recycler alone created 1906 signals there against 317 in the standard game, a recycling recipe for every item of a mod.

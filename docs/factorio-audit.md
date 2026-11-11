# Factorio 2.1.24 circuit audit and support matrix

Audit date: 2026-11-11. Scope: constant, arithmetic, decider and selector combinators, lamps, circuit wires, signals and the blueprint string format.
This document drives the model types, the DSL, the blueprint importer/exporter and the simulator of "face".

## 0. How to read this document

Every statement carries a provenance tag:

| Tag | Meaning |
| --- | --- |
| [api] | `/Users/henning/factorio/factorio-data/runtime-api.json` (machine-readable runtime API) |
| [data: file] | Lua prototypes, locale or embedded blueprint strings under `factorio-data` / `factorio-install`; path is relative to that root |
| [changelog] | `factorio-data/changelog.txt` (identical copy in `factorio-install`), version quoted |
| [web: url] | Web lookup on 2026-11-11 |
| [unverified] | From memory or inference. Must be confirmed by a game-driven conformance fixture before the simulator relies on it |

Rules used when tags conflict: [data] and [changelog] beat [api] (the API file is one patch older, see 1.1); [api] beats [web]; the wiki is frequently stale for 2.1.
A combined tag such as "[api] [unverified]" means the field exists per the API but the described behavior is not confirmed.

The game executable was not run for this audit. No statement here is validated against a running game.

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

Complete list across core, base, space-age, quality, recycler, elevated-rails. There is exactly one prototype per type; no module adds variants or copies [data: grep over all six modules].

| Name | Type | Module | Collision box | Tile size (north) | Rotatable | Power | Wire reach | Provenance |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `constant-combinator` | constant-combinator | base | +-0.35 x +-0.35 | 1 x 1 | 4-way sprites | none | 9 | [data: base/prototypes/entity/circuit-network.lua, combinator-pictures.lua] |
| `arithmetic-combinator` | arithmetic-combinator | base | +-0.35 x +-0.65 | 1 wide x 2 tall | 4-way | electric, primary-input, 1 kW | 9 | same |
| `decider-combinator` | decider-combinator | base | +-0.35 x +-0.65 | 1 wide x 2 tall | 4-way | electric, primary-input, 1 kW | 9 | same |
| `selector-combinator` | selector-combinator | base | +-0.35 x +-0.65 | 1 wide x 2 tall | 4-way | electric, primary-input, 1 kW | 9 | same |
| `small-lamp` | lamp | base | +-0.15 x +-0.15 | 1 x 1 | no | electric, usage priority `lamp`, 5 kW | 9 | [data: base/prototypes/entity/entities.lua] |

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
| `output_signal` | SignalID | none | no output when absent [unverified] | [api] |

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
| Plain JSON | since 2.0 the game also imports uncompressed JSON text directly | [web: same] |

Runtime helpers: `LuaItemStack.export_stack()` / `import_stack(data)` produce and consume the full string; `helpers.encode_string` "Deflates and base64 encodes", `helpers.decode_string`
"Base64 decodes and inflates" (without the version character [unverified]); `helpers.table_to_json` / `json_to_table` [api].
fflate (already installed) covers zlib inflate/deflate for the importer and exporter.

### 5.2 Root objects

The root object has exactly one key [web: https://wiki.factorio.com/Blueprint_string_format]:

| Root key | Content | Provenance |
| --- | --- | --- |
| `blueprint` | a single blueprint | [web] [data: all 89 shipped strings] |
| `blueprint_book` | `item` (`"blueprint-book"`), `label`, `label_color`, `description`, `icons`, `blueprints` (array of objects with a 0-based `index` and one item key such as `blueprint`), `active_index` (0-based), `version` | [web]; nesting of books and planners inside books [unverified] |
| `upgrade_planner`, `deconstruction_planner` | other exportable items | [api: export_stack lists blueprint, blueprint-book, deconstruction-planner, upgrade-planner, item-with-tags]; key names [unverified] |

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
| 1x1 entity (constant combinator, lamp) | both coordinates end in .5 | [data: shipped lamps and constant combinator] |
| 2x1 combinator facing north or south (0, 8) | x ends in .5, y is an integer (center lies on the tile boundary) | [data: shipped selector at (6.5, -21), direction 8] |
| 2x1 combinator facing east or west (4, 12) | x is an integer, y ends in .5 | [unverified], follows from rotation |
| Tiles occupied, north-facing, center (x, y) | output half: tile containing (x, y - 0.5); input half: tile containing (x, y + 0.5) | [data: connection bounding boxes, see 3.1] |
| `direction` | 16-way in 2.x: north 0, northnortheast 1, northeast 2, eastnortheast 3, east 4, ..., south 8, ..., west 12, ..., northnorthwest 15; omitted when north | [api: defines.direction member order]; values 4, 8, 12 dominate shipped strings [data] |
| Combinator directions | only 0, 4, 8, 12 are meaningful (4-way sprites) | [data: combinator-pictures.lua] |
| Rotation semantics | direction 0: output north, input south. 4: output east. 8: output south. 12: output west | [data: bounding boxes] for 0; others [unverified] |
| `snap-to-grid` etc. | blueprint-level, do not change entity coordinates' meaning | [web] |

The exporter must emit positions that respect tile alignment, otherwise the game re-snaps or rejects; `set_blueprint_entities` has a `fix_positions` option at runtime [api].
Wire reach is 9 tiles for all five entities [data: core/lualib/circuit-connector-sprites.lua]; a layout generator must keep wired entities within reach (the game drops or refuses over-long wires [unverified]).

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
| Empty condition list: result | [unverified] |
| A condition with blank `first_signal` | [unverified] |

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
| "Enable if: Turn this entity on only when the condition is true." Applies only when `circuit_enabled` is true and a wire is connected | [data: core.cfg]; gating by `circuit_enabled` [api default false] [unverified] |
| Default condition (blank signal `<` 0) is false | [api defaults]; [unverified] |
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
| F-01 | Export one of each entity type with non-default settings via `export_stack()`; record the exact JSON | selector `control_behavior` shape (flat versus `selector_conditions`), default omission, key order, `first_signal_networks` shape, `color_mode` numbers, build number in `version` |
| F-02 | `print` every `defines.wire_connector_id`, `defines.wire_type`, `defines.direction`, `defines.control_behavior.lamp.color_mode` value | 4.2, 3.8 numeric values |
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
| F-23 | Import round-trip: face export -> `import_stack` -> `export_stack` for each entity type, including 2x1 entities in all four directions and self-wires | exporter correctness, position rules, wire normalization |

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

### 9.1 Blueprint level

| Item | Proposed status | Reason when not supported |
| --- | --- | --- |
| Envelope `0` + base64 + zlib, plain JSON input | supported | |
| Root `blueprint` | supported | |
| Root `blueprint_book` | unsupported-with-diagnostic (offer to pick one contained blueprint) | A book is a container; the editor works on one circuit |
| Root `upgrade_planner`, `deconstruction_planner` | unsupported-with-diagnostic | Not circuits |
| `version` major 2 (2.0.x, 2.1.x) | supported; exporter writes 2.1.24.0 (pending F-01) | |
| `version` major 1 (1.1 and 1.2.x pre-release) | unsupported-with-diagnostic | Different wire and control-behavior format; converter deferred |
| `version` newer than 2.1.24 | supported with a warning | Unknown fields may appear |
| `label`, `description` | supported | |
| `label_color`, `icons`, `snap-to-grid`, `absolute-snapping`, `position-relative-to-grid` | preserved-on-roundtrip-only | No effect on circuit behavior |
| `tiles`, `schedules`, `stock_connections`, `parameters`, `branch_version`, unknown root keys | preserved-on-roundtrip-only | Out of scope; dropping them would damage user blueprints |
| Blueprint parameters (`parameter-N` signals, parametrised numbers) | preserved-on-roundtrip-only; simulated as ordinary signals with a warning | Parameter substitution happens at build time in game |
| Entities other than the five types | preserved-on-roundtrip-only with a diagnostic; not simulated (their connectors emit nothing) | Out of scope; keeping them lets mixed blueprints survive an edit |
| Wires with connector 1..4 between supported entities | supported | |
| Wires touching a preserved entity; copper wires (5, 6) | preserved-on-roundtrip-only with a diagnostic | Other end is not simulated |
| Wires referencing a missing entity number or an invalid connector for the entity type | unsupported-with-diagnostic (wire dropped) | Malformed input |

### 9.2 Common entity fields

| Entity | Setting | Proposed status | Reason when not supported |
| --- | --- | --- | --- |
| all five | `entity_number`, `name`, `position` | supported | |
| combinators | `direction` 0, 4, 8, 12 | supported | |
| combinators | `direction` other values | unsupported-with-diagnostic (snap to nearest of four) | Not producible in game |
| small-lamp | `direction` | preserved-on-roundtrip-only | Lamp is not rotatable |
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
| `max_count`, `minimum_delivery_count`, `import_from`, `request_from`, `trash_not_requested` | preserved-on-roundtrip-only | Logistic-request fields without meaning for a constant combinator |
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
| everything / anything in any slot; each output without each operand | unsupported-with-diagnostic | Invalid configuration |

### 9.5 Decider combinator

| Setting | Proposed status | Reason when not supported |
| --- | --- | --- |
| `conditions[]` with `first_signal`, `second_signal`, `constant`, `comparator` (all six, both spellings) | supported | |
| `compare_type` and / or with AND precedence | supported, pending F-10 | |
| Per-operand `first_signal_networks`, `second_signal_networks` | supported | |
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

## 10. Open questions for the coordinator

1. Selector `control_behavior` wire format (flat per API versus `selector_conditions` wrapper seen in game data) blocks the exporter until F-01 is run.
2. Signal order for anything outputs and selector ties needs the data dump to carry group order, subgroup order, `order` strings and quality levels, plus F-13 / F-16 to confirm the comparator.
3. Rocket capacity needs runtime item weights (`LuaItemPrototype` at runtime), which a `--dump-data-raw` style dump does not contain. Either extend the dump task or keep the mode non-simulated.
4. Whether 1.x strings should be converted rather than rejected: the game still imports them, so users may hold such strings.
5. The DSL needs a way to say "group" as OR-of-ANDs only; a richer boolean syntax must be normalized or rejected.

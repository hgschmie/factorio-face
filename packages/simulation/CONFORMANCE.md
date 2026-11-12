# @face/simulation: conformance status

The engine implements the reference model of `docs/factorio-audit.md` section 6 for Factorio 2.1.24.
**Nothing in this package has been validated against the running game.** No fixture has provenance `game` yet.

Status values used below:

- **documented**: the behavior follows a statement in the audit that carries a `[data]`, `[api]`, `[changelog]` or `[web]` tag. Still not game-validated.
- **assumed**: the audit tags the behavior `[unverified]` or leaves it open; the engine makes the choice described here (the audit's stated expectation where it gives one).

Every assumed rule has one place in the source and at least one test whose name carries the audit fixture id (`F-nn assumption: ...`).
When a game fixture disagrees: change the place named in the table, update the test, flip the status to `game`.

## Engine model

- **Two-phase tick.** State is the output held by every arithmetic, decider and selector combinator. The content of a network at tick t is the int32-wrapping sum of the outputs held by its emitters.
  `step()` lets every combinator read the content of tick t, then commits all new outputs at once; they are on the networks at tick t + 1. Evaluation order has no effect.
- **Tick 0 / reset state.** After `createSimulation` and after `reset()`: tick is 0, every arithmetic, decider and selector output is empty, constant combinators emit their configured signals,
  random generators are re-seeded, runtime notes are cleared. A snapshot of tick t shows the network content of tick t, what every entity reads and holds at tick t, and lamp states computed from the content of tick t.
- **Clock.** The selector's time mode reads `environment.time.startTick + tick`. The random mode draws on simulation ticks (since reset) and is seeded per entity from `options.seed` and the entity id.
- **Scope limits.** Every entity is powered and not frozen; there is no day/night cycle; logistic groups are not shared between combinators; a circuit is immutable while it runs
  (an edit means `compile` again; `semanticFingerprint` tells whether the running simulation must be reset). Fixture F-04 (editing a constant combinator at a known tick) therefore has no counterpart in the engine yet.
- **Signal order.** `SimulationEnvironment.compareSignals` supplies the order used by anything outputs, selector ties and snapshot lists; remaining ties are broken by signal key.
  The default environment orders by `kind:name`, then quality level. The catalog adapter is expected to compare group order, subgroup order, `order` string, name and quality level (audit open question 2, pending F-13 / F-16).
- **History memory bound.** `History` keeps at most `capacity` snapshots (default 600). Snapshots share every part that did not change between ticks, so one tick costs
  O(changed networks + changed entities + their signal entries) plus two containers of O(networks + entities) references if anything changed; an idle tick costs one small object.
  Worst case: `capacity * (networks + entities + all signal entries)` small objects.

## Assumptions and documented rules

Columns: rule id (also in source comments), chosen behavior, audit section, fixture that will decide it, status, place in the source.

### Tick model and networks

| Rule | Chosen behavior | Audit | Fixture | Status | Source |
| --- | --- | --- | --- | --- | --- |
| T-LATENCY | Arithmetic and decider outputs appear on the network one tick after the input they were computed from | 6.1 | F-03 | documented | `engine.ts` `advance` |
| T-SELECTOR | The selector combinator has the same one-tick latency | 6.1 | F-03 | assumed | `engine.ts` `advance` |
| T-SIMULTANEOUS | All combinators read tick t and commit together; the result does not depend on entity order | 6.1 | F-03 | assumed | `engine.ts` `advance` |
| T-CONSTANT | Constant combinator signals are on the network without combinator delay, from tick 0 | 6.1 | F-03, F-04 | assumed | `engine.ts` `reset` |
| T-RESET | Tick 0 starts with all combinator outputs empty; a self-wired `A + 1 -> A` shows 1 at tick 1 | 6.1 | F-05 | assumed | `engine.ts` `reset` |
| T-LAMP | A lamp evaluates condition and color from the current tick's content and emits nothing | 6.1 | F-21 | assumed | `engine.ts` `snapshot`, `lamp.ts` |
| T-POWER | Everything is always powered and not frozen | 6.1 | none | assumed | not modeled |
| N-INT32 | Values are int32; sums over the emitters of a network wrap | 6.2 | F-05 | documented | `engine.ts` `sum` |
| N-COLORS | Same-colored wires form one network; red and green are separate; a combinator output goes to both colors | 6.2 | F-07 | documented | `compile.ts` |
| N-REDGREEN | An input with both networks selected reads the wrapping sum of red and green | 6.2 | F-07 | assumed (wrap) | `signals.ts` `sumMaps` |
| N-ZERO | A signal whose sum is 0 does not exist: red +3 and green -3 hide it from each, anything, everything, count and select | 6.2 | F-07 | assumed | `signals.ts` `sumMaps` |
| N-NONE | A network selection with neither color (the game allows unchecking both) reads nothing: a signal is 0, wildcards and each find no signals, a copied output count is 0, a lamp sees no condition or color signal | 3.3 | none | assumed | `signals.ts` `InputView.select` |
| N-DOUBLE | Wiring both output colors of one combinator into one input doubles the value there | 6.2 | none | assumed | follows from N-COLORS, N-REDGREEN |

### Arithmetic combinator

| Rule | Chosen behavior | Audit | Fixture | Status | Source |
| --- | --- | --- | --- | --- | --- |
| A-ADD | `+`, `-` wrap to int32 | 6.3 | F-06 | documented | `int32.ts` `add`, `subtract` |
| A-MUL | `*` wraps like addition (`65536 * 65536 = 0`, `-2^31 * -1 = -2^31`) | 6.3 | F-06 | assumed | `int32.ts` `multiply` |
| A-DIV | `/` truncates toward zero | 6.3 | F-06 | documented | `int32.ts` `divide` |
| A-DIV0 | `x / 0 = 0` | 6.3 | F-06 | assumed | `int32.ts` `divide` |
| A-DIVMIN | `-2^31 / -1 = -2^31` | 6.3 | F-06 | assumed | `int32.ts` `divide` |
| A-MOD | `%` takes the sign of the left operand | 6.3 | F-06 | documented | `int32.ts` `remainder` |
| A-MOD0 | `x % 0 = 0` | 6.3 | F-06 | assumed | `int32.ts` `remainder` |
| A-MODMIN | `-2^31 % -1 = 0` | 6.3 | F-06 | assumed | `int32.ts` `remainder` |
| A-POW | Integer power with int32 wrap at every multiplication; `0 ^ 0 = 1`, `2 ^ 31 = -2^31`, `2 ^ 32 = 0` | 6.3 | F-06 | assumed | `int32.ts` `power` |
| A-POWNEG | A negative exponent yields 0 for every base (alternative in the audit: truncated real result) | 6.3 | F-06 | assumed | `int32.ts` `power` |
| A-SHIFT | Shift amounts are masked to five bits: 32 acts like 0, 33 like 1, -1 like 31 | 6.3 | F-06 | assumed | `int32.ts` `shiftAmount` |
| A-SHL, A-SHR | `<<` fills with zeros, `>>` preserves the sign | 6.3 | F-06 | documented | `int32.ts` |
| A-BITS | `AND`, `OR`, `XOR` act on the 32-bit two's-complement pattern | 6.3 | F-06 | assumed | `int32.ts` |
| A-EACH | each -> each applies the operation per input signal; each -> specific adds the results; a result of 0 is not emitted | 6.3 | F-06 | documented | `arithmetic.ts` |
| A-EACH-SUM | The each -> specific sum wraps | 6.3 | F-06 | assumed | `signals.ts` `Accumulator` |
| A-EACH-SCOPE | each iterates the non-zero signals of the networks selected for that operand, keeping kind and quality | 6.3 | F-07 | assumed | `arithmetic.ts` |
| A-EACH-EACH | each op each: union of both operands' signals, a signal missing on one side reads as 0 | 6.3 | F-08 | assumed | `arithmetic.ts` |
| A-EACH-SPECIFIC | In `each op S` the signal S reads normally and is not removed from the iteration | 6.3 | F-09 | assumed | `rules.ts` `eachExcludesSpecificOperand` |
| A-NOOUT | Without an output signal nothing is emitted | 3.5 | none | assumed | `arithmetic.ts` |
| A-INVALID | everything / anything in any slot, or an each output without an each operand: the combinator is invalid and emits nothing | 2.4, 6.3 | none | assumed (everything/anything), documented (each output) | `validate.ts` |

### Decider combinator

| Rule | Chosen behavior | Audit | Fixture | Status | Source |
| --- | --- | --- | --- | --- | --- |
| D-PRECEDENCE | The flat list is an OR of AND groups; a group starts at every condition joined with `or` | 6.4 | F-10 | documented | `decider.ts` `groupConditions` |
| D-FIRSTJOIN | The join of the first condition is ignored | 3.6 | F-10 | assumed | `decider.ts` `groupConditions` |
| D-NETWORKS | Each operand reads its own network selection; both networks are summed | 6.4 | F-10 | documented | `decider.ts` `conditionHolds` |
| D-EMPTY | An empty condition list is false: only else outputs fire | 6.4 | F-15 | assumed | `rules.ts` `emptyConditionListResult` |
| D-BLANK | A condition without a first signal is false | 6.4 | F-15 | assumed | `rules.ts` `blankFirstSignalResult` |
| D-EVERYTHING | everything: all non-zero signals on the operand's networks pass; true without input | 6.4 | F-11 | documented | `decider.ts` `conditionHolds` |
| D-ANYTHING | anything: at least one signal passes; false without input | 6.4 | F-11 | documented | `decider.ts` `conditionHolds` |
| D-RHS-EXCLUDED | In `everything / anything cmp S` the right-hand signal S is excluded from the checked set (wiki claim) | 6.4 | F-11 | assumed | `rules.ts` `wildcardExcludesRightHandSignal` |
| D-ANY-SAME | Several anything conditions in one AND group must hold for the same signal; everything conditions are independent | 6.4 | F-11 | assumed | `decider.ts` `planPlain` |
| D-RHS-WILDCARD | everything / anything as right-hand signal: invalid, the combinator emits nothing | 2.4 | F-11 | assumed | `validate.ts` |
| D-EACH-EXPR | With each in any condition the whole AND/OR expression is evaluated once per signal; passing signals activate the outputs, failing ones the else outputs | 6.4 | F-12 | assumed (interpretation with OR groups) | `decider.ts` `planEach` |
| D-EACH-SET | each iterates the union of the non-zero signals on the networks of every each operand; without any such signal nothing is emitted | 6.4 | F-12 | assumed | `decider.ts` `planEach` |
| D-BOUND-ZERO | A bound each / anything signal that is absent on a condition's networks reads as 0 and is compared normally | 6.4 | F-12 | assumed | `decider.ts` `conditionHolds` |
| D-EACH-RHS | each on the right-hand side is the bound signal's value on that operand's networks | 6.4 | F-12 | assumed | `decider.ts` `conditionHolds` |
| D-EACH-MIXED | anything / everything next to each are evaluated on their own, not bound to the each signal | 6.4 | F-12 | assumed | `decider.ts` `planEach` |
| D-OUT | Specific output: input count on the output's networks, or the constant. everything output: every non-zero signal of the output's networks | 6.4 | F-12 | documented | `decider.ts` `planPlain` |
| D-ANY-OUT | anything output: the first signal that passed the anything conditions, else the first input signal on the output's networks, in signal order | 6.4 | F-13 | assumed | `decider.ts` `planPlain` |
| D-ORDER | "Signal order" is `environment.compareSignals`; the comparator is supplied by the catalog adapter | 6.4, 10.2 | F-13, F-16 | assumed | `signals.ts` `SignalTable.rank` |
| D-EACH-OUT | With each: each output passes every activating signal; anything output the first activating signal in signal order | 6.4 | F-12 | documented (table), assumed (order) | `decider.ts` `planEach` |
| D-EACH-SPECIFIC | With each, a specific output emits the sum of the activating signals' input counts, or the constant once per activating signal | 6.4 | F-12 | assumed | `decider.ts` `planEach` |
| D-EACH-INVALID | each output without each in the conditions, everything output with each: invalid, the combinator emits nothing | 6.4 | F-12 | documented ("not defined") | `validate.ts` |
| D-ELSE | Else outputs fire when the expression is false | 6.4 | F-14 | documented | `decider.ts` |
| D-ELSE-WILD | anything / everything in else outputs refer to the input signals of the output's networks (no signal passed) | 6.4 | F-14 | assumed | `decider.ts` `planPlain` |
| D-OUT-SUM | Outputs naming the same signal add up and wrap | 6.4 | F-14 | assumed | `signals.ts` `Accumulator` |
| D-ZERO-OUT | A copied value of 0 and a constant 0 emit nothing | 6.4 | F-15 | assumed | `signals.ts` `Accumulator` |

### Selector combinator

| Rule | Chosen behavior | Audit | Fixture | Status | Source |
| --- | --- | --- | --- | --- | --- |
| S-INPUT | The input is the red + green sum; the `networks` field of the index operand is ignored | 6.5 | F-16 | documented | `selector.ts` |
| S-SELECT | Descending index 0 is the highest value, ascending index 0 the lowest; an out-of-range index selects nothing | 6.5 | F-16 | documented | `selector.ts` `planSelect` |
| S-ORDER | Values sort as signed numbers; equal values keep signal order in both directions; quality variants are separate signals | 6.5 | F-16 | assumed | `selector.ts` `planSelect` |
| S-SINGLE | A single input signal passes comparator `=` regardless of the index (wiki; "surprising" per audit) | 6.5 | F-16 | documented | `rules.ts` `selectSingleInputPassesThrough` |
| S-NEGINDEX | A negative index selects nothing (except S-SINGLE) | 6.5 | F-16 | assumed | `selector.ts` `planSelect` |
| S-INDEX-SORTED | The index signal supplies the index and takes part in the sort like any other input | 6.5 | F-16 | assumed | `rules.ts` `selectIndexSignalIsSorted` |
| S-RANGE | A comparator other than `=` selects every zero-based sorted position p with `p <comparator> index`; S-SINGLE does not apply | 6.5 | F-16 | assumed (bounds) | `selector.ts` `planSelect` |
| S-COUNT | count emits the number of distinct input signals; nothing without input or without a count signal | 6.5 | F-17 | documented | `selector.ts` `planCount` |
| S-COUNT-QUALITY | Quality variants of one prototype count separately | 6.5 | F-17 | assumed | `selector.ts` `planCount` |
| S-RANDOM | A signal is drawn uniformly at every simulation tick divisible by the interval (0 and 1: every tick); in between the chosen signal passes with its current value, nothing while it is absent | 6.5 | F-19 | assumed | `selector.ts` `planRandom` |
| S-RANDOM-PRNG | mulberry32 seeded per entity; sequences cannot match the game (static note `random-not-reproducible`) | 6.5, 9.6 | none | assumed, by design | `selector.ts` `createRandom` |
| S-LOOKUP | stack-size and rocket-capacity ignore input values and emit the environment's number on the same signal, quality kept; no number: nothing plus a runtime note; 0: nothing | 6.5, 11 | F-17 | assumed | `selector.ts` `planLookup` |
| S-QFILTER | quality-filter compares quality levels (legendary = 5); the comparator defaults to `=` | 6.5, 2.6 | F-18 | assumed | `selector.ts` `planQualityFilter` |
| S-QFILTER-ANY | quality-filter without a quality ("any quality") passes every input | 6.5 | F-18 | assumed | `selector.ts` `planQualityFilter` |
| S-QSELECT | quality-select groups by (kind, name) and passes the highest or lowest level with its value | 6.5 | F-18 | documented (grouping key assumed) | `selector.ts` `planQualitySelect` |
| S-QTRANSFER | quality-transfer reads the target signal exactly as configured (including its quality) and emits it with the chosen quality and the same value | 6.5 | F-18 | assumed | `selector.ts` `planQualityTransfer` |
| S-QTRANSFER-SIGNAL | From-signal mode uses the highest quality level at which the source prototype is on the input; nothing if it is absent | 6.5 | F-18 | documented | `selector.ts` `planQualityTransfer` |
| S-QTRANSFER-EACH | An each target re-labels every input signal; signals collapsing onto one identity add up | 2.4, 6.5 | F-18 | assumed | `selector.ts` `planQualityTransfer` |
| S-QUALITY-UNKNOWN | Signals whose quality the environment does not know are dropped by the quality modes, with a runtime note | none | F-18 | assumed | `selector.ts` |
| S-TIME | time emits `startTick + tick` of the evaluating tick (visible one tick later), wrapped to int32; day tick = unwrapped game tick modulo day length (default 25000) | 6.5 | F-19 | assumed | `selector.ts` `planTime` |
| S-TIME-UNSET | Unset time slots emit nothing (no prototype default is applied); slots sharing a signal add up | 6.5 | F-19 | assumed | `selector.ts` `planTime` |
| S-WILDCARD | Wildcards in selector signal slots (except each as transfer target): invalid, the combinator emits nothing | 2.4 | none | assumed | `validate.ts` |

### Constant combinator

| Rule | Chosen behavior | Audit | Fixture | Status | Source |
| --- | --- | --- | --- | --- | --- |
| C-SUM | Output is the per-signal sum over all active sections, wrapping; nothing when switched off | 6.6 | F-20 | documented | `constant.ts` `constantOutput` |
| C-ROUND | `count * multiplier` in double precision, truncated toward zero (after snapping products within a relative 1e-12 of an integer), then wrapped | 6.6 | F-20 | assumed | `constant.ts` `applyMultiplier` |
| C-UNGROUPED | The multiplier applies to every section, grouped or not; group names have no effect | 6.6 | F-20 | assumed | `constant.ts` `constantOutput` |
| C-ZERO | A filter with count 0 emits nothing | 6.6 | F-20 | assumed | `signals.ts` `Accumulator` |
| C-WILDCARD | A wildcard filter is skipped (static note); the rest of the combinator emits | 2.4, 9.3 | none | assumed | `constant.ts`, `validate.ts` |

### Lamp

| Rule | Chosen behavior | Audit | Fixture | Status | Source |
| --- | --- | --- | --- | --- | --- |
| L-AMBIENT | No day/night cycle: a lamp without circuit control is lit only when always-on | 6.7, 9.8 | F-21 | assumed (simulator convention) | `lamp.ts` `planLamp` |
| L-ENABLE | A wired lamp with an enable condition is lit exactly when the condition holds, regardless of always-on | 6.7 | F-21 | assumed | `lamp.ts` `planLamp` |
| L-UNWIRED | An enable condition applies only while the lamp has a circuit wire (any color) | 6.7 | F-21 | assumed | `rules.ts` `lampConditionNeedsWire` |
| L-BLANK | The default condition (no first signal) is false | 6.7 | F-21 | assumed | `rules.ts` `blankFirstSignalResult` |
| L-WILDCARD | everything / anything work in the enable condition as in a decider (including D-RHS-EXCLUDED); each or a wildcard right-hand side makes the lamp invalid (dark) | 2.4 | F-21 | assumed | `lamp.ts`, `validate.ts` |
| L-SCOPE | The input network selection scopes both the condition and the color signals | 6.7 | F-22 | assumed | `lamp.ts` `planLamp` |
| L-MAPPING | Color mapping uses the prototype table (red, green, blue, yellow, pink, cyan, white, grey, black), scaled to 0..255, grey = 128 | 6.7 | F-22 | documented | `lamp.ts` `MAPPING_COLORS` |
| L-PRIORITY | With several color signals the first one in mapping order with a value greater than 0 wins | 6.7 | F-22 | assumed | `lamp.ts` `MAPPING_COLORS` |
| L-COMPONENTS | Components mode reads three signals; an unset slot uses the prototype default (signal-red, -green, -blue; packed: signal-white) | 6.7, 3.8 | F-22 | documented | `lamp.ts` `DEFAULT_COLOR_SIGNALS` |
| L-CLAMP | Components outside 0..255 are clamped | 6.7 | F-22 | assumed | `lamp.ts` `colorComponent` |
| L-PACKED | Packed RGB is `0xRRGGBB` in the low 24 bits; higher bits, including the sign, are ignored | 6.7 | F-22 | assumed | `lamp.ts` `unpackRgb` |
| L-NOCOLOR | No color signal present (mapping: none positive; components: all three 0; packed: 0): the lamp shows its static color, else the default white light | 6.7 | F-22 | assumed | `lamp.ts` `planLamp` |
| L-QUALITY | Color signals of a quality other than normal do not count | 6.7 | F-22 | assumed | `lamp.ts` `planLamp` |
| L-COLOR-WIRE | Use-colors needs a circuit wire but no enable condition | 6.7 | F-22 | assumed | `lamp.ts` `planLamp` |

## Fixture format

Files: `tests/fixtures/conformance/*.json` at the repository root, one fixture per file. `packages/simulation/test/fixtures.test.ts` validates and runs every file in that directory,
so game-recorded fixtures only have to be dropped in. Types: `ConformanceFixture` in `src/fixture.ts`; runner: `runFixture`, structural check: `validateFixture`.

| Field | Type | Meaning |
| --- | --- | --- |
| `format` | `1` | Format version |
| `id` | string | Unique name; must equal the file name without `.json` |
| `covers` | string[] | Audit fixture ids (`F-nn`) the file covers |
| `title` | string | One-line description |
| `provenance` | `"assumed"` \| `"documented"` \| `"game"` | `game`: recorded from the running game. `documented`: every asserted value follows from sourced statements. `assumed`: at least one asserted value rests on an engine assumption |
| `source` | string, optional | How the expectations were derived or recorded (game version, scenario, command line) |
| `environment` | `EnvironmentData`, optional | `signalOrder` (signal keys without quality, lowest first), `stackSizes`, `rocketCapacities` (by `kind:name`), `qualities` (`{name, level}`), `time` (`dayLength`, `startTick`) |
| `seed` | number, optional | Seed for the random selector mode |
| `circuit` | `Circuit` | Model JSON of `@face/model` (`entities` with `id`, `name`, `position`, `kind` and settings; `wires`) |
| `ticks` | number | Ticks to simulate; expectations may address ticks 0..`ticks` |
| `match` | `"exact"` (default) \| `"listed"` | `exact`: the listed signals are the complete content. `listed`: only listed signals are checked and 0 means absent |
| `expect[]` | array | Expectations, each for one tick or an inclusive range |
| `expect[].tick`, `.through` | number | The tick, and optionally the last tick of a range |
| `expect[].outputs` | `{ [entityId]: { [signalKey]: value } }` | Signals an entity emits on its output terminal at that tick |
| `expect[].networks[]` | `{ terminal: {entity, side}, color, signals }` | Content of the network of that color on any of its member terminals |
| `expect[].lamps` | `{ [entityId]: { lit, color? } }` | Lamp state; `color` omitted = not checked, `null` = no color, `{r, g, b}` = 0..255 |

Signal keys are `kind:name` or `kind:name@quality` (`signalKey` of `@face/model`). Tick 0 is the reset state described above; a game recording has to be aligned to it
(game tick at which the blueprint's combinators have just been built and have not yet produced output).

Fixtures marked `documented` assert steady-state ticks only, so they do not depend on the assumed timing of constant combinators (T-CONSTANT).

### Authored fixtures

| File | Covers | Provenance |
| --- | --- | --- |
| `F-03-latency-chain` | F-03 | assumed |
| `F-05-counter`, `F-05-counter-wrap`, `F-05-decider-clock` | F-05 (F-06) | assumed |
| `F-05-memory-cell` | F-05, F-19 | assumed |
| `F-06-arithmetic-edge-cases` | F-06 | assumed |
| `F-07-red-green-zero-sum` | F-07 | assumed |
| `F-10-decider-and-or-precedence` | F-10 | documented |
| `F-11-everything-anything-truth-table` | F-11 | documented |
| `F-11-right-hand-signal-excluded` | F-11 | assumed |
| `F-12-each-truth-table` | F-12, F-14 | assumed |
| `F-13-anything-output-order` | F-13 | assumed |
| `F-16-selector-select` | F-16 | assumed |
| `F-17-selector-count-stack-size` | F-17 | assumed |
| `F-18-selector-quality` | F-18 | assumed |
| `F-19-selector-time`, `F-19-selector-random-single-input` | F-19 | assumed |
| `F-20-constant-sections` | F-20 | documented |
| `F-20-constant-multiplier` | F-20 | assumed |
| `F-21-lamp-enable` | F-21 | assumed |
| `F-22-lamp-colors` | F-22 | assumed |

Not covered by a fixture file, by nature: F-01, F-02, F-23 (blueprint export, `packages/blueprints`), F-04 (constant edit timing, see scope limits),
F-08, F-09, F-14 (else with wildcards), F-15 (covered by unit tests named after the fixture id in `packages/simulation/test`).

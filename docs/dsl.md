# face circuit language, version 1 (draft)

Status: draft for Milestone 1. The language is the persisted form of a circuit and the single owner of editing history; the graphical editor edits the same text through source patches. Game facts come from `docs/factorio-audit.md` (Factorio 2.1.24). File extension: `.face`. Encoding: UTF-8, LF line endings.

The semantic model produced from this language is `Circuit` in `@face/model` (`packages/model/src/circuit.ts`); that file defines the defaults referenced below.

## Example

```text
// A counter that lights a lamp.
circuit "Feedback example" {
    constant-combinator source at (40, 80) {
        virtual:signal-A = 1
    }

    decider-combinator gate at (300, 80) {
        when virtual:signal-A < 10
        output virtual:signal-A = input
    }

    arithmetic-combinator twice at (300, 240) {
        virtual:signal-B = virtual:signal-A[red] * 2
    }

    small-lamp light at (560, 80) {
        when virtual:signal-B > 8
    }

    wire red source.out <-> gate.in
    wire green gate.out <-> gate.in      // feedback
    wire red gate.out <-> twice.in
    wire green twice.out <-> light.in
}
```

## Lexical structure

- Whitespace and newlines separate tokens and are otherwise insignificant. Statements need no terminator; an optional `;` or `,` between statements is ignored.
- Comments: `// to end of line` and `/* block */`. Comments and whitespace are trivia and are preserved by every editor operation that does not rewrite the enclosing statement.
- Identifier (entity names): `[A-Za-z_][A-Za-z0-9_]*`. Keywords are reserved and case-sensitive.
- Name (the word of an entity declaration, and names from the game data as values): an identifier that may have further parts joined by `-`, `[A-Za-z_][A-Za-z0-9_]*(-[A-Za-z0-9_]+)*`, as in `small-lamp` or `assembling-machine-2`. A name that does not read like this (`5d-lamp`, `F#3`, a name with a dot or a blank) or that is a reserved keyword is written as a string: `"5d-lamp"`. A string is accepted wherever a bare name is.
- Integer: optional `-` followed by decimal digits, or `0x` hexadecimal; must fit signed 32 bit. A `-` directly followed by a digit after an operator or `=` is a sign. Decimal numbers (`1.5`, `-0.5`) are only legal in `tile (...)` and as a section `multiplier`.
- String: double-quoted, on one line. Escapes: `\"`, `\\`, `\n` (line break), `\t` (tab), `\r` (carriage return). The editor writes line breaks, tabs and carriage returns as escapes; a tab typed into a string is the same value as `\t`.
- Signal literal: `kind:name` or `kind:name@quality`, written without spaces. `kind` is one of `item`, `fluid`, `virtual`, `entity`, `recipe`, `space-location`, `asteroid-chunk`, `quality`, `custom`. `name` and `quality` match `[A-Za-z0-9_][A-Za-z0-9_.-]*`; any other prototype name is written quoted: `item:"odd name"@"odd quality"`. Because names may contain `-`, the binary operators `-` and `+` must be surrounded by whitespace.
- Wildcards are keywords, not signal literals: `each`, `anything`, `everything`. (`virtual:signal-each` etc. are accepted and normalized to the keyword form by the editor; they denote the same signals.)
- Color literal: `#rrggbb`.

Reserved keywords: `circuit wire red green at tile facing north east south west in out when and or output else input section each anything everything true false AND OR XOR import component port`.
`import`, `component` and `port` are reserved for reusable components (Milestone 4) and currently produce a "not supported yet" diagnostic.
No entity of the game has a keyword: an entity is declared by its name in the game, which is data and not part of the language. So a further entity, of the game or of a mod, reserves nothing, and the words that name the families of behaviour in this document (`constant`, `arithmetic`, `decider`, `selector`, `lamp`, `pole`, `speaker`, `entity`) are free as entity names like `pump`, `belt` and `chest`. The signal kind `entity:` is a signal literal: `entity:small-biter`. The names of properties (`pitch`, `note`, `read-contents`, ...) and the words in front of `when` (`logistic`, `harvest`, ...) are not reserved either.

## Grammar

```ebnf
file        = circuit ;
circuit     = "circuit" STRING "{" { member } "}" ;
member      = entity | wire ;

entity      = prototype IDENT [ "at" point ] [ "tile" point ] [ "facing" direction ] "{" { statement } "}" ;
prototype   = NAME | STRING ;                           (* the game's name of the entity: small-lamp, "5d-lamp" *)
point       = "(" NUMBER "," NUMBER ")" ;
direction   = "north" | "east" | "south" | "west" ;

wire        = "wire" color terminal "<->" terminal ;
color       = "red" | "green" ;
terminal    = IDENT "." ( "in" | "out" ) | IDENT ;    (* the bare name: the one connection point of an entity that neither only reads nor only writes *)

signal      = SIGNAL | "each" | "anything" | "everything" ;
networks    = "[" ( color | "none" ) "]" ;            (* absent: both networks *)
sigref      = signal [ networks ] ;
operand     = sigref | INT ;
comparator  = "<" | ">" | "=" | "!=" | "<=" | ">=" ;
property    = PROPNAME "=" value ;                      (* PROPNAME: identifier, may contain "-" *)
value       = INT | STRING | COLOR | "true" | "false" | signal | IDENT-like enum word ;
```

A network selection says which of the two input networks a signal is read from: `S` reads the sum of red and green (the game default), `S[red]` and `S[green]` one of them, `S[none]` neither. The game allows unchecking both boxes; a signal read from no network is absent, so its value is 0 and wildcards find no signals there. `none` is not a reserved word: it has this meaning only between the brackets and as the value of a `networks` property, and remains a legal entity name.

An entity is declared by the game's own name for it, the one a blueprint has: `constant-combinator source { ... }`, `small-lamp light { ... }`, `big-electric-pole p1 { }`, `fast-inserter feeder { ... }`. The word is a name of the game data, not a keyword: which names there are is the entity table in use, the one of the standard game or the one read from the user's game with its mods (`ltn-combinator c { }`). It is written bare where it reads as one word that is not reserved, in quotes otherwise (`"5d-lamp" l { }`, and `"wire" w { }` for an entity a mod names like a keyword); in quotes it is accepted for every name (`"small-lamp" l { }`). The editor writes it bare where it can. Because no keyword starts a declaration, a declaration is recognized by its shape: the word, the name of the entity, and then `at`, `tile`, `facing` or `{`. The braces are part of every declaration, also of one with nothing in them.

What the block takes is decided by the family of behaviour the entity belongs to, its kind, which follows the game's prototype type and not the name:

| Kind | Prototype type of the game | Standard game | Block |
| --- | --- | --- | --- |
| `constant` | `constant-combinator` | `constant-combinator` | signals with their counts, sections |
| `arithmetic` | `arithmetic-combinator` | `arithmetic-combinator` | one expression |
| `decider` | `decider-combinator` | `decider-combinator` | conditions and outputs |
| `selector` | `selector-combinator` | `selector-combinator` | an operation and its properties |
| `lamp` | `lamp` | `small-lamp` | a condition and the light |
| `pole` | `electric-pole` | `small-electric-pole`, `medium-electric-pole`, `big-electric-pole`, `substation` | nothing |
| `speaker` | `programmable-speaker` | `programmable-speaker` | a condition or a pitch signal, and the sound |
| `entity` | every other type with circuit settings | 88 prototypes: chests, inserters, belts, machines, ... | the settings of its prototype type |

A prototype a mod adds to one of the first six types is of that kind whatever its name and its size (a combinator of one tile, a lamp of 2 x 2), and takes the same block as the standard one. The entity itself decides the tiles it covers, whether it turns and, where it has one of its own, its wire reach; the kind decides the behaviour. The kinds have no word in the language: they are the sections below and the `kind` of an entity in the model (`@face/model`).

A name the game data in use does not have is an error on the word, `unknown-prototype`: `Unknown entity 'smal-lamp'; did you mean small-lamp?`, with the nearest names where there are any (a typing error away, or containing the word: `lamp` gives `small-lamp`), else `Unknown entity 'mod-lamp': the game data in use has no entity of this name (...)`. The latter is what a project made with mods says when it is opened with game data that lacks them. Such a declaration has that one error: it is read past by its braces, whatever it says, and is no entity, so the rest of the circuit is read as usual and a wire to its name reports `Unknown entity 'name'` like a wire to any name that is not declared. A name the game has and the editor has nothing for is `unsupported-prototype`: a programmable speaker a mod adds, because the instruments and notes of the editor are those of the one prototype `programmable-speaker` (`'mod-speaker' (Loud speaker) is not supported: ...`), and a prototype of a type without circuit settings here.

Terminals. In the game only the arithmetic, decider and selector combinator have two connectors, an input and an output: `gate.in`, `gate.out`. Every other entity has one. A constant combinator only writes to it (`source.out`), a lamp and a speaker only read from it (`light.in`). A pole does neither, it only joins the wires on it, and its connection point is written as the bare entity name: `wire red source.out <-> p1`, `wire green p1 <-> p2`, `wire red p2 <-> light.in`. All wires of one color on a pole are one network; red and green stay apart. Every other entity of the game (a chest, an inserter, a train stop) reads and writes on its one connector in the game, so it has neither an input nor an output either and is wired by its bare name as well: `wire red source.out <-> chest`.

Entity names are unique within a circuit. Members may appear in any order; a wire may precede the entities it references. Statement order inside an entity is preserved; order is semantically relevant only for decider outputs, constant filters and sections.

`at (x, y)` is the schematic position on the editor canvas (integers, canvas units, 20-unit grid). If absent, the editor auto-places the entity and writes the clause on first move.

`tile (x, y)` is the optional position of the entity in the game, as a blueprint has it: the center of the entity in tiles, x growing to the east and y to the south, relative to an origin that is free to choose. It is independent of `at`; an entity without the clause has no place in the game yet. A tile is one unit square between whole coordinates, so a center has to fit the tiles the entity covers (`docs/factorio-audit.md` 3.1 and 5.4):

| Entity | Covers | Center |
| --- | --- | --- |
| `constant-combinator`, `small-lamp`, `programmable-speaker`, `small-electric-pole`, `medium-electric-pole` | 1 tile | x and y end in .5: `tile (2.5, -0.5)` |
| `big-electric-pole`, `substation` | 2 x 2 tiles | a whole x and a whole y: `tile (4, -1)` covers the tiles from x = 3 to 5 and from y = -2 to 0 |
| `arithmetic-combinator`, `decider-combinator`, `selector-combinator` facing east or west (also without `facing`) | 2 tiles side by side | a whole x, y ends in .5: `tile (3, 0.5)` covers the tiles from x = 2 to 4 |
| `arithmetic-combinator`, `decider-combinator`, `selector-combinator` facing north or south | 2 tiles, one above the other | x ends in .5, a whole y: `tile (6.5, -21)` covers the tiles from y = -22 to -20 |

The rule behind the table: along an axis on which the entity covers an odd number of tiles the coordinate of the center ends in .5, along one with an even number it is whole. The sizes are game data per prototype (`PROTOTYPES` in `@face/model`, from the entity table of the game); the table has the standard combinators, the lamp, the speaker and the poles, and a combinator, a lamp or a pole of a mod is placed by its own size. The same rule places every other entity, whose prototypes cover from 1 x 1 up to 9 x 9 tiles (the rocket silo) and need not be square: a boiler covers 3 x 2 tiles facing north or south and 2 x 3 facing east or west, so `tile (1.5, 1) facing north` and `tile (1, 1.5)` are both on the grid for it.

Of the two tiles of a combinator the one `facing` points to carries the output and the other the input. A modded combinator that is longer or wider is cut in the middle of its length along `facing` the same way; one of a single tile has both connectors on it. An entity with one connector has no such halves, also when it covers 2 x 2 tiles. A `tile` that does not fit this grid is kept as written and gets the warning `tile-off-grid`, which names the nearest center that fits. Two entities whose tiles overlap get the warning `tile-overlap` each, naming the other; the game cannot place them like that. For the overlap, a tile off the grid counts as the nearest footprint on it.

`facing <direction>` is the direction the entity faces: the direction its output points to, seen from its input, as in the game. Without the clause an entity faces east. On the editor canvas the direction decides which edges of the card carry the connection pins; the card and its text do not turn. Facing east, the inputs are on the left edge and the outputs on the right edge, red above green. The pins turn with the direction as one figure: facing south the outputs are on the bottom edge and the inputs on the top edge, red right of green; facing west the outputs are on the left and the inputs on the right, red below green; facing north the outputs are on the top and the inputs on the bottom, red left of green. A constant combinator follows the same rule with the one terminal it has; a lamp and a speaker do not rotate and always have their terminal on the left edge. A pole does not rotate either; its one connection point is one pair of pins in the middle of the top edge, red left of green, and its wires arrive from above. Every other entity with one connection point of this sort (a chest, an inserter) has it there as well. The editor writes the clause when an entity is rotated or flipped and from then on keeps it, also as `facing east`. `facing` is also the in-game direction kept for blueprint round trips. Neither `tile` nor `facing` ever affects simulation.

Whether an entity can be turned is game data of its prototype. The four combinators of the game can; its lamp, its speaker and its poles cannot, in the game as in the editor (a combinator or a lamp of a mod has its own data); an inserter and a belt turn, a chest and a stone furnace do not (the data is what an entity built in the running game says, `docs/factorio-audit.md` 13.4). `facing` on an entity that cannot turn is legal and kept, has no effect (the entity is drawn as if it faced east, and the clause is not meant for a blueprint) and gets the warning `unused-facing`, which names the entity: `A wooden chest cannot be rotated; 'facing' is ignored`. When the editor turns a combinator that has a `tile`, it corrects the tile in the same edit, because the half tile moves to the other axis: the top-left tile of the two stays where it is. `decider-combinator d tile (1, 0.5)` (on the tiles from x 0 to 2, input on the left one) becomes `tile (0.5, 1) facing south` and `tile (0.5, 1) facing north` (on that left tile and the one below it) and stays `tile (1, 0.5)` with `facing west`: a half turn keeps both tiles and swaps input and output, as flipping a combinator does in the game. A tile that was off the grid is first moved to the nearest place on it. A constant combinator keeps its tile as it is. Changing the word by hand does not touch `tile`; the warning then says what fits. On the blueprint board the editor refuses a turn that would put the entity onto a tile of another one; on the edit canvas it turns, and the overlap gets its warning.

### Common property

`description = "text"` is allowed in every entity. It is the free text of the game's "Add description" on a combinator; a text of several lines is written on one source line with `\n` between the lines:

```
decider-combinator gate at (300, 80) {
    description = "Counts A up to ten,\nthen starts over."
    when virtual:signal-A < 10
    output virtual:signal-A = input
}
```

The text is kept exactly as written, including blanks at either end. An empty description is the same as none: the editor removes the property instead of writing `description = ""` (one written by hand stays until it is changed). The description never affects the simulation. The game has it on the four combinators only (`player_description` in a blueprint); on every other entity it is a note of the project. No length limit is enforced: none is documented for the game (open; `docs/factorio-audit.md` 3.2 states none).

### Constant combinator

`constant-combinator`, and every prototype of that type a mod adds.

```ebnf
constant-stmt = filter | section | "enabled" "=" BOOL | property ;
filter        = SIGNAL "=" INT ;
section       = "section" [ STRING ] "{" { filter | "active" "=" BOOL | "multiplier" "=" NUMBER } "}" ;
```

Bare filters form one anonymous section. If `section` blocks are present, bare filters are an error. A quoted section name is the logistic group. Defaults: `enabled = true`, `active = true`, `multiplier = 1`. The multiplier is a decimal number and may be negative (the game stores a float). A signal may appear only once per section (error); the same signal in different sections adds up. Wildcards are not legal in a constant combinator.

### Arithmetic combinator

`arithmetic-combinator`, and every prototype of that type a mod adds.

```ebnf
arithmetic-stmt = signal "=" operand arith-op operand | property ;
arith-op        = "*" | "/" | "+" | "-" | "%" | "^" | "<<" | ">>" | "AND" | "OR" | "XOR" ;
```

Exactly one expression statement; none means an unconfigured combinator (model defaults). The left side is the output signal and takes no network selection. `each` rules follow the game: `each` as output requires `each` as an input operand; `anything`/`everything` are not legal here.

### Decider combinator

`decider-combinator`, and every prototype of that type a mod adds.

```ebnf
decider-stmt = when | output | "else" output | property ;
when         = "when" condition { ( "and" | "or" ) condition } ;
condition    = sigref comparator operand ;
output       = "output" signal "=" ( INT | "input" [ networks ] ) ;
```

At most one `when`. `and` binds tighter than `or` and there is no grouping, matching the game's condition list (`compare_type` of each condition after the first). `output S = input` copies the input count of `S` (optionally from one network, `input[red]` or `input[green]`, or from none, `input[none]`); `output S = 5` emits a constant. `else output` lines are emitted when the condition is false. Outputs keep their source order.

### Selector combinator

`selector-combinator`, and every prototype of that type a mod adds. Property bag; `operation` selects the mode and determines which other properties are legal.

| operation | properties (defaults) |
| --- | --- |
| `select` (default) | `order = max` or `min` (`max`); `index = INT or signal` (`0`); `index-comparator = <comparator>` (`=`) |
| `count` | `output = signal` |
| `random` | `interval = INT` (`0`) |
| `stack-size` | none |
| `rocket-capacity` | none |
| `quality-filter` | `quality = <quality name>` (absent: any quality, then only `=` is meaningful); `comparator = <comparator>` (`=`) |
| `quality-select` | `order = highest` or `lowest` (`highest`) |
| `quality-transfer` | `source = <quality name>` or `source = signal` with `source-signal = signal`; `destination = signal` |
| `time` | `day-length = signal`; `day-tick = signal`; `game-tick = signal` |

Example: `selector-combinator pick at (0, 0) { operation = select  order = min  index = virtual:signal-I }`.

### Lamp

`small-lamp`, and every prototype of the type `lamp` a mod adds.

```ebnf
lamp-stmt = "when" sigref-without-networks comparator ( SIGNAL | INT ) | property ;
```

`when` is the circuit enable condition (its presence sets `circuit_enabled`). Properties: `networks = red`, `green` or `none` (default both; the lamp's input network selection, which applies to the condition and to the color signals), `always-on = BOOL` (`false`), `colors = mapping`, `components` or `packed-rgb` (presence sets `use_colors`), `red`, `green`, `blue`, `rgb` (signals for the color modes), `color = #rrggbb` (static color).

### Electric pole

`small-electric-pole`, `medium-electric-pole`, `big-electric-pole`, `substation`, and every prototype of the type `electric-pole` a mod adds.

```ebnf
pole-stmt = property ;    (* the description is all there is to say *)
```

An electric pole relays circuit signals and lets wires span more distance. It has no behaviour of its own and no settings: which pole it is, is the word of its declaration, and `small-electric-pole p { }` is a complete one. Game data per prototype of the standard game (a pole of a mod has its own size and reach):

| Entity | Covers | Wire reach |
| --- | --- | --- |
| `small-electric-pole` | 1 tile | 7.5 |
| `medium-electric-pole` | 1 tile | 9 |
| `big-electric-pole` | 2 x 2 tiles | 32 |
| `substation` | 2 x 2 tiles | 18 |

A pole has one connection point, the bare name (see Terminals above); `p.in` and `p.out` are errors. Its wire reach is its own and does not follow the project setting (see Wire reach below). In the simulation a pole joins the wires on it: every wire of one color on a pole belongs to one network, with no delay.

```
small-electric-pole relay at (300, 80) tile (4.5, 0.5) { }
big-electric-pole trunk at (560, 80) tile (10, 1) {
}
wire red source.out <-> relay
wire red relay <-> trunk
```

### Programmable speaker

`programmable-speaker`, and no other: a speaker a mod adds is not supported.

```ebnf
speaker-stmt = "when" sigref-without-networks comparator ( SIGNAL | INT ) | property ;
```

It reads the sum of the red and the green network on its one terminal, `name.in`; it has no network selection in the game. It plays in one of two ways, which exclude each other:

- `when S > 5`: the circuit condition, as for a lamp (`anything` and `everything` are allowed on the left). The speaker plays `instrument` and `note` while the condition holds.
- `pitch = S`: the game's "Signal value is pitch". The value of `S` picks the note of the instrument, 1 being its first; `note` is then not used. `when` together with `pitch` is an error.

A speaker with neither never plays and gets the warning `unconfigured`.

| Property | Value (default) | Game field |
| --- | --- | --- |
| `pitch` | signal | `circuit_parameters.signal_value_is_pitch` with the signal in `circuit_condition.first_signal` |
| `instrument` | name (the first instrument of the game) | `circuit_parameters.instrument_id` |
| `note` | name (the first note of the instrument) | `circuit_parameters.note_id` |
| `volume` | number from 0 to 100, percent (`100`) | `parameters.playback_volume`, 0 to 1 |
| `volume-signal` | signal; its presence means "Signal value is volume" | `parameters.volume_controlled_by_signal`, `volume_signal_id` |
| `playback` | `local`, `surface` or `global` (`local`) | `parameters.playback_mode`; the game's GUI calls `global` "Universe" |
| `polyphony` | BOOL (`false`) | `parameters.allow_polyphony` |
| `stop-playing-sounds` | BOOL (`false`) | `circuit_parameters.stop_playing_sounds` |
| `show-alert` | BOOL (`false`) | `alert_parameters.show_alert` |
| `show-on-map` | BOOL (`true`) | `alert_parameters.show_on_map` |
| `alert-icon` | signal | `alert_parameters.icon_signal_id` |
| `alert-message` | string (`""`) | `alert_parameters.alert_message` |

Instruments and notes are written with the names the game's speaker prototype gives them, which are also the keys of the game's translations: `instrument = piano`, `note = "F#3"`, `instrument = drum-kit`, `note = hat-1`. A name that reads as one word is written bare, any other one quoted (every sharp note, because of the `#`). A blueprint stores the position of the instrument and of the note in the prototype's lists instead; the catalog (`@face/catalog`, `speakers`) has the lists in that order, so the two forms translate into each other, and a name stays right when a game version or a mod inserts an entry before it. The language itself knows no instrument: with the catalog's list given to the analysis (`AnalyzeOptions.instruments`), an instrument the game does not have gets the warning `unknown-instrument` and a note its instrument does not have `unknown-note`; without the list the names are taken as written.

`volume` is a percentage and may have decimals; a value outside 0 to 100 is an error. With `volume-signal` the value of that signal is the volume in percent, clamped to 0..100, and `volume` is not used. `pitch`, `volume-signal` and `alert-icon` take no wildcard.

The simulation plays no sound. For every tick it says whether the speaker would play, with which instrument, note and volume, and whether an alert is shown; `playback`, `polyphony`, `stop-playing-sounds`, `show-on-map`, `alert-icon` and `alert-message` are kept for the blueprint and do not change that (`packages/simulation/CONFORMANCE.md`, rules SP-*).

```
programmable-speaker alarm at (560, 80) {
    when item:iron-plate < 100
    instrument = alarms
    note = siren
    playback = global
    show-alert = true
    alert-message = "Iron is running out"
}
programmable-speaker tune { pitch = virtual:signal-P  instrument = piano  volume = 60 }
```

### Every other entity

```ebnf
entity-stmt = [ ROLE ] "when" sigref-without-networks comparator ( SIGNAL | INT ) | property ;
```

Every entity of the game that connects to the circuit network and is none of the above: chests, inserters, belts, splitters, assembling machines, furnaces, pumps, turrets, train stops, rail signals, walls, roboports and so on, 88 prototypes of Factorio 2.1.24 (`docs/factorio-audit.md` 13), and with the data of a modded game those of its mods whose prototype type has settings here (a loader of one tile). This is still a circuit editor: such an entity is here with its size, its wire reach, its one connection point and its circuit settings, not with what it does in a factory.

```
fast-inserter feeder at (300, 80) tile (3.5, 0.5) facing north {
    when item:iron-plate < 100
    read-hand = pulse
    set-filters = true
}
steel-chest box { }
wire red source.out <-> feeder
```

The word names the entity as a blueprint does (`steel-chest`, `express-transport-belt`, `train-stop`). It decides the tiles the entity covers, whether it turns, its wire reach and, through the game's prototype type (`fast-inserter` is an `inserter`), which settings it takes: the tables below. A setting or a condition that the prototype does not have is an error that names the prototype and lists what it has, as `interval` is for a selector that does not select at random.

Settings are properties, `word = value`, of four forms: a switch (`true` or `false`), a mode (one of the words listed), a signal (no wildcard), and a network selection (`red`, `green` or `none`; without the property both, as for a lamp). Where the game has a checkbox in front of a choice of modes ("read hand contents", then pulse or hold), the two are one word whose first value is the checkbox being off: `read-hand = none`, `pulse` or `hold`. Every setting has the default of a freshly placed entity; the editor does not write a setting that is at its default, and one written by hand is accepted and means the same as leaving it out. A signal setting without the property is the signal the prototype uses by itself in the game where it has one (`virtual:signal-E` for the empty slots of a chest), else none.

Conditions are statements. `when S < 100` is the condition that enables the entity (the game's "Enable/disable"); every other condition has a word in front that says what it decides: `logistic when ...`, `harvest when ...`, `input-left when ...`, `close when ...`. A condition is a single comparison as for a lamp: `anything` and `everything` are allowed on the left, the right side is a signal or an integer, and the signals take no network selection (`networks` says where all conditions of the entity read). A condition that is written is in use: its presence stands for the checkbox the game has next to it, so there is no way, and no need, to keep a condition that is switched off. Each condition may appear once.

Two conditions have something in the game where the source has nothing (`docs/factorio-audit.md` 12.2). The two conditions of a side of a splitter share one checkbox: where one is written and the other is not, the game has its own condition for the other (`signal-I < 0` for `input-left`, `signal-I > 0` for `input-right`, `signal-O` likewise for the output side), and a circuit that comes back from a blueprint says it. A new wall of the game has the checkbox of `open-gate when` on with a blank condition; a wall without the condition is exported with the checkbox off. And the game keeps a setting only where the prototype has a use for it: `read-fuel` on a machine that burns nothing is legal here and gone in the game.

The entity has one connection point, written as the bare name (see Terminals above). In the game it reads and writes there. In the simulation it sends nothing: there are no stand-in signals for what a chest holds or a train stop counts. What it reads is shown, and each circuit condition is evaluated every tick, so that the editor can show whether the entity is enabled (`packages/simulation/CONFORMANCE.md`). A condition on the logistic network (`logistic when`) is kept and not evaluated.

`blueprint-data = "..."` holds what a blueprint says about the entity that the editor does not model (its recipe, filters, requests, quality, a direction that is no quarter turn), as the JSON text of an object, in a string with the usual escapes. The blueprint import writes it and the export reads it back; it is kept byte for byte and is not meant to be edited by hand. Text that is not the JSON of an object is an error.

Placement: the footprint rule of `tile` above with the size of the prototype. An entity the game builds in two directions only (the `storage-tank`) faces north or east: `facing south` is read as north and `facing west` as east. An entity the game does not put on the tile grid (the `land-mine`) may have any `tile` and never gets `tile-off-grid`; for `tile-overlap` it counts with the nearest tile. A rail signal has sixteen directions in the game and two turrets eight; the editor turns in quarter turns.

The settings per prototype type, and the words with their values, defaults and the fields of the blueprint's `control_behavior` they stand for. The type `loader-1x1` (the loader of one tile) has no prototype in the standard game that a circuit wire connects to; mods have (miniloaders), and in the game it has the control behaviour of the `loader`, so it shares that row. Both tables are written from the settings table of the model (`ENTITY_SETTINGS` in `packages/model/src/entitySettings.ts`); the defaults, and the numbers a blueprint has for the words of a mode, are those of the game itself (fixture F-01, `docs/factorio-audit.md` 14.5).

<!-- entity-settings:begin (generated from ENTITY_SETTINGS; `npx vitest run packages/language/test/docs.test.ts` checks it, UPDATE_DOCS=1 rewrites it) -->
| Prototype type | Prototypes | Conditions | Properties |
| --- | --- | --- | --- |
| `accumulator` | `accumulator` | none | `output-networks`, `read-charge`, `output-signal` |
| `agricultural-tower` | `agricultural-tower` | `when`, `logistic when`, `harvest when`, `plant when` | `networks`, `output-networks`, `read-contents` |
| `ammo-turret`, `electric-turret`, `fluid-turret` | `flamethrower-turret`, `gun-turret`, `laser-turret`, `railgun-turret`, `rocket-turret`, `tesla-turret` | `when`, `logistic when`, `ignore-unlisted when` | `networks`, `output-networks`, `read-ammo`, `set-priority-list` |
| `artillery-turret` | `artillery-turret` | `when`, `logistic when` | `networks`, `output-networks`, `read-ammo` |
| `assembling-machine` | `assembling-machine-1`, `assembling-machine-2`, `assembling-machine-3`, `biochamber`, `centrifuge`, `chemical-plant`, `crusher`, `cryogenic-plant`, `electromagnetic-plant`, `foundry`, `oil-refinery` | `when`, `logistic when` | `networks`, `output-networks`, `set-recipe`, `read-contents`, `include-in-crafting`, `read-fuel`, `read-ingredients`, `read-recipe-finished`, `recipe-finished-signal`, `read-working`, `working-signal` |
| `asteroid-collector` | `asteroid-collector` | `when`, `logistic when` | `networks`, `output-networks`, `set-filters`, `read-contents`, `include-hands` |
| `boiler` | `boiler`, `heat-exchanger` | `when`, `logistic when` | `networks`, `output-networks`, `read-fuel` |
| `cargo-landing-pad` | `cargo-landing-pad` | none | `networks`, `output-networks`, `read-contents`, `read-empty-slots`, `empty-slots-signal`, `set-requests` |
| `container`, `linked-container`, `proxy-container` | `blue-chest`, `bottomless-chest`, `crash-site-chest-1`, `crash-site-chest-2`, `iron-chest`, `linked-chest`, `proxy-container`, `red-chest`, `steel-chest`, `wooden-chest` | none | `output-networks`, `read-contents`, `read-empty-slots`, `empty-slots-signal` |
| `display-panel` | `display-panel` | none | none |
| `furnace` | `electric-furnace`, `recycler`, `steel-furnace`, `stone-furnace` | `when`, `logistic when` | `networks`, `output-networks`, `read-contents`, `include-in-crafting`, `read-fuel`, `read-ingredients`, `read-recipe-finished`, `recipe-finished-signal`, `read-working`, `working-signal` |
| `heat-pipe` | `heat-pipe` | none | `output-networks`, `read-temperature`, `temperature-signal` |
| `infinity-container`, `logistic-container` | `active-provider-chest`, `buffer-chest`, `infinity-chest`, `passive-provider-chest`, `requester-chest`, `storage-chest` | `when` | `networks`, `output-networks`, `read-contents`, `read-empty-slots`, `empty-slots-signal`, `set-requests` |
| `infinity-pipe`, `pipe`, `pipe-to-ground`, `storage-tank` | `infinity-pipe`, `pipe`, `pipe-to-ground`, `storage-tank` | none | `output-networks`, `read-contents`, `read-temperature`, `temperature-signal` |
| `inserter` | `bulk-inserter`, `burner-inserter`, `fast-inserter`, `inserter`, `long-handed-inserter`, `stack-inserter` | `when`, `logistic when` | `networks`, `output-networks`, `set-filters`, `read-hand`, `set-stack-size`, `stack-size-signal` |
| `lab` | `biolab`, `lab` | none | `networks`, `output-networks`, `set-research`, `read-contents`, `read-fuel`, `read-research-cost`, `read-technology-level`, `technology-level-signal` |
| `land-mine`, `offshore-pump`, `power-switch` | `land-mine`, `offshore-pump`, `power-switch` | `when`, `logistic when` | `networks` |
| `loader`, `loader-1x1` | `express-loader`, `fast-loader`, `loader`, `turbo-loader` | `when`, `logistic when` | `networks`, `output-networks`, `set-filters`, `read-transfers` |
| `mining-drill` | `big-mining-drill`, `burner-mining-drill`, `electric-mining-drill`, `pumpjack` | `when`, `logistic when` | `networks`, `output-networks`, `read-resources` |
| `pump` | `pump` | `when`, `logistic when` | `networks`, `set-filter` |
| `radar` | `radar` | none | `mode`, `channel` |
| `rail-chain-signal` | `rail-chain-signal` | `close when` | `networks`, `output-networks`, `read-signal`, `red-signal`, `orange-signal`, `green-signal`, `blue-signal` |
| `rail-signal` | `rail-signal` | `close when` | `networks`, `output-networks`, `read-signal`, `red-signal`, `orange-signal`, `green-signal` |
| `reactor` | `heating-tower`, `nuclear-reactor` | none | `output-networks`, `read-fuel`, `read-temperature`, `temperature-signal` |
| `roboport` | `roboport` | none | `output-networks`, `read-items`, `read-robot-stats`, `available-logistic-signal`, `total-logistic-signal`, `available-construction-signal`, `total-construction-signal`, `roboport-count-signal` |
| `rocket-silo` | `rocket-silo` | none | `output-networks`, `read-items`, `read-launched`, `launched-signal` |
| `space-platform-hub` | `space-platform-hub` | none | `networks`, `output-networks`, `read-contents`, `send-to-platform`, `set-requests`, `read-empty-slots`, `empty-slots-signal`, `read-moving-from`, `read-moving-to`, `read-speed`, `speed-signal`, `read-damage-taken`, `damage-taken-signal` |
| `splitter` | `express-splitter`, `fast-splitter`, `splitter`, `turbo-splitter` | `input-left when`, `input-right when`, `output-left when`, `output-right when` | `networks`, `set-filter` |
| `train-stop` | `train-stop` | `when`, `logistic when` | `networks`, `output-networks`, `send-to-train`, `read-from-train`, `read-stopped-train`, `train-stopped-signal`, `set-trains-limit`, `trains-limit-signal`, `read-trains-count`, `trains-count-signal`, `set-priority`, `priority-signal` |
| `transport-belt` | `express-transport-belt`, `fast-transport-belt`, `transport-belt`, `turbo-transport-belt` | `when`, `logistic when` | `networks`, `output-networks`, `read-contents` |
| `wall` | `stone-wall` | `open-gate when` | `networks`, `output-networks`, `read-sensor`, `output-signal` |

| Word | Value (default) | Blueprint field | In the game | Prototype types |
| --- | --- | --- | --- | --- |
| `output-networks` | `red`, `green` or `none` (both) | `output_networks` | Send to | all that have the word |
| `read-charge` | `true` or `false` (`true`) | `read_charge` | Read charge | all that have the word |
| `output-signal` | signal (the prototype's `default_output_signal`) | `output_signal` | Charge signal | `accumulator` |
| `when` | comparison (not in use) | `circuit_condition`, in use with `circuit_enabled` | Enable/disable | `agricultural-tower`, `ammo-turret`, `artillery-turret`, `assembling-machine`, `asteroid-collector`, `boiler`, `electric-turret`, `fluid-turret`, `furnace`, `inserter`, `land-mine`, `loader`, `loader-1x1`, `mining-drill`, `offshore-pump`, `power-switch`, `pump`, `train-stop`, `transport-belt` |
| `logistic when` | comparison (not in use) | `logistic_condition`, in use with `connect_to_logistic_network` | Logistic network condition | all that have the word |
| `networks` | `red`, `green` or `none` (both) | `input_networks` | Read from | all that have the word |
| `harvest when` | comparison (not in use) | `harvesting_condition`, in use with `enable_harvesting_condition` | Harvest | all that have the word |
| `plant when` | comparison (not in use) | `planting_condition`, in use with `enable_planting_condition` | Plant | all that have the word |
| `read-contents` | `true` or `false` (`false`) | `read_contents` | Read contents | `agricultural-tower`, `assembling-machine`, `furnace`, `lab` |
| `ignore-unlisted when` | comparison (not in use) | `ignore_unlisted_targets_condition`, in use with `set_ignore_unlisted_targets` | Ignore unlisted targets | all that have the word |
| `read-ammo` | `true` or `false` (`false`) | `read_ammo` | Read ammunition | `ammo-turret`, `electric-turret`, `fluid-turret` |
| `set-priority-list` | `true` or `false` (`false`) | `set_priority_list` | Set priority list | all that have the word |
| `read-ammo` | `true` or `false` (`true`) | `read_ammo` | Read ammunition | `artillery-turret` |
| `set-recipe` | `true` or `false` (`false`) | `set_recipe` | Set recipe | all that have the word |
| `include-in-crafting` | `true` or `false` (`true`) | `include_in_crafting` | Include in crafting | all that have the word |
| `read-fuel` | `true` or `false` (`false`) | `read_fuel` | Read fuel | all that have the word |
| `read-ingredients` | `true` or `false` (`false`) | `read_ingredients` | Read ingredients | all that have the word |
| `read-recipe-finished` | `true` or `false` (`false`) | `read_recipe_finished` | Read recipe finished | all that have the word |
| `recipe-finished-signal` | signal (none) | `recipe_finished_signal` | Recipe finished signal | all that have the word |
| `read-working` | `true` or `false` (`false`) | `read_working` | Read working | all that have the word |
| `working-signal` | signal (none) | `working_signal` | Working signal | all that have the word |
| `set-filters` | `true` or `false` (`false`) | `circuit_set_filters` | Set filters | all that have the word |
| `read-contents` | `true` or `false` (`false`) | `circuit_read_contents` | Read contents | `asteroid-collector` |
| `include-hands` | `true` or `false` (`true`) | `include_hands` | Include hands | all that have the word |
| `read-contents` | `true` or `false` (`true`) | `read_contents` | Read contents | `cargo-landing-pad`, `container`, `infinity-container`, `linked-container`, `logistic-container`, `proxy-container`, `space-platform-hub` |
| `read-empty-slots` | `true` or `false` (`false`) | `read_empty_slots` | Read empty slots | all that have the word |
| `empty-slots-signal` | signal (the prototype's `default_empty_slots_signal`) | `empty_slots_signal` | Empty slots signal | all that have the word |
| `set-requests` | `true` or `false` (`false`) | `set_requests` | Set requests | all that have the word |
| `read-temperature` | `true` or `false` (`false`) | `read_temperature` | Read temperature | all that have the word |
| `temperature-signal` | signal (the prototype's `default_temperature_signal`) | `temperature_signal` | Temperature signal | `heat-pipe`, `reactor` |
| `when` | comparison (not in use) | `circuit_condition`, in use with `circuit_condition_enabled` | Enable/disable the logistic connection | `infinity-container`, `logistic-container` |
| `read-contents` | `none`, `contents` or `segment-contents` (`contents`) | `circuit_mode_of_operation` | Read contents | `infinity-pipe`, `pipe`, `pipe-to-ground`, `storage-tank` |
| `temperature-signal` | signal (the prototype's `default_fluid_temperature_signal`) | `temperature_signal` | Temperature signal | `infinity-pipe`, `pipe`, `pipe-to-ground`, `storage-tank` |
| `read-hand` | `none`, `pulse` or `hold` (`none`) | `circuit_hand_read_mode`; `none` is `circuit_read_hand_contents` off | Read hand contents | all that have the word |
| `set-stack-size` | `true` or `false` (`false`) | `circuit_set_stack_size` | Set stack size | all that have the word |
| `stack-size-signal` | signal (the prototype's `default_stack_control_input_signal`) | `stack_control_input_signal` | Stack size signal | all that have the word |
| `set-research` | `true` or `false` (`false`) | `set_research` | Set research | all that have the word |
| `read-research-cost` | `true` or `false` (`false`) | `read_research_cost` | Read research cost | all that have the word |
| `read-technology-level` | `true` or `false` (`false`) | `read_technology_level` | Read technology level | all that have the word |
| `technology-level-signal` | signal (the prototype's `default_technology_level_signal`) | `technology_level_signal` | Technology level signal | all that have the word |
| `read-transfers` | `true` or `false` (`false`) | `circuit_read_transfers` | Read transfers | all that have the word |
| `read-resources` | `none`, `this-miner` or `entire-patch` (`this-miner`) | `circuit_resource_read_mode`; `none` is `circuit_read_resources` off | Read resources | all that have the word |
| `set-filter` | `true` or `false` (`false`) | `set_filter` | Set filter | all that have the word |
| `mode` | `surface` or `universe` (`surface`) | `mode` | Mode | all that have the word |
| `channel` | signal (none) | `universe_channel` | Universe channel | all that have the word |
| `close when` | comparison (not in use) | `circuit_condition`, in use with `circuit_close_signal` | Close signal | all that have the word |
| `read-signal` | `true` or `false` (`true`) | `circuit_read_signal` | Read signal | all that have the word |
| `red-signal` | signal (the prototype's `default_red_output_signal`) | `red_output_signal` | Red signal | all that have the word |
| `orange-signal` | signal (the prototype's `default_orange_output_signal`) | `orange_output_signal` | Yellow signal | all that have the word |
| `green-signal` | signal (the prototype's `default_green_output_signal`) | `green_output_signal` | Green signal | all that have the word |
| `blue-signal` | signal (the prototype's `default_blue_output_signal`) | `blue_output_signal` | Blue signal | all that have the word |
| `read-items` | `none`, `logistics` or `missing-requests` (`logistics`) | `read_items_mode` | Read items | `roboport` |
| `read-robot-stats` | `true` or `false` (`false`) | `read_robot_stats` | Read robot statistics | all that have the word |
| `available-logistic-signal` | signal (the prototype's `default_available_logistic_output_signal`) | `available_logistic_output_signal` | Available logistic robots | all that have the word |
| `total-logistic-signal` | signal (the prototype's `default_total_logistic_output_signal`) | `total_logistic_output_signal` | Total logistic robots | all that have the word |
| `available-construction-signal` | signal (the prototype's `default_available_construction_output_signal`) | `available_construction_output_signal` | Available construction robots | all that have the word |
| `total-construction-signal` | signal (the prototype's `default_total_construction_output_signal`) | `total_construction_output_signal` | Total construction robots | all that have the word |
| `roboport-count-signal` | signal (the prototype's `default_roboport_count_output_signal`) | `roboport_count_output_signal` | Roboport count | all that have the word |
| `read-items` | `none`, `logistic-inventory` or `orbital-requests` (`logistic-inventory`) | `read_items_mode` | Read items | `rocket-silo` |
| `read-launched` | `true` or `false` (`false`) | `read_launched` | Read rocket launched | all that have the word |
| `launched-signal` | signal (the prototype's `default_launched_signal`) | `launched_signal` | Rocket launched signal | all that have the word |
| `send-to-platform` | `true` or `false` (`true`) | `send_to_platform` | Send to platform | all that have the word |
| `read-moving-from` | `true` or `false` (`false`) | `read_moving_from` | Read moving from | all that have the word |
| `read-moving-to` | `true` or `false` (`false`) | `read_moving_to` | Read moving to | all that have the word |
| `read-speed` | `true` or `false` (`false`) | `read_speed` | Read speed | all that have the word |
| `speed-signal` | signal (the prototype's `default_speed_signal`) | `speed_signal` | Speed signal | all that have the word |
| `read-damage-taken` | `true` or `false` (`false`) | `read_damage_taken` | Read damage taken | all that have the word |
| `damage-taken-signal` | signal (the prototype's `default_damage_taken_signal`) | `damage_taken_signal` | Damage taken signal | all that have the word |
| `input-left when` | comparison (not in use; while the other one of its side is, the game has `signal-I < 0` here) | `input_left_condition`, in use with `set_input_side` | Input priority left | all that have the word |
| `input-right when` | comparison (not in use; while the other one of its side is, the game has `signal-I > 0` here) | `input_right_condition`, in use with `set_input_side` | Input priority right | all that have the word |
| `output-left when` | comparison (not in use; while the other one of its side is, the game has `signal-O < 0` here) | `output_left_condition`, in use with `set_output_side` | Output priority left | all that have the word |
| `output-right when` | comparison (not in use; while the other one of its side is, the game has `signal-O > 0` here) | `output_right_condition`, in use with `set_output_side` | Output priority right | all that have the word |
| `send-to-train` | `true` or `false` (`true`) | `send_to_train` | Send to train | all that have the word |
| `read-from-train` | `true` or `false` (`false`) | `read_from_train` | Read train contents | all that have the word |
| `read-stopped-train` | `true` or `false` (`false`) | `read_stopped_train` | Read stopped train | all that have the word |
| `train-stopped-signal` | signal (the prototype's `default_train_stopped_signal`) | `train_stopped_signal` | Stopped train signal | all that have the word |
| `set-trains-limit` | `true` or `false` (`false`) | `set_trains_limit` | Set train limit | all that have the word |
| `trains-limit-signal` | signal (the prototype's `default_trains_limit_signal`) | `trains_limit_signal` | Train limit signal | all that have the word |
| `read-trains-count` | `true` or `false` (`false`) | `read_trains_count` | Read train count | all that have the word |
| `trains-count-signal` | signal (the prototype's `default_trains_count_signal`) | `trains_count_signal` | Train count signal | all that have the word |
| `set-priority` | `true` or `false` (`false`) | `set_priority` | Set priority | all that have the word |
| `priority-signal` | signal (the prototype's `default_priority_signal`) | `priority_signal` | Priority signal | all that have the word |
| `read-contents` | `none`, `pulse`, `hold` or `entire-belt-hold` (`none`) | `circuit_contents_read_mode`; `none` is `circuit_read_hand_contents` off | Read belt contents | `transport-belt` |
| `open-gate when` | comparison (not in use) | `circuit_condition`, in use with `circuit_open_gate` | Open gate | all that have the word |
| `read-sensor` | `true` or `false` (`false`) | `circuit_read_sensor` | Read gate sensor | all that have the word |
| `output-signal` | signal (the prototype's `default_output_signal`) | `output_signal` | Gate sensor signal | `wall` |
<!-- entity-settings:end -->

## Fragments

A fragment is a sequence of entity and wire declarations as they stand inside a circuit block, without the block:

```ebnf
fragment    = { member } | circuit ;
```

```text
constant-combinator source at (40, 80) {
    virtual:signal-A = 1
}

decider-combinator gate at (300, 80) {
    when virtual:signal-A < 10
    output virtual:signal-A = input
}

wire red source.out <-> gate.in
wire green gate.out <-> gate.in
```

It is the text a copy of entities puts on the clipboard (canonical form, no indentation, a blank line between entities and before
the wires), and what a paste on the canvas reads. It is not a file format: a `.face` file is always a circuit. The same rules as
in a circuit apply inside a fragment: names are unique, and every wire connects two entities of the fragment, so a copy never
carries a wire to an entity outside the selection. Comments, `;` and `,` are allowed as in a circuit. The source of a whole
circuit is accepted where a fragment is read and stands for its members; the circuit name is ignored. A fragment with any error
is not a fragment: it is rejected as a whole. Pasted into a circuit, a fragment's entities keep their names where these are
free; a taken name loses its trailing digits and gets the smallest number from 2 that is free (`gate` becomes `gate2`, `gate2`
becomes `gate3`), and the wires of the fragment follow. `tile` is dropped (two entities cannot stand on one tile of the game);
`facing`, the description and the configuration are kept. Because a fragment is ordinary source text, it can also be pasted
between the braces of a circuit in a text editor; names then stay as they are and a clash is the usual duplicate-name error.

## Diagnostics

Errors (block simulation and graphical edits until fixed; the last valid graph stays visible): syntax errors, duplicate entity names, unknown entity or terminal in a wire, a terminal the entity does not have (`.in` of a constant combinator, `.out` of a lamp, `.in` of a pole or a chest, the bare name of a combinator, a lamp or a speaker; `invalid-terminal` says how the entity is wired), a wire from a terminal to itself, integers outside int32, illegal wildcard use, duplicate or contradictory statements (two `when`, two expressions), unknown property or enum value, a declaration whose word is no entity of the game data in use (`unknown-prototype`) or one the editor does not support (`unsupported-prototype`), a speaker with both `when` and `pitch`, a `volume` outside 0 to 100, a setting or a condition that the prototype of the entity does not have, a `blueprint-data` that is not the JSON text of an object.

Warnings (do not block): duplicate or reversed declarations of the same wire (rendered and simulated once), signals unknown to the enabled catalog or belonging to a disabled module/group, an instrument or note the game's speaker does not have (`unknown-instrument`, `unknown-note`), unconfigured combinators and speakers, unused `else output` without `when`, a `tile` that is not on the tile grid for its entity and the direction it faces (`tile-off-grid`), entities whose tiles overlap (`tile-overlap`, on each of them), `facing` on an entity that cannot turn: a lamp, a speaker, a pole, a chest (`unused-facing`), a wire between entities that are further apart than the wire may span (`wire-too-long`). The placement warnings and `wire-too-long` are given for a circuit, not for a fragment.

Wire reach. In the game a circuit wire connects two entities only when they are within its reach, and the reach is per entity: an electric pole has its own (7.5 tiles for a small one, 9 for a medium one, 32 for a big one, 18 for a substation; the table under Electric pole), and so have the two other prototypes that the game gives a reach other than its standard 9 (the `power-switch` 10, the `agricultural-tower` 30); every other entity of this language has 9. A wire may span the smaller reach of its two ends. The reach of the entities without one of their own is not part of the language: it is a setting of the project (`wireReach` in `face.json`, 9 when absent, from 0 to 64, fractions allowed, 0 means unlimited; a number out of range is read as the nearest end of it, 0 or 64) that the editor passes to the analysis (`AnalyzeOptions.wireReach`). A pole keeps its own reach whatever the project says. An unlimited end does not limit: with the setting 0 a wire between two entities without a reach of their own never gets the warning, and a wire to a pole has the pole's reach. So a constant combinator and a small pole connect up to 7.5 tiles, a constant combinator and a big pole up to the project's 9, two big poles up to 32, and a small and a big pole up to 7.5. What is measured is the distance between the two entities, not between their centers or their connectors: the straight line between the nearest points of their selection boxes, the box the game highlights around an entity under the cursor. Per axis that is the gap between the boxes in tiles, 0 where they overlap on that axis, and the distance is the hypotenuse of the two gaps. For most entities the box is the tiles they stand on: two such entities side by side are 0 tiles apart; two 1x1 entities with nine empty tiles between them in a row are 9 apart; with 6 empty tiles between them horizontally and 6 vertically 8.49. A 2x1 combinator counts with both of its tiles, whichever way it faces and whichever of its ends is wired, and a big pole with its four. For 18 prototypes the box is a little smaller or larger than the tiles (the inserters, the splitters, the small electric pole, the stone and the steel furnace, the train stop, the recycler, the rail signal, the display panel, the offshore pump; the entity table has it, `docs/factorio-audit.md` 13.2), and it turns with the entity: an inserter and a chest with one empty tile between them are 1.1 tiles apart, a small pole and a lamp with eight empty tiles between them 8.1. Two electric poles are the exception: a wire between them is measured from center to center, so two small poles reach each other with their centers up to 7.5 tiles apart, which leaves six empty tiles between them in a row. An entity whose `tile` is off the grid is measured as it stands, not as rounded. This is the game's rule, verified against Factorio 2.1.24 (fixture F-24, `docs/factorio-audit.md` 5.4; the recording has every pair of the four poles' reaches, poles against other entities, and every box that is not the tiles). A wire is too long when that distance is greater than the reach; exactly the reach is fine. The warning is on the first declaration of the wire and names both ends, the distance and the reach that applied with whose it is: `Wire from 'source.out' to 'light.in': the entities are 12.4 tiles apart; the wire reach of the project is 9`, `Wire from 'p' to 'light.in': the entities are 8.1 tiles apart; the wire reach of a small electric pole is 7.5`, and between two poles `Wire from 'p1' to 'far': the poles are 9 tiles apart from center to center; the wire reach of a small electric pole is 7.5`. Of two equal reaches the one an entity has by itself is named. A wire with an end that has no `tile` has no distance and gets no warning, and neither does a wire from an entity to itself. The wire stays in the circuit and is simulated like any other.

Every diagnostic carries a source range, a severity, a stable code and a message.

## Identity and editing rules

- Source text identifies entities by name. The language session assigns each entity a stable `id` that survives renames (by command or by typing) so that selection, simulation probes and layout stay attached.
- Setting, moving and removing `tile` (`setTiles`, for any number of entities in one transaction) patches the numbers inside the clause, inserts ` tile (x, y)` behind `at` (or the name) or removes the clause; a tile that is off the grid for its entity is refused. Rotating (`faceEntities`) leaves alone what cannot turn (lamps, speakers, poles, chests) and writes the corrected `tile` together with `facing`; an entity that the game builds in two directions only (the storage tank) is turned to north or east. Mirroring a selection (`arrangeEntities`, for any number of entities in one transaction) writes what a flip changes of each entity together: the numbers of `at`, the numbers of `tile` and the direction word, each patched or inserted as the commands above do it (a new clause goes in the order `at`, `tile`, `facing`). It turns nothing that cannot rotate, never removes a clause, and refuses a `tile` that is off the grid for the entity in the direction it then faces. Where the entities go is the editor's business: on its edit canvas it mirrors the `at` positions within their bounds and leaves `tile` alone, on its blueprint board it mirrors the footprints of the entities that have a `tile` within their bounds and leaves `at` alone; a horizontal flip turns `east` into `west` and back, a vertical one `north` into `south` and back, which covers the same tiles. A new entity (`addEntity`) is one of a prototype of the game data in use, and can be given its `tile` in the same edit; the tile has to be on the grid for the entity in the direction it is added with. Without a name a new entity is called by its kind and the first free number where the kind says what it is (`constant1`, `lamp2`, `pole3`, whichever prototype of the kind), and every other one by its prototype: `fast_inserter1`, `steel_chest2`, with `-` written as `_` and a tier number at the end left out (`assembling_machine1` for an `assembling-machine-2`).
- Which entity of the game an entity is, is changed by replacing the word of its declaration (`updateEntity` with another prototype of the same kind: a small pole becomes a big one, an inserter a fast inserter). Nothing else of the declaration is touched by the change of the word: the block stays as it is, and what the editor's inspector changes in it is its own doing (it keeps the settings the new prototype has too). The word is written bare where it can be.
- Graphical commands are source patches: the smallest set of text changes that performs the operation, applied as one undoable transaction. Unrelated text, comments, spacing and declaration order are never touched. Configuration changes replace only the affected statements; untouched statements keep their trivia.
- Rename rewrites the declaration and every wire reference, a bare name included. Delete removes the entity, every incident wire declaration (including duplicates and reversed forms) and their own-line comments stay with whatever they were attached to unless they are trailing comments of a removed line.
- Adding a wire that already exists (in either direction) is a no-op with no undo entry.
- Paste inserts the entities of a fragment after the last entity and its wires after the last member, as `addEntity` and `addWire` do, in the indentation of the file and in canonical form; it is one transaction.
- Wildcards and signal literals are printed in canonical form by commands; hand-written text is not reformatted.

## Open points for review

- `virtual:signal-A` is explicit but verbose; a shorthand for virtual signals could be added without breaking existing files.
- Selector and lamp use property bags; statement forms can be added later if they read better.
- Components (`import`, `component`, `port`) are reserved, not designed in this version.

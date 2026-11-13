# face circuit language, version 1 (draft)

Status: draft for Milestone 1. The language is the persisted form of a circuit and the single owner of editing history; the graphical editor edits the same text through source patches. Game facts come from `docs/factorio-audit.md` (Factorio 2.1.24). File extension: `.face`. Encoding: UTF-8, LF line endings.

The semantic model produced from this language is `Circuit` in `@face/model` (`packages/model/src/circuit.ts`); that file defines the defaults referenced below.

## Example

```text
// A counter that lights a lamp.
circuit "Feedback example" {
    constant source at (40, 80) {
        virtual:signal-A = 1
    }

    decider gate at (300, 80) {
        when virtual:signal-A < 10
        output virtual:signal-A = input
    }

    arithmetic twice at (300, 240) {
        virtual:signal-B = virtual:signal-A[red] * 2
    }

    lamp light at (560, 80) {
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
- Integer: optional `-` followed by decimal digits, or `0x` hexadecimal; must fit signed 32 bit. A `-` directly followed by a digit after an operator or `=` is a sign. Decimal numbers (`1.5`, `-0.5`) are only legal in `tile (...)` and as a section `multiplier`.
- String: double-quoted, on one line. Escapes: `\"`, `\\`, `\n` (line break), `\t` (tab), `\r` (carriage return). The editor writes line breaks, tabs and carriage returns as escapes; a tab typed into a string is the same value as `\t`.
- Signal literal: `kind:name` or `kind:name@quality`, written without spaces. `kind` is one of `item`, `fluid`, `virtual`, `entity`, `recipe`, `space-location`, `asteroid-chunk`, `quality`, `custom`. `name` and `quality` match `[A-Za-z0-9_][A-Za-z0-9_.-]*`; any other prototype name is written quoted: `item:"odd name"@"odd quality"`. Because names may contain `-`, the binary operators `-` and `+` must be surrounded by whitespace.
- Wildcards are keywords, not signal literals: `each`, `anything`, `everything`. (`virtual:signal-each` etc. are accepted and normalized to the keyword form by the editor; they denote the same signals.)
- Color literal: `#rrggbb`.

Reserved keywords: `circuit constant arithmetic decider selector lamp pole speaker wire red green at tile facing north east south west in out when and or output else input section each anything everything true false AND OR XOR import component port`.
`import`, `component` and `port` are reserved for reusable components (Milestone 4) and currently produce a "not supported yet" diagnostic.
`pole` and `speaker` became reserved with the two entity kinds: a file that used one of them as an entity name has to rename that entity. Every word that names an entity kind is reserved, so each kind that is added later reserves its word. The names of properties (`prototype`, `pitch`, `note`, ...) are not reserved.

## Grammar

```ebnf
file        = circuit ;
circuit     = "circuit" STRING "{" { member } "}" ;
member      = entity | wire ;

entity      = kind IDENT [ "at" point ] [ "tile" point ] [ "facing" direction ] "{" { statement } "}" ;
kind        = "constant" | "arithmetic" | "decider" | "selector" | "lamp" | "pole" | "speaker" ;
point       = "(" NUMBER "," NUMBER ")" ;
direction   = "north" | "east" | "south" | "west" ;

wire        = "wire" color terminal "<->" terminal ;
color       = "red" | "green" ;
terminal    = IDENT "." ( "in" | "out" ) | IDENT ;    (* the bare name: the one connection point of a pole *)

signal      = SIGNAL | "each" | "anything" | "everything" ;
networks    = "[" ( color | "none" ) "]" ;            (* absent: both networks *)
sigref      = signal [ networks ] ;
operand     = sigref | INT ;
comparator  = "<" | ">" | "=" | "!=" | "<=" | ">=" ;
property    = PROPNAME "=" value ;                      (* PROPNAME: identifier, may contain "-" *)
value       = INT | STRING | COLOR | "true" | "false" | signal | IDENT-like enum word ;
```

A network selection says which of the two input networks a signal is read from: `S` reads the sum of red and green (the game default), `S[red]` and `S[green]` one of them, `S[none]` neither. The game allows unchecking both boxes; a signal read from no network is absent, so its value is 0 and wildcards find no signals there. `none` is not a reserved word: it has this meaning only between the brackets and as the value of the lamp's `networks` property, and remains a legal entity name.

A kind is a family of behaviour, not one entity of the game. Where the game has several entities of one family, the declaration says which one it is with the property `prototype`, whose value is the game's own name of the entity as a blueprint has it: `pole p { prototype = big-electric-pole }`. The first prototype of a kind is the default and is not written by the editor. Today only `pole` has several; the same property serves every family that follows (belts, inserters, chests). The prototype decides the tiles an entity covers and, for a pole, its wire reach; it never affects the simulation.

Terminals. In the game only the arithmetic, decider and selector combinator have two connectors, an input and an output: `gate.in`, `gate.out`. Every other entity has one. A constant combinator only writes to it (`source.out`), a lamp and a speaker only read from it (`light.in`). A pole does neither, it only joins the wires on it, and its connection point is written as the bare entity name: `wire red source.out <-> p1`, `wire green p1 <-> p2`, `wire red p2 <-> light.in`. All wires of one color on a pole are one network; red and green stay apart.

Entity names are unique within a circuit. Members may appear in any order; a wire may precede the entities it references. Statement order inside an entity is preserved; order is semantically relevant only for decider outputs, constant filters and sections.

`at (x, y)` is the schematic position on the editor canvas (integers, canvas units, 20-unit grid). If absent, the editor auto-places the entity and writes the clause on first move.

`tile (x, y)` is the optional position of the entity in the game, as a blueprint has it: the center of the entity in tiles, x growing to the east and y to the south, relative to an origin that is free to choose. It is independent of `at`; an entity without the clause has no place in the game yet. A tile is one unit square between whole coordinates, so a center has to fit the tiles the entity covers (`docs/factorio-audit.md` 3.1 and 5.4):

| Entity | Covers | Center |
| --- | --- | --- |
| `constant`, `lamp`, `speaker`, `pole` as `small-electric-pole` or `medium-electric-pole` | 1 tile | x and y end in .5: `tile (2.5, -0.5)` |
| `pole` as `big-electric-pole` or `substation` | 2 x 2 tiles | a whole x and a whole y: `tile (4, -1)` covers the tiles from x = 3 to 5 and from y = -2 to 0 |
| `arithmetic`, `decider`, `selector` facing east or west (also without `facing`) | 2 tiles side by side | a whole x, y ends in .5: `tile (3, 0.5)` covers the tiles from x = 2 to 4 |
| `arithmetic`, `decider`, `selector` facing north or south | 2 tiles, one above the other | x ends in .5, a whole y: `tile (6.5, -21)` covers the tiles from y = -22 to -20 |

The rule behind the table: along an axis on which the entity covers an odd number of tiles the coordinate of the center ends in .5, along one with an even number it is whole. The sizes are game data per prototype (`PROTOTYPES` in `@face/model`).

Of the two tiles of a combinator the one `facing` points to carries the output and the other the input. An entity with one connector has no such halves, also when it covers 2 x 2 tiles. A `tile` that does not fit this grid is kept as written and gets the warning `tile-off-grid`, which names the nearest center that fits. Two entities whose tiles overlap get the warning `tile-overlap` each, naming the other; the game cannot place them like that. For the overlap, a tile off the grid counts as the nearest footprint on it.

`facing <direction>` is the direction the entity faces: the direction its output points to, seen from its input, as in the game. Without the clause an entity faces east. On the editor canvas the direction decides which edges of the card carry the connection pins; the card and its text do not turn. Facing east, the inputs are on the left edge and the outputs on the right edge, red above green. The pins turn with the direction as one figure: facing south the outputs are on the bottom edge and the inputs on the top edge, red right of green; facing west the outputs are on the left and the inputs on the right, red below green; facing north the outputs are on the top and the inputs on the bottom, red left of green. A constant combinator follows the same rule with the one terminal it has; a lamp, a speaker and a pole do not rotate and always have their terminal on the left edge. The editor writes the clause when an entity is rotated and from then on keeps it, also as `facing east`. `facing` is also the in-game direction kept for blueprint round trips. Neither `tile` nor `facing` ever affects simulation.

The four combinators can be turned; a lamp, a speaker and a pole cannot, in the game as in the editor. `facing` on one of them is legal and kept, has no effect (the entity is drawn as if it faced east, and the clause is not meant for a blueprint) and gets the warning `unused-facing`. When the editor turns a combinator that has a `tile`, it corrects the tile in the same edit, because the half tile moves to the other axis: the top-left tile of the two stays where it is. `decider d tile (1, 0.5)` (on the tiles from x 0 to 2, input on the left one) becomes `tile (0.5, 1) facing south` and `tile (0.5, 1) facing north` (on that left tile and the one below it) and stays `tile (1, 0.5)` with `facing west`: a half turn keeps both tiles and swaps input and output, as flipping a combinator does in the game. A tile that was off the grid is first moved to the nearest place on it. A constant combinator keeps its tile as it is. Changing the word by hand does not touch `tile`; the warning then says what fits. On the blueprint board the editor refuses a turn that would put the entity onto a tile of another one; on the edit canvas it turns, and the overlap gets its warning.

### Common property

`description = "text"` is allowed in every entity. It is the free text of the game's "Add description" on a combinator; a text of several lines is written on one source line with `\n` between the lines:

```
decider gate at (300, 80) {
    description = "Counts A up to ten,\nthen starts over."
    when virtual:signal-A < 10
    output virtual:signal-A = input
}
```

The text is kept exactly as written, including blanks at either end. An empty description is the same as none: the editor removes the property instead of writing `description = ""` (one written by hand stays until it is changed). The description never affects the simulation. The game has it on the four combinators only (`player_description` in a blueprint); on a lamp, a pole and a speaker it is a note of the project. No length limit is enforced: none is documented for the game (open; `docs/factorio-audit.md` 3.2 states none).

### constant

```ebnf
constant-stmt = filter | section | "enabled" "=" BOOL | property ;
filter        = SIGNAL "=" INT ;
section       = "section" [ STRING ] "{" { filter | "active" "=" BOOL | "multiplier" "=" NUMBER } "}" ;
```

Bare filters form one anonymous section. If `section` blocks are present, bare filters are an error. A quoted section name is the logistic group. Defaults: `enabled = true`, `active = true`, `multiplier = 1`. The multiplier is a decimal number and may be negative (the game stores a float). A signal may appear only once per section (error); the same signal in different sections adds up. Wildcards are not legal in a constant combinator.

### arithmetic

```ebnf
arithmetic-stmt = signal "=" operand arith-op operand | property ;
arith-op        = "*" | "/" | "+" | "-" | "%" | "^" | "<<" | ">>" | "AND" | "OR" | "XOR" ;
```

Exactly one expression statement; none means an unconfigured combinator (model defaults). The left side is the output signal and takes no network selection. `each` rules follow the game: `each` as output requires `each` as an input operand; `anything`/`everything` are not legal here.

### decider

```ebnf
decider-stmt = when | output | "else" output | property ;
when         = "when" condition { ( "and" | "or" ) condition } ;
condition    = sigref comparator operand ;
output       = "output" signal "=" ( INT | "input" [ networks ] ) ;
```

At most one `when`. `and` binds tighter than `or` and there is no grouping, matching the game's condition list (`compare_type` of each condition after the first). `output S = input` copies the input count of `S` (optionally from one network, `input[red]` or `input[green]`, or from none, `input[none]`); `output S = 5` emits a constant. `else output` lines are emitted when the condition is false. Outputs keep their source order.

### selector

Property bag; `operation` selects the mode and determines which other properties are legal.

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

Example: `selector pick at (0, 0) { operation = select  order = min  index = virtual:signal-I }`.

### lamp

```ebnf
lamp-stmt = "when" sigref-without-networks comparator ( SIGNAL | INT ) | property ;
```

`when` is the circuit enable condition (its presence sets `circuit_enabled`). Properties: `networks = red`, `green` or `none` (default both; the lamp's input network selection, which applies to the condition and to the color signals), `always-on = BOOL` (`false`), `colors = mapping`, `components` or `packed-rgb` (presence sets `use_colors`), `red`, `green`, `blue`, `rgb` (signals for the color modes), `color = #rrggbb` (static color).

### pole

```ebnf
pole-stmt = "prototype" "=" ( "small-electric-pole" | "medium-electric-pole" | "big-electric-pole" | "substation" ) | property ;
```

An electric pole relays circuit signals and lets wires span more distance. It has no behaviour of its own and no settings besides which pole it is; `pole p { }` is a complete declaration and a `small-electric-pole`. Game data per prototype:

| `prototype` | Covers | Wire reach |
| --- | --- | --- |
| `small-electric-pole` (default) | 1 tile | 7.5 |
| `medium-electric-pole` | 1 tile | 9 |
| `big-electric-pole` | 2 x 2 tiles | 32 |
| `substation` | 2 x 2 tiles | 18 |

A pole has one connection point, the bare name (see Terminals above); `p.in` and `p.out` are errors. Its wire reach is its own and does not follow the project setting (see Wire reach below). In the simulation a pole joins the wires on it: every wire of one color on a pole belongs to one network, with no delay.

```
pole relay at (300, 80) tile (4.5, 0.5) { }
pole trunk at (560, 80) tile (10, 1) {
    prototype = big-electric-pole
}
wire red source.out <-> relay
wire red relay <-> trunk
```

### speaker

```ebnf
speaker-stmt = "when" sigref-without-networks comparator ( SIGNAL | INT ) | property ;
```

The programmable speaker (`programmable-speaker`). It reads the sum of the red and the green network on its one terminal, `name.in`; it has no network selection in the game. It plays in one of two ways, which exclude each other:

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
speaker alarm at (560, 80) {
    when item:iron-plate < 100
    instrument = alarms
    note = siren
    playback = global
    show-alert = true
    alert-message = "Iron is running out"
}
speaker tune { pitch = virtual:signal-P  instrument = piano  volume = 60 }
```

## Fragments

A fragment is a sequence of entity and wire declarations as they stand inside a circuit block, without the block:

```ebnf
fragment    = { member } | circuit ;
```

```text
constant source at (40, 80) {
    virtual:signal-A = 1
}

decider gate at (300, 80) {
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

Errors (block simulation and graphical edits until fixed; the last valid graph stays visible): syntax errors, duplicate entity names, unknown entity or terminal in a wire, a terminal the entity kind does not have (`constant.in`, `lamp.out`, `pole.in`, the bare name of anything but a pole; `invalid-terminal` says how the entity is wired), a wire from a terminal to itself, integers outside int32, illegal wildcard use, duplicate or contradictory statements (two `when`, two expressions), unknown property or enum value (an unknown `prototype` among them), a speaker with both `when` and `pitch`, a `volume` outside 0 to 100.

Warnings (do not block): duplicate or reversed declarations of the same wire (rendered and simulated once), signals unknown to the enabled catalog or belonging to a disabled module/group, an instrument or note the game's speaker does not have (`unknown-instrument`, `unknown-note`), unconfigured combinators and speakers, unused `else output` without `when`, a `tile` that is not on the tile grid for the kind and direction of its entity (`tile-off-grid`), entities whose tiles overlap (`tile-overlap`, on each of them), `facing` on a lamp, a speaker or a pole (`unused-facing`), a wire between entities that are further apart than the wire may span (`wire-too-long`). The placement warnings and `wire-too-long` are given for a circuit, not for a fragment.

Wire reach. In the game a circuit wire connects two entities only when they are within its reach, and the reach is per entity: an electric pole has its own (7.5 tiles for a small one, 9 for a medium one, 32 for a big one, 18 for a substation; the table under `pole`), every other entity of this language has 9. A wire may span the smaller reach of its two ends. The reach of the entities without one of their own is not part of the language: it is a setting of the project (`wireReach` in `face.json`, 9 when absent, from 0 to 64, fractions allowed, 0 means unlimited; a number out of range is read as the nearest end of it, 0 or 64) that the editor passes to the analysis (`AnalyzeOptions.wireReach`). A pole keeps its own reach whatever the project says. An unlimited end does not limit: with the setting 0 a wire between two entities without a reach of their own never gets the warning, and a wire to a pole has the pole's reach. So a constant combinator and a small pole connect up to 7.5 tiles, a constant combinator and a big pole up to the project's 9, two big poles up to 32, and a small and a big pole up to 7.5. What is measured is the distance between the two entities, not between their centers or their connectors: the straight line between the nearest points of their tile footprints. Per axis that is the gap between the footprints in tiles, 0 where they overlap on that axis, and the distance is the hypotenuse of the two gaps. Two entities side by side are 0 tiles apart; two 1x1 entities with nine empty tiles between them in a row are 9 apart; with 6 empty tiles between them horizontally and 6 vertically 8.49. A 2x1 combinator counts with both of its tiles, whichever way it faces and whichever of its ends is wired, and a big pole with its four. An entity whose `tile` is off the grid is measured as it stands, not as rounded. This is the game's rule, verified against Factorio 2.1.24 (fixture F-24, `docs/factorio-audit.md` 5.4; the recording has the small, the medium and the big pole, the substation's 18 is from the game data until it is recorded again). A wire is too long when that distance is greater than the reach; exactly the reach is fine. The warning is on the first declaration of the wire and names both ends, the distance and the reach that applied with whose it is: `Wire from 'source.out' to 'light.in': the entities are 12.4 tiles apart; the wire reach of the project is 9`, `Wire from 'p1' to 'far': the entities are 8.5 tiles apart; the wire reach of a small electric pole is 7.5`. Of two equal reaches the one an entity has by itself is named. A wire with an end that has no `tile` has no distance and gets no warning, and neither does a wire from an entity to itself. The wire stays in the circuit and is simulated like any other.

Every diagnostic carries a source range, a severity, a stable code and a message.

## Identity and editing rules

- Source text identifies entities by name. The language session assigns each entity a stable `id` that survives renames (by command or by typing) so that selection, simulation probes and layout stay attached.
- Setting, moving and removing `tile` (`setTiles`, for any number of entities in one transaction) patches the numbers inside the clause, inserts ` tile (x, y)` behind `at` (or the name) or removes the clause; a tile that is off the grid for its entity is refused. Rotating (`faceEntities`) leaves lamps, speakers and poles alone and writes the corrected `tile` together with `facing`. A new entity (`addEntity`) can be given its `tile` in the same edit; it has to be on the grid for the entity facing east. `addEntity` takes the `prototype` of a kind that has several (a new `pole` is a small one without it).
- Graphical commands are source patches: the smallest set of text changes that performs the operation, applied as one undoable transaction. Unrelated text, comments, spacing and declaration order are never touched. Configuration changes replace only the affected statements; untouched statements keep their trivia.
- Rename rewrites the declaration and every wire reference, the bare name of a pole included. Delete removes the entity, every incident wire declaration (including duplicates and reversed forms) and their own-line comments stay with whatever they were attached to unless they are trailing comments of a removed line.
- Adding a wire that already exists (in either direction) is a no-op with no undo entry.
- Paste inserts the entities of a fragment after the last entity and its wires after the last member, as `addEntity` and `addWire` do, in the indentation of the file and in canonical form; it is one transaction.
- Wildcards and signal literals are printed in canonical form by commands; hand-written text is not reformatted.

## Open points for review

- `virtual:signal-A` is explicit but verbose; a shorthand for virtual signals could be added without breaking existing files.
- Selector and lamp use property bags; statement forms can be added later if they read better.
- Components (`import`, `component`, `port`) are reserved, not designed in this version.

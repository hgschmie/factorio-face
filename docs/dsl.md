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
- String: double-quoted, escapes `\"`, `\\`, `\n`.
- Signal literal: `kind:name` or `kind:name@quality`, written without spaces. `kind` is one of `item`, `fluid`, `virtual`, `entity`, `recipe`, `space-location`, `asteroid-chunk`, `quality`, `custom`. `name` and `quality` match `[A-Za-z0-9_][A-Za-z0-9_.-]*`; any other prototype name is written quoted: `item:"odd name"@"odd quality"`. Because names may contain `-`, the binary operators `-` and `+` must be surrounded by whitespace.
- Wildcards are keywords, not signal literals: `each`, `anything`, `everything`. (`virtual:signal-each` etc. are accepted and normalized to the keyword form by the editor; they denote the same signals.)
- Color literal: `#rrggbb`.

Reserved keywords: `circuit constant arithmetic decider selector lamp wire red green at tile facing north east south west in out when and or output else input section each anything everything true false AND OR XOR import component port`.
`import`, `component` and `port` are reserved for reusable components (Milestone 4) and currently produce a "not supported yet" diagnostic.

## Grammar

```ebnf
file        = circuit ;
circuit     = "circuit" STRING "{" { member } "}" ;
member      = entity | wire ;

entity      = kind IDENT [ "at" point ] [ "tile" point ] [ "facing" direction ] "{" { statement } "}" ;
kind        = "constant" | "arithmetic" | "decider" | "selector" | "lamp" ;
point       = "(" NUMBER "," NUMBER ")" ;
direction   = "north" | "east" | "south" | "west" ;

wire        = "wire" color terminal "<->" terminal ;
color       = "red" | "green" ;
terminal    = IDENT "." ( "in" | "out" ) ;

signal      = SIGNAL | "each" | "anything" | "everything" ;
networks    = "[" color "]" ;                         (* absent: both networks *)
sigref      = signal [ networks ] ;
operand     = sigref | INT ;
comparator  = "<" | ">" | "=" | "!=" | "<=" | ">=" ;
property    = PROPNAME "=" value ;                      (* PROPNAME: identifier, may contain "-" *)
value       = INT | STRING | COLOR | "true" | "false" | signal | IDENT-like enum word ;
```

Entity names are unique within a circuit. Members may appear in any order; a wire may precede the entities it references. Statement order inside an entity is preserved; order is semantically relevant only for decider outputs, constant filters and sections.

`at (x, y)` is the schematic position on the editor canvas (integers, canvas units, 20-unit grid). If absent, the editor auto-places the entity and writes the clause on first move. `tile (x, y)` and `facing` are the optional in-game placement kept for blueprint round trips; they never affect simulation.

### Common property

`description = "text"` is allowed in every entity (the in-game entity description).

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

At most one `when`. `and` binds tighter than `or` and there is no grouping, matching the game's condition list (`compare_type` of each condition after the first). `output S = input` copies the input count of `S` (optionally from one network); `output S = 5` emits a constant. `else output` lines are emitted when the condition is false. Outputs keep their source order.

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

`when` is the circuit enable condition (its presence sets `circuit_enabled`). Properties: `networks = red` or `green` (default both; the lamp's input network selection), `always-on = BOOL` (`false`), `colors = mapping`, `components` or `packed-rgb` (presence sets `use_colors`), `red`, `green`, `blue`, `rgb` (signals for the color modes), `color = #rrggbb` (static color).

## Diagnostics

Errors (block simulation and graphical edits until fixed; the last valid graph stays visible): syntax errors, duplicate entity names, unknown entity or terminal in a wire, a terminal the entity kind does not have (`constant.in`, `lamp.out`), a wire from a terminal to itself, integers outside int32, illegal wildcard use, duplicate or contradictory statements (two `when`, two expressions), unknown property or enum value.

Warnings (do not block): duplicate or reversed declarations of the same wire (rendered and simulated once), signals unknown to the enabled catalog or belonging to a disabled module/group, unconfigured combinators, unused `else output` without `when`.

Every diagnostic carries a source range, a severity, a stable code and a message.

## Identity and editing rules

- Source text identifies entities by name. The language session assigns each entity a stable `id` that survives renames (by command or by typing) so that selection, simulation probes and layout stay attached.
- Graphical commands are source patches: the smallest set of text changes that performs the operation, applied as one undoable transaction. Unrelated text, comments, spacing and declaration order are never touched. Configuration changes replace only the affected statements; untouched statements keep their trivia.
- Rename rewrites the declaration and every wire reference. Delete removes the entity, every incident wire declaration (including duplicates and reversed forms) and their own-line comments stay with whatever they were attached to unless they are trailing comments of a removed line.
- Adding a wire that already exists (in either direction) is a no-op with no undo entry.
- Wildcards and signal literals are printed in canonical form by commands; hand-written text is not reformatted.

## Open points for review

- `virtual:signal-A` is explicit but verbose; a shorthand for virtual signals could be added without breaking existing files.
- Selector and lamp use property bags; statement forms can be added later if they read better.
- Components (`import`, `component`, `port`) are reserved, not designed in this version.

# @face/renderer

The React workbench of FActorio Circuit Editor. It runs in the sandboxed Electron renderer and talks to the main process only through the
typed `window.face` API (`apps/desktop/src/ipc.ts`, imported type-only).

Two layers:

- `session/` owns everything that is not a view: the source document with its history, the analysis, the selection, the simulation, the
  catalog services and the project file. It is plain TypeScript without React and runs headless (that is how it is tested).
- Everything else is presentational: views take plain props (types from `@face/model`, view state, callbacks) and contain no document
  logic. `App.tsx` is the one place that connects the two.

## Structure

```
src/
  App.tsx              composition root: session hook, catalog icons, signal picker and signal descriptions for the views
  main.tsx, index.html entry point; index.html carries the Content-Security-Policy
  platform.ts          the platform, and where keyboard input belongs (text controls, controls that use the arrow keys)
  session/
    projectSession.ts  ProjectSession: implements WorkbenchController, wires the parts below, batches change notifications
    document.ts        SourceDocument: the CodeMirror EditorState (text, history, selection) with or without a mounted view
    analysis.ts        runs the language per document version, drops stale results, keeps the last valid circuit, shares structure
    drafts.ts          inspector edits the language cannot write yet: normalization, completeness check, hints
    clipboard.ts       copy and paste of entities: the clipboard text, what is accepted from it, where a pasted group lands   (pure)
    simulationRunner.ts  compile on change, keep state by semantic fingerprint, timer, bounded history, SimulationView
    simulationView.ts  snapshots to dock traces and card statuses                    (pure)
    catalogService.ts  per module set: SignalResolver, signal info, picker tree, module list for the settings
    environment.ts     simulation environment from the catalog (order, stack sizes, rocket capacity, qualities)   (pure)
    persistence.ts     project file mapping, dirty comparison, starter project      (pure)
    completion.ts      completion candidates from the language's expectations and the catalog   (pure)
    editorSupport.ts   CodeMirror glue: token kinds, lint transaction, completion source
    starter.ts         the example circuit of docs/dsl.md, the content of a new project
    useProjectSession.ts  React binding (useSyncExternalStore) and the `window.faceSession` probe
  workbench/
    controller.ts      the WorkbenchController seam (state, commands, shared view types)
    Workbench.tsx      shell: lays out the panels, routes callbacks to commands, wires the native menu and the close handshake
    selectionText.ts   the selection in words: status bar text, counts, wire labels   (pure)
    TopBar.tsx         title bar (brand, Circuit / Source / Split) and project bar (name, save state, undo, redo, fit, settings, save)
    Palette.tsx        tools (select, red wire, green wire), the five building blocks, entity list
    SourcePane.tsx     file heading, SourceEditor, problems list (errors first, a click selects the range)
  canvas/
    Canvas.tsx         SVG canvas: camera, gestures, pending wire, context menu; emits callbacks only
    Scene.tsx          memoized wires (with their click target) and cards, culled to the visible area
    EntityCard.tsx     one memoized card (kind, description marker, icon, name, summary, live status rows, a red and a green pin per side in
                       TERMINALS, on the edges the entity's facing gives them)
    statusRows.ts      the status rows of a card: geometry, which signals fit, the rows as text   (pure)
    ContextMenu.tsx    keyboard-navigable popup menu
    geometry.ts        card and pin geometry (`pinPoint`, `pinEdge`, `pinHeading`), rectangles  (pure)
    viewport.ts        camera transforms, zoom, fit, culling rectangle (pure)
    drag.ts            snap, drag threshold, group drag, placement     (pure)
    wireRouting.ts     wire routes for every combination of pin edges, SVG path data   (pure)
  editor/
    SourceEditor.tsx   CodeMirror view over an `EditorBinding`; owns no state
    extensions.ts      editor chrome: gutters, selection, indentation, keys, theme
    theme.ts           editor colors in the app palette
    tokenHighlight.ts  viewport decorations from an external tokenizer
    tokens.ts          token kind to class mapping, minimal text diff  (pure)
  inspector/
    Inspector.tsx      identity, rename + Delete at the top, description, draft hint, settings slot, connections; a selected wire;
                       the summary of several selected things; undo and redo from its fields
    EntitySettingsForm.tsx and ConstantForm / ArithmeticForm / DeciderForm / SelectorForm / LampForm
    SignalField.tsx    validated `kind:name[@quality]` input with icon, name, warning and the picker slot
    fields.tsx         text, number, select and checkbox fields, the red/green NetworkToggle, the text a field holds on its own
    formParts.tsx, immutable.ts, validation.ts
  picker/
    SignalPicker.tsx   signal picker like the game's: group tabs, subgroup rows, search, quality row
  settings/
    ProjectSettings.tsx  project name and the five standard modules as signal groups
  shortcuts/
    shortcuts.ts       the shortcut table: every key of the app, key matching, labels per platform, the arrow distance   (pure)
    ShortcutOverview.tsx  the modal overview of all shortcuts
  simulation/
    SimulationDock.tsx controls, trace table with sparklines, tick counter
    sparkline.ts       sparkline geometry                              (pure)
  entities/            kind labels, signal text forms (short names, lists, compact numbers), card summaries, the direction an entity
                       faces and its quarter turns (`facing.ts`)  (pure)
  icons/               interface glyphs, entity icons, catalog icon resolvers (with probes for the git-ignored artwork)
  styles/              tokens.css and one stylesheet per area
test/                  vitest: pure view modules
test/session/          vitest: the session, headless (commands, invalid source, simulation, catalog, persistence, drafts)
```

End-to-end tests live in `tests/e2e/` and drive the built app with Playwright's Electron support.

## The WorkbenchController seam

`workbench/controller.ts` defines what the views get from the session:

```ts
interface WorkbenchController {
  readonly state: WorkbenchState;       // immutable snapshot; a new object per change, unchanged parts keep identity
  readonly commands: WorkbenchCommands; // stable object; commands never throw, failures arrive as state.error
  readonly editor: EditorBinding;       // the session-owned editor state: { state, apply(transactions), attach(view) }
}
```

`WorkbenchState`: `project` (name, path, fileName, dirty, epoch), `circuit` (last valid `Circuit`), `editable` (false while the source
has errors), `selection` (entity ids), `wireSelection` (wire keys), `mode`, `tool`, `source`, `diagnostics` (with line numbers), `canUndo` / `canRedo`, `simulation`
(`SimulationView`: running, tick, speed, traces, per-entity status with inputs per wire color, notice), `catalog` (`CatalogView`: modules, qualities, `picker()`,
`describe(signal)`), `draft` (pending inspector edit of the selected entity) and `error`.

`WorkbenchCommands`: view (`setMode`, `setTool`, `select`, `dismissError`), document (`placeEntity`, `moveEntities`, `rotateEntities`, `faceEntities`, `updateEntity`,
`discardDraft`, `renameEntity`, `deleteEntities`, `deleteSelection`, `copyEntities`, `pasteEntities`, `nudgeSelection`, `duplicateSelection`, `addWire`, `removeWire`,
`toggleWire`, `setSource`, `undo`, `redo`),
simulation (`run`, `pause`,
`step`, `resetSimulation`, `setSpeed`), settings (`setModuleEnabled`, `setProjectName`) and project (`newProject`, `openProject`,
`loadProject`, `save`, `saveAs`).

## How the session works

- **One document, one history.** `SourceDocument` holds a CodeMirror `EditorState`. A mounted `SourceEditor` is created from that state
  and hands every transaction to `EditorBinding.apply`; the session's own edits go through the same function. Mounting, hiding or
  unmounting the editor changes nothing about text, history or selection. Undo and redo are CodeMirror's, for typing, canvas and inspector
  alike.
- **Commands are source patches.** Every graphical command runs the matching `@face/language` edit command against the current analysis
  and dispatches its text changes as one transaction with `isolateHistory`, so it is exactly one undo step. A command without changes
  (a wire that exists, a move to the same place) dispatches nothing. Typing never merges into a command step.
- **Field edits are one step.** The inspector passes a `coalesce` key per focus of a text or color input; consecutive `updateEntity`
  calls with the same key, with nothing else touching the document in between, are merged into the previous history event.
- **Undo from a text field.** The document history is the only undo authority; no text field of the window has an undo of its own.
  Edit > Undo and Redo arrive in `Workbench` as menu commands (on macOS that is also where Cmd+Z ends while a field has the focus).
  Where the browser would apply its own undo to a field (Ctrl+Z on the other platforms), `Workbench` cancels the `beforeinput` event
  (`historyUndo`, `historyRedo`) and takes the same path; the browser keeps one undo stack for all fields of the window, and applying
  it would arrive as typing and be written as a new edit. With the focus in the inspector the request goes to `InspectorHandle.history`:
  what is not written yet (text a field could not parse, a name before Return, a pending draft) is taken back by undo, which then
  goes no further, and is dropped by redo; otherwise it is one step in the document history. The fields then show the document's
  values (`FieldTextEpochContext` invalidates the text they hold on their own; that update is rendered at once with `flushSync`, so
  that a key arriving right behind the command is typed into what the undo left). In a text field that is not part of the document
  (project name, signal search) undo and redo do nothing. The source editor keeps CodeMirror's handling.
- **Description.** Every entity has a multi-line Description box under its name (`DescriptionField` in `Inspector.tsx`): one line
  high while empty, as high as its text up to eight lines, then it scrolls. Return is a line break, so unlike the other fields the
  text is not written while it is typed: it is written when the box is left or on Cmd/Ctrl+Return, as one `updateEntity` without a
  `coalesce` key, which is one undo step. Until then the box carries `data-unwritten`; Escape drops the text, and so does the
  first undo. Text of blanks only is written as no description, which removes the property from the source. The box edits the
  pending draft like any settings field, so a description added to an incomplete edit waits with it. In the source the text is
  one line, `description = "..."` with `\n` between the lines (`docs/dsl.md`). A card with a description shows the `note` glyph in
  its top right corner (`g.card-note`) and the text in its tooltip. Lamps have no description in the game; the box says so in its
  tooltip and the text stays in the project.
- **Saving while a field holds unwritten text.** A name or a description is written when its field is left. Save and Save As
  (menu, key, the close prompt) first leave and re-enter the focused field when it carries `data-unwritten` (`writeFocusedField`
  in `Workbench.tsx`), so the saved file has the text and the caret stays where it was.
- **Rotation.** `facing` in the entity header is the direction the output points to; without the clause an entity faces east
  (`DEFAULT_FACING` of `@face/language`, `facingOf` in `entities/facing.ts`). `rotateEntities(ids, turn)` turns each of the
  entities a quarter turn in place (clockwise: east, south, west, north), `faceEntities(ids, direction)` sets a direction. Both
  run the language command `faceEntities`, which patches the direction word of the clause or inserts ` facing <direction>`
  behind `tile`, `at` or the name and never removes a clause: one transaction for all entities, one undo step, nothing for an
  entity that faces the direction already. A rotation therefore always leaves an explicit clause, `facing east` included. Name,
  position and settings edits keep the direction (`updateEntity` takes the placement from the document). The simulation does
  not see it: `semanticFingerprint` is unchanged, so a running engine, its tick and its history stay. Copy and paste keep it.
- **Network toggles.** `NetworkToggle` writes any of the four selections; both off is `[none]` after a signal and `networks = none` on
  a lamp. A color without a wire on the entity's input terminal is drawn grayed (class `unwired`, dashed outline, a title that says
  so) but works as usual. The inspector passes the connected colors down through `InputWiresContext`.
- **Copy, cut and paste of entities.** The clipboard carries text: `copyEntities(ids)` prints the entities and every wire whose two
  ends are both among them as a circuit fragment (`docs/dsl.md`, "Fragments"), in canonical form, from the circuit on show; it
  therefore also works while the source has errors. The text can be pasted into another project, another window, a text editor or
  the source pane. `pasteEntities(text, corner?)` reads the text with `analyzeFragment` and runs the language command
  `pasteFragment`: one transaction, one undo step, the copies appended where `addEntity` and `addWire` put theirs, in the
  indentation of the file. A taken name loses its trailing digits and gets the smallest number from 2 that is free (`gate` becomes
  `gate2`, `gate2` becomes `gate3`) and the wires follow; `tile` is dropped, everything else is copied. The copies get ids of their
  own and are the selection afterwards. Text that is not a fragment as a whole (or declares no entity, or is longer than a circuit
  source may be) changes nothing and is reported in the toast; there is no partial paste. Position (`pasteShift`): with `corner`
  the top-left corner of the group goes there, otherwise the group goes where it was copied from; from there it moves on by
  (40, 40) until none of its entities sits exactly on an existing one. A copy pasted into its own circuit so lands 40 units right
  of and below the original, the next one 80, and a group that was cut comes back in place. Cut is `copyEntities` plus
  `deleteEntities`, the deletion being the undo step.
- **Moving and duplicating the selection.** `nudgeSelection(delta)` moves the selected entities by a distance in canvas units
  (the language command `moveEntities`): one undo step per call, the selection stays, an entity that is off the grid stays off
  it by the same amount. `duplicateSelection()` is `copyEntities` of the selection followed by `pasteEntities` without a corner,
  inside the session: the same text, the same names (`gate2`), the same place (40 units right of and below the original, further
  on while that is taken), one undo step, the copies are the selection and the select tool is active. No clipboard is involved.
  With no entity selected, and while the source has errors, both do nothing and report nothing.
- **Analysis.** Every document change bumps a version and runs `analyze(source, previous, { signals, version })` synchronously.
  `Analysis.accept` only takes the result of the latest request, so the same code path works when the analysis moves to a worker;
  `ProjectSession.acceptAnalysis` is the entry point for that. With errors, `editable` is false, the last valid circuit stays, and
  commands and simulation are blocked. Entities whose declaration text did not change keep their object identity, which is what lets the
  memoized cards skip rendering.
- **Selection** is two lists: entity ids (`selection`) and wire keys (`wireSelection`, the `wireKey` of `@face/model`: color plus
  the ids of both ends, independent of the direction of the declaration). `select(ids, wires?)` replaces both, so every caller
  that passes entities only clears the wires. Ids come from the language session and survive renames, by command or by typing,
  and a wire key with them. After every analysis both lists are reduced to what the circuit still has, so a selected wire stays
  selected through moves, renames and typing elsewhere and leaves the selection when it is removed, by whatever means. Undo of
  a deletion does not select again. A caret the user places inside a declaration selects that entity, one inside a wire
  statement that wire (`sourceMap.wireAt`); nothing is scrolled or marked in the source in the other direction, for entities
  and wires alike. `deleteSelection()` removes the selected entities with their wires and the selected wires as one language
  command (`deleteEntities` with `wires`), which is one undo step. The simulation dock follows the entity selection only.
- **Inspector drafts.** Forms emit complete entities. `drafts.ts` first sets fields without meaning to what the language implies (the
  output constant while copying the input count, the join of the first condition, ...). If the result is still not expressible (a
  condition without signal, an expression without output, a signal twice in a section), it is kept in `state.draft` with a hint; the
  inspector shows the draft instead of the entity, and the next edit that makes it valid writes all of it as one step. A draft is dropped
  when the selection moves on, when it is discarded, or when its entity changes in the source.
- **Diagnostics** go to `state.diagnostics` and, as a separate effect-only transaction, to the lint extension. Highlighting uses the tokens
  of the analysis the session already has; completion maps the language's `completionContext` to keywords, properties, enum values,
  entity terminals and the catalog signals of the enabled modules.
- **Catalog.** `CatalogService` is rebuilt when the project's module list changes. It is the language's `SignalResolver` (unknown and
  disabled signals are warnings; text is never touched), the source of names and icon ids, and the picker tree. `SignalField` receives
  the wildcards its slot accepts (`SIGNAL_SLOTS` of the language) and the picker offers no others.
- **Simulation.** `SimulationRunner` compiles each new valid circuit with the catalog environment. If `semanticFingerprint` is unchanged
  (moves, renames, comments) the running engine, its tick and its history stay; otherwise it starts at tick 0. It has no reference to the
  document, so no simulation activity can create an edit. While the source has errors it is blocked with a notice and resumes afterwards.
  The dock traces every output signal of the selected entities (the first three entities when nothing is selected); lamps trace their
  lit state; what an entity reads per wire color is in the row's tooltip.
- **Card statuses.** `StatusCache` (`simulationView.ts`) turns the latest snapshot into one `EntityStatus` per entity: `input`
  (`red` and `green`, each `{ wired, signals }`; absent on a constant combinator), `output` (all emitted signals; absent on a
  lamp), `lamp` (`{ lit, color }`), `active` (a lit lamp) and `label` (the output or the lamp state as text: the first two
  signals, then `+N`). The signal lists are the engine's own, in its signal order, not copies. `wired` comes from the compiled
  circuit (`CompiledCircuit.terminals`): the snapshot alone cannot tell an input without a wire from a wire that carries
  nothing. A status is cached per entity record of the snapshot and the map per entity table. The engine replaces a record
  exactly when what the entity reads, emits or lights changes, so a card gets a new status object, and renders, only then.
- **Project files.** New project (the example circuit), open, save, save as and open recent go through `window.face`. Dirty means: the text
  or the settings (name, module set) differ from what was saved. Manifest fields this version does not edit (custom signal groups, unknown
  fields in `extras`, other circuit files) are written back as loaded.

`window.faceSession` (`getState()`, `commands`) exposes the controller for the end-to-end tests and measurements; it adds no behaviour.

## Design tokens

`styles/tokens.css` holds the theme as CSS custom properties; the other stylesheets and the CodeMirror theme refer to them and carry no
colors of their own apart from black and white overlays.

Colors: neutral grays, cream, an orange accent and a confirm green, sampled from the Factorio mod portal. The grays nest: panels are on the
frame level (`#313031`), editors, inputs and the canvas are wells (`#242324`), cards and controls are raised (`#414040`); dark edges
(`#1c1c1c`) separate panels and surround wells. No neutral has a green cast. Headings and names are cream (`#ffe6c0`), body text is near
white. The accent orange (`#f0a418`) is for accent text, icons, selection outlines and focus; active and selected controls are filled with
`--accent-fill` (`#f1bd65`) and dark `--ink`. The primary action of a group (Run, Save while there are unsaved changes) is filled with
`--confirm` green. Green otherwise means the green wire or an ok status, red the red wire, an error or a delete control.
`test/themeColors.test.ts` pins these rules: grays stay grays, chromatic colors are declared tokens, green dominates only in the confirm and
green wire tokens, every `var()` resolves, the window background of the main process matches, and ink and accent text keep their contrast.

| Group | Tokens |
| --- | --- |
| Reference grays | `--gray-shadow`, `-edge`, `-well`, `-frame`, `-divider`, `-card`, `-tab`, `-control` |
| Surfaces | `--surface-window`, `-titlebar`, `-projectbar`, `-palette`, `-inspector`, `-dock`, `-statusbar`, `-popover` (frame); `-editor`, `-inset`, `-well` (wells); `-raised`, `-raised-hover`, `-active`, `-control`, `-hover` |
| Canvas | `--canvas-center` / `-mid` / `-edge`, `--canvas-dot`, `--card-top` / `-bottom` / `-border` / `-divider` / `-lit` |
| Borders | `--border-edge`, `--border-subtle`, `--border`, `--border-strong`, `--border-input`, `--border-popover` |
| Text | `--text`, `--text-strong` (cream), `--text-soft`, `--text-label`, `--text-muted`, `--text-dim`, `--text-faint`, `--ink` (dark, on filled controls) |
| Accent | `--accent`, `--accent-fill`, `--accent-bright`, `--accent-border`, `--focus-ring` |
| Confirm | `--confirm`, `--confirm-bright`, `--confirm-edge` |
| Wires | `--wire-red`, `--wire-green`, `--wire-casing` (canvas); `--wire-red-ui`, `--wire-green-ui` and their `-surface` / `-border` (controls) |
| Entity kinds | `--kind-constant` (pink), `--kind-arithmetic` (cyan), `--kind-decider` (violet), `--kind-selector` (blue), `--kind-lamp` (yellow); a `kind-<kind>` class sets `--kind-color` |
| Status | `--status-ok`, `--status-warning`, `--status-error`, `--danger*`, `--notice-*` |
| Traces and syntax | `--trace-1` ... `-3`, `--syntax-signal`, `-number`, `-string`, `-atom` |
| Typography | `--font-ui`, `--font-mono`, `--text-xs` ... `--text-xl`, `--tracking-label` |
| Layout | `--titlebar-height`, `--projectbar-height`, `--palette-width`, `--inspector-width`, `--dock-height`, `--statusbar-height`, `--radius-*` |

Token classes for source highlighting (`face-tok-keyword`, `-string`, `-number`, `-comment`, `-signal`, `-atom`, `-name`, `-operator`,
`-punctuation`, `-color-red`, `-color-green`, `-invalid`) are in `styles/source.css`; `editor/tokens.ts` maps tokenizer kinds to them.

## Canvas behaviour worth knowing

- Card layout (card units, `EntityCard.tsx`): margin 13 on both sides. Header band down to the divider at 26.5: kind accent
  (3 x 13 at y 7), kind label (9px, baseline 17), description marker (13 at the top right). Body down to the divider at 72.5:
  entity icon 34 at (13, 32), name (15px, baseline 46, 13 characters) and summary (12px monospace, baseline 63, 15 characters)
  from x 56. Below it three status rows of 9px monospace text, centered at y 84, 100 and 116 (`STATUS_ROWS` in
  `statusRows.ts`). Nothing but the pins lies outside x 13 to 171; the pins reach 7 units into the card. The card, its text and
  its icon never turn with the entity. Where pins sit on the top or the bottom edge (an entity facing north or south) the content
  next to them gives way, and only there: a card with pins on its top edge has the kind accent, the kind label and the
  description marker 2 units lower (label baseline 19), a card with pins on its bottom edge has its three status rows centered at
  y 82, 97 and 112 (`RAISED_ROWS`), which leaves 2.5 units between the icons of the last row and the pins. A card facing east or
  west is drawn exactly as before entities could be rotated.
- Status rows, while the simulation has data: what the entity reads on red (a red bar in front), what it reads on green (a
  green bar) and what it emits (an arrow; the same on both colors). A lamp has its state in the third row instead (`lit` or
  `off`, and a swatch of the light's color when it has one). A constant combinator has no input rows; its output starts in
  the first row and runs on into the other two. Each signal is its catalog icon (13 units) and its value; without an icon,
  the short name (up to 12 characters) and the value. `layoutRow` places as many signals as fit and ends the row with `+N`
  for the rest; it looks at no more signals than it places. Values of more than four digits are abbreviated the way the game
  does (`compactNumber`: `12k`, `1.0M`, `2.1G`, cut off, never rounded up). A row without signals shows a dash; the bar of
  an input without a wire of its color is dimmed (class `unwired`). The widths are computed from an assumed advance of
  5.5 units per character (SF Mono and Menlo have 5.42), not measured.
- The card's tooltip has the rows in full with exact values, one line each: `Red in:`, `Green in:`, `Out:` or `Light:`,
  with `no wire` and `nothing` for the two empty cases, up to 32 signals per line and `+N` beyond.
- Card status in the DOM: `g.card` carries `data-status` (the status label), `data-in-red` and `data-in-green` (the tooltip's
  text of that input; absent on a constant), also on an outline. The rows are `g.card-row` with `data-row="red|green|out|lamp"`
  and the classes `red`, `green`, `out`, `lamp` and `unwired`; inside them `.row-marker`, one `<image>` (with a catalog icon)
  and one `text.row-value` per signal, `text.row-more` (`+N`), `text.row-none` (the dash, a lamp that is off) and
  `rect.row-swatch`. Rows are memoized by their signal list, which the engine keeps while a network or an output is unchanged.
- Grid 20 units; cards are 184 x 128. Every terminal (`TERMINALS`: `in`, `out`) has one connection pin per wire color. Which edge
  of the card carries them follows from the direction the entity faces (`facing`, the direction its output points to; east when the
  source does not say). The pins turn with the entity as one rigid figure, clockwise from east over south and west to north; offsets
  from the top-left corner of the card:

  | Facing | Outputs | Inputs | Output red, green | Input red, green | Red is |
  | --- | --- | --- | --- | --- | --- |
  | east | right edge | left edge | (184, 60), (184, 80) | (0, 60), (0, 80) | above green |
  | south | bottom edge | top edge | (100, 128), (80, 128) | (100, 0), (80, 0) | right of green |
  | west | left edge | right edge | (0, 80), (0, 60) | (184, 80), (184, 60) | below green |
  | north | top edge | bottom edge | (80, 0), (100, 0) | (80, 128), (100, 128) | left of green |

  All pins are on grid lines, 20 units apart; those on the top and bottom edge sit around the middle of the card (92). A constant
  and a lamp have the pins of their one terminal. `pinPoint(position, side, color, facing)` in `geometry.ts` is the only place that
  knows the positions (`pinEdge` and `pinHeading` name the edge and the direction a wire leaves in); a wire of a color starts and
  ends in the center of the pin of that color, and the rubber band of a pending wire starts there too.
- Pins in the DOM: `g.pin` inside the card with `data-terminal="in|out"`, `data-wire-color="red|green"`, `data-edge="left|right|top|
  bottom"` and a `<title>` such as "Red input"; the card (`g.card`) carries `data-facing`. Pins are drawn in the wire color tokens.
  A wire tool sets `wire-red` / `wire-green` on `.canvas`: only the pins of that color are targets (highlight, click, pending state,
  start of the rubber band), the others are dimmed and ignored, whatever edge they are on. The model is unchanged: a wire is a
  color plus two terminals, and the tool decides the color.
- Rotating: `R` turns the selected entities a quarter turn clockwise, `Shift+R` counter-clockwise, as in the game (see
  "Keyboard shortcuts" for where the keys act). A held key does not repeat. The context menu of a card has "Rotate clockwise" and "Rotate
  counter-clockwise" with the keys, and the inspector of a single entity has the Facing control (`.facing-toggle`, a group named
  "Facing" with four buttons `data-direction`, `aria-pressed` on the current one). Every entity of a selection turns in place, each
  from its own direction; the selection is not turned as a group. One rotation of a selection is one undo step. While the source
  has errors all three are off.
- Routes (`wireRouting.ts`): every wire is a line of horizontal and vertical segments from pin to pin, drawn with rounded corners
  (radius 14; a corner next to a shorter segment gets what fits: the whole first or last segment, half of one between two corners).
  There are no curves. A wire leaves and enters a pin at a right angle to its edge. Red and green between the same two terminals
  run as parallels one pin spacing (20) apart and never touch, except in a narrow gap and at the one crossing described below.
  `routeWire(color, a, b, sameEntity)` takes the position, the side and the facing of both ends; the route does not depend on
  their order. The rules below are written for two entities facing east. Two entities that face the same other way, and the
  feedback wire of one entity, get the same rules in a frame turned with them (the whole figure turns: a column of entities
  facing south is wired with straight vertical lines, the loop of a feedback wire passes the side of the card on which the red
  pins sit).
  - Output to an input at least 16 units to its right (12 for entities facing north or south: in both cases the gap that cards one
    grid step apart leave): out, one vertical leg midway between the two cards, in; a straight line when the pins are level. The color on the outside of the first bend takes the far leg. In a gap below 26 units (cards one grid step
    apart leave 16, cards facing north or south 12) the two legs move together, down to 10 apart (6 in a gap of 12) and 3 from the
    cards.
  - Output to an input that is not to its right: a detour out to the right, across between the two cards (below both when they are
    less than 40 apart vertically, then also around the lower one) and into the input from the left, 10 and 30 units from the cards.
  - Output to input of one card: a loop over the top with 20 (red, inside) and 40 (green, outside) units of clearance. Facing
    south the loop passes the right side of the card, facing west below it, facing north its left side.
  - Two inputs or two outputs: out, a leg 10 (green) and 30 (red) units beyond the terminal further out, back in. The colors have to
    cross once, at a right angle: here where red returns into the lower terminal. When the card of the outer terminal is in the way
    of the other one (cards side by side), the wire first passes 10 and 30 units below that card, or above it when the other terminal
    is higher (green is then outside); the crossing is at the far corner of that lane.

  Two entities that face different ways have their pins on edges in any combination, so their line is searched instead of built
  from a rule per case (`laneRoute`, `searchLine`):
  - The line between the centers of the two terminals runs on a few lanes: the lines through the two pins, the lines 20 units
    beside each card, and the line midway between the two cards where they are at least 40 apart. It leaves and enters each
    terminal straight for 20 units and stays 20 units away from both cards. Among all such lines the one with the fewest corners
    is taken, then the shortest (a corner counts as 100 units), then the one that turns on the middle lane, then on a lane of the
    pins or of the first card.
  - From an output to an input the colors are exact parallels 10 units to both sides of that line (10 and 30 units from a card
    they pass), red on the left seen from the output.
  - Between two outputs or two inputs red is on one side of the line where it leaves and on the other where it arrives. The colors
    swap sides at the last corner that has room for it and cross there once, at a right angle. Two such terminals that face each
    other on one line have no corner: red steps over halfway, and green passes around the step, 10 units from each card and a pin
    spacing further out, crossing red in front of the second card.
  - Cards 26 to 40 units apart: the line keeps half the gap from the cards instead of 20, so the pair still fits between them.
    Where even that is impossible (a terminal that points into a narrower gap, cards one grid step apart) each color takes lanes
    of its own, green 10 and red 30 units from the cards, then 3 and up to 13; the colors may then cross more than once. Cards
    that touch or overlap get a line that ignores them.

  Routes do not avoid other cards, and wires of different connections may share a line. Fit to Content adds 40 units around the
  cards, which holds every feedback loop whatever the direction.
- Wires in the DOM: `g.wire` in `g.wires` with `data-wire` (the wire key), `data-color` and the class `selected`; inside it
  `path.wire-hit`, `path.wire-casing` and `path.wire-core` on the same route. `wire-hit` is a 12 unit wide stroke: it takes the
  pointer while the select tool is active (and only then), shows a faint glow under the pointer and is the accent outline of a
  selected wire, whose core is also drawn thicker. Hover is CSS only; a selection change re-renders the wires whose `selected`
  flag changed, and selected wires are moved to the end of `g.wires`, above the other wires and below the cards.
- Selecting wires (select tool): a press on a wire selects it alone, with Shift it is added to or taken out of the selection,
  which may hold entities as well; a drag that starts on a wire pans. Cards and their pins lie above the wires, so a pin wins
  over the end of a wire and a card over a wire behind it. Where wires overlap or cross (routes may share a line), the one drawn
  last takes the click, a selected one therefore first; 12 units keep the target off the casing of a neighbor 10 units away.
  With a wire tool or a place tool a wire is no target: the click pans, starts nothing, or places the card. The marquee and
  Select All take entities only (the marquee keeps the selected wires, Select All drops them). Escape and a click on empty
  canvas clear both lists.
- A drop is computed from the press and release coordinates of the pointer, not from the rendered preview.
- The wheel listener is registered non-passive on the canvas container and cancels scrolling.
- Cut, copy and paste: Edit > Cut / Copy / Paste and Cmd/Ctrl+X / C / V both end in the browser's `cut`, `copy` and `paste` events,
  which `Workbench` handles on the document. The events carry the clipboard (`clipboardData`), so the page needs no clipboard
  permission and no IPC for them. They act on the entities when the canvas is shown and the focus is not in a text control, the
  source editor or a dialog (`focusIsOnText`); there, and for a copy while text of the page is selected (a message in the toast),
  they stay the browser's own. Cut and copy take the selected entities only (the wires between them are part of the text
  anyway): with wires alone selected both do nothing, and a cut leaves a selected wire that still exists selected. A paste puts the top-left corner of the group on the grid point under
  the pointer while that is over the canvas (`CanvasHandle.pasteCorner`); otherwise see `pasteShift` above. While the source has
  errors copy works, cut and paste do nothing. The context menu of a card has Cut and Copy with their shortcuts (Cut disabled
  while the source has errors); they run `document.execCommand`, which raises the same events. There is no Paste in the context
  menu: a page cannot start a paste (`document.execCommand("paste")` is refused and the clipboard permissions are denied), so it
  would need a channel on which the main process pastes on the page's behalf. Pasting is Edit > Paste and Cmd/Ctrl+V. With
  entities selected the menu also has the two rotations, between Copy and Delete.
- Deletion: on the canvas through the context menu (right click) only; there is no toolbar on the selection. Also Delete / Backspace
  while focus is inside the canvas, Edit > Delete, and the Delete button at the top of the inspector. Keys never delete while a text
  control or the source editor has focus. All of them delete the whole selection, entities and wires, as one undo step
  (`deleteSelection`). A right click on a card or (select tool) a wire outside the selection selects it alone first; the menu
  of a wire has Delete, and Cut and Copy as well when entities are selected with it.
- Inspector: one selected wire is shown as `.inspector-wire` (`data-wire`, `data-color`) with its two ends as buttons
  (`.wire-end`, `data-side`, output first) that select the entity, and Delete. More than one selected thing is summed up in
  `.inspector-multi`: the names of the entities, the wires as `ul.selected-wires` and one Delete for all of it. The status bar
  (`.status-selection`) names up to four entities or a single wire and counts anything else.
- Rendering: the scene is memoized against a culling rectangle snapped to a 400 unit lattice, cards and wires are memoized individually,
  cards become outlines below 30 % zoom, and the drop shadow is skipped above 60 visible cards.

## Keyboard shortcuts

`shortcuts/shortcuts.ts` holds every shortcut of the app in one table (`SHORTCUTS`): id, group, description, who acts on the key
(`scope`) and either the key the renderer matches (`chord`) or the accelerator of the native menu. The key handlers
(`shortcutFor(event)`), the tooltips and context menu labels (`shortcutLabel(id)`, `withShortcut(text, id)`) and the overview
(`shortcutKeys`) all read it. The accelerators of the native menu are data in `apps/desktop/src/accelerators.ts`
(`MENU_ACCELERATORS`): `menu.ts` registers them and the table lists them, so this is the one module of the main process the
renderer imports at runtime (it has no Node or Electron imports). `test/shortcuts.test.ts` fails when an accelerator has no row,
when two rows share a key on a platform or when one key event matches two rows.

| Action | macOS | Elsewhere | Scope |
| --- | --- | --- | --- |
| Select tool | `Q` | `Q` | circuit |
| Red wire, green wire tool | `⌥R`, `⌥G` | `Alt+R`, `Alt+G` | circuit |
| Building block to place: Constant, Arithmetic, Decider, Selector, Lamp | `1` ... `5` | `1` ... `5` | circuit |
| Place the block in the middle of the view | `↩` | `Enter` | canvas (focus on the canvas itself) |
| Cancel: the pending wire, then the tool, then (in the canvas) the selection | `Esc` | `Esc` | circuit, canvas |
| Rotate clockwise, counter-clockwise | `R`, `⇧R` | `R`, `Shift+R` | circuit |
| Move the selection one grid step, five grid steps | arrows, `⇧` arrows | arrows, `Shift` arrows | circuit |
| Duplicate the selection | `⌘D` | `Ctrl+D` | circuit |
| Delete the selection | `⌫` or Delete | `Del` or Backspace | canvas |
| Cut, Copy, Paste | `⌘X`, `⌘C`, `⌘V` | `Ctrl+X`, `Ctrl+C`, `Ctrl+V` | clipboard events |
| Keyboard shortcuts (the overview) | `?` | `?` | window |
| Undo, Redo, Select All | `⌘Z`, `⇧⌘Z`, `⌘A` | `Ctrl+Z`, `Ctrl+Y`, `Ctrl+A` | menu |
| Circuit, Source, Split | `⌘1`, `⌘2`, `⌘3` | `Ctrl+1`, `Ctrl+2`, `Ctrl+3` | menu |
| Zoom In, Zoom Out, Fit to Content | `⌘+`, `⌘-`, `⌘0` | `Ctrl++`, `Ctrl+-`, `Ctrl+0` | menu |
| Run / Pause, Step, Reset | `⌘R`, `⌘T`, `⇧⌘R` | `Ctrl+R`, `Ctrl+T`, `Ctrl+Shift+R` | menu |
| New, Open, Save, Save As | `⌘N`, `⌘O`, `⌘S`, `⇧⌘S` | `Ctrl+N`, `Ctrl+O`, `Ctrl+S`, `Ctrl+Shift+S` | menu |

- **Scopes.** `circuit`: handled by `Workbench` with one `keydown` listener on the document, wherever the focus is while the
  canvas is shown (canvas, palette, buttons of the inspector and the dock, nothing focused), but never where the key means
  something else: a text control, a select, the source editor, a dialog, an open menu (`keyIsTaken`, judged by the target of the
  event), and not in Source mode. `window`: the same in every view mode. `canvas`: handled by `Canvas` while the focus is
  inside it, as before the table existed. Escape is both: inside the canvas it drops a pending wire, then returns to the
  select tool, then clears the selection; from anywhere else it drops the pending wire (`CanvasHandle.cancelPendingWire`),
  then returns to the select tool, and leaves the selection alone. `menu`: an accelerator; the command arrives over IPC.
  `clipboard`: the browser's cut, copy and paste events.
- **Matching.** A chord names every modifier it wants; any other modifier that is held makes it no match (`Cmd/Ctrl+R` is Run,
  never a rotation; `AltGr`, which arrives as Ctrl+Alt on Windows, matches nothing). Letters, the arrows and the named keys are
  compared with `event.key` without case, so they follow the keyboard layout. `Alt+R` and `Alt+G` are compared with
  `event.code` (`KeyR`, `KeyG`), because Option changes the character on macOS; the digits with `Digit1` ... `Digit5`, because
  some layouts (AZERTY) have the digits behind Shift. Both are therefore the physical keys of a US layout, and the numeric
  keypad picks no building block. `?` is the character, whatever Shift it takes. A composing input method and an event that
  something else has cancelled are left alone. A held key repeats only for the arrows.
- **What the keys do.** The tool keys set the tool (pressed again they keep it; the buttons toggle). `1` to `5` follow the order
  of the palette (`ENTITY_KINDS`). The arrows call `nudgeSelection` with 20 units, with Shift 100 (`nudgeDelta`), unless the
  focused control uses the arrows itself (`usesArrowKeys` in `platform.ts`: text, selects, sliders, radio groups, lists, tabs,
  menus); without a selection they keep their default. `Cmd/Ctrl+D` calls `duplicateSelection`. While the source has errors the
  keys that edit (rotation, arrows, duplicate, delete) and the tools that edit (wires, building blocks, like their disabled
  buttons) do nothing; `Q`, Escape and `?` work.
- **Discoverability.** The three tool buttons and the five building blocks name their key in the tooltip (`title`); the building
  blocks also show it as a key cap next to their name (`kbd.key-hint`). The cap is `aria-hidden` and the buttons carry no
  `aria-keyshortcuts`: the tooltip is the accessible description of the button, so a screen reader hears the key once, also
  VoiceOver, which does not announce `aria-keyshortcuts`. Context menu items show their keys as before.
- **Overview.** `ShortcutOverview` lists the table in its groups (Tools, Editing, View, Simulation, File) with the key names of
  the platform, one key cap per key. It opens with `?` and with Help > Keyboard Shortcuts (menu command `help.shortcuts`). It is
  a modal dialog (`role="dialog"`, `aria-modal`, labelled by its heading): the focus goes to its Close button, Tab stays inside,
  a click on its text focuses the dialog itself, so no key reaches the circuit behind it. Escape, Close and a press beside the
  dialog close it and give the focus back to where it was. Escape closes the dialog only; a tool picked before stays picked.

## Icons

`EntityIcon` / `EntityIconSvg` take an `EntityIconResolver` (`(kind) => url | undefined`). `icons/catalogEntityIcons.ts` probes the five
item icons of the generated catalog through `face-asset://catalog/icons/item/<name>.png` and resolves only those that load.
`icons/catalogSignalIcons.ts` does the same for signal, group and quality icons with one probe; the two wire tool buttons of the palette
take the game's `item/red-wire` and `item/green-wire` icons from it. When `packages/catalog/generated` is absent (it is git-ignored),
entity kinds and wire tools show inline pictograms and signals are shown by name, in the picker as well.

## Commands

```
source scripts/env.sh
npm run build                 # dist/renderer, dist/main.cjs, dist/preload.cjs   (node scripts/build.mjs --watch to rebuild on change)
npm start                     # run the built app; profile in .runtime/user-data
npx vitest run apps           # unit tests (session tests need no DOM)
npm run test:e2e              # Playwright against the built app; output in .runtime/
```

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
    persistence.ts     project file mapping, dirty comparison, the empty project a session begins with   (pure)
    completion.ts      completion candidates from the language's expectations and the catalog   (pure)
    editorSupport.ts   CodeMirror glue: token kinds, lint transaction, completion source
    useProjectSession.ts  React binding (useSyncExternalStore) and the `window.faceSession` probe
  workbench/
    controller.ts      the WorkbenchController seam (state, commands, shared view types)
    Workbench.tsx      shell: lays out the panels, routes callbacks to commands, wires the native menu and the close handshake
    selectionText.ts   the selection in words: status bar text, counts, wire labels   (pure)
    statusText.ts      what the status line says about the source and about the project file, a path in the two parts it is
                       shortened by   (pure)
    TopBar.tsx         title bar (brand, Circuit / Source / Split) and project bar (name, undo, redo, fit, settings, save)
    CanvasStrip.tsx    the strip above the canvas: title and counts, the tools (select, red wire, green wire), the Edit | Blueprint
                       switch, "Place all"
    Palette.tsx        the entity selector (`PALETTE_GROUPS`: square tiles with a popup, the combinators as the first row,
                       "Entities in use", the other entities in groups that open and close), entity list
    paletteGroups.ts   which groups and sections are open, remembered in the browser storage of the profile   (pure apart from `browserStore`)
    SourcePane.tsx     file heading, SourceEditor, problems list (errors first, a click selects the range)
  canvas/
    Canvas.tsx         SVG canvas: camera per display mode, gestures, pending wire, context menu, the checkerboard, the bubble
                       of the entity under the pointer, the hint line and the zoom controls; emits callbacks only
    Scene.tsx          memoized wires (with their click target) and entities in the layout of the display mode, culled to the visible area
    layout.ts          `CanvasLayout`: where an entity and its pins are in a display mode; `editLayout`, `blueprintLayout`   (pure)
    board.ts           the blueprint board: tile size, `derivedTiles`, `arrangeBoard`, the rules of editing on it, pins on a footprint   (pure)
    flip.ts            mirroring a selection: the cards of the edit canvas, the footprints of the board, when a flip is refused   (pure)
    hover.ts           when a popup that follows the pointer appears, moves on and goes (`HoverIntent`), what the bubble of the
                       board asks for   (pure apart from the timers)
    EntityCard.tsx     one memoized card (what the entity is, description marker, icon, name, summary, live status rows, a red and a green
                       pin per place of its terminals, on the edges the entity's facing gives them); `CardFace` is the card without pins
                       and place, `Pin` one pin
    BlueprintEntity.tsx  one memoized entity on the board: footprint, icon, name, arrows, pins, compact live state
    EntityBubble.tsx   the bubble of the entity under the pointer on the board: `CardFace` and the description as an HTML overlay
    bubble.ts          where the bubble goes (`placeBubble`)   (pure)
    statusRows.ts      the status rows of a card: geometry, which signals fit, the rows as text, the compact output of the board   (pure)
    ContextMenu.tsx    keyboard-navigable popup menu
    geometry.ts        card and pin geometry (`pinPlaces`, `pinPoint`, `pinEdge`, `pinHeading`), rectangles  (pure)
    viewport.ts        camera transforms, zoom, fit, culling rectangle (pure)
    drag.ts            snap, drag threshold, group drag, placement     (pure)
    wireRouting.ts     wire routes for every combination of pin edges, the edge a connection point without a direction is wired at
                       (`wirePlaces`), SVG path data   (pure)
  editor/
    SourceEditor.tsx   CodeMirror view over an `EditorBinding`; owns no state
    extensions.ts      editor chrome: gutters, selection, indentation, keys, theme
    theme.ts           editor colors in the app palette
    tokenHighlight.ts  viewport decorations from an external tokenizer
    tokens.ts          token kind to class mapping, minimal text diff  (pure)
  inspector/
    Inspector.tsx      identity, rename + Delete at the top, description, draft hint, settings slot, connections; a selected wire;
                       the summary of several selected things; undo and redo from its fields
    EntitySettingsForm.tsx and ConstantForm / ArithmeticForm / DeciderForm / SelectorForm / LampForm / SpeakerForm
    PrototypeField.tsx which entity of its kind an entity is, for a kind with several game prototypes (a pole)
    speakerEdits.ts    instrument and note of a speaker against the game's lists: what is a default and is not written   (pure)
    instruments.ts     `InstrumentsContext`: the speaker's instruments and notes from the catalog, for the form and the cards
    SignalField.tsx    validated `kind:name[@quality]` input with icon, name, warning and the picker slot
    fields.tsx         text, integer, number, select and checkbox fields, the red/green NetworkToggle, the text a field holds on its own
    formParts.tsx      sections, list items, the operand and the circuit condition (`ConditionFields`: lamp and speaker)
    immutable.ts, validation.ts
  picker/
    SignalPicker.tsx   signal picker like the game's: group tabs, subgroup rows, search, quality row
  settings/
    ProjectSettings.tsx  project name, wire reach and the five standard modules as signal groups
    wireReach.ts       the text of the wire reach field as a number in range   (pure)
    AppSettings.tsx    the settings of the application on this machine: the game installation the icons are read from (modal)
    appSettings.ts     what that dialog says about an installation, when the hint is due, which report of the state counts   (pure)
    useAppSettings.ts  the state as the main process reports it, and the two requests that change it
  dialog/
    Modal.tsx          the modal dialog: backdrop, title, close button, focus kept inside and given back
  shortcuts/
    shortcuts.ts       the shortcut table: every key of the app, key matching, labels per platform, the arrow distance   (pure)
    ShortcutOverview.tsx  the modal overview of all shortcuts
  simulation/
    SimulationDock.tsx controls, trace table with sparklines, tick counter
    sparkline.ts       sparkline geometry                              (pure)
  entities/            kind labels and the names an entity goes by (`kindInfo.ts`), the registry of what the palette offers
                       (`registry.ts`), signal text forms (short names, lists, compact numbers), card summaries, the quarter turns
                       and the mirror images of the direction an entity faces (`facing.ts`)  (pure)
  icons/               interface glyphs, entity icons per prototype, catalog icon resolvers (with probes: the icons come from the
                       user's installation of the game or from bundled files, and neither may be there)
  styles/              tokens.css and one stylesheet per area
test/                  vitest: pure view modules
test/session/          vitest: the session, headless (commands, invalid source, simulation, catalog, persistence, drafts)
```

End-to-end tests live in `tests/e2e/` and drive the built app with Playwright's Electron support. The app starts with an empty project (or
the last one of the profile), so `launchApp` opens the example through File > Open Example before it returns, which is the circuit most
specs work on; `launchApp({ open: "start" })` leaves the window as the app started it. Unit tests that need the example as sample text
take it from `test/fixtures/example.ts`, which reads the source the shipped project file is written from (`tools/examples`).

## The WorkbenchController seam

`workbench/controller.ts` defines what the views get from the session:

```ts
interface WorkbenchController {
  readonly state: WorkbenchState;       // immutable snapshot; a new object per change, unchanged parts keep identity
  readonly commands: WorkbenchCommands; // stable object; commands never throw, failures arrive as state.error
  readonly editor: EditorBinding;       // the session-owned editor state: { state, apply(transactions), attach(view) }
}
```

`WorkbenchState`: `project` (name, path, fileName, dirty, wireReach, epoch), `circuit` (last valid `Circuit`), `editable` (false while the source
has errors), `selection` (entity ids), `wireSelection` (wire keys), `mode`, `displayMode` (`edit` or `blueprint`), `tool`, `source`, `diagnostics` (with line numbers), `canUndo` / `canRedo`, `simulation`
(`SimulationView`: running, tick, speed, traces, per-entity status with inputs per wire color, notice), `catalog` (`CatalogView`: modules, qualities,
`speakerInstruments`, `picker()`, `describe(signal)`), `draft` (pending inspector edit of the selected entity) and `error` (the message of the toast; see "Messages"
below).

`WorkbenchCommands`: view (`setMode`, `setDisplayMode`, `setTool`, `select`, `dismissError`), document (`placeEntity`, `moveEntities`, `rotateEntities`, `faceEntities`, `flipEntities`, `updateEntity`,
`discardDraft`, `renameEntity`, `deleteEntities`, `deleteSelection`, `copyEntities`, `pasteEntities`, `nudgeSelection`, `duplicateSelection`, `addWire`, `removeWire`,
`toggleWire`, `setSource`, `undo`, `redo`), the blueprint board (`setTiles`, `nudgeTiles`, `placeHere`, `unplace`, `placeEntityOnTile`; see "Editing on the board"),
simulation (`run`, `pause`,
`step`, `resetSimulation`, `setSpeed`), settings (`setModuleEnabled`, `setProjectName`, `setWireReach`) and project (`newProject`, `openProject`,
`loadProject`, `openExample`, `save`, `saveAs`).

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
  its top right corner (`g.card-note`); the text itself is in the inspector only. The game has a description on the four
  combinators only (`KIND_INFO[kind].describedInGame`); for a lamp, a pole and a speaker the box says so in its tooltip ("A lamp
  has no description in the game. This text stays in the project.") and the text stays in the project.
- **Saving while a field holds unwritten text.** A name or a description is written when its field is left. Save and Save As
  (menu, key, the close prompt) first leave and re-enter the focused field when it carries `data-unwritten` (`writeFocusedField`
  in `Workbench.tsx`), so the saved file has the text and the caret stays where it was.
- **Rotation.** `facing` in the entity header is the direction the output points to; without the clause an entity faces east
  (`DEFAULT_FACING` and `facingOf` of `@face/model`). `rotateEntities(ids, turn)` turns each of the
  entities a quarter turn in place (clockwise: east, south, west, north), `faceEntities(ids, direction)` sets a direction. Both
  run the language command `faceEntities`, which patches the direction word of the clause or inserts ` facing <direction>`
  behind `tile`, `at` or the name and never removes a clause: one transaction for all entities, one undo step, nothing for an
  entity that faces the direction already. A rotation therefore always leaves an explicit clause, `facing east` included. Name,
  position and settings edits keep the direction (`updateEntity` takes the placement from the document). The simulation does
  not see it: `semanticFingerprint` is unchanged, so a running engine, its tick and its history stay. Copy and paste keep it.
  Every combinator rotates; a lamp does not, as in the game (`canRotate` of `@face/model`). The language command leaves lamps
  out, so a selection of lamps alone is no step and a mixed one turns the others; `facingOf` is east for a lamp whatever its
  source says, so its pins never move (a `facing` clause typed on a lamp gets the warning `unused-facing`). An entity with a
  `tile` gets its tile corrected in the same transaction: a 2x1 combinator keeps the top-left tile of its footprint, so a half turn
  keeps both tiles and swaps input and output (`rotateTile`).
- **Flipping.** `flipEntities(ids, axis)` mirrors the entities as a group, as the game flips a blueprint: they swap sides
  within the bounds of all of them (`horizontal`: left and right, `vertical`: top and bottom), and each one that can turn
  faces the mirrored way (`flipped` in `entities/facing.ts`: a horizontal flip turns east into west and west into east, a
  vertical one north into south and south into north; the other two directions stay). One entity so turns in place. Where the
  entities go is `canvas/flip.ts`: on the edit canvas `flipCards` mirrors the `at` positions (all cards have one size, so the
  bounds of their corners do) and leaves `tile` alone, which a flipped direction keeps valid; on the board `flipTiles`
  mirrors the footprints of the entities that have a `tile`, as the board shows them, so every footprint stays on the grid,
  and leaves `at` alone. An entity of the selection without a `tile` has no tiles to mirror: it is turned, gets no `tile`,
  stays at its derived place and does not count for the bounds. The result goes to the language command `arrangeEntities`
  (position, tile and direction of any number of entities): one transaction, one undo step, nothing for a flip that changes
  nothing (a combinator facing north flipped horizontally). On the board a flip that would put an entity onto a tile of an
  entity outside the selection is refused as a whole and reported like a refused turn (`blockedFlip`; "Not flipped: source
  would stand on a tile of gate."); on the edit canvas it is never refused. `canFlip(entities, tiles)` says whether there is
  anything to flip: one of the entities can turn, or at least two are mirrored (on the board: two with a `tile`). It is what
  greys out the two menu items and stops the keys for a single lamp or pole. The simulation does not see a flip.
- **Placing with a direction.** A place tool says what it places and holds its direction: `Tool` is
  `{ type: "place", kind, prototype?, facing? }`. It is an `EntityShape` of the model: the first prototype of the kind without
  `prototype` (the tools of the digit keys have none, the entries of the palette always name theirs), east without `facing`
  (`placeFacing(tool)`; always east for an entity that does not turn: a lamp, a speaker, a pole). `R` and `Shift+R` turn it
  while the tool is active (`turnedTool(tool, turn)`, set with `setTool`), and `H` and `V` flip it (`flippedTool(tool, axis)`),
  in both display modes, instead of acting on the selection; a tool for an entity that does not turn is left alone and the
  keys then do nothing. `sameTool` compares the kind
  and the prototype and does not look at the direction (it is the same button of the palette), but `setTool` does: the tool
  picked again by its key, or after another tool, comes without `facing` and so faces east again. A click that places nothing
  (a taken tile) keeps the tool and its direction. `placeEntity(kind, position, facing?, prototype?)` and
  `placeEntityOnTile(kind, tile, facing?, prototype?)` pass all of it to the language command `addEntity`, which writes
  ` facing <direction>` behind `at` or `tile` for every direction but east (a new entity that faces east has no clause, as
  before; never for an entity that does not turn) and `prototype = <name>` for every prototype but the first of its kind.
  The hint line names the entity (`entityNoun`: "to place a big electric pole") and, where it turns, the direction and the
  key ("to place a decider facing south (R turns it)"); on the edit canvas that is the only sign of it before the click, on
  the board the outline has the footprint of the prototype and turns as well.
- **Messages.** `state.error` is one message, shown in the toast (`.toast`, `role="alert"`) with a Dismiss button; a newer one
  replaces it. The session sets it through `show(message, refusal?)` and keeps two sorts apart. A message about a refused edit
  (a name that is taken, a wire that cannot be, a `tile` off the grid, "Nothing was pasted", a turn or a flip refused on the board)
  describes the document it was refused on, so it goes away with the next change of the document, whatever makes it: a command
  that works, undo, redo, typing in the source. Commands that change nothing (a blocked move, a tool, a menu, the display mode)
  leave it. The message about a refused turn or flip was about the selection, so it also goes when other entities, or none, are
  selected; the others stay through a selection, because the inspector writes a name when its field is left, and a click on
  another card would take the message about that name away before it was read. A message that is not about an edit (a project
  that could not be opened or saved) stays until it is dismissed or the next project is loaded.
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
  `deleteEntities`, the deletion being the undo step. On the blueprint board the session ignores `corner`: the point under the
  pointer or the menu is a place on the board there, not an edit position, so a paste is placed like a duplicate.
- **Moving and duplicating the selection.** `nudgeSelection(delta)` moves the selected entities by a distance in canvas units
  (the language command `moveEntities`): one undo step per call, the selection stays, an entity that is off the grid stays off
  it by the same amount. `duplicateSelection()` is `copyEntities` of the selection followed by `pasteEntities` without a corner,
  inside the session: the same text, the same names (`gate2`), the same place (40 units right of and below the original, further
  on while that is taken), one undo step, the copies are the selection and the select tool is active. No clipboard is involved.
  With no entity selected, and while the source has errors, both do nothing and report nothing.
- **Analysis.** Every document change bumps a version and runs `analyze(source, previous, { signals, wireReach, version })` synchronously;
  a change of the module set or of the wire reach runs it again for the same text.
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
  The dock traces every output signal of the selected entities (the first three entities with something to trace when nothing is
  selected); lamps trace their lit state and speakers whether they play (`alarm sound`, 1 while playing, the row lit like a lamp's);
  what an entity reads per wire color is in the row's tooltip. A pole has nothing to trace (`isTraceable`): it has no row, with or
  without a selection, and where that leaves the dock empty it says that a pole only passes signals on.
- **Card statuses.** `StatusCache` (`simulationView.ts`) turns the latest snapshot into one `EntityStatus` per entity: `input`
  (`red` and `green`, each `{ wired, signals }`; absent on a constant combinator; for a pole the two networks it joins), `output`
  (all emitted signals; absent on a lamp, a speaker and a pole), `lamp` (`{ lit, color }`), `speaker` (`{ playing, instrument,
  note, volume, alert }`, the engine's record), `active` (a lit lamp, a speaker that plays) and `label` (the output or the state
  as text: the first two signals, then `+N`; `lit`, `off`; `playing piano F#3`, with ` at 60%` when the volume is not the full
  one, `silent` (`speakerText`); empty for a pole, which has neither). The signal lists are the engine's own, in its signal order, not copies. `wired` comes from the compiled
  circuit (`CompiledCircuit.terminals`): the snapshot alone cannot tell an input without a wire from a wire that carries
  nothing. A status is cached per entity record of the snapshot and the map per entity table. The engine replaces a record
  exactly when what the entity reads, emits or lights changes, so a card gets a new status object, and renders, only then.
- **Project files.** New project, open, save, save as, open recent and open example go through `window.face`. A new project is the
  empty one the main process creates (`createEmptyProject` in `apps/desktop/src/emptyProject.ts`: one circuit, `circuit "Untitled circuit" {}`
  on two lines, no entities); the session begins with the same project, which that module also gives the renderer, so the window never
  waits for a file. An example (File > Open Example, `openExample(file)`) is a project file that ships with the app; it arrives without
  a path, so it is an unsaved copy without unsaved changes, Save asks for a location, and it is not a recent project. Every one of
  these asks first when the open project has unsaved changes.
- **Start.** `useProjectSession` calls `session.start()` once: it asks the main process for the project that was open last
  (`openLastProject()`, the top of Open Recent) and loads it in place of the empty project, without a prompt and without an unsaved
  change. With no such project the empty one stays. When the project cannot be read any more the empty one stays as well and the toast
  says "The last project could not be reopened." with the reason; its entry stays in Open Recent, as it does for a recent project that
  fails to open by hand. What the user did to the empty project before the answer arrived is kept (the last project is then not
  opened), and a project command given meanwhile runs after the start.
- **Dirty** means: the text
  or the settings (name, module set, wire reach) differ from what was saved. The wire reach is written to `face.json` only when it is not
  the default (9), so a project that never changed it has no such field. Manifest fields this version does not edit (custom signal groups, unknown
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
| Canvas | `--canvas-center` / `-mid` / `-edge`, `--canvas-dot`, `--card-top` / `-bottom` / `-border` / `-divider` / `-lit`, `--board-tile-dark` / `-light`, `--board-arrow` |
| Borders | `--border-edge`, `--border-subtle`, `--border`, `--border-strong`, `--border-input`, `--border-popover` |
| Text | `--text`, `--text-strong` (cream), `--text-soft`, `--text-label`, `--text-muted`, `--text-dim`, `--text-faint`, `--ink` (dark, on filled controls) |
| Accent | `--accent`, `--accent-fill`, `--accent-bright`, `--accent-border`, `--focus-ring` |
| Confirm | `--confirm`, `--confirm-bright`, `--confirm-edge` |
| Wires | `--wire-red`, `--wire-green`, `--wire-casing` (canvas); `--wire-red-ui`, `--wire-green-ui` and their `-surface` / `-border` (controls) |
| Entity kinds | `--kind-constant` (pink), `--kind-arithmetic` (cyan), `--kind-decider` (violet), `--kind-selector` (blue), `--kind-lamp` (yellow), `--kind-pole` (a neutral gray: it does nothing of its own), `--kind-speaker` (sand, warm like the lamp it is grouped with and no second yellow); a `kind-<kind>` class sets `--kind-color` |
| Status | `--status-ok`, `--status-warning`, `--status-error`, `--danger*`, `--notice-*` |
| Traces and syntax | `--trace-1` ... `-3`, `--syntax-signal`, `-number`, `-string`, `-atom` |
| Typography | `--font-ui`, `--font-mono`, `--text-xs` ... `--text-xl`, `--tracking-label` |
| Layout | `--titlebar-height`, `--projectbar-height`, `--palette-width`, `--inspector-width`, `--dock-height`, `--statusbar-height`, `--radius-*` |

Token classes for source highlighting (`face-tok-keyword`, `-string`, `-number`, `-comment`, `-signal`, `-atom`, `-name`, `-operator`,
`-punctuation`, `-color-red`, `-color-green`, `-invalid`) are in `styles/source.css`; `editor/tokens.ts` maps tokenizer kinds to them.

## Display modes and the layout

The canvas shows the circuit in one of two display modes (`DisplayMode` in `workbench/controller.ts`):

- **Edit**: the canvas as it always was. Cards of 184 x 128 at the `at` position of their entity, pins on the edges, routed wires.
- **Blueprint**: a checkerboard of tiles on which every entity takes the space it takes in the game, at its `tile`: 1x1 for a
  constant combinator and a lamp, 2x1 for the other combinators, turned with the facing. Wires are straight lines.

The mode is view state of the session like the workbench mode and the tool: `state.displayMode`, set with
`commands.setDisplayMode(mode)`, not part of the document, not undoable, `edit` for every project that is opened and kept while
it stays open. The segmented control `Edit | Blueprint` in the strip above the canvas (`.display-switch`, a group named "Display
mode" with `aria-pressed` buttons) and the key `B` switch it. The canvas container carries `data-display` and the class
`display-edit` or `display-blueprint`.

**What a mode offers.** `DISPLAY_CAPABILITIES` (`controller.ts`) is the one place that says it:

| Flag | Meaning | Edit | Blueprint |
| --- | --- | --- | --- |
| `move` | dragging entities and the arrow keys | yes | yes |
| `place` | the building blocks of the palette | yes | yes |
| `wire` | the wire tools | yes | yes |
| `paste` | paste and duplicate | yes | yes |
| `rotate` | `R`, `Shift+R`, `H`, `V` and the rotation and flip items of the context menu | yes | yes |
| `tiles` | positions are tiles: a move and a new entity write `tile` instead of `at`, a turn has to find its tiles free, and the controls that give and take a tile are shown | no | yes |

`Canvas` (the drag and its commit, the place tool, the menu items, the hint), `Workbench` (the keys, the paste event, the
strip with its wire tools and "Place all", the footer of the inspector) and `Palette` (`canPlace`) read it, and the session refuses a tool the mode
does not offer (`toolAllowed`), falls back to the select tool when a mode change takes the tool away, and applies the rule for
turns where `tiles` is set. Everything that does not depend on a position works in both modes: selecting (click,
Shift-click, marquee, wires), pan, zoom, Fit, copy, cut, delete, Select all and the whole inspector. While the source has
errors nothing can be dragged, and a click on one member of a multi-selection narrows the selection to it at once.

**The layout.** `Canvas` and `Scene` never ask where a card is; they ask a `CanvasLayout` (`canvas/layout.ts`), built per render
from the display mode, the entities and the positions of a drag in progress (`layoutFor`):

```ts
interface CanvasLayout {
  readonly mode: DisplayMode;
  readonly step: number;        // positions snap to multiples of this: 20 on the edit canvas, one tile (80) on the board
  readonly fitMargin: number;   // what Fit keeps free around bounds(), for wires beside an entity
  readonly detailZoom: number;  // below this zoom entities are drawn without text: 0.3 and 0.5
  rect(entity): Rect;           // marquee, culling, the corner a drag moves, the anchor of the bubble
  pin(entity, side, color): Point;
  route(wire, a, b): { path, bounds };
  bounds(): Rect | undefined;
}
```

`editLayout` wraps what was there before (`cardRect`, `pinPoint`, `routeWire`, `entitiesBounds`); `blueprintLayout` is built on
`arrangeBoard` and adds `placement(entity)` (top-left tile, size, facing, `placed`, `conflict`, and for a drag in progress
`moving` and `blocked`). The two are told apart by
`layout.mode`, which is how `Scene` picks `EntityCard` or `BlueprintEntity` and the order of the layers. Hit testing is by DOM
attributes (`data-entity-id`, `data-terminal`, `data-wire-color`, `data-wire`) in both modes. Both layouts take the preview
positions of a drag as top-left corners in canvas units (the board rounds them to tiles), so the drag gesture of the canvas is
the same code for both; only the commit differs (`onSetTiles` with the tile centers instead of `onMoveEntities`).

**The camera** is kept per mode (the two pictures have nothing to do with each other): `Canvas` holds one view per mode
(`CanvasViews`), restores the one of the mode on show and fits a mode the first time it is shown; a gesture in progress and an
open menu end with the mode. `Workbench` keeps the views while the canvas is unmounted in Source mode (`initialViews`,
`onViewChange(view, displayMode)`) and drops them with the project.

**The board** (`canvas/board.ts`). One tile is `TILE` = 80 canvas units; tile (0, 0) is the square from (0, 0) to (80, 80).
The ground is an SVG pattern of two by two tiles (`#board-tiles`) in `--board-tile-dark` and `--board-tile-light`, drawn over
the visible rectangle, so it covers the canvas at any pan and zoom.

- An entity with a `tile` stands on the tiles `occupiedTiles` gives for its center, kind and facing. A center that is off the
  grid is drawn on the nearest footprint (`tileOrigin`) and is a conflict; so are entities that share a tile
  (`findTileOverlaps`). Conflicts are drawn where their tile says, on top of each other if need be, with a dashed red outline.
- An entity without a `tile` stands at a derived place and looks not placed (dashed outline, paler body). `derivedTiles(entities)`
  gives these places as the centers a `tile` clause would hold, ready for `setTiles`: the top-left corner of the card divided by
  `EDIT_UNITS_PER_TILE` (92, half a card width, the same in both directions, so the picture keeps the proportions of the edit
  layout and a card is as wide as a 2x1 entity) and rounded to a tile. If the footprint would touch a taken tile, the entity
  goes to the nearest free place: the nearest ring of tiles around the wanted one, in it the nearest tile in a straight line,
  then the upper, then the left one. Taken are the tiles of all entities with a `tile` and of the derived ones that come
  earlier in the circuit. Nothing is written to the source; the place follows the edit position until the entity gets a tile.
- `arrangeBoard(entities, moved?)` is both together: one `BoardPlacement` per entity. `moved` is a move in progress (the
  top-left tiles the moved entities would get): they stand there as if it were their `tile`, so entities without one give way
  while the drag goes on, whatever a moved entity stands on is in conflict with it, and a moved entity that stands on a taken
  tile is `blocked`.

**Editing on the board.** The rules are pure functions in `canvas/board.ts`, the session commands apply them, and the canvas
uses the same functions for its previews. They all rest on one: only an entity with a `tile` takes tiles. An entity without one
stands at a derived place, gives way to the others and is never in the way. `at` is never touched by any of it.

| Rule | Function | What it says |
| --- | --- | --- |
| Moving | `blockedMoves(entities, origins)` | A move (a drag, the arrow keys) gives every moved entity the tile of its new place, also one that had none. It is blocked as a whole when one of them would cover a tile of an entity that has a `tile` and is not moved. A blocked move changes nothing. The moved entities are not in each other's way: a group moves as it is. |
| Turning | `blockedTurn(entities, facings)` | A turned entity keeps its top-left tile (`rotateTile`). The turn is blocked for the whole selection when one of them would newly cover a tile on which another entity with a `tile` stands after the turn. Tiles an entity covers already do not count (a half turn is always possible, and an entity in a conflict can be turned out of it). Blueprint mode only: on the edit canvas a turn is never refused, the analysis warns (`tile-overlap`). |
| Flipping | `flipTiles(entities, axis)`, `blockedFlip(entities, flips)` | The entities with a `tile` swap sides within the bounds of their footprints and every one that can turn faces the mirrored way ("Flipping" above). The flip is blocked for the whole selection when one of them would cover a tile of an entity that has a `tile` and is not flipped with it (`firstObstacle`). Blueprint mode only: on the edit canvas the cards are mirrored and nothing is refused. |
| Placing where shown | `derivedTiles(entities)` | An entity without a `tile` gets the one of the place it is shown at ("Place here", "Place all", a drag that ends where it began). These places keep clear of all tiles that are taken and of each other, so placing any subset cannot be blocked. |
| Unplacing | | The `tile` clause is removed; the entity stands at a derived place again. |
| Another prototype | `blockedReshape(entities, changed)` | The inspector's choice of which pole an entity is may change the tiles it covers. The entity keeps the top-left tile of its footprint and its `tile` is corrected in the same step (a small pole on `tile (7.5, 7.5)` becomes a big one on `tile (8, 8)`). The change is blocked when the entity would newly cover a tile of another entity with a `tile`. Blueprint mode only, like the turn rule: on the edit canvas the change is made and the analysis warns (`tile-overlap`). |
| A new entity | `footprintOriginAt(point, shape, facing)`, `canStandAt(entities, shape, origin, facing)`, `freeOriginNear(entities, shape, wanted, facing)`, `editPositionOf(origin)` | It faces the way the place tool was turned (east at first) and its footprint, turned with it, has the pointer in its middle: a 1x1 entity takes the tile under the pointer, a 2x1 entity the two tiles around it. It is refused when it would cover a taken tile. With Enter it goes to the free place nearest to the middle of the view (searched like a derived place). Its `at` is the position its tile is derived from (92 units per tile, on the 20 unit grid), moved on by 40 units while it is exactly the `at` of another entity (`pasteShift`). |

- Session commands (`WorkbenchCommands`), each one undo step: `setTiles(tiles: { id, tile }[])` with the centers as the `tile`
  clause holds them (blocked: nothing happens; a center off the grid: refused by the language and reported), `nudgeTiles(delta)`
  for the selection in whole tiles from where the board shows it, `placeHere(ids?)` (all entities without `ids`),
  `unplace(ids)`, `placeEntityOnTile(kind, tile, facing?, prototype?)`. `rotateEntities` and `faceEntities` apply the turn rule
  while the display mode has `tiles` and report a refusal in the toast: "Not rotated: gate would stand on a tile of light.";
  `flipEntities` applies the flip rule: "Not flipped: source would stand on a tile of gate."
  `updateEntity` does the same for another prototype: "Not changed: p would stand on a tile of light." Both messages go
  with the next change of the document or of the selected entities ("Messages" above).
- Dragging: the gesture of the edit canvas with a step of one tile. The preview is arranged with `arrangeBoard(entities, moved)`;
  entities of the drag are drawn last (`g.card.moving`), one on a taken tile is `blocked` (`data-blocked`, red body and outline)
  and the entity under it gets the conflict outline. The canvas has the class `dragging`, and the bubble is hidden. A drop that
  ends on the tiles it started from moves nothing, but it places the dragged entities that have no `tile` on the tiles they
  are shown at: an entity with the dashed outline is dragged a little way, or out and back, and stands where it was shown
  (one undo step; for entities that all have their tile such a drop writes nothing). A plain click, which stays within the
  drag threshold of 3 pixels, only selects. A blocked drop is refused by `setTiles`, so the entities go back. Dragging
  is how a conflict of the source is repaired: a tile off the grid comes onto it, and of two entities on one tile the upper one
  is dragged off.
- Arrow keys: one tile, five with Shift (`nudgeTiles`); a blocked step does nothing.
- Rotating: `R`, `Shift+R`, the two menu items and the Facing control, as on the edit canvas, under the turn rule.
- Flipping: `H`, `V` and the two menu items, under the flip rule.
- Placing where shown: the button "Place all" with the number of entities without a tile in the strip above the canvas
  (`button.place-all`, only while there are some); in the context menu of a selection "Place here" for its entities without
  a tile and "Unplace" for those with one (`Place 2 here`, `Unplace 1` when the item does not take the whole selection).
  They have no shortcut. A drag that ends where it began places as well (above). The hint line says that dashed entities
  have no tile. (The commands were called "Snap all", "Snap to tile grid" and "Release from tile grid" until 2026-11-13.)
- Placing: with a place tool the footprint of the new entity follows the pointer (`rect.board-ghost` with `data-tile-x`,
  `data-tile-y`, `data-facing` and `data-prototype`, class `blocked` and the cursor `not-allowed` over a taken tile, where a
  click does nothing and the tool stays). The footprint is the one of the tool's prototype: two by two tiles for a big pole
  and a substation, with the pointer on the corner the four share. `R` and `Shift+R` turn the outline, not the selection ("Placing with a direction" above): a 2x1
  outline changes between lying and upright around the pointer, an arrow in its middle (`path.board-ghost-arrow`, none for an
  entity that does not turn: a lamp, a speaker, a pole) points the way the entity will face, and whether the tiles are free is asked for the turned footprint. Enter places
  with the same direction. The new entity is selected and the tool goes back to select, as on the edit canvas; `facing` is
  written with the `tile`, whose center is the one of the turned footprint.
- Paste and duplicate: as on the edit canvas, by `Cmd/Ctrl+V`, Edit > Paste, the Paste of the context menu and `Cmd/Ctrl+D`.
  The copies have no `tile` (a fragment drops it): they appear as entities that are not placed (dashed, at their derived
  place), are the selection, and are one undo step. Their edit position is the one of a paste without a corner (where they
  were copied from, moved on by (40, 40) until free), also when the pointer is over the board or the menu was opened on it:
  a point of the board is not an edit position. From there they are dragged or placed like any entity without a tile; the
  hint line and "Place all" say so.
- Wiring: the wire tools work as on the edit canvas (click a pin, click a second pin of the color; the pending wire is a
  straight dashed line to the pointer).
- The inspector's footer shows `Tile X .. Y ..` (the center, as in the source) or "Not placed on a tile" on the board
  (`showTile`), and the position of the card on the edit canvas.

**An entity on the board** (`BlueprintEntity.tsx`, canvas units from the top-left corner of its footprint). The body leaves 4
units of its tiles free on every side. Kind accent top left, an indicator top right (lit while a combinator emits something or
a lamp is on, in the lamp's color when it has one; a lit lamp also gets a glow over its body), the entity icon and the name
(11 characters on one tile and on an upright 2x1 entity, 18 on a lying one) in the middle, and on a 2x1 entity below the name
what it emits in short (`compactOutput`: the first signal, `+N`, a dash for nothing). A 2x1 entity has a notch on both long
edges where the input half ends and two yellow arrows along its facing, one at the input end and one at the output end, as the
game draws them. Below 50 % zoom the text is left out and the icon is larger. On one tile the content moves 9 units away from
pins on the top or the bottom end.

- Pins (`boardPinOffset`): inside the footprint, 12 units from the outer end of their tile, 20 apart; input pins on the input
  half, output pins on the output half (a constant has its output where it faces, a lamp and a speaker their input on the
  west end). Red is on the left seen along the facing, as on the cards. The one connection point of an entity without input
  and output (`io`: a pole) has no direction and sits in the middle of the top end of the footprint (`boardPinHeading`),
  where the wires hang on a pole in the game, on one tile as on 2x2: red at (middle - 10, 12), green at (middle + 10, 22).
  Green is 10 units lower so that the two wires between poles in a row do not lie on one line (between poles in a column
  they are 20 apart). They are the same `g.pin` elements with `data-terminal`, `data-wire-color` and `data-edge` (`top`
  for a pole).
- An entity without halves and without a direction (a pole) has neither arrows nor a notch. On 2x2 tiles its content is in
  the middle of the four: the icon at 48 units, the name below it (18 characters). A lamp that is lit and a speaker that
  plays show it the same way: the indicator, the glow over the body and the class `active`.
- In the DOM the group is `g.card.board-entity` with the attributes of a card (`data-entity-id`, `data-entity-name`,
  `data-kind`, `data-facing`, `data-x`, `data-y`, `data-status`, `data-in-red`, `data-in-green`) plus `data-tile-x` and
  `data-tile-y` (the top-left tile), `data-placed` (`true` or `false`), `data-conflict` and `data-blocked`; the classes
  `selected`, `active`, `unplaced`, `conflict`, `moving` and `blocked`. A selected entity has the orange outline of a selected card. An entity that is not placed or
  in conflict says so in a tooltip (`<title>`); the others have none, like the cards.
- Wires are drawn above the entities, as in the game, with the same `g.wire` markup, classes and click target as the routed
  ones: a straight line between the two pins, and for a wire from the output of an entity to its own input an arc that passes
  32 units beside the line (`SELF_WIRE_SAG`), just outside the long edge on the side of its color. Because wires are on top, a
  click where a wire crosses an entity selects the wire; with a tool other than select, wires take no pointer events on the
  board, so they never cover a pin.

**Wire reach.** In the game a circuit wire connects two entities only when they are within its reach; the game data says 9
tiles for every entity the editor knows (`docs/factorio-audit.md` 5.4). Here it is a project setting: `project.wireReach`, 9
(`DEFAULT_WIRE_REACH`) unless the project file says otherwise, from 0 to 64 tiles, fractions allowed (`WIRE_REACH_RANGE`,
`isWireReach`); 0 (`UNLIMITED_WIRE_REACH`) means unlimited, nothing is flagged. It is edited in the project settings
(`WireReachField`: the label "Wire reach", a text field that is written with Enter or by leaving it, "A number from 0 to 64; 0
means unlimited" under a text that is no number, a number out of range taken as the nearest end of it (`clampWireReach`, the
same as for a project file), and the button "Reset to 9") through `commands.setWireReach(value)`, which ignores a
value out of range. Like the name and the modules it is not part of
the document: not undoable, and a change makes the project dirty.

- The measure is `wireDistance(a, b)` of `@face/model` (`wireReach.ts`): the distance between the nearest points of the two
  tile footprints (`footprintDistance`), in tiles, 0 for entities that touch. It is the game's rule, verified by fixture F-24
  (`tests/fixtures/game/F-24-wire-reach.json`). A wire is too long when that distance is greater than the reach
  (`exceedsWireReach`); exactly the reach is fine. A wire with an end that has no `tile` has no distance, and a wire of an
  entity to itself spans 0, so neither is ever flagged. `formatWireDistance(distance, reach)` is the distance for display: one
  decimal, more where that would hide on which side of the reach it is ("9.01" next to a reach of 9), none for a whole number of tiles ("9", with `tileUnit` for "1 tile"); `formatWireReach(reach)`
  is the reach, "unlimited" for 0.
- Flagging never blocks: a move, a turn or a new entity that makes a wire too long is carried out, and the simulation does not
  know the reach.
- The problems list: the analysis gets the reach as an option (`Analysis.request(..., wireReach)`, `AnalyzeOptions.wireReach`)
  and reports `wire-too-long` (a warning) on the wire statement. `setWireReach` analyzes again; the circuit object, the text
  and the simulation stay as they are.
- The board: `BlueprintLayout.wireDistance(a, b)` measures the entities as they stand, so an entity of a drag in progress counts
  with the tile the drag would give it, also one that has no tile yet. `Scene` flags a wire that is too long: `g.wire.too-long`
  with `data-too-long="true"` and an extra `path.wire-flag` between casing and core, dashes in `--status-warning` (yellow)
  that show on both sides of the core, which keeps the color of the wire. That is neither the solid orange outline of a
  selected wire nor a red wire, and a selected wire that is too long has both. The `<title>` of a wire with a distance ends in
  `(4 tiles apart)` or `(12.4 tiles apart, over the wire reach of 9)`. Because the layout is rebuilt for every tile of a drag, the flags
  follow the drag: a wire that would become too long at the previewed place is flagged before the drop, one that would become
  fine is not. An entity without a tile shows its wires measured while it is dragged, also over the tiles it stood on, where
  the drop then places it. The edit canvas shows every wire as before, without a distance.
- The inspector: a selected wire between two different entities that both have a tile shows `section.wire-distance` (in both
  display modes): how far apart the entities are, "Reach 9" ("Reach unlimited" for 0; the reach that applied, also a pole's own),
  a sentence that says whose reach that is and why (`wireReachNote` in `selectionText.ts`: "The wire reach of a small electric
  pole is 7.5: a pole has its own reach, and a wire spans the smaller reach of its two ends.", and where the project limits a
  wire to a pole that would reach further: "The wire reach of the project is 9. It is the smaller reach of the two ends: a big
  electric pole reaches 32.") and, when it is too long, `data-too-long` and a notice (`role="status"`). The ends of a wire are
  named `output`, `input` and, for the point of a pole, `connection`.

**The bubble.** On the board the entity under the pointer shows its full card next to it in `EntityBubble`: `CardFace`, the
same component the card of the edit canvas draws (kind, description marker, icon, name, summary, the three status rows), and
below it the description text when there is one. It belongs to the pointer, not to the selection: selecting an entity shows
none.

- When it shows is `HoverIntent` (`canvas/hover.ts`), the same rule the popups of the entity selector follow: it appears once
  the pointer has rested on an entity for 250 ms (`HOVER_DELAY_MS`), so crossing entities shows nothing; while one is on show
  the next entity gets its bubble at once; it goes 120 ms after the pointer has left (`HOVER_LINGER_MS`), which is what keeps
  it from flickering across the gap between two entities, and an entity entered in that time takes it over without a gap.
- Which entity is under the pointer is geometry (`entityAt`: the footprint that holds the pointer, the one drawn last where
  two share tiles), not the DOM target: a wire or a pin on top of the entity does not take the bubble away.
- It is not shown (`bubbleAllowed`) on the edit canvas, with a wire or a place tool (it would cover pins and target tiles),
  while a press is held (a drag of entities, a marquee, a pan; a press hides it at once and it returns only when the pointer
  moves again after the release) and while the context menu is open. It also goes when the pointer leaves the canvas, and
  when the entity leaves the pointer (a zoom, a pan with the wheel, a move by the arrow keys): the canvas checks at every
  render that the pointer is still inside the footprint.
- It is an HTML overlay of constant screen size (184 px wide, the size of a card at 100 %), so it is as readable zoomed far
  out as close up; it does not scale with the board. `placeBubble` puts it on the first side with room (right, left, below,
  above), otherwise on the side with the most room, keeps it inside the canvas and aims its pointer at the middle of the
  entity. The bubble takes no pointer events (`pointer-events: none`), so everything under it stays reachable, and it has no
  pins and no entity attributes: it is `div.entity-bubble` with `data-entity-name` and `data-side`.

## The strip above the canvas

`workbench/CanvasStrip.tsx` is a row of its own between the project bar and the canvas (`header.canvas-strip`, the first
child of `.graph-pane`; the canvas is in `.canvas-area` below it). Nothing of it lies over the canvas, where only the hint
line and the zoom controls (`.canvas-footer`), the bubble, the context menu and the notice about an invalid source remain.

- `.canvas-heading`: the title "Circuit workspace" and under it the counts (`.counts`: "4 entities", "4 connections").
- The canvas tools (`.tool-row`, a group named "Canvas tools"): select, red wire and green wire, which were in the sidebar
  until 2026-11-13. Keys, tooltips with the key, `aria-pressed` and the disabled state of the wire tools (`canWire`) are as
  they were; a wire tool that is clicked again returns to the select tool.
- `.canvas-strip-view`: the `Edit | Blueprint` switch and, on the board while entities have no tile, "Place all" with their
  number (`button.place-all`, disabled while the source has errors).
- The strip is one line at the window the app starts with. It is a wrapping flex row: where the canvas is narrow (Split
  mode, the smallest window in Split mode) the switch and "Place all" go to a second line and stay together; in the
  smallest window in Circuit mode it is still one line. `tests/e2e/canvasStrip.spec.ts` checks the three widths.

## The status line

`footer.statusbar`, three parts:

- `.status-lead`: the state of the source (`.status-source` with `data-level` and a tooltip that says what the light
  means; the text and the level come from `statusLead(errors, editable)` in `workbench/statusText.ts`) and the warnings
  chip (`.status-warnings`, which opens the source).

  | Light | Text | When |
  | --- | --- | --- |
  | green (`ok`) | No errors | the source has no errors and the canvas can edit |
  | red (`error`) | N errors in source, canvas is read-only | the source has errors; the canvas shows the last valid circuit |
  | amber (`checking`) | Checking the source | no error is known but the analysis has not caught up with the text (`editable` is false). The analysis is synchronous today, so this state is not seen; it is there for an analysis in a worker. |

- `.status-middle`: the selection in words (`.status-selection`) and the grid of the display mode.
- `.project-meta`: the path of the project file (`.path`, "Not saved yet" without one) and the save state
  (`[data-testid="save-state"]`, `role="status"`: "Unsaved changes" with the class `unsaved`, "All changes saved", "No
  changes" for a project without a file; `saveStateText`). Both were under the project name in the project bar until
  2026-11-13; the bar keeps the name. A long path is shortened in the middle by the layout, not by cutting the text:
  `splitPath` gives the folders (`.path-head`, which shrinks and ends in an ellipsis) and the last separator with the file
  name (`.path-tail`, which stays). The element so always holds the whole path as its text, and the tooltip has it too.

## Canvas behaviour worth knowing

- Card layout (card units, `EntityCard.tsx`): margin 13 on both sides. Header band down to the divider at 26.5: kind accent
  (3 x 13 at y 7), what the entity is (`entityTitle`: the kind, or the game's name where the kind has several prototypes, as
  "BIG ELECTRIC POLE"; 9px, baseline 17, 20 characters, set closer beyond 16 so that it ends before the marker), description
  marker (13 at the top right). Body down to the divider at 72.5: the icon of the prototype 34 at (13, 32), name (15px,
  baseline 46, 13 characters) and summary (12px monospace, baseline 63, 15 characters) from x 56. A summary of two lines
  (`summaryLines`: only a speaker has one) is set in 10px with 18 characters at baselines 56 and 67.5 under the name at 43.
  The summaries: a pole says what its prototype decides ("reach 32 · 2x2"), a speaker what it plays and when ("piano F#3" over
  "when A > 2", or "pitch from A" over "piano"); a sound the speaker leaves to the game's default is named from the catalog
  (`InstrumentsContext`). Below it three status rows of 9px monospace text, centered at y 84, 100 and 116 (`STATUS_ROWS` in
  `statusRows.ts`). Nothing but the pins lies outside x 13 to 171; the pins reach 7 units into the card. The card, its text and
  its icon never turn with the entity. Where pins sit on the top or the bottom edge (an entity facing north or south) the content
  next to them gives way, and only there: a card with pins on its top edge has the kind accent, the kind label and the
  description marker 2 units lower (label baseline 19), a card with pins on its bottom edge has its three status rows centered at
  y 82, 97 and 112 (`RAISED_ROWS`), which leaves 2.5 units between the icons of the last row and the pins. A card facing east or
  west is drawn exactly as before entities could be rotated.
- Status rows, while the simulation has data: what the entity reads on red (a red bar in front), what it reads on green (a
  green bar) and what it emits (an arrow; the same on both colors). A lamp has its state in the third row instead (`lit` or
  `off`, and a swatch of the light's color when it has one), and so has a speaker (`playing piano F#3` behind a mark of sound
  waves, both in the bright accent while it plays, or `silent`; 26 characters). A pole has the two rows of its networks and
  no third. A constant combinator has no input rows; its output starts in the first row and runs on into the other two. Each signal is its catalog icon (13 units) and its value; without an icon,
  the short name (up to 12 characters) and the value. `layoutRow` places as many signals as fit and ends the row with `+N`
  for the rest; it looks at no more signals than it places. Values of more than four digits are abbreviated the way the game
  does (`compactNumber`: `12k`, `1.0M`, `2.1G`, cut off, never rounded up). A row without signals shows a dash; the bar of
  an input without a wire of its color is dimmed (class `unwired`). The widths are computed from an assumed advance of
  5.5 units per character (SF Mono and Menlo have 5.42), not measured.
- A card has no tooltip (no SVG `<title>` of its own; removed on 2026-11-12 because it repeated the card). The pins keep theirs.
- Card status in the DOM: `g.card` carries `data-status` (the status label; absent on a pole, which has none), `data-in-red` and
  `data-in-green` (what that input reads as exact text, `inputText`: up to 32 signals and `+N` beyond, `no wire` and `nothing`
  for the two empty cases; absent on a constant), also on an outline. The rows are `g.card-row` with
  `data-row="red|green|out|lamp|speaker"` and the classes `red`, `green`, `out`, `lamp`, `speaker`, `playing` and `unwired`; inside them `.row-marker`, one `<image>` (with a catalog icon)
  and one `text.row-value` per signal, `text.row-more` (`+N`), `text.row-none` (the dash, a lamp that is off) and
  `rect.row-swatch`. Rows are memoized by their signal list, which the engine keeps while a network or an output is unchanged.
- Grid 20 units; cards are 184 x 128. Every terminal (`TERMINALS`: `in`, `out`, `io`) has one connection pin per wire color at
  each place it is drawn at (`pinPlaces`): an input and an output at their one place, the one connection point of an entity
  that has neither (`io`: a pole, and most entities of the game) at both, where an input would be and where an output would
  be. The two pairs of pins are one and the same point (`data-terminal="io"`, told apart by `data-edge` only): a wire may be
  started and ended at either, both light up while a wire is pending, and where the wire attaches is decided by the route
  (below). Which edge
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
  and a lamp have the pins of their one terminal; a lamp and a speaker do not rotate, so their input pins are always on the left
  edge, and a pole has its point on the left and on the right edge. `pinPoint(position, place, color, facing)` in `geometry.ts` is
  the only place that knows the positions (`pinEdge` and `pinHeading` name the edge and the direction a wire leaves in; a place
  is `in` or `out`); a wire of a color starts and ends in the center of the pin of that color. The rubber band of a pending
  wire starts there too; from a point with two places it starts at the one nearer to the pointer
  (`CanvasLayout.pin(entity, side, color, toward)`).
- Pins in the DOM: `g.pin` inside the card with `data-terminal="in|out|io"`, `data-wire-color="red|green"`, `data-edge="left|right|top|
  bottom"` and a `<title>` such as "Red input", "Green output" or "Red connection"; the card (`g.card`) carries `data-facing`. Pins are drawn in the wire color tokens.
  A wire tool sets `wire-red` / `wire-green` on `.canvas`: only the pins of that color are targets (highlight, click, pending state,
  start of the rubber band), the others are dimmed and ignored, whatever edge they are on. The model is unchanged: a wire is a
  color plus two terminals, and the tool decides the color.
- Rotating: `R` turns the selected entities a quarter turn clockwise, `Shift+R` counter-clockwise, as in the game (see
  "Keyboard shortcuts" for where the keys act; with a place tool they turn what it is about to place instead, see "Placing
  with a direction"). A held key does not repeat. The context menu of a card has "Rotate clockwise" and "Rotate
  counter-clockwise" with the keys, and the inspector of a single entity has the Facing control (`.facing-toggle`, a group named
  "Facing" with four buttons `data-direction`, `aria-pressed` on the current one). Every entity of a selection turns in place, each
  from its own direction; the selection is not turned as a group. One rotation of a selection is one undo step. While the source
  has errors all three are off. A lamp, a speaker and a pole do not rotate (`canRotate`): their inspector has no Facing control, the keys skip them, and the two menu
  items are disabled while the selection holds nothing that can rotate.
- Flipping: `H` mirrors the selection left to right and `V` top to bottom, as in the game; the context menu of a card has
  "Flip horizontal" and "Flip vertical" with the keys, below the rotations. Unlike a rotation a flip acts on the selection
  as a group ("Flipping" under "How the session works"). One flip is one undo step. The keys do nothing and the items are
  disabled while there is nothing to flip (`canFlip`: a single lamp or pole) and while the source has errors; with a place
  tool the keys flip what it is about to place.
- Routes (`wireRouting.ts`): every wire is a line of horizontal and vertical segments from pin to pin, drawn with rounded corners
  (radius 14; a corner next to a shorter segment gets what fits: the whole first or last segment, half of one between two corners).
  There are no curves. A wire leaves and enters a pin at a right angle to its edge. Red and green between the same two terminals
  run as parallels one pin spacing (20) apart and never touch, except in a narrow gap and at the one crossing described below.
  `routeWire(color, a, b, sameEntity)` takes the position, the side and the facing of both ends; the route does not depend on
  their order. An end that is a connection point without a direction (`io`) is first given one of its two places
  (`wirePlaces`): the one that is nearer to the other end, measured along the wire, which is the place with the shortest line
  (the red line is measured for both colors, so they attach at the same edge; of two lines of one length the one on the left
  edges is taken). From there it is routed as the input or the output that sits at that place, by the rules below, so nothing
  in them knows a pole. A chain source -> pole -> pole -> lamp so runs from left to right in straight lines (out of a right
  edge, into the next left edge); a pole straight above or below another entity is wired on the side the two share instead
  of around a card; and a pole to the left of an output is reached at its right edge. The rules below are written for two entities facing east. Two entities that face the same other way, and the
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
  the pointer while that is over the canvas (`CanvasHandle.pasteCorner`); otherwise, and always on the blueprint board, see `pasteShift` above. While the source has
  errors copy works, cut and paste do nothing. The context menu of a card has Cut, Copy and Paste with their shortcuts (Cut and
  Paste disabled while the source has errors); Cut and Copy run `document.execCommand`, which raises the same events. A page cannot
  start a paste (`document.execCommand("paste")` is refused and the clipboard permissions are denied), so Paste asks the main
  process: `FaceApi.paste()` (channel `face:edit:paste`, no arguments, trusted sender only) makes the window paste into itself with
  `webContents.paste()`, as Edit > Paste does, and the page gets the usual `paste` event. No clipboard content crosses IPC; the
  cost is that the page can trigger a paste into itself, and so read the clipboard text, without the user's key or menu. The menu
  of empty canvas has Paste too, above Select all; outside Electron (no `api`) the item is disabled. A paste from the menu puts the
  top-left corner of the group on the grid point at which the menu was opened, not under the pointer: `Canvas` keeps that point
  with the open menu and passes it to `onPaste`, `Workbench` holds it for the one paste event that follows (any paste event
  clears it, and so does a call that fails), so a later Cmd/Ctrl+V goes to the pointer again. With entities selected the menu also
  has the two rotations and the two flips, between Paste and Delete, and on the blueprint board below them "Place here" and
  "Unplace". The menu opens at the pointer and moves up and to the left as far as it has to, to stay inside the canvas
  (`ContextMenu` measures itself, `within`).
- Deletion: on the canvas through the context menu (right click) only; there is no toolbar on the selection. Also Delete / Backspace
  while focus is inside the canvas, Edit > Delete, and the Delete button at the top of the inspector. Keys never delete while a text
  control or the source editor has focus. All of them delete the whole selection, entities and wires, as one undo step
  (`deleteSelection`). A right click on a card or (select tool) a wire outside the selection selects it alone first; the menu
  of a wire has Delete, and Cut, Copy and Paste as well when entities are selected with it.
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
| Entity to place: Constant, Arithmetic, Decider, Selector, Lamp (`KEYED_KINDS`; no other entity has a key) | `1` ... `5` | `1` ... `5` | circuit |
| Place the block in the middle of the view (on the board: on the free tile nearest to it) | `↩` | `Enter` | canvas (focus on the canvas itself) |
| Cancel: the pending wire, then the tool, then (in the canvas) the selection | `Esc` | `Esc` | circuit, canvas |
| Rotate clockwise, counter-clockwise: the selection, or with a place tool the entity it is about to place | `R`, `⇧R` | `R`, `Shift+R` | circuit |
| Flip horizontal, vertical: the selection as a group, or with a place tool the entity it is about to place | `H`, `V` | `H`, `V` | circuit |
| Move the selection one grid step, five grid steps (on the board: tiles) | arrows, `⇧` arrows | arrows, `Shift` arrows | circuit |
| Duplicate the selection | `⌘D` | `Ctrl+D` | circuit |
| Delete the selection | `⌫` or Delete | `Del` or Backspace | canvas |
| Cut, Copy, Paste | `⌘X`, `⌘C`, `⌘V` | `Ctrl+X`, `Ctrl+C`, `Ctrl+V` | clipboard events |
| Edit / Blueprint view | `B` | `B` | circuit |
| Keyboard shortcuts (the overview) | `?` | `?` | window |
| Undo, Redo, Select All | `⌘Z`, `⇧⌘Z`, `⌘A` | `Ctrl+Z`, `Ctrl+Y`, `Ctrl+A` | menu |
| Circuit, Source, Split | `⌘1`, `⌘2`, `⌘3` | `Ctrl+1`, `Ctrl+2`, `Ctrl+3` | menu |
| Zoom In, Zoom Out, Fit to Content | `⌘+`, `⌘-`, `⌘0` | `Ctrl++`, `Ctrl+-`, `Ctrl+0` | menu |
| Run / Pause, Step, Reset | `⌘R`, `⌘T`, `⇧⌘R` | `Ctrl+R`, `Ctrl+T`, `Ctrl+Shift+R` | menu |
| New, Open, Save, Save As | `⌘N`, `⌘O`, `⌘S`, `⇧⌘S` | `Ctrl+N`, `Ctrl+O`, `Ctrl+S`, `Ctrl+Shift+S` | menu |
| Application settings (Settings... in the application menu on macOS, in the File menu elsewhere) | `⌘,` | `Ctrl+,` | menu |

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
- **What the keys do.** The tool keys set the tool (pressed again they keep it; the buttons toggle). `1` to `5` are the four
  combinators and the lamp (`KEYED_KINDS` in `entities/registry.ts`, a decision that stays as the palette grows: entities added
  later get no key); `5` opens the group of the lamp when it is closed. The arrows call `nudgeSelection` with 20 units, with Shift 100 (`nudgeDelta`), on the
  blueprint board `nudgeTiles` with one tile and five, unless the
  focused control uses the arrows itself (`usesArrowKeys` in `platform.ts`: text, selects, sliders, radio groups, lists, tabs,
  menus); without a selection they keep their default. `Cmd/Ctrl+D` calls `duplicateSelection`. `R` and `Shift+R` turn the
  selection, or, while a place tool is active, what that tool is about to place (`turnedTool`; nothing for a lamp, a speaker or a pole).
  `H` and `V` flip the selection (`flipEntities`, where `canFlip` says there is something to flip) or the place tool
  (`flippedTool`); they are the plain keys only, so `Cmd/Ctrl+V` stays the paste and `Cmd+H` the system's. `B` switches
  the display mode; what a mode does not offer (`DISPLAY_CAPABILITIES`) does nothing. While the source has errors the
  keys that edit (rotation, flipping, arrows, duplicate, delete) and the tools that edit (wires, building blocks, like their disabled
  buttons) do nothing; `Q`, Escape and `?` work.
- **Discoverability.** The three tool buttons name their key in the tooltip (`title`). The five tiles of the entity selector
  with a key name it in their popup, as "Key 3", so that the digit is not read as a count. The buttons carry no
  `aria-keyshortcuts`: the tooltip, or the popup while it is on show (`aria-describedby`), is the accessible description of
  the button, so a screen reader hears the key once, also VoiceOver, which does not announce `aria-keyshortcuts`. Context
  menu items show their keys as before.
- **Overview.** `ShortcutOverview` lists the table in its groups (Tools, Editing, View, Simulation, File) with the key names of
  the platform, one key cap per key. It opens with `?` and with Help > Keyboard Shortcuts (menu command `help.shortcuts`). It is
  a modal dialog (`role="dialog"`, `aria-modal`, labelled by its heading): the focus goes to its Close button, Tab stays inside,
  a click on its text focuses the dialog itself, so no key reaches the circuit behind it. Escape, Close and a press beside the
  dialog close it and give the focus back to where it was. Escape closes the dialog only; a tool picked before stays picked.
  That behaviour is `dialog/Modal.tsx`, which the application settings share.

## Icons

`EntityIcon` / `EntityIconSvg` take an entity (or just its kind and prototype) and an `EntityIconResolver`
(`(prototype) => url | undefined`). `icons/catalogEntityIcons.ts` probes one item icon per prototype of `PROTOTYPES`
(`prototypeIconId` of the registry: `item/<prototype name>` unless the registry says otherwise) of the generated catalog through
`face-asset://catalog/icons/item/<name>.png` and resolves only those that load, so each pole shows its own item.
`icons/catalogSignalIcons.ts` does the same for signal, group and quality icons with one probe; the two wire tool buttons of the palette
take the game's `item/red-wire` and `item/green-wire` icons from it. The main process answers these URLs with icons it renders from the
user's installation of the game, or with bundled files (`packages/catalog/generated` in development, git-ignored). With neither,
entities and wire tools show inline pictograms and signals are shown by name, in the picker as well. The pictograms tell the
kinds apart by their shape, not only by a mark: a combinator is a box with a display, a lamp a bulb, a speaker a loudspeaker
with sound waves, a pole a mast with a crossbar (taller and wider for the bigger poles, a box with two masts for a substation).
An icon the installation should have but lacks (a module that is not installed) arrives as a gray placeholder image.

The URL of an icon does not say where it comes from, and an image does not fetch an unchanged URL again. When the installation in use
changes while the app runs, the state of the application settings carries a higher `iconRevision`; both resolvers take it, append it
as `?r=<n>` (`revisionQuery`; nothing for revision 0, the installation found at start) and probe again.

## Application settings

`settings/AppSettings.tsx` is the dialog for the settings of the application on this machine (menu command `app.settings`:
Settings... with `Cmd+,` in the application menu on macOS, with `Ctrl+,` in the File menu elsewhere). It is a `Modal` and shows what
`appSettingsView` (pure) makes of the state the main process reports (`AppSettingsState` in `ipc.ts`): the folder in use
(`.game-folder-path`, `data-source="chosen|detected|none"`; "No installation found" without one) and whether it was chosen or found
automatically; the game version (`[data-fact="version"]`, `data-level="ok|note|warning"`: a note for another patch release than the
catalog's, a warning for another release line, used all the same); the data directory when it is not the folder shown
(`[data-fact="data"]`); the modules found and those not installed (`[data-fact="modules"]`, `[data-missing]`); the problem of a chosen
folder that cannot be used (`[data-message="problem"]`, the folder stays chosen); the reason a folder was refused
(`[data-message="error"]`). "Choose..." asks the main process to show the native folder chooser, "Reset to auto-detect" (enabled while
a folder is chosen) to forget the choice; the renderer never names a folder. Both are disabled while a request is on its way.
`useAppSettings` reads the state once, follows the change event and keeps the newer of two reports (`reduceAppSettings`).

Nothing is asked at the first start: the app looks for the game by itself. Only when no installation is in use and no bundled icon
loads either does the workbench show one hint at the right end of the title bar (`.icon-hint`, `needsGameFolderHint`; there it covers
nothing and takes no room from the workbench), with a button "Game folder..." that opens the dialog and one that dismisses the hint
until the next start.

## The entity selector

The left sidebar offers what can be placed. What it offers is data, `PALETTE_GROUPS` in `entities/registry.ts`:

```ts
const GROUPS = [
  { id: "combinators", label: "Combinators", pinned: true, prototypes: ["constant-combinator", "arithmetic-combinator", "decider-combinator", "selector-combinator"] },
  { id: "lights-and-sound", label: "Lights and sound", open: true, prototypes: ["small-lamp", "programmable-speaker"] },
  { id: "power-poles", label: "Power poles", open: false, prototypes: ["small-electric-pole", "medium-electric-pole", "big-electric-pole", "substation"] },
];
```

An entry is a game prototype name; its kind, its label (the game's name), its tiles and its wire reach come from `PROTOTYPES`
of `@face/model`, its icon from `prototypeIconId`. **A further entity of a kind the editor has** (another pole, another lamp)
is a row in `PROTOTYPES` and its name in a group here: the palette entry, its icon, the place tool, the footprint on the
board, the choice in the inspector (`PrototypeField`), the card heading and the wire reach follow from that. **A further
category** is a group. **A further kind** (a family with behaviour of its own) also needs its part in the model, the
language and the simulation, a `KIND_INFO` row, a summary line and, if it has settings, a form; an entity with one
connection point (`TERMINALS`: `io`) gets its pins, its wiring and its place on the board from the general code.
`test/registry.test.ts` fails when a prototype of the model is in no group or in two.

- **Tiles.** Every entry is a square tile with nothing but its icon (`button.palette-tile`, 30 pixel icon), four in a row
  at the width of the sidebar (a grid of four columns, about 48 pixels each at 240 pixels of sidebar and 41 at 212). The
  game's name is its accessible name (`aria-label`: "Decider combinator"); it has no `title`, because everything else is in
  the popup. Every tile carries `data-kind` and `data-prototype`. The entry of the palette, one per prototype, also has the
  class `palette-item`; the tiles of "Entities in use" have `in-use` instead, so `.palette-item[data-prototype=...]` names
  one element.
- **The popup** (`div.tile-popup`, `role="tooltip"`, `data-prototype`, `data-side`) says what a tile stands for, in the
  look of the board's bubble (card colors, the kind's accent on its left edge, the same pointer): the game's name, what the
  kind is for (`KIND_INFO[kind].description`), for an entity with a reach of its own its tiles and reach ("2 x 2 tiles, wire
  reach 32"; `prototypeFacts`), and the key of the five entries that have one, written "Key 3" so that it is not read as a
  count. It shows for the tile the pointer rests on, by the rule of the board's bubble (`HoverIntent`: after 250 ms, at once
  from tile to tile, gone 120 ms after the pointer left), and without a wait for the tile that has the keyboard focus
  (`:focus-visible` only: a tile that was clicked keeps the focus, and its popup leaves with the pointer). A disabled tile
  shows it too. It is fixed to the window beside the sidebar at the height of its tile (`placeBubble` with the row of the
  tile up to the edge of the sidebar as the anchor), so it covers no tile, its own included; it takes no pointer events.
  When the sections are scrolled the popup of the pointer goes, and the popup of the focused tile moves with its tile (the
  browser scrolls a tile into view when the keyboard reaches it) and goes when that is scrolled out of sight. While it is on show the tile names its text as `aria-describedby`.
- **The combinators** (the pinned group) are the first row, always on show, without a heading (`.palette-items`, a group
  named "Combinators").
- **Entities in use** (`section.palette-group[data-group="in-use"]`, below the combinators, above the groups): one tile for
  each game prototype the circuit on show contains, without the pinned entries, in the order of the palette (`entriesInUse`
  in `registry.ts`), so a tile keeps its place whatever is placed next. The section is always there; with none it has the
  line "None besides the combinators." (`.palette-empty`) as high as a row of tiles, so nothing moves when the first lamp
  is placed. Its heading shows the number of tiles and closes it like a group; that is remembered under
  `face.palette.inUseOpen`. An entity in it also stays in its group. Both tiles arm the same tool (`sameTool`), and both
  are pressed while it is armed.
- **The groups.** Every other group has a heading that is a button (`button.palette-group-header` with `aria-expanded` and
  `aria-controls`, the name and the number of entries) and, while open, its tiles in a panel (`role="group"`, named like
  the group; hidden and empty while closed, so nothing of it is in the tab order).
- The count badge of the panel is the number of entries (`PALETTE_ENTRIES`).
- Which groups are open is a preference of the person at this machine (`workbench/paletteGroups.ts`): stored as JSON under
  `face.palette.openGroups` in `localStorage`, which belongs to the profile of the app (userData), so it is the same for every
  project and survives a restart. The list of the circuit (`face.palette.circuitListOpen`) and "Entities in use" have a key
  of their own (`readSectionOpen`; open unless a "false" is stored). The main process offers no per-viewer state over IPC.
  Every access is guarded: without storage, with storage that throws and with a value that is not what was written, the groups
  start as the registry says ("Lights and sound" open, "Power poles" closed) and work for as long as the window lives. Only
  known group ids with a boolean are taken from the store, so a group added later starts as it is defined.
- A place tool whose entry is in a closed group opens that group (the lamp by `5`), and the armed entry (the tile in its
  group) is scrolled into view. A group closed by hand while its tool is armed stays closed. A section that is opened is
  scrolled so that as much of it as fits shows, from its heading down.
- Layout: the heading, the row of the combinators, then two areas that share what is left and scroll on their own: the
  sections (`.palette-groups`: "Entities in use" and the groups; up to two thirds, never more than they need; it reaches the
  edge of the sidebar, where its scrollbar has room beside the tiles, so its columns are those of the first row) and the
  entity list (`.entity-list`, the rest, at least 48 pixels). At the default window (1510 x 960) the sections fit without
  scrolling, also with every group open. At the smallest window (1120 x 760) with every group open they scroll and the list
  shows its first rows; `tests/e2e/entitySelector.spec.ts` checks both sizes (nothing is cut off, every entry and every
  entity can be reached).

## Poles and speakers

- A pole (`pole`, four prototypes) has one connection point (`io`), no settings and no state. Its card names the pole in the
  heading and shows its reach, its tiles and the signals on its red and on its green network. The inspector has the choice of
  the prototype (`.prototype-field`, a group named "Pole" with one `aria-pressed` button per prototype: icon, name, tiles and
  reach) and a note on what a pole does; changing it is `updateEntity` with the rule "Another prototype" of the board. A
  statement `prototype = ...` that is in the source stays when the choice returns to the small pole: `updateEntity` of the
  language patches the value of a statement and does not remove a statement for its value, for every kind.
- A speaker (`speaker`) reads on its one input. `SpeakerForm` has every setting of the language (`docs/dsl.md`): "Plays when"
  (a condition, edited with the `ConditionFields` the lamp uses, or "Signal value is pitch" with the pitch signal; the signal
  goes along when the mode changes, and a condition whose signal is taken out is no condition), instrument and note as
  selects fed from the catalog (`InstrumentsContext`, the names of the game as labels; the note select has the notes of the
  chosen instrument and is absent in pitch mode; `speakerEdits.ts`: the first instrument and the first note of an instrument
  are not written, a change of the instrument keeps the note where the new one has it and takes its first otherwise; a name
  the game data does not have stays selectable and is marked, and without lists the two are text fields), the volume in
  percent (`NumberField`, 0 to 100 with decimals, validated like every field) or "Signal value is volume" with its signal,
  the playback mode, polyphony, "Stop playing sounds", and the alert (show, show on map, icon, message).
- Wire reach per entity: `wireSpan` of `@face/model` through `BlueprintLayout.wireSpan`; the title of a wire, the flag on the
  board and the wire inspector name the reach that applied, also a pole's own, and all three follow the prototype.
- Completion offers a pole by its bare name and the instruments and notes of the catalog (`session/completion.ts`); the analysis gets
  the instrument list from `CatalogService.instruments`, the simulation environment from `environmentData`.

## Commands

```
source scripts/env.sh
npm run build                 # dist/renderer, dist/main.cjs, dist/preload.cjs   (node scripts/build.mjs --watch to rebuild on change)
npm start                     # run the built app; profile in .runtime/user-data
npx vitest run apps           # unit tests (session tests need no DOM)
npm run test:e2e              # Playwright against the built app; output in .runtime/
npm run examples              # write examples/*.faceproj from tools/examples/*.face (--check: fail when they differ)
```

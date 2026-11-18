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
  main.tsx, index.html entry point: asks for the game data and applies it, then renders; index.html carries the Content-Security-Policy
  gameData/
    dataInUse.ts       the data this window works with: asked for once, installed in the model and the catalog, built-in on failure
    projectMods.ts     the record of the game a project was made with: when a save writes it, what it says against the data in use   (pure)
    gameDataView.ts    what the "Game data" section says in every state of a request to read the game, the entities a read
                       left out by reason and as a list to copy; the state's reducer   (pure)
    useGameData.ts     the status as the main process reports it, the requests, and the reload that applies other data
    GameDataSection.tsx  the section of the application settings
    reopen.ts          the settings dialog comes back after that reload (session storage, one reload)
  platform.ts          the platform, and where keyboard input belongs (text controls, controls that use the arrow keys)
  textSelection.ts     text of the page that is selected and copied: whose a cut, copy or paste is (pure), the selection a press
                       elsewhere drops, a copy the page starts itself
  session/
    projectSession.ts  ProjectSession: implements WorkbenchController, wires the parts below, batches change notifications
    document.ts        SourceDocument: the CodeMirror EditorState (text, history, selection) with or without a mounted view
    analysis.ts        runs the language per document version, drops stale results, keeps the last valid circuit, shares structure
    drafts.ts          inspector edits the language cannot write yet: normalization, completeness check, hints
    clipboard.ts       copy and paste of entities: the clipboard text, what is accepted from it, where a pasted group lands   (pure)
    simulationRunner.ts  compile on change, keep state by semantic fingerprint, timer, bounded history, SimulationView
    simulationView.ts  snapshots to dock traces and card statuses                    (pure)
    catalogService.ts  per module set: SignalResolver, signal info, picker tree, module list for the settings
    moduleUse.ts       which switched-off modules a source uses (the game data of one analysis, recording)
    environment.ts     simulation environment from the catalog (order, stack sizes, rocket capacity, qualities)   (pure)
    persistence.ts     project file mapping, dirty comparison, the empty project a session begins with   (pure)
    blueprints.ts      blueprints of the game: what a pasted text or a file holds, the list of a book, the wording of the import
                       report, the project a blueprint opens as, the blueprint string of the circuit and what is in its way   (pure)
    completion.ts      completion candidates from the language's expectations and the catalog   (pure)
    editorSupport.ts   CodeMirror glue: token kinds, lint transaction, completion source
    useProjectSession.ts  React binding (useSyncExternalStore) and the `window.faceSession` probe
  workbench/
    controller.ts      the WorkbenchController seam (state, commands, shared view types)
    Workbench.tsx      shell: lays out the panels, routes callbacks to commands, wires the native menu and the close handshake
    selectionText.ts   the selection in words: status bar text, counts, wire labels, what the inspector is about   (pure)
    moduleOrder.ts     the order in which modules are shown and named: the game's own, then the mods by title   (pure)
    statusText.ts      what the status line says about the source and about the project file, a path in the two parts it is
                       shortened by   (pure)
    TopBar.tsx         title bar (brand, Circuit / Source / Split) and project bar (name, undo, redo, fit, "Project Settings", save)
    CanvasStrip.tsx    the strip above the canvas: title and counts, the tools (select, red wire, green wire), the Edit | Blueprint
                       switch, "Place all"
    Palette.tsx        the entity selector (square tiles with a popup: the combinators as the first row, "Entities in use", and
                       every entity of the project's modules in a tab per item group of the game with a search), entity list
    paletteGroups.ts   what the palette remembers in the browser storage of the profile: the tab on show, the search, the open
                       sections   (pure apart from the two stores)
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
                       pin per terminal, on the edges the entity's facing gives them); `CardFace` is the card without pins
                       and place, `Pin` one pin
    BlueprintEntity.tsx  one memoized entity on the board: footprint, icon, name, arrows, pins, compact live state
    EntityBubble.tsx   the bubble of the entity under the pointer on the board: `CardFace` and the description as an HTML overlay
    bubble.ts          where the bubble goes (`placeBubble`)   (pure)
    statusRows.ts      the status rows of a card: geometry, which signals fit, the rows as text, the compact output of the board   (pure)
    ContextMenu.tsx    keyboard-navigable popup menu
    geometry.ts        card and pin geometry (`pinPoint`, `pinEdge`, `pinHeading`), rectangles  (pure)
    viewport.ts        camera transforms, zoom, fit, culling rectangle (pure)
    drag.ts            snap, drag threshold, group drag, placement     (pure)
    wireRouting.ts     wire routes for every combination of pin edges (a connection point without a direction is wired as an
                       output on the top edge), SVG path data   (pure)
  editor/
    SourceEditor.tsx   CodeMirror view over an `EditorBinding`; owns no state
    extensions.ts      editor chrome: gutters, selection, indentation, keys, theme
    theme.ts           editor colors in the app palette
    tokenHighlight.ts  viewport decorations from an external tokenizer
    tokens.ts          token kind to class mapping, minimal text diff  (pure)
  inspector/
    Inspector.tsx      identity, rename + Delete at the top, description, draft hint, settings slot, connections; a selected wire;
                       the summary of several selected things; undo and redo from its fields; back to its top for another entity or wire
    EntitySettingsForm.tsx and ConstantForm / ArithmeticForm / DeciderForm / SelectorForm / LampForm / SpeakerForm
    GenericForm.tsx    the settings of a generic entity (kind `entity`): a control per setting of its prototype type, from the
                       settings table of the model
    PrototypeField.tsx which entity of its kind an entity is, for a kind with several game prototypes in the game data (a pole; a
                       combinator or a lamp where a mod adds one), and which one of its prototype type a generic entity is
                       (`compact`: icons in a row, also for a kind with more than four prototypes)
    speakerEdits.ts    instrument and note of a speaker against the game's lists: what is a default and is not written   (pure)
    conditionEdits.ts  a condition with a switch (lamp, generic entity): the unset one as its fields show it, and what an edit makes of it   (pure)
    instruments.ts     `InstrumentsContext`: the speaker's instruments and notes from the catalog, for the form and the cards
    SignalField.tsx    validated `kind:name[@quality]` input with icon, name, warning and the picker slot
    signalWarning.ts   the note under a signal field for a signal the project does not provide, in the words of the source's warning   (pure)
    fields.tsx         text, integer, number, select and checkbox fields, the red/green NetworkToggle, the text a field holds on its own
    formParts.tsx      sections, list items, the operand and the circuit condition (`ConditionFields`: speaker; `SwitchedConditionFields`:
                       lamp and generic entity, where a condition in use without a signal is the unset one)
    immutable.ts, validation.ts
  picker/
    SignalPicker.tsx   signal picker like the game's: group tabs, subgroup rows, search, quality row
  settings/
    ProjectSettings.tsx  project name, wire reach and the modules of the project as signal groups (the game's, and the mods of a game that was read)
    moduleList.ts        the module list in words: row notes, counts, filter, the notes around the list
    wireReach.ts       the text of the wire reach field as a number in range, the line under the field   (pure)
    AppSettings.tsx    the settings of the application on this machine: the game installation the icons are read from, the game data (modal)
    appSettings.ts     what that dialog says about an installation, when the hint is due, which report of the state counts   (pure)
    useAppSettings.ts  the state as the main process reports it, and the two requests that change it
  dialog/
    Modal.tsx          the modal dialog: backdrop, title, close button, focus kept inside and given back; it starts in the
                       control marked `data-autofocus`, otherwise in its first one
  blueprint/
    ImportBlueprint.tsx  the dialog to paste a blueprint string into (also: what is in the way of a chosen file, the list of a
                       blueprint book), and the report on what an import left out
    ExportBlueprint.tsx  the dialog with the blueprint string to copy, and the one that lists what is in the way of a blueprint
  shortcuts/
    shortcuts.ts       the shortcut table: every key of the app, key matching, labels per platform, the arrow distance   (pure)
    ShortcutOverview.tsx  the modal overview of all shortcuts
  simulation/
    SimulationDock.tsx controls, trace table with sparklines, tick counter
    sparkline.ts       sparkline geometry                              (pure)
  entities/            kind labels and the names an entity goes by (`kindInfo.ts`), what a prototype type is on a circuit for
                       and the notes on it (`typeInfo.ts`), what the selector offers as a function of the catalog, the entity
                       table and the modules (`registry.ts`), the settings form of a generic entity as data
                       (`genericSettings.ts`), signal text forms (short names, lists, compact numbers), card summaries, the
                       quarter turns and the mirror images of the direction an entity faces (`facing.ts`)  (pure)
  icons/               interface glyphs, entity icons per prototype, catalog icon resolvers (with probes: the icons come from the
                       user's installation of the game and the user's mods, or from bundled files, and none may be there)
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

`WorkbenchState`: `project` (name, path, fileName, dirty, wireReach, epoch, madeWith, modsNotice), `circuit` (last valid `Circuit`), `editable` (false while the source
has errors), `selection` (entity ids), `wireSelection` (wire keys), `mode`, `displayMode` (`edit` or `blueprint`), `tool`, `source`, `diagnostics` (with line numbers), `canUndo` / `canRedo`, `simulation`
(`SimulationView`: running, tick, speed, traces, per-entity status with inputs per wire color, notice), `catalog` (`CatalogView`: modules, otherMods, unknownModules, qualities,
`speakerInstruments`, `picker()`, `entities()` (the `EntityRegistry` of the entity selector), `describe(signal)`, `entityWarning(prototype)`), `draft` (pending inspector edit of the selected entity) and `error` (the message of the toast; see "Messages"
below).

`WorkbenchCommands`: view (`setMode`, `setDisplayMode`, `setTool`, `select`, `dismissError`), document (`placeEntity`, `moveEntities`, `rotateEntities`, `faceEntities`, `flipEntities`, `updateEntity`,
`discardDraft`, `renameEntity`, `deleteEntities`, `deleteSelection`, `copyEntities`, `pasteEntities`, `nudgeSelection`, `duplicateSelection`, `addWire`, `removeWire`,
`toggleWire`, `setSource`, `undo`, `redo`), the blueprint board (`setTiles`, `nudgeTiles`, `placeHere`, `unplace`, `placeEntityOnTile`; see "Editing on the board"),
simulation (`run`, `pause`,
`step`, `resetSimulation`, `setSpeed`), settings (`setModuleEnabled`, `enableUsedModules`, `setProjectName`, `setWireReach`) and project (`newProject`, `openProject`,
`loadProject`, `openExample`, `save`, `saveAs`) and blueprints (`readBlueprint`, `openBlueprint`, `chooseBlueprintFile`, `exportBlueprint`,
`saveBlueprintFile`; see "Blueprints of the game").

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
- **Scroll position.** The inspector scrolls as a whole. When it comes to show another entity or another wire
  (`inspectedSubject` in `selectionText.ts`: the id of the one selected entity, the key of the one selected wire, nothing for
  none or several) it goes back to its top, so that the title and the warning under it are in view; an edit of the entity on
  show, which makes a new circuit with the same id in it, leaves it where it was scrolled to.
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
  `{ type: "place", prototype, facing? }`. It is an `EntityShape` of the model, the game's name of what it places (the tools of
  the digit keys name the standard prototype of their kind, `standardPrototype`), east without `facing` (`placeFacing(tool)`; always east for an entity that does not turn: a lamp, a speaker, a pole). `R` and `Shift+R` turn it
  while the tool is active (`turnedTool(tool, turn)`, set with `setTool`), and `H` and `V` flip it (`flippedTool(tool, axis)`),
  in both display modes, instead of acting on the selection; a tool for an entity that does not turn is left alone and the
  keys then do nothing. `sameTool` compares the prototype and does not look at the direction (it is the same button of the palette), but `setTool` does: the tool
  picked again by its key, or after another tool, comes without `facing` and so faces east again. A click that places nothing
  (a taken tile) keeps the tool and its direction. `placeEntity(prototype, position, facing?)` and
  `placeEntityOnTile(prototype, tile, facing?)` pass all of it to the language command `addEntity`, which declares the entity
  by the name of its prototype and writes ` facing <direction>` behind `at` or `tile` for every direction but east (a new entity
  that faces east has no clause, as before; never for an entity that does not turn).
  The hint line names the entity (`entityNoun`: "to place a big electric pole") and, where it turns, the direction and the
  key ("to place a decider facing south (R turns it)"); on the edit canvas that is the only sign of it before the click, on
  the board the outline has the footprint of the prototype and turns as well.
- **Messages.** `state.error` is one message, shown in the toast (`.toast`, `role="alert"`) with a Dismiss button; a newer one
  replaces it. While a canvas is shown the toast is a child of `.canvas-area`: in the middle of the canvas, 62 units above
  its lower edge, which is above the hint line and the zoom controls, and in Split mode beside the source pane, not over
  its problems list. In Source mode it stands over the bottom of the window's body, as it always did. The session sets it through `show(message, refusal?)` and keeps two sorts apart. A message about a refused edit
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
  comparison without signal, an expression without output, a signal twice in a section), it is kept in `state.draft` with a hint; the
  inspector shows the draft instead of the entity, and the next edit that makes it valid writes all of it as one step. A draft is dropped
  when the selection moves on, when it is discarded, or when its entity changes in the source.
- **Diagnostics** go to `state.diagnostics` and, as a separate effect-only transaction, to the lint extension. Highlighting uses the tokens
  of the analysis the session already has, and the word of an entity declaration, which is a name of the game and no keyword, has
  the class of a keyword (`declarationWords` of the language); completion maps the language's `completionContext` to keywords, at the
  start of a member the entities of the game data in use with their names in the game, properties, enum values, entity terminals and
  the catalog signals of the enabled modules.
- **Catalog.** `CatalogService` is rebuilt when the project's module list changes. It is the language's `SignalResolver` (unknown and
  disabled signals are warnings; text is never touched), the source of names and icon ids, and the picker tree. `SignalField` receives
  the wildcards its slot accepts (`SIGNAL_SLOTS` of the language) and the picker offers no others.
- **Modules.** The enabled modules are the project's list (`modules` of `face.json`), whatever data is in use; `base` is on in any
  case. What the project switches (`CatalogView.modules`, `listedModules` of the catalog package) is the game's own modules that
  the data has and, with data read from a game, every mod that a signal or a record of the entity table names as its module; the
  other mods are counted (`otherMods`), never listed and never written into a project. A module switches on with what it requires
  and recommends and off with what requires it, also through mods that are not listed. Names of the project file that are not in
  the list are kept at its end; those the data does not know at all are shown (`unknownModules`).
  A signal or an entity of a module that is off stays in the source and is parsed, drawn, simulated and exported; it gets a warning
  that names the module by its title (`disabled-signal`, `disabled-prototype`; the service is the language's `SignalResolver`
  and has its `PrototypeResolver` as `prototypes`) and is not offered: not in the picker, not in the selector (`registry.offers`),
  not in the Type field (`alternativePrototypes`), not in the completion (`offersPrototype`). Every analysis runs on a recording
  stand-in (`moduleUse`), so the session knows which switched-off modules the source uses: `ProjectView.modulesOff`, which
  `enableUsedModules` switches on, each with what it requires, as one change of the settings.
  A record may be of several modules (with data read from a game: a recipe that one mod makes of another's item, such as the
  recycler's, and the barrel of a mod's fluid): it is there with all of them on, its warning names those that are off, and it
  counts for each in the list.
  The inspector says the same in the same words. Under the title of an entity of modules that are off stands the sentence of
  its `disabled-prototype` warning (`p.entity-warning`, from `CatalogView.entityWarning`, which calls the language's
  `disabledPrototypeMessage`). Under a signal field stands "Belongs to Space Age, which is switched off in the project
  settings" (`small.field-warning`, from `signalWarning` of `inspector/signalWarning.ts` with `SignalInfo.switchedOff` and the
  language's `switchedOffText`); "Not available with the signal groups of this project" for a signal that a module of the project
  removes, which has no module to name; "Not a signal of Factorio's catalog" for one the data does not have.
  A new project (the one the window starts with, File > New Project) has `defaultModules`: the game's own modules that the data in
  use has, in the order of the empty project, and no mod. An existing project is opened with the list it has.
- **Simulation.** `SimulationRunner` compiles each new valid circuit with the catalog environment. If `semanticFingerprint` is unchanged
  (moves, renames, comments) the running engine, its tick and its history stay; otherwise it starts at tick 0. It has no reference to the
  document, so no simulation activity can create an edit. While the source has errors it is blocked with a notice and resumes afterwards.
  The dock traces every output signal of the selected entities (the first three entities with something to trace when nothing is
  selected); lamps trace their lit state and speakers whether they play (`alarm sound`, 1 while playing, the row lit like a lamp's);
  what an entity reads per wire color is in the row's tooltip. A generic entity has a row per circuit condition it holds (`farm harvest`,
  `enabled` or `disabled`, 1 while it holds; "Generic entities" below). A pole and an entity without a condition have nothing to trace
  (`hasTrace`): they have no row, with or without a selection, and where that leaves the dock empty it says what can be followed.
- **Card statuses.** `StatusCache` (`simulationView.ts`) turns the latest snapshot into one `EntityStatus` per entity: `input`
  (`red` and `green`, each `{ wired, signals }`; absent on a constant combinator; for a pole the two networks it joins), `output`
  (all emitted signals; absent on a lamp, a speaker and a pole), `lamp` (`{ lit, color }`), `speaker` (`{ playing, instrument,
  note, volume, alert }`, the engine's record), `active` (a lit lamp, a speaker that plays) and `label` (the output or the state
  as text: the first two signals, then `+N`; `lit`, `off`; `playing piano F#3`, with ` at 60%` when the volume is not the full
  one, `silent` (`speakerText`); empty for a pole, which has neither), and for a generic entity with a circuit condition and a wire `conditions` (per condition its key, what it decides and whether it holds) and `enabled` (the condition that enables it), with the label `enabled, harvest disabled` (`conditionsText`). The signal lists are the engine's own, in its signal order, not copies. `wired` comes from the compiled
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
| Entity kinds | `--kind-constant` (pink), `--kind-arithmetic` (cyan), `--kind-decider` (violet), `--kind-selector` (blue), `--kind-lamp` (yellow), `--kind-pole` (a neutral gray: it does nothing of its own), `--kind-speaker` (sand, warm like the lamp it is grouped with and no second yellow); `kind-entity` (the generic entities) has the pole's gray until the entity package; a `kind-<kind>` class sets `--kind-color` |
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
  `unplace(ids)`, `placeEntityOnTile(prototype, tile, facing?)`. `rotateEntities` and `faceEntities` apply the turn rule
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
  and output (`io`: a pole) has no direction and sits in the middle of the top end of the footprint (`pinHeading`),
  where the wires hang on a pole in the game, on one tile as on 2x2: red at (middle - 10, 12), green at (middle + 10, 12),
  side by side at one height as on the cards. They are the same `g.pin` elements with `data-terminal`, `data-wire-color`
  and `data-edge` (`top` for a pole).
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
  32 units beside the line (`SELF_WIRE_SAG`), just outside the long edge on the side of its color. A wire steps aside where
  the pin of the other color at one of its ends lies in its way, closer than 10 units (`WIRE_PIN_CLEARANCE`, half a pin
  spacing) to the straight line (`boardWireLine`). That is so where the two pins of a terminal are in line with the wire:
  poles in a row, combinators in a column. Straight, the wire would run through that pin, and a red and a green wire
  between the same two entities would lie on one line. It runs parallel to the straight line instead, as near to it as
  clears those pins, and joins its own pins with a rounded step at both ends (`routePath`). Exactly in line both sides
  are as near: red takes the upper one (the left one of a vertical line), green the other, so between poles in a row red
  runs at y = 2 of their tiles, in the free strip above the bodies, and green at y = 22, a pin spacing apart. Poles in a
  column and on a diagonal of 30 degrees and more keep straight wires, which their pins hold 20 to 10 units apart; on a
  flatter diagonal each wire moves by what is missing. The line depends on the pins only, not on the order of the ends
  and not on whether the other color is wired. Because wires are on top, a
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
the document: not undoable, and a change makes the project dirty. Under the field one line says the range, what 0 means, the
reach of the game and that a pole has its own (`WIRE_REACH_NOTE`, the description of the field for assistive technology); how
the distance is measured is a paragraph behind the button "More about wire reach" (`.disclosure` with `aria-expanded`,
`[data-note="wire-reach-details"]`), closed whenever the panel opens, because the module list below needs the room.

- The measure is `wireDistance(a, b)` of `@face/model` (`wireReach.ts`): the distance between the nearest points of the two
  selection boxes (`selectionBox`, `boxDistance`), in tiles; the box is the tile footprint for most prototypes, so that such
  entities are 0 tiles apart when they touch, and a little smaller or larger for 18 (an inserter, a splitter, a small pole).
  Two electric poles are measured from center to center instead (`wireMeasure`, `WireSpan.measure`). It is the game's rule,
  verified by fixture F-24 (`tests/fixtures/game/F-24-wire-reach.json`). A wire is too long when that distance is greater than the reach
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
  `(4 tiles apart)` or `(12.4 tiles apart, over the wire reach of 9)`, between two poles `(9 tiles apart from center to center, over the
  wire reach of a small electric pole, 7.5)` (`describeWireDistance`). Because the layout is rebuilt for every tile of a drag, the flags
  follow the drag: a wire that would become too long at the previewed place is flagged before the drop, one that would become
  fine is not. An entity without a tile shows its wires measured while it is dragged, also over the tiles it stood on, where
  the drop then places it. The edit canvas shows every wire as before, without a distance.
- The inspector: a selected wire between two different entities that both have a tile shows `section.wire-distance` (in both
  display modes): how far apart the entities are ("The two entities are 4 tiles apart", between two poles "The two poles are 9 tiles
  apart from center to center"), "Reach 9" ("Reach unlimited" for 0; the reach that applied, also a pole's own),
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
line and the zoom controls (`.canvas-footer`), the bubble, the context menu, the toast and the notice about an invalid
source remain. With its controls on one line the strip is 51 units high, and so is the project bar above the workbench
(`.projectbar`, `--projectbar-height`) at every window size: the project symbol and the buttons in it are 30 units high
and the name is set in 15px. The title bar keeps 62 units (66 in a window at least 900 high).

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

## Selecting and copying text

The shell is an application, not a page: `body` has `user-select: none`, so the canvas, tiles, headings and controls are
pressed and dragged without text being selected. Text that informs is the exception, and one rule in `styles/base.css` says
which that is: paragraphs, `pre`, `small`, definition lists and tables, whatever has the role `status`, `alert` or `note`,
everything in a dialog (`[role="dialog"]`: the modal dialogs, the project settings, the signal picker), the status line and the
tick of the simulation. A second rule takes the controls out again wherever they are, with all they contain: `button`, `label`,
`summary`, `[role="tab"]`, `[role="menu"]`. Both are written with `:where()`, without specificity, so a component decides
where it has to: text fields and the source editor (`user-select: text`), the canvas (`none`), and the message of a row of the
problems list, which is a button (`.diagnostic-message`; the click that ends a selection there does not jump to the source,
`hasSelectionInside`). New text that informs needs no rule when it is a paragraph or sits in a dialog.

- Copy: Cmd/Ctrl+C and Edit > Copy end in the `copy` event; with text of the page selected the browser copies it, also while
  entities are selected (`clipboardIsForEntities`, see cut, copy and paste below). So that such a selection does not stay
  behind and take the next copy, a press on anything that cannot be selected (a control, the canvas; any button of the
  pointer) drops it (`dropTextSelectionOnPress`, on `pointerdown` of the document, by the computed `user-select` of the
  target and its ancestors). A selection in the source editor is the editor's and is left alone.
- Gestures: a selection starts only where the press lands on selectable text. The canvas prevents the default of its presses
  and captures the pointer; the project settings, the signal picker and the canvas menu close on a press outside
  (`pointerdown`), not on a release, and a modal dialog on a press on its backdrop, so a drag that selects text and ends
  outside closes nothing.
- Context menu: the page has one of its own on the canvas, which prevents the event. Everywhere else the main process shows a
  native one (`apps/desktop/src/contextMenu.ts`): Copy for selected text, and Cut, Copy, Paste and Select All in a text field
  or the source editor. They are role items and raise the same clipboard events as the Edit menu.
- `copyText(text)` puts text on the clipboard from a click ("Copy list" in the game data section): it starts a copy with
  `document.execCommand` and hands the text over in the `copy` event, ahead of the listener of the workbench.

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
- Grid 20 units; cards are 184 x 128. Every terminal (`TERMINALS`: `in`, `out`, `io`) has one connection pin per wire color.
  The one connection point of an entity that has neither input nor output (`io`: a pole, and most entities of the game)
  is one pair of pins in the middle of the top edge, red at (80, 0) and green at (100, 0), whatever the entity faces: the
  place it has on the blueprint board, and the place of the output of an entity facing north. Which edge
  of the card carries an input and an output follows from the direction the entity faces (`facing`, the direction its output points to; east when the
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
  edge, and a pole has its point on the top edge. `pinPoint(position, side, color, facing)` in `geometry.ts` is
  the only place that knows the positions (`pinEdge` and `pinHeading` name the edge and the direction a wire leaves in: up for
  `io`); a wire of a color starts and ends in the center of the pin of that color. The rubber band of a pending
  wire starts there too (`CanvasLayout.pin(entity, side, color)`).
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
  their order. An end that is a connection point without a direction (`io`) is routed as what sits at its place, the output
  of an entity facing north (`directed`), by the rules below, so nothing in them knows a pole: its wires arrive from above.
  Two poles are two such outputs (the rule for two outputs, turned): up, across 10 (green) and 30 (red) units above the
  higher card, and down, with the one crossing of the colors next to one of the poles. A chain source -> pole -> pole ->
  lamp so runs along one line 30 units above the cards: up between the constant and the first pole, across from pole to
  pole, and down in front of the lamp; the wires of one color share the piece into the pin of a pole. A pole below another
  is wired from its top past the side of the upper card (the right side, or the left one when it stands further left) and
  down into the point of that one. Between an output and a pole the colors cross once, between a pole and an input they
  are parallels. The rules below are written for two entities facing east. Two entities that face the same other way, and the
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
  source editor or a dialog (`focusIsOnText`); there, and for a cut or a copy while text of the page is selected (a message, the
  status line), they stay the browser's own: selected text wins over selected entities for a copy, and cannot be cut. The rule is
  `clipboardIsForEntities` of `textSelection.ts` (pure); see "Selecting and copying text" below. Cut and copy take the selected entities only (the wires between them are part of the text
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
| Import Blueprint > From File, Paste Blueprint; Export Blueprint > As File, Show Blueprint | `⇧⌘O`, `⇧⌘B`, `⇧⌘E`, `⇧⌘C` | `Ctrl+Shift+O`, `Ctrl+Shift+B`, `Ctrl+Shift+E`, `Ctrl+Shift+C` | menu |
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

`EntityIcon` / `EntityIconSvg` take an entity (or just its prototype) and an `EntityIconResolver`
(`(prototype) => url | undefined`). `icons/catalogEntityIcons.ts` probes one item icon per prototype of `PROTOTYPES`
(`prototypeIconId` of the registry: the item that places the prototype, `item/<prototype name>` for all that have one) of the generated catalog through
`face-asset://catalog/icons/item/<name>.png` and resolves only those that load, so each pole shows its own item.
`icons/catalogSignalIcons.ts` does the same for signal, group and quality icons with three probes (`probeIcons`: the signal A and two
more icons of the table; icons are there when one of them loads, since any one icon can be a mod's image that does not load); the two
wire tool buttons of the palette take the game's `item/red-wire` and `item/green-wire` icons from it. The main process answers these
URLs with icons it renders from the user's installation of the game and, for data read from a game with mods, from the user's mods,
or with bundled files (`packages/catalog/generated` in development, git-ignored). With none of them,
entities and wire tools show inline pictograms and signals are shown by name, in the picker as well. The pictograms tell the
kinds apart by their shape, not only by a mark: a combinator is a box with a display, a lamp a bulb, a speaker a loudspeaker
with sound waves, a pole a mast with a crossbar (taller and wider for the bigger poles, a box with two masts for a substation).
An icon the installation should have but lacks (a module that is not installed) arrives as a gray placeholder image.

Which icons there are is data of the main process (`DataInUse.icons`, the ids of its icon table): an icon that is not among them has
no URL and is never asked for. An icon of a mod is among them, and is drawn from the mod's folder or archive in the user's mod
directory when it is asked for. It can fail then (the mod was removed or updated since the game was read, or its image is none the
app reads), and the answer is 404, not a placeholder. Every view that shows a catalog icon gives way on its own: `IconImage` (the
picker, the selector's tabs, the inspector's signal field, the signal history, the wire tool buttons) shows its `fallback`, the name
or the glyph, or nothing where the icon only decorates; a status row of a card lays the signal out by its short name again once its
`<image>` reports an error (`StatusRow` in `canvas/EntityCard.tsx`); an entity keeps its pictogram because its icon is probed before
it is used. No view shows the browser's mark for a broken image.

The URL of an icon does not say where it comes from, and an image does not fetch an unchanged URL again. When the installation in use
changes while the app runs, the state of the application settings carries a higher `iconRevision`; both resolvers take it, append it
as `?r=<n>` (`revisionQuery`; nothing for revision 0, the installation found at start) and probe again.

## Blueprints of the game

The File menu has two submenus with two commands each (`menu.ts`; the keys are in the table above): Import Blueprint with From File...
(`file.importBlueprint`) and Paste Blueprint... (`file.pasteBlueprint`), Export Blueprint with As File... (`file.exportBlueprint`) and
Show Blueprint (`file.showBlueprint`). They are in no other menu. The format, the mapping and what an import
drops are the business of `@face/blueprints`; `session/blueprints.ts` (pure) turns its results into what the dialogs show, and the
session has five commands for it. `Workbench` holds which of the four dialogs is on show (`BlueprintDialog`, one at a time).

- **In, three ways, one result.** `readBlueprint(text, select?)` says what a text holds (`BlueprintReading`): a blueprint with the
  source of its circuit and its report, the rows of a blueprint book, or an error as a sentence. `openBlueprint(blueprint)` opens it
  as a new project: the empty project of the main process (`newProject()`, which also tells the main process that the window has no
  file) with the label as its name ("Imported blueprint" without one; control characters and line breaks removed, 200 characters) and
  the printed circuit as its source. It has no path, it is shown on the blueprint board (`displayMode` `blueprint`: every entity has
  its tile) and it counts as changed until it is saved (`neverSaved`), so Save asks for a location, the window asks before it closes,
  and it is not a recent project. The prompt for unsaved changes of the project it replaces comes first; `openBlueprint` resolves
  false when the user kept that project. The speaker's instruments are those of the modules a new project has.
  The modules of the project are those of a new one and every module that a signal or an entity of the circuit is of, with what
  those require and without what they only recommend (`importModules` of the session: the printed circuit is analyzed against the
  modules of a new project, and what turns out to be off is switched on). What that adds is in the report under "Signal groups":
  "Switched on: Some Mod, ...", by title in the order of the rows of the project settings (`listOrder`), twelve at most by name. A blueprint that arrives whole and needs nothing more has no report.
- **The paste dialog** (`ImportBlueprint`, dialog "Paste blueprint string"): a text box that starts with the focus, read on every
  change (`useDeferredValue`, so typing does not wait for a long string). Below it, while the box is not blank: the error
  (`[data-message="error"]`, the box is `aria-invalid`), or what the blueprint is (`[data-message="blueprint"]`: `"Name": 4 entities.`
  or `5 of 9 entities can be imported. ...`), or the book. Import is enabled only for something that can be imported; Cancel, Escape
  and the backdrop close. When the user keeps the current project in the unsaved-changes prompt the dialog stays with its text.
- **A book** is listed as the package returns it: every item in its order, a book inside it followed by its own items, indented by
  its depth (`bookRows`: label or "Blueprint without a label", "12 entities, 4 known to the editor", `importable`). The blueprints
  are radio buttons (`role="radiogroup"` "Blueprints of the book"); one without an entity the editor knows, a planner and a book
  are listed and cannot be chosen. The first importable one is chosen at the start.
- **A file** (Import Blueprint > From File...): `chooseBlueprintFile()` has the main process show the file dialog and read the file; the renderer
  gets the text and the file name. One blueprint opens at once, without a dialog. A book or an error is shown in the same dialog
  ("Import blueprint"), with the name of the file in place of the text box.
- **Nothing to open.** A blueprint without an entity the editor knows (or without entities) is an error of the dialog: "The editor
  knows none of the 3 entities of this blueprint (transport-belt, inserter), so there is nothing to import."
- **The report** (`ImportReport`, dialog "Blueprint imported", after the project is open; `importReport` makes its lines): the
  summary ("Imported 5 of 9 entities and 2 wires."), the dropped entities per prototype ("3 x transport-belt"), the wires ("2 circuit
  wires to dropped entities went with them.", "1 copper wire (power) was dropped: the editor has circuit wires only.", invalid wires),
  the notes on settings (`Ignored` / `Invalid` / `Changed` / `Reset`, the prototype, the field and what became of it, the entities by
  name) and what of the blueprint itself is not kept (description, snapping, tiles, ...; the warnings of the package). An import with
  nothing in any of these has no report: the circuit just opens. The icons of a blueprint never count, every blueprint has them.
- **Untrusted text.** The importer bounds the text (16 MiB looked at, 8 MiB of string, 32 MiB unpacked, 5000 known entities) and
  never throws. What a blueprint can put into a dialog is bounded here: names to 80 characters, messages to 600, the lists of the
  report to 50 lines (`REPORT_LINES`), a book to 1000 rows (`BOOK_ROWS`). Everything is rendered as text.
- **Out.** `exportBlueprint()` gives the blueprint string of the circuit with the game version it is written for and the warnings
  of the export, or the problems (`BlueprintExport`); while the source has errors the one problem is that (`invalid-source`), because
  the circuit on show is not the circuit of the source. Show Blueprint opens `BlueprintString`: the string in a read-only box,
  in focus and selected, "Copy" (a copy of the selection through `document.execCommand("copy")`, the mechanism of the canvas menu:
  the clipboard API is refused by the app's permission handlers), "Factorio 2.1.25" (`[data-fact="version"]`) and the warnings.
  Export Blueprint > As File... calls `saveBlueprintFile(exported)`: the main process shows the save dialog (suggested name from the project
  name, `.txt`) and writes the string; the toast then says where it went and how many warnings there are.
- **Problems.** Neither is produced while something is in the way: `ExportProblems` (dialog "No blueprint yet") lists the problems
  of the package with the entity names (`[data-problem="no-tile|off-grid|overlap|custom-signal|..."]`). For entities without a tile
  it offers "Show blueprint board": the board, with those entities selected, where "Place all" is.

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

## Game data

The entity and signal data is the one that comes with the build or one the main process read from the user's installed game, mods
included (`docs/adr/0001-architecture.md`, item 15). The renderer never runs anything: it asks the main process, which asks the user
in a native dialog of its own before it starts the game.

- **At start.** `main.tsx` awaits `loadDataInUse(window.face)` before it renders: `getGameData()` answers with the source and, for
  data read from a game, the catalog and the entity table. `applyData` installs them (`setEntityTable(parseEntityTable(...))` of
  `@face/model`, `setCatalog(createCatalog(...))` of `@face/catalog`), so that the session, the language and every view find them
  where they look (`entityTable()`, `currentCatalog()`). Data the editor cannot use after all, or a call that fails, leaves the
  built-in data in place with a reason (`DataInUse.problem`), which is also how the main process reports a damaged cache file and
  one of an earlier format, which asks for the game to be read again. The
  workbench shows that reason at the right end of the title bar (`.data-hint`, with "Game data..." and a dismiss button), in place of
  the icon hint.
- **The session** gets the `DataInUse` (`SessionOptions.data`). With data read from a game the catalog is of one set, each
  record of which names the mod that created it (`modules`), and the catalog's head has each mod's title and dependencies. The
  project switches those mods like the game's own modules (see "Modules" above): one list with one meaning, whatever data is in
  use. A new project has the game's own modules on and the mods off; a project saved before the mods could be switched has no mod
  in its list and opens with the warnings and the button below, without a conversion. `ProjectView.gameData` says that the data
  was read from a game.
- **The module list in the project settings** (`ProjectSettings.tsx`, in words by `settings/moduleList.ts`). One row per module
  (`.module-list li[data-module]`, the game's own first, `data-game`, then the mods by title whatever its case, `listOrder` of
  `workbench/moduleOrder.ts`; the catalog has them by name): the checkbox and the title, which has the width of the row (a mod's
  own text, rendered as text, on two lines where it needs them and cut after that; on hover the title in full with the name,
  `rowHint`); below it what the module adds (`.module-count`, `moduleCounts`: "N signals, M entities", a count of none left out,
  "Only hidden signals or entities" for a module that is listed for records none of which can be chosen); and below that the note
  of what switching it does ("Switching on also switches on ...", "Always enabled" for `base`; `small`). The signals counted are
  the selectable ones that are there only with the module: those it created, and those of another creator that need it, so a
  record of two modules counts in both rows (the sum of the rows can exceed the number of signals). From eleven rows on the list
  has a filter field above it ("Filter signal groups": title or name, any case; Escape empties it; `[data-note="no-match"]`).
  Below the list: the mods that are not in it, counted (`[data-note="other-mods"]`, "14 other mods of your game add no signals
  or entities."); with the built-in data the line that the mods of the game appear here after the game has been read in the
  application settings (`[data-note="mods-hint"]`); and the names the data does not know. Above the list, when the project uses
  signals or entities of modules that are off (`[data-note="modules-off"]`): which, by title and counted after four, and the
  button "Switch them on" (`enableUsedModules`). Every sentence that lists modules (that notice, the notes of the rows,
  `moduleTitles`; the "Switched on" line of an import report, `importModules`) has them in the order of the rows.
- **The layout of the panel** (`styles/settings.css`). The panel is a column as high as its content, up to the height of the
  window below the two bars (`max-height`). Every part keeps its height (`.project-settings > *` is `flex: none`) except the
  list, which may shrink (`flex: 0 1 auto`, `min-height: 0`) and scrolls by itself: with five rows it is as high as they are, with
  the mods of a game it takes what the name, the wire reach, the notice, the filter and the lines below it leave, and those stay
  in view while it scrolls. A list of four rows or more is never squeezed below 148 pixels (three rows and the top of a
  fourth); only where the window leaves less (the smallest window with the notice on show, or the text about the wire reach
  open in a low window) does the panel scroll as a whole (`overflow: auto`).
- **The record of the mods** (`gameData/projectMods.ts`). `toProjectData` gets `modsRecord(data)`: the game version and what the game
  had loaded, when the data was read from a game with at least one mod; it replaces the project's `gameMods`. Otherwise the record
  the project was loaded with is written back unchanged. When a project is loaded, `modsNotice` compares its record with the data in
  use: mods and modules the data lacks, mods in another version (a module of the game only counts when it is missing), a game
  version that differs. The sentence is the message of the toast and stays in the project settings (`ProjectView.modsNotice`,
  `[data-note="mods-notice"]`, with `[data-note="made-with"]` for the record itself). The project opens all the same and its source
  is not changed; a declaration of an entity the data in use does not have is one error of the language (`unknown-prototype`; the wires to it add none), so the
  circuit of a project with an entity of a missing mod is not drawn until the game is read with that mod.
- **The section** "Game data" of the application settings (`GameDataSection.tsx`, `gameDataView`, `useGameData`). It shows the
  source in words (`.game-data-source`, `data-source="built-in|game"`: "Built in, Factorio 2.1.25" or "Read from your game on
  <date>: 2.1.25 with N mods", from `describeGameDataSource` of the main process's pure module), a notice when the game or its mods
  have changed since (`[data-message="stale"]`; looked at whenever the section comes on show), the problem of a file that cannot be
  used (`"data-problem"`), data that waits for a reload (`"pending"`), and the request: `"confirming"` while the native dialog is
  open, `"progress"` while the game runs (a progress bar, "Step 2 of 5: the game loads its data and your mods", the time since the
  start, and Cancel in place of the read button), `"read-failed"` with the end of the game's log in a scrollable, focusable `<pre>`
  (`.game-log`), `"outcome"` (read in so many seconds, or cancelled) and `"warnings"` (icons that are left out because a layer of theirs is no image the app can read, files
  of the user that changed during the run, a run without the sandbox). The wired entities a read left out are no warning of
  the run: they belong to the data and are there after a restart (`GameDataStatus.leftOut`, of the data the cache holds, else of
  the data in use; `[data-message="left-out"]`). One line says how many there are and what that means ("31 entities of your game
  were left out: they cannot be placed or imported, because the game's data about them does not fit together. Such entities are
  mostly internal helper entities of mods."); under it a disclosure button "Left-out entities" (`aria-expanded`, closed at first)
  opens the list: one group per reason (`leftOutView`, `LEFT_OUT_REASON_TEXT`: the reason in plain words and the count, what the
  build found once for the group where all share it, else per name), the names sorted, in a box that scrolls (220px at most,
  focusable), as text that can be selected. "Copy list" puts the same list on the clipboard as plain text (`copyText` of
  `textSelection.ts`, the copy event a page may start on a click). Names and findings are the game's and its mods': bounded by
  the main process and rendered as text. "Read from the game..." is disabled with the
  reason below it (`"unavailable"`) without an installation that has its program; "Use built-in data" discards what was read (or a
  file that cannot be used). The run's state arrives as an event; the rest of the status is asked for again when a request ends and
  when the installation changes.
- **Applying.** Other data is applied by loading the window again. After a read that worked and after a discard the hook calls the
  session's `reloadWindow()`: the unsaved-changes prompt of any project replacement, then `applyGameData()`, on which the main
  process reloads the window. When the user keeps the window, the data waits and the section offers "Reload the window". The
  dialog is open again after the reload (`reopen.ts`), with the outcome of the last request, which the main process keeps.
- **Keyboard and focus** are the dialog's: Tab goes round its enabled buttons, and when the button under the focus is replaced or
  disabled (Read by Cancel, Cancel by Read) the one that takes its place gets the focus.
- **What a mod brings** is in the selector, the signal picker, completion and the language like anything of the game, with its own
  icons: the main process draws them from the mod's files (see "Icons"). Where an icon of a mod cannot be drawn, the views show the
  name and their pictogram. Names of mods get through the
  language quoted where they are not one word (`"5d-chest" box { }`, `item:"my item"`; `test/gameData/modNames.test.ts`); the
  signal field of the inspector takes typed keys of the plain form only, so a signal with a name outside `[A-Za-z0-9_.-]` is chosen
  in the picker or written in the source.

## The entity selector

The left sidebar offers what can be placed. What it offers is data, and no prototype is named in the renderer: `entityRegistry(catalog,
table, modules)` in `entities/registry.ts` makes it from

- the signal catalog (`@face/catalog`): for every entity of the game its item group, its subgroup and its order string, which are those
  of the item that builds it, with the changes a module makes (`pickerTree` with `kinds: ["entity"]`, the function the signal picker
  is built with);
- the entity table (`@face/model`): which prototypes a circuit wire connects to, which of them the game hides (`hidden`: the chests
  of its editor, the loaders), which module adds them, and through `PROTOTYPES` their kind, name, tiles and reach;
- the modules of the project (`CatalogView.entities()`, built on first use per module set).

```ts
interface EntityRegistry {
  pinned: PaletteEntry[];               // the first row: the combinators (`PINNED_KINDS`, a decision of the user)
  groups: PaletteGroup[];               // the tabs: { name, label, icon, subgroups: [{ name, entries }] }, all in the game's order
  entries: PaletteEntry[];              // everything offered, once
  entry(prototype): PaletteEntry | undefined;   // also of a prototype that is not offered (hidden, module off)
  offers(prototype): boolean;
  groupOf(prototype): string | undefined;       // the tab that holds its tile
  position(prototype): number;                  // its place in the game's order of everything
}
```

A Space Age project has four tabs (Logistics, Production, Space, Combat) with 85 entities; the base game alone three (no Space: the
rocket silo and the landing pad are in Production) with 67. **A further entity of the game** is its record in the catalog and in the
entity table: its tile, its tab and row, its popup, the place tool, the footprint on the board, the card, the form of its type and
the choice among the prototypes of its type follow. **A further prototype type** is a row of `ENTITY_SETTINGS` in the model; the
renderer adds a line to `TYPE_DESCRIPTIONS` (`entities/typeInfo.ts`, a test fails without it; a type without a line is described from
its settings). **A further kind** (a family with behaviour of its own) needs its part in the model, the language and the simulation,
a `KIND_INFO` row, a summary line and, if it has settings, a form.

- **Tiles.** Every entry is a square tile with nothing but its icon (`button.palette-tile`). The game's name is its accessible name
  (`aria-label`: "Decider combinator"); it has no `title`, because everything else is in the popup. Every tile carries `data-kind`,
  `data-prototype` and `data-place`. The entry of the palette, one per prototype, also has the class `palette-item` (the tile in the
  first row for a combinator, the tile in its subgroup for every other entity); the tiles of "Entities in use" have `in-use` and the
  second tile of a combinator in its subgroup `pinned-copy`, so `.palette-item[data-prototype=...]` names one element.
- **Sizes.** The combinators are four in a row (about 48 pixels each at 240 pixels of sidebar and 41 at 212, 30 pixel icon). Every
  other tile is six in a row (`.palette-tiles.compact`: 31.5 pixels at 240 pixels of sidebar and 26.8 at 212, gap 4, the icon 82 % of
  the tile). Six is what keeps the icons legible (26 and 22 pixels) and the largest tab short: Logistics with Space Age is 42 tiles in
  seven subgroups, which are ten rows, 355 pixels high (308 in the narrow sidebar).
- **The popup** (`div.tile-popup`, `role="tooltip"`, `data-prototype`, `data-side`) says what a tile stands for, in the look of the
  board's bubble (card colors, the kind's accent on its left edge, the same pointer): the game's name, what the entity is on a circuit
  for (`entityDescription`: of the kind, and for a generic entity of its prototype type), its tiles and, where it is not the
  project's, its wire reach ("3 x 3 tiles", "2 x 2 tiles, wire reach 32"; `prototypeFacts`), and the key of the five entries that
  have one, written "Key 3" so that it is not read as a count. It shows for the tile the pointer rests on, by the rule of the board's
  bubble (`HoverIntent`: after 250 ms, at once from tile to tile, gone 120 ms after the pointer left), and without a wait for the tile
  that has the keyboard focus (`:focus-visible` only: a tile that was clicked keeps the focus, and its popup leaves with the
  pointer). A disabled tile shows it too. It is fixed to the window beside the sidebar at the height of its tile (`placeBubble` with
  the row of the tile up to the edge of the sidebar as the anchor), so it covers no tile, its own included; it takes no pointer
  events. When the sections are scrolled the popup of the pointer goes and the tile that has come under the resting pointer gets its
  own after the usual wait (it is looked up: the browser reports it only once the pointer moves); the popup of the focused tile moves
  with its tile and goes when that is scrolled out of sight. While it is on show the tile names its text as `aria-describedby`.
- **The combinators** (`registry.pinned`) are the first row, always on show, without a heading (`.palette-items`, a group named
  "Combinators"). They are in their subgroup of the game as well.
- **Entities in use** (`section.palette-group[data-group="in-use"]`, below the combinators): one tile for each game prototype the
  circuit on show contains, without the pinned entries, in the game's order (`entriesInUse`), so a tile keeps its place whatever is
  placed next. A prototype the selector does not offer is among them when the circuit has it: a loader or a chest of the game's
  editor that a blueprint brought, an entity of a module that is switched off. The section is always there; with none it has the line
  "None besides the combinators." (`.palette-empty`) as high as a row of tiles, so nothing moves when the first lamp is placed. Its
  heading shows the number of tiles and closes it; that is remembered under `face.palette.inUseOpen`. Both tiles of an entity arm
  the same tool (`sameTool`), and both are pressed while it is armed.
- **The search** (`input[type=search]`, "Search entities") looks through every group by the name in the game and by the prototype
  name, whatever the case (`searchEntries`). The results are the rows of the game under the names of their groups (`h3`); no tab is
  selected meanwhile. Enter arms the first entity found, Escape empties the field, a tab ends the search.
- **The tabs** (`role="tablist"`, "Entity groups"): one button per group with the group's icon of the game, or its name where no
  icon is to be had; `aria-selected`, `data-group`, the name as `aria-label` and with the number of entities as `title`. The panel
  under them (`role="tabpanel"`) has the subgroups of the group on show as rows (`.palette-subgroup[data-subgroup]`): every subgroup
  starts a row of its own, as in the game.
- The count badge of the panel is the number of entries (`registry.entries`).
- **What is remembered** is a preference of the person at this machine (`workbench/paletteGroups.ts`), not part of a project: the
  tab under `face.palette.tab` and the open sections (`face.palette.inUseOpen`, `face.palette.circuitListOpen`) in `localStorage`,
  which belongs to the profile of the app (userData), so they are the same for every project and survive a restart; the search under
  `face.palette.search` in `sessionStorage`, so it survives Source mode (which takes the palette away) and the app does not start
  with a filtered list. The main process offers no per-viewer state over IPC. Every access is guarded: without storage, with storage
  that throws and with a value that is not what was written the selector starts on its first tab with every section open and works
  for as long as the window lives. A stored tab the project does not have (Space without Space Age) gives way to the first one.
- A place tool whose tile is not on show brings its tab (the lamp by `5`, a tile of "Entities in use" of another tab), ends a search
  that does not show it, and the armed entry is scrolled into view. A tab shown by hand while the tool is armed stays. The keys `1`
  to `4` arm a tile of the first row and leave the tab alone.
- Layout: the heading, the row of the combinators, then two areas that share what is left and scroll on their own: the sections
  (`.palette-groups`: "Entities in use", the search and the tabs, which stay at its top while it scrolls (`position: sticky`), and the
  tiles; five sixths, never more than they need; it reaches the edge of the sidebar, where its scrollbar has room beside the tiles) and
  the entity list (`.entity-list`, the rest, at least 48 pixels). A tile that is scrolled into view stops below the search and the tabs
  (`scroll-margin`, with their height in `--palette-head`). At the default window (1510 x 960) the sections are 405 pixels high: with
  one row of entities in use seven of the ten rows of Logistics show and the rest is 91 pixels of scrolling; Production (seven rows),
  Space and Combat fit. At the smallest window (1120 x 760) four rows show and the list its first row. Closing the list or the entities
  in use gives their room to the tiles. `tests/e2e/entitySelector.spec.ts` checks both sizes (nothing is cut off, every entry and every
  entity can be reached) and prints the measured layout.

## Poles and speakers

- A pole (`pole`, four prototypes) has one connection point (`io`), no settings and no state. Its card names the pole in the
  heading and shows its reach, its tiles and the signals on its red and on its green network. The inspector has the choice of
  the prototype (`.prototype-field`, a group named "Pole" with one `aria-pressed` button per prototype: icon, name, tiles and
  reach) and a note on what a pole does; changing it is `updateEntity` with the rule "Another prototype" of the board, and in
  the source the word of the declaration is replaced (`small-electric-pole p` becomes `big-electric-pole p`), nothing else.
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

## Generic entities (kind `entity`)

The model has 88 further prototypes of the game as one kind, `entity` (chests, inserters, belts, machines, train stops, ...; `ENTITY_SETTINGS` of
`@face/model`, `docs/dsl.md` "entity"). Everything the renderer does with them follows the entity table and the settings table; it names no
prototype. What there is:

- **Names** (`entities/kindInfo.ts`, `entities/typeInfo.ts`): `entityTitle` is the game's name of the prototype ("Fast inserter"), as for a pole;
  `entityDescription` is a line per prototype type on what it is on a circuit for (`TYPE_DESCRIPTIONS`, one per row of the settings table; a type without one is
  described from its settings); `KIND_INFO.entity` has the category line "Game entity"; a description is a note of the project.
- **Icon** (`entities/registry.ts`, `prototypeIconId`): the icon of the item that places the prototype (`placedBy` of the entity table; for all but
  four chests of the game's editor an item of its name). `useCatalogEntityIcons` probes all 98 prototypes; without the image an entity shows the
  boxed pictogram without a mark.
- **Placing**: a tile arms a place tool with the prototype. On the board the ghost has the footprint of the prototype (1 x 1 up to 9 x 9, turned
  with the tool where it is not square). R and Shift+R turn what the game builds in four directions, give the other one of the two directions of
  a storage tank (`placeFacing`, `turnedTool`: north and east), and do nothing for an entity that does not turn; H and V mirror the same way.
  A new entity is named after its prototype (`fast_inserter1`, `assembling_machine1`).
- **Card** (`entities/summary.ts`, `canvas/EntityCard.tsx`): the heading is the game's name. The summary has at most two lines: the circuit
  conditions it holds (the one that enables it as it is, every other one behind what it decides, `close A > 0`; `unset` in the place of the comparison
  for one in use without a signal, `open-gate unset`; the first of several with the count of the others; "no condition" where its type has one
  and none is set), and under them what it reads and sets in the words of the language
  (`activeSettings`: the switches that are on and the modes, set or by default, `read-contents`, `read-hand: pulse`; as many as fit, then `+N`).
  An entity whose type has no condition has both lines for that. The two input rows show the networks on its one connection point; the third
  row (`data-row="conditions"`) has its circuit conditions while the simulation reports them (with a condition and a wire): each a mark that is
  filled while the condition holds and a label, `enabled` or `disabled` for the one that enables the entity and what it decides for every other
  one (`harvest`, `input-left`), as many as fit, then `+N` (`layoutConditions`). `data-status` has all of them in words (`enabled, harvest
  disabled`). A card whose enable condition does not hold has the class `disabled`: its icon and its name step back.
- **Board** (`canvas/BlueprintEntity.tsx`): the footprint the model gives with one pair of pins in the middle of its top end, whatever the entity
  faces; no arrows, since there is no input and output half. A footprint of more than one tile in both directions has its icon and its name sized
  by its shorter side (`blockContent`: an icon of 48 on 2 x 2, 76 on 3 x 3, 132 on 5 x 5, 192 on 9 x 9, the name from 10 to 26 units), and it
  keeps its text at a zoom at which a small footprint has lost it (`boardNameFont` against `legibleFont` of the canvas). The light in its corner
  is on while its enable condition holds (or any condition, for an entity without that one); with the enable condition not holding the footprint
  is dimmed like the card (`disabled`).
- **Inspector** (`inspector/GenericForm.tsx`, `entities/genericSettings.ts`): a form made from the settings table, in its order and with its
  labels: a checkbox for a switch, a select for a mode (the words of the language as labels), the signal field for a signal (it shows the signal
  the prototype uses by itself, which is not written), the red/green toggles for a network selection, and for a condition a checkbox with the
  condition editor of the lamp under it (a condition that is switched on starts as the game has it: `signal-I < 0` for the left input of a
  splitter, the first virtual signal above zero otherwise; the logistic condition says that it is kept and not evaluated). A setting that
  belongs to another one shows only while that one has its value (`shownWhile` of the table, `settingShown`: the signal of "read empty slots", the
  channel of a radar in universe mode). An edit is `withSetting`: a value at its default is not held, so the source does not get it; a statement
  that is in the source already has its value patched, as for every kind. A condition in use without a signal is the unset condition
  (`when unset`; `inspector/conditionEdits.ts`): its fields show an empty signal with `<` and 0 behind it, as the game does, and a note that it never
  holds. Taking the signal out of a condition makes it unset, and what stood behind the signal goes with it; putting a signal in makes it a
  comparison. A comparator or a number changed while the signal is still missing is a draft with the hint 'The condition "Enable/disable" needs a
  signal.' (`session/drafts.ts`), written once the signal is there. The checkbox takes the condition away, unset or not. The lamp's form does
  the same with its one condition, and its card says `unset`. In the simulation an entity with an unset enable condition and a circuit wire is
  `disabled` like one whose condition is false, and a lamp is off. Above the form: the choice of the prototype among those of its prototype type that the
  project can place, as icons in the game's order with the chosen one named under them (`PrototypeField` with `compact`; `alternativePrototypes`,
  `withPrototype`; the same two functions give an entity of any other kind the prototypes of its kind, which with the built-in data is a choice
  for a pole only and with data of a modded game for every kind a mod adds a prototype to), refused on the board when the new footprint would cover a tile of another entity ("Not changed: maker would stand on a tile of
  box."); the notes of `prototypeNotes` (a wall connects only next to a gate; an entity no item builds is taken into no blueprint; the messages of a
  display panel and the research conditions of a lab are kept only). The facing control has the directions the game builds the entity in: four,
  north and east for a storage tank, none for one that does not turn. Under the form a line names what a blueprint had that the editor only keeps
  (`keptFields`: the top-level keys of `blueprint-data`, "Kept from the blueprint: station, manual_trains_limit."). The description field says in
  its tooltip that the entity has no description in the game.
- **Dock** (`session/simulationView.ts`): a generic entity sends nothing, so it has no output row and no "no output". It has a row per circuit
  condition it holds (`tracedConditions`, `hasTrace`): named `condition` for the one that enables it and by what it decides for every other one,
  with the value `enabled` or `disabled` (`no wire` while it has no circuit wire, since no condition applies then) and a trace of 1 while it holds.
  An entity without a condition has no row. The dock and the status line show no totals, so `totals.entitiesDisabled` of the snapshot is not
  shown anywhere either.
- **Blueprints**: an import of them reports nothing dropped; what the editor does not model is in the source as `blueprint-data`.

Tests: `test/registry.test.ts`, `test/genericEntity.test.ts`, `test/genericForm.test.ts`, `tests/e2e/entitySelector.spec.ts`,
`tests/e2e/entityForms.spec.ts`, `tests/e2e/genericEntities.spec.ts`.

## Commands

```
source scripts/env.sh
npm run build                 # dist/renderer, dist/main.cjs, dist/preload.cjs   (node scripts/build.mjs --watch to rebuild on change)
npm start                     # run the built app; profile in .runtime/user-data
npx vitest run apps           # unit tests (session tests need no DOM)
npm run test:e2e              # Playwright against the built app; output in .runtime/
npm run examples              # write examples/*.faceproj from tools/examples/*.face (--check: fail when they differ)
```

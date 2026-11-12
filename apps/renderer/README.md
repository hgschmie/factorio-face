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
  session/
    projectSession.ts  ProjectSession: implements WorkbenchController, wires the parts below, batches change notifications
    document.ts        SourceDocument: the CodeMirror EditorState (text, history, selection) with or without a mounted view
    analysis.ts        runs the language per document version, drops stale results, keeps the last valid circuit, shares structure
    drafts.ts          inspector edits the language cannot write yet: normalization, completeness check, hints
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
    TopBar.tsx         title bar (brand, Circuit / Source / Split) and project bar (name, save state, undo, redo, fit, settings, save)
    Palette.tsx        tools (select, red wire, green wire), the five building blocks, entity list
    SourcePane.tsx     file heading, SourceEditor, problems list (errors first, a click selects the range)
  canvas/
    Canvas.tsx         SVG canvas: camera, gestures, pending wire, context menu; emits callbacks only
    Scene.tsx          memoized wires and cards, culled to the visible area
    EntityCard.tsx     one memoized card (icon, name, summary, description marker, live status line, a red and a green pin per side in TERMINALS)
    ContextMenu.tsx    keyboard-navigable popup menu
    geometry.ts        card and pin geometry (`pinPoint`), rectangles  (pure)
    viewport.ts        camera transforms, zoom, fit, culling rectangle (pure)
    drag.ts            snap, drag threshold, group drag, placement     (pure)
    wireRouting.ts     wire routes and SVG path data                   (pure)
  editor/
    SourceEditor.tsx   CodeMirror view over an `EditorBinding`; owns no state
    extensions.ts      editor chrome: gutters, selection, indentation, keys, theme
    theme.ts           editor colors in the app palette
    tokenHighlight.ts  viewport decorations from an external tokenizer
    tokens.ts          token kind to class mapping, minimal text diff  (pure)
  inspector/
    Inspector.tsx      identity, rename + Delete at the top, description, draft hint, settings slot, connections; undo and redo from its fields
    EntitySettingsForm.tsx and ConstantForm / ArithmeticForm / DeciderForm / SelectorForm / LampForm
    SignalField.tsx    validated `kind:name[@quality]` input with icon, name, warning and the picker slot
    fields.tsx         text, number, select and checkbox fields, the red/green NetworkToggle, the text a field holds on its own
    formParts.tsx, immutable.ts, validation.ts
  picker/
    SignalPicker.tsx   signal picker like the game's: group tabs, subgroup rows, search, quality row
  settings/
    ProjectSettings.tsx  project name and the five standard modules as signal groups
  simulation/
    SimulationDock.tsx controls, trace table with sparklines, tick counter
    sparkline.ts       sparkline geometry                              (pure)
  entities/            kind labels, signal text forms, card summaries  (pure)
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
has errors), `selection`, `mode`, `tool`, `source`, `diagnostics` (with line numbers), `canUndo` / `canRedo`, `simulation`
(`SimulationView`: running, tick, speed, traces, per-entity status, notice), `catalog` (`CatalogView`: modules, qualities, `picker()`,
`describe(signal)`), `draft` (pending inspector edit of the selected entity) and `error`.

`WorkbenchCommands`: view (`setMode`, `setTool`, `select`, `dismissError`), document (`placeEntity`, `moveEntities`, `updateEntity`,
`discardDraft`, `renameEntity`, `deleteEntities`, `addWire`, `removeWire`, `toggleWire`, `setSource`, `undo`, `redo`), simulation (`run`, `pause`,
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
- **Network toggles.** `NetworkToggle` writes any of the four selections; both off is `[none]` after a signal and `networks = none` on
  a lamp. A color without a wire on the entity's input terminal is drawn grayed (class `unwired`, dashed outline, a title that says
  so) but works as usual. The inspector passes the connected colors down through `InputWiresContext`.
- **Analysis.** Every document change bumps a version and runs `analyze(source, previous, { signals, version })` synchronously.
  `Analysis.accept` only takes the result of the latest request, so the same code path works when the analysis moves to a worker;
  `ProjectSession.acceptAnalysis` is the entry point for that. With errors, `editable` is false, the last valid circuit stays, and
  commands and simulation are blocked. Entities whose declaration text did not change keep their object identity, which is what lets the
  memoized cards skip rendering.
- **Selection** is a list of entity ids. Ids come from the language session and survive renames, by command or by typing. A caret the user
  places inside a declaration selects that entity.
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

- Grid 20 units; cards are 184 x 128. Every terminal side (`TERMINALS`: inputs on the left edge, outputs on the right) has one connection
  pin per wire color, red 60 and green 80 units below the top edge, so both sit on grid lines 20 units apart. `pinPoint(position, side,
  color)` in `geometry.ts` is the only place that knows this; a wire of a color starts and ends in the center of the pin of that color.
- Pins in the DOM: `g.pin` inside the card with `data-terminal="in|out"`, `data-wire-color="red|green"` and a `<title>` such as "Red
  input". Pins are drawn in the wire color tokens. A wire tool sets `wire-red` / `wire-green` on `.canvas`: only the pins of that color
  are targets (highlight, click, pending state, start of the rubber band), the others are dimmed and ignored. The model is unchanged: a
  wire is a color plus two terminals, and the tool decides the color.
- Routes (`wireRouting.ts`): every wire is a line of horizontal and vertical segments from pin to pin, drawn with rounded corners
  (radius 14; a corner next to a shorter segment gets what fits: the whole first or last segment, half of one between two corners).
  There are no curves. Red and green between the same two terminals run as parallels one pin spacing (20) apart and never touch,
  except in a narrow gap and at the one crossing described below.
  - Output to an input at least 16 units to its right: out, one vertical leg midway between the two cards, in; a straight line when
    the pins are level. The color on the outside of the first bend takes the far leg. In a gap below 26 units (cards one grid step
    apart leave 16) the two legs move together, down to 10 apart and 3 from the cards.
  - Output to an input that is not to its right: a detour out to the right, across between the two cards (below both when they are
    less than 40 apart vertically, then also around the lower one) and into the input from the left, 10 and 30 units from the cards.
  - Output to input of one card: a loop over the top with 20 (red, inside) and 40 (green, outside) units of clearance.
  - Two inputs or two outputs: out, a leg 10 (green) and 30 (red) units beyond the terminal further out, back in. The colors have to
    cross once, at a right angle: here where red returns into the lower terminal. When the card of the outer terminal is in the way
    of the other one (cards side by side), the wire first passes 10 and 30 units below that card, or above it when the other terminal
    is higher (green is then outside); the crossing is at the far corner of that lane.
  Routes do not avoid other cards, and wires of different connections may share a line.
- A drop is computed from the press and release coordinates of the pointer, not from the rendered preview.
- The wheel listener is registered non-passive on the canvas container and cancels scrolling.
- Deletion: on the canvas through the context menu (right click) only; there is no toolbar on the selection. Also Delete / Backspace
  while focus is inside the canvas, Edit > Delete, and the Delete button at the top of the inspector. Keys never delete while a text
  control or the source editor has focus.
- Rendering: the scene is memoized against a culling rectangle snapped to a 400 unit lattice, cards and wires are memoized individually,
  cards become outlines below 30 % zoom, and the drop shadow is skipped above 60 visible cards.

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

# Working rules for every contributor (human or agent)

These rules are binding for all work in this repository.

## Filesystem

- Write only inside `/Users/henning/ai/face/face`. This includes caches, temp files, logs, app profiles, screenshots and build output. Never write to `/tmp`, the home directory or `../prototypes`.
- `/Users/henning/factorio/factorio-install` (the game's `data` directory) and `/Users/henning/factorio/factorio-data` are read-only. Reading and copying from them is fine.
- `../prototypes` is read-only reference material. The production tree must never import from it or depend on it at build or run time.
- Before running any node/npm/electron tooling: `source scripts/env.sh` (redirects caches, TMPDIR and app profiles into the workspace). Temp files go to `$TMPDIR` (`.cache/tmp`), runtime state to `.runtime/`.

## Dependencies and tooling

- Do not run `npm install` and do not add dependencies. Installed: react, react-dom, CodeMirror 6, fflate, electron, electron-builder, esbuild, typescript, vitest, @playwright/test. If something else seems necessary, stop and report it.
- Node 26 runs `.ts` files directly (type stripping); tools may be `.mjs` or `.ts`.
- Do not create git commits, branches or stashes. The coordinator commits.
- Stay inside the directories assigned to your work package. If a shared contract (`packages/model`, `docs/dsl.md`) needs to change, report it instead of editing it, unless your brief says otherwise.

## Review before every commit

- Whoever is about to commit (normally the coordinator) first runs `~/.local/bin/or-review --working-tree` in the repository root, after the tests pass. The review arrives as Markdown on stdout; progress and token usage go to stderr.
- `--working-tree` covers tracked files only. Make new files visible first with `git add -N <file>` (intent to add: the file shows up in the diff, its content is still staged with a normal `git add` for the commit).
- Every finding is addressed before the commit: fixed, or declined with a stated reason. After fixes that are more than trivial, run the review again. The user is told which findings were fixed and which were declined when asked to confirm the commit.
- The settings file `.or-review` is maintained by the user; do not change it. The tool sends the diff to an external model; never put secrets in a change.

## Code style

- Senior/staff-level TypeScript: compact, clear, no tricks. Strict mode, no `any` unless justified. Lines up to 200 characters. Unix line endings.
- Never use emojis anywhere: code, comments, docs, test names, output.
- Few comments; explain only non-obvious constraints.
- Core packages (`packages/*`) must not import React, Electron, CodeMirror or Node-only APIs unless the package brief says so. They must run in a browser renderer, a worker and vitest.
- Packages import each other as `@face/<name>` (npm workspaces; `exports` points at `src/index.ts`).
- Every package has vitest tests in `packages/<name>/test/*.test.ts`. Run yours with `npx vitest run packages/<name>`; typecheck with `npx tsc --noEmit -p tsconfig.json`. `make test` runs everything.

## Reporting

End with a concise report: what exists, the public API, what was verified and how (test counts, commands), deviations from the brief, and open issues. Report failures plainly.

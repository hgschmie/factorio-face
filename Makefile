# All targets run with caches, temp files and app profiles contained in this directory (see scripts/env.sh).
SHELL := /bin/bash
ENV := source scripts/env.sh &&

.PHONY: install build typecheck test e2e run catalog examples probe-wire-reach clean

install:
	$(ENV) npm install && node node_modules/electron/install.js

build:
	$(ENV) npm run build

typecheck:
	$(ENV) npm run typecheck

test: typecheck
	$(ENV) npm test

e2e: build
	$(ENV) npm run test:e2e

run: build
	$(ENV) npm start

catalog:
	$(ENV) npm run catalog

# Writes examples/*.faceproj, the example projects that ship with the app, from the circuit sources in tools/examples.
examples:
	$(ENV) npm run examples

# Records tests/fixtures/game/F-24-wire-reach.json from the installed game.
probe-wire-reach:
	$(ENV) npm run probe-wire-reach

clean:
	rm -rf dist .runtime

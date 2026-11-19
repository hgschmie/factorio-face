# All targets run with caches, temp files and app profiles contained in this directory (see scripts/env.sh).
SHELL := /bin/bash
ENV := source scripts/env.sh &&

.PHONY: install build typecheck test e2e run catalog examples probe-wire-reach probe-blueprints probe-blank-condition probe-blueprint-book clean

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

# Records tests/fixtures/game/F-01-blueprints.json from the installed game: what it exports and what it makes of our blueprints.
probe-blueprints:
	$(ENV) npm run probe-blueprints

# Records tests/fixtures/game/F-29-blank-condition.json from the installed game: what an entity does whose circuit condition is in use and blank.
probe-blank-condition:
	$(ENV) npm run probe-blank-condition

# Records tests/fixtures/game/F-30-blueprint-book.json from the installed game: how it writes and reads a blueprint book.
probe-blueprint-book:
	$(ENV) npm run probe-blueprint-book

clean:
	rm -rf dist .runtime

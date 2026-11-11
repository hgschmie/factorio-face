# All targets run with caches, temp files and app profiles contained in this directory (see scripts/env.sh).
SHELL := /bin/bash
ENV := source scripts/env.sh &&

.PHONY: install build typecheck test e2e run catalog clean

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

clean:
	rm -rf dist .runtime

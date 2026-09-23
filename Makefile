.PHONY: all install dev build test package deploy install-vault clean

SHELL := /bin/bash

VAULT_DIR ?= $(HOME)/obsidian/.obsidian/plugins/nostr-writer

all: build

install:
	npm install

dev:
	npm run dev

build:
	npm run build

test:
	npx tsc --noEmit -skipLibCheck
	npm test

package: build
	@mkdir -p dist
	@zip -j dist/nostr-writer.zip main.js manifest.json styles.css
	@echo "Package created at dist/nostr-writer.zip"

install-vault: build
	@mkdir -p "$(VAULT_DIR)"
	@cp -v main.js manifest.json styles.css "$(VAULT_DIR)/"
	@echo "Installed Nostr Writer to $(VAULT_DIR)"

deploy: package
	@echo "Build and package complete. Ready for distribution."

clean:
	rm -rf dist main.js styles.css.map tests/*.js

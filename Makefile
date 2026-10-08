.PHONY: all install dev build test package deploy install-vault clean version-patch version-minor version-major

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

# SemVer Versioning & Release Automation
define bump_version
	@echo "Running tests before version bump..."
	@NEW_VER=$$(npm version $(1) --no-git-tag-version --ignore-scripts) && \
	node version-bump.mjs && \
	git add package.json package-lock.json manifest.json versions.json && \
	git commit -m "chore(release): $$NEW_VER" && \
	git tag -a "$$NEW_VER" -m "Release $$NEW_VER" && \
	echo "Created release commit and tag $$NEW_VER" && \
	git push origin HEAD && \
	git push origin "$$NEW_VER" && \
	echo "Successfully pushed commit and tag $$NEW_VER to remote"
endef

version-patch: test
	$(call bump_version,patch)

version-minor: test
	$(call bump_version,minor)

version-major: test
	$(call bump_version,major)

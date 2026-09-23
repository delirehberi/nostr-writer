# Obsidian Nostr Writer
> Seamlessly publish long-form articles, notes, and drafts directly from Obsidian to the decentralized Nostr network.

[![Release](https://img.shields.io/github/v/release/jamesmagoo/nostr-writer?style=flat-square)](https://github.com/jamesmagoo/nostr-writer/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](LICENSE)
[![NIPs](https://img.shields.io/badge/NIPs-01%20%7C%2023%20%7C%2046%20%7C%2092%20%7C%2098-purple?style=flat-square)](https://github.com/nostr-protocol/nips)

---

## 📖 A Match Made in Heaven

[**Obsidian**](https://obsidian.md/) is a world-class markdown editor, idea synthesizer, and local-first thinking environment.

[**Nostr**](https://nostr.com/) is the decentralized, censorship-resistant protocol for distributing the written word without gatekeepers or walled gardens.

**Nostr Writer** connects your local Obsidian vault directly to Nostr relays and decentralized media servers, empowering writers to publish freely while keeping their personal writing environment distraction-free.

---

## ✨ Features

- **Long-Form Publishing (NIP-23)**: Publish full markdown articles as Kind `30023` events or draft notes as Kind `30024` events to platforms like Habla, Blogstack, Yakihonne, and more.
- **Pluggable Authentication (Nsec & NIP-46 Bunker)**:
  - **Local `nsec`**: Fast local signing with `nostr-tools`.
  - **NIP-46 Remote Bunker**: Connect securely via `bunker://` or `nostrconnect://` (Amber, nsecBunker, Alby, etc.) so your private key never resides on your computer.
- **Blossom Media Hosting (BUD-01 / BUD-02)**:
  - Multi-server Blossom uploads with SHA-256 hash calculation and **NIP-98 HTTP Authorization** headers.
  - Automatic `imeta` tag generation (NIP-92) for high-fidelity decentralized media previews.
  - Configurable in-modal media server picker with legacy server fallback.
- **Interactive Dry-Run / Event Preview**:
  - Inspect the generated Nostr event JSON before broadcasting.
  - Verify event tags, targeted relays, and author signature.
  - Direct one-click "Sign & Broadcast" right from the preview modal.
- **Smart Tag Extraction & UI**:
  - Automatically parses YAML frontmatter `tags` (string or array formats).
  - Safely extracts body `#hashtags` while ignoring markdown headings, code blocks, and math.
  - Interactive tag pill badges with comma-separated and Enter-key input.
- **Multilingual URL-Safe Slug Generator**:
  - Automatically generates clean kebab-case slugs from article titles with full Turkish and accented character conversion (e.g., `ş`, `ğ`, `ı`, `ö`, `ç`, `ü`).
  - Supports frontmatter `slug` or `d` tag override with live validation.
- **Per-Post Relay & Media Server Targeting**:
  - Select or deselect individual relays directly in the publish popup to target specific audiences or communities.
- **Short-Form Note Composer (Kind 1)**:
  - Quickly draft and publish short thoughts, micro-posts, or threads without leaving Obsidian.
- **Nostr Bookmarks & Highlights Sync**:
  - View and import your remote Nostr bookmarks and highlights directly into your local vault as `.md` notes.
- **Multi-Profile Management**:
  - Configure and switch between multiple pen names, identities, and keys effortlessly.

---

## 📦 Installation

### Option 1: Via Obsidian Community Plugins (Recommended)
1. Open Obsidian **Settings** > **Community plugins**.
2. Turn off **Restricted mode** if enabled.
3. Click **Browse** and search for **Nostr Writer**.
4. Click **Install**, then click **Enable**.

---

### Option 2: Manual Installation via Release Bundle
1. Go to the [**Latest Releases**](https://github.com/jamesmagoo/nostr-writer/releases) page on GitHub.
2. Download the `nostr-writer.zip` archive (or download `main.js`, `manifest.json`, and `styles.css` directly).
3. In your Obsidian vault directory, navigate to:
   ```bash
   <VaultFolder>/.obsidian/plugins/
   ```
4. Create a folder named `nostr-writer`:
   ```bash
   mkdir -p <VaultFolder>/.obsidian/plugins/nostr-writer
   ```
5. Extract `nostr-writer.zip` (or place `main.js`, `manifest.json`, and `styles.css`) into that directory:
   ```text
   <VaultFolder>/.obsidian/plugins/nostr-writer/
   ├── main.js
   ├── manifest.json
   └── styles.css
   ```
6. In Obsidian, go to **Settings** > **Community plugins** > **Installed plugins**, click the reload icon, and toggle on **Nostr Writer**.

---

### Option 3: Developer Installation from Source
If you are developing or compiling from source:

```bash
# Clone repository
git clone https://github.com/jamesmagoo/nostr-writer.git
cd nostr-writer

# Install dependencies
make install

# Build and deploy directly to your local Obsidian vault
make install-vault VAULT_DIR="/path/to/your/vault/.obsidian/plugins/nostr-writer"
```

---

## 🛠️ Usage & Frontmatter Guide

Nostr Writer automatically extracts metadata from your markdown note's YAML frontmatter.

### Example Markdown Frontmatter:
```yaml
---
title: The Decentralized Future of Publishing
summary: A comprehensive look into Nostr, NIP-23 long-form content, and independent journalism.
image: https://cdn.example.com/cover.png
tags:
  - nostr
  - bitcoin
  - freedom
slug: decentralized-future-of-publishing
published_at: 1711234567
---

Your long-form markdown article content begins here...
```

| Frontmatter Field | Description |
| :--- | :--- |
| `title` | Article title (used for NIP-23 `title` tag and auto-slug generation). |
| `summary` / `description` | Short teaser or summary for the article (NIP-23 `summary` tag). |
| `image` / `banner` | Featured header image URL (NIP-23 `image` tag). |
| `tags` / `hashtags` | List of tags (or comma-separated string) for discoverability (`t` tags). |
| `slug` / `d` | Custom identifier for replaceable long-form articles (`d` tag). |
| `published_at` | Custom UNIX timestamp for publication date. |

When you click **Publish to Nostr**, frontmatter is extracted and cleanly stripped from the article body before broadcasting to relays.

---

## 🔒 Security Architecture

### NIP-46 Nostr Bunker (Highest Security)
When using a **Remote Signer** (`bunker://` or `nostrconnect://` with Amber, nsecBunker, Alby, etc.):
- Your private key (`nsec`) **never touches your computer or Obsidian vault files**.
- Nostr Writer communicates with your remote signer via encrypted relays.
- You approve signing requests on your hardware or mobile device.

### Local Nsec Storage
If you configure a local `nsec` key:
- Keys are stored locally in your vault's plugin data directory:
  ```text
  <VaultFolder>/.obsidian/plugins/nostr-writer/data.json
  ```
- Keys are never transmitted to external telemetry or third-party servers. Ensure your local device and backup storage remain secure.

---

## 🧰 Development & Makefile Commands

This repository includes standard tooling and automated test suites:

| Command | Action |
| :--- | :--- |
| `make install` | Installs project dependencies (`npm install`). |
| `make dev` | Starts continuous development build with esbuild watch mode. |
| `make build` | Runs TypeScript type checking and generates production bundle. |
| `make test` | Runs the 36 automated unit and integration tests. |
| `make package` | Builds and creates the distribution zip bundle at `dist/nostr-writer.zip`. |
| `make install-vault` | Builds and copies files directly to your configured `VAULT_DIR`. |
| `make version-patch` | Runs tests, bumps patch version (`x.y.Z+1`), updates all manifests, commits, tags `v*`, and pushes. |
| `make version-minor` | Runs tests, bumps minor version (`x.Y+1.0`), updates all manifests, commits, tags `v*`, and pushes. |
| `make version-major` | Runs tests, bumps major version (`X+1.0.0`), updates all manifests, commits, tags `v*`, and pushes. |
| `make clean` | Cleans build artifacts and temporary test files. |

---

## ⚡️ SATS & Support

If you find Nostr Writer useful, consider supporting open-source development:

- **Lightning Address**: `magoo@getalby.com`
- **Nostr npub**: `npub10a8kw2hsevhfycl4yhtg7vzrcpwpu7s6med27juf4lzqpsvy270qrh8zkw`
- **Buy Me a Coffee**: [buymeacoffee.com/jamesmagoo](https://www.buymeacoffee.com/jamesmagoo)

---

## 📄 License

Distributed under the [MIT License](LICENSE). Built for the Nostr and Obsidian communities.

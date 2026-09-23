# CLAUDE.md

This file provides architectural context, development guidelines, and testing procedures for Claude Code when working in the Nostr Writer repository.

---

## 🚀 Project Overview

**Obsidian Nostr Writer** is an Obsidian plugin enabling authors to publish long-form articles (NIP-23 Kind 30023), draft articles (Kind 30024), and short-form notes (Kind 1) from Obsidian to the decentralized Nostr protocol, along with Blossom (BUD-01/02) media uploads and remote signing (NIP-46).

---

## 🛠️ Development & Tooling Commands

The project uses a standard `Makefile` wrapping `npm` and `esbuild`:

```bash
# Install dependencies
make install

# Development mode with file watching
make dev

# Production build and type checking
make build

# Run comprehensive test suites (36 unit & integration tests)
make test

# Package release bundle (dist/nostr-writer.zip)
make package

# Install directly into a local Obsidian vault
make install-vault VAULT_DIR="/path/to/your/vault/.obsidian/plugins/nostr-writer"

# SemVer Versioning & Automated Release (runs tests, bumps all manifests, tags v*, and pushes)
make version-patch
make version-minor
make version-major

# Clean build artifacts
make clean
```

---

## 🏛️ Architecture & Code Organization

```text
src/
├── signer/                   # Pluggable signing subsystem (Local & Remote)
│   ├── NostrSigner.ts        # Common interface (getPublicKey, signEvent, getType)
│   ├── NsecSigner.ts         # Local nsec signing via Uint8Array & nostr-tools
│   ├── BunkerSigner.ts       # NIP-46 remote signing (bunker:// and nostrconnect://)
│   ├── SignerFactory.ts      # Instantiates signers based on profile configuration
│   └── index.ts
│
├── builder/                  # Nostr event builder engine
│   ├── EventBuilder.ts       # Builds Kind 30023, 30024, Kind 1, and NIP-98 events
│   └── index.ts
│
├── utils/                    # Core utilities & parsers
│   ├── SlugUtil.ts           # URL-safe kebab-case slugifier with Turkish/accent support
│   ├── TagExtractor.ts       # YAML frontmatter tag parser & safe body hashtag extractor
│   ├── BlossomUtil.ts        # Blossom URL normalization, SHA-256 computation, imeta tags
│   ├── RelayUtil.ts          # Relay URL normalization, sanitization, and deduplication
│   └── Logger.ts             # Centralized debug & error logging
│
├── service/                  # Core protocol services
│   ├── NostrService.ts       # Relay pool management, multi-profile state, NIP-23/NIP-46 broadcast
│   └── ImageUploadService.ts # Blossom (BUD-01/02) & legacy media upload with NIP-98 auth
│
├── ConfirmPublishModal.ts    # Publish dialog with tag pills, auto-slug, relay & server pickers
├── DryRunPreviewModal.ts     # JSON event preview modal with direct broadcast capability
├── ShortFormModal.ts         # Fast note composer modal (Kind 1)
├── PublishedView.ts          # History of published posts with profile switching
├── ReaderView.ts             # Nostr bookmarks reader view
├── HighlightsView.ts         # Nostr highlights reader view
└── settings.ts               # Plugin settings (Multi-profile nsec/bunker, Blossom servers, Relays)

main.ts                       # Obsidian plugin entrypoint & command registrations
styles.css                    # UI styles for modal dialogs, tag pills, and views
Makefile                      # Tooling and build automation
```

---

## 🧪 Testing Guidelines

Unit and integration tests are organized in `tests/`:
- `tests/phase2.test.ts`: Slugification (Turkish/accents), tag extraction, and event builder validation.
- `tests/phase3.test.ts`: Relay filtering, dry-run JSON generation, and modal data flow.
- `tests/phase4.test.ts`: Blossom SHA-256 hashes, NIP-98 auth headers, `imeta` formatting, and relay URL validation.
- `tests/phase5.test.ts`: Full cryptographic verification (Schnorr signatures, NIP-01 ID hashing, NIP-23 protocol checks, `nak` CLI interoperability, and security zero-leakage audits).

Run tests at any time with:
```bash
make test
```

---

## 🔒 Security Standards

1. **Zero Private Key Leakage**: Private keys (`nsec`) must never appear in serialized events, dry-run preview JSON, tag arrays, or logs.
2. **NIP-46 Bunker Security**: Remote signer connections use encrypted Nostr communication with local ephemeral/client keys.
3. **Input Sanitization**: Slugs, tags, and relay URLs must be strictly sanitized to prevent HTML injection or path traversal.
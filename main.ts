import { Notice, Plugin } from "obsidian";
import { nip19 } from "nostr-tools";
import { generateSecretKey } from "nostr-tools/pure";
import { bytesToHex } from "@noble/hashes/utils";
import ShortFormModal from "src/ShortFormModal";
import ConfirmPublishModal from "./src/ConfirmPublishModal";
import NostrService from "./src/service/NostrService";
import {
	NostrWriterPluginSettings,
	NostrWriterSettingTab,
} from "./src/settings";
import { PublishedView, PUBLISHED_VIEW } from "./src/PublishedView";
import { ReaderView, READER_VIEW } from "./src/ReaderView";
import { HighlightsView, HIGHLIGHTS_VIEW } from "./src/HighlightsView";

export default class NostrWriterPlugin extends Plugin {
	nostrService: NostrService;
	settings: NostrWriterPluginSettings;
	private ribbonIconElShortForm: HTMLElement | null = null;
	statusBar: any;

	async onload() {
		await this.loadSettings();
		this.updateStatusBar();
		await this.startupNostrService();
		this.addSettingTab(new NostrWriterSettingTab(this.app, this));
		this.updateRibbonIcon();

		this.registerView(
			PUBLISHED_VIEW,
			(leaf) => new PublishedView(leaf, this)
		);

		this.registerView(
			READER_VIEW,
			(leaf) => new ReaderView(leaf, this, this.nostrService)
		);

		this.registerView(
			HIGHLIGHTS_VIEW,
			(leaf) => new HighlightsView(leaf, this, this.nostrService)
		);

		this.addRibbonIcon("blocks", "See notes published to Nostr", () => {
			this.togglePublishedView();
		});

		this.addRibbonIcon("star-list", "See your Nostr Bookmarks", () => {
			this.toggleReaderView();
		});

		this.addRibbonIcon("lines-of-text", "See your Nostr Highlights", () => {
			this.toggleHighlightsView();
		});

		this.addRibbonIcon(
			"file-up",
			"Publish this note to Nostr",
			async (evt: MouseEvent) => {
				await this.checkAndPublish();
			}
		);

		this.addCommand({
			id: "publish-note-to-nostr",
			name: "Publish",
			callback: async () => {
				await this.checkAndPublish();
			},
		});

		this.addCommand({
			id: "test-print",
			name: "Show configured relays",
			callback: async () => {
				const relays = this.nostrService.getAllConfiguredRelayUrls();
				if (relays.length === 0) {
					new Notice("No relays configured. Using default relays.");
				} else {
					new Notice(`Configured Relays (${relays.length}):\n${relays.join("\n")}`);
				}
			},
		});

		this.addCommand({
			id: "get-pub",
			name: "See your public key",
			callback: async () => {
				const pubKey = await this.nostrService.getPublicKey();
				if (pubKey) {
					try {
						const npub = nip19.npubEncode(pubKey);
						new Notice(`Public Key:\n${npub}`);
					} catch (_) {
						new Notice(`Public Key: ${pubKey}`);
					}
				} else {
					new Notice("No signer public key found. Please check settings.");
				}
			},
		});

		this.addCommand({
			id: "get-pub-clipboard",
			name: "Copy public key to clipboard",
			callback: async () => {
				const pubKey = await this.nostrService.getPublicKey();
				if (pubKey) {
					let toCopy = pubKey;
					try {
						toCopy = nip19.npubEncode(pubKey);
					} catch (_) {
						toCopy = pubKey;
					}
					navigator.clipboard
						.writeText(toCopy)
						.then(() => {
							new Notice(`Public Key copied to clipboard:\n${toCopy}`);
						})
						.catch((err) => {
							new Notice(`Failed to copy Public Key: ${err}`);
						});
				} else {
					new Notice("No signer public key found. Please check settings.");
				}
			},
		});
	}

	togglePublishedView = async (): Promise<void> => {
		const existing = this.app.workspace.getLeavesOfType(PUBLISHED_VIEW);
		if (existing.length) {
			this.app.workspace.revealLeaf(existing[0]);
			return;
		}

		await this.app.workspace.getRightLeaf(false).setViewState({
			type: PUBLISHED_VIEW,
			active: true,
		});

		this.app.workspace.revealLeaf(
			this.app.workspace.getLeavesOfType(PUBLISHED_VIEW)[0]
		);
	};

	toggleReaderView = async (): Promise<void> => {
		const existing = this.app.workspace.getLeavesOfType(READER_VIEW);
		if (existing.length) {
			this.app.workspace.revealLeaf(existing[0]);
			return;
		}

		await this.app.workspace.getRightLeaf(false).setViewState({
			type: READER_VIEW,
			active: true,
		});

		this.app.workspace.revealLeaf(
			this.app.workspace.getLeavesOfType(READER_VIEW)[0]
		);
	};

	toggleHighlightsView = async (): Promise<void> => {
		const existing = this.app.workspace.getLeavesOfType(HIGHLIGHTS_VIEW);
		if (existing.length) {
			this.app.workspace.revealLeaf(existing[0]);
			return;
		}

		await this.app.workspace.getRightLeaf(false).setViewState({
			type: HIGHLIGHTS_VIEW,
			active: true,
		});

		this.app.workspace.revealLeaf(
			this.app.workspace.getLeavesOfType(HIGHLIGHTS_VIEW)[0]
		);
	};

	async onunload(): Promise<void> {
		if (this.nostrService) {
			await this.nostrService.shutdownRelays();
		}
		this.app.workspace
			.getLeavesOfType(PUBLISHED_VIEW)
			.forEach((leaf) => leaf.detach());
		this.app.workspace
			.getLeavesOfType(READER_VIEW)
			.forEach((leaf) => leaf.detach());
		this.app.workspace
			.getLeavesOfType(HIGHLIGHTS_VIEW)
			.forEach((leaf) => leaf.detach());
	}

	async startupNostrService(): Promise<void> {
		this.nostrService = new NostrService(this, this.app, this.settings);
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign(
			{},
			{
				signerType: "nsec",
				signerTarget: "",
				privateKey: "",
				bunkerClientSecretKey: "",
				shortFormEnabled: false,
				statusBarEnabled: true,
				relayConfigEnabled: false,
				relayURLs: [
					"wss://nos.lol",
					"wss://relay.damus.io",
					"wss://relay.nostr.band",
					"wss://relayable.org",
					"wss://nostr.rocks",
					"wss://nostr.fmt.wiz.biz",
				],
				imageStorageProviders: [
					"https://blossom.primal.net",
					"https://blossom.damus.io",
				],
				selectedImageStorageProvider: "https://blossom.primal.net",
				premiumStorageEnabled: false,
				multipleProfilesEnabled: false,
				profiles: [],
			},
			await this.loadData()
		);

		// Ensure persistent bunker client key is generated
		if (!this.settings.bunkerClientSecretKey || !/^[0-9a-fA-F]{64}$/.test(this.settings.bunkerClientSecretKey)) {
			this.settings.bunkerClientSecretKey = bytesToHex(generateSecretKey());
			await this.saveSettings();
		}

		// Backwards compatibility migration
		if (!this.settings.signerTarget && this.settings.privateKey) {
			this.settings.signerType = "nsec";
			this.settings.signerTarget = this.settings.privateKey;
		} else if (this.settings.signerTarget && !this.settings.privateKey && this.settings.signerType === "nsec") {
			this.settings.privateKey = this.settings.signerTarget;
		}

		if (Array.isArray(this.settings.profiles)) {
			for (const p of this.settings.profiles) {
				if (!p.signerType) {
					p.signerType = "nsec";
				}
				if (!p.signerTarget && p.profilePrivateKey) {
					p.signerTarget = p.profilePrivateKey;
				}
			}
		}
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	isEmptyContent(content: string): boolean {
		return content.trim() === "";
	}

	async checkAndPublish(): Promise<void> {
		if (!this.nostrService.hasSignerConfigured()) {
			new Notice(
				"🔑 Please set your private key or Bunker connection in Nostr Writer settings before publishing."
			);
			return;
		}
		const activeFile = this.app.workspace.getActiveFile();
		if (activeFile) {
			const fileContent: string = await this.app.vault.read(activeFile);
			if (this.isEmptyContent(fileContent)) {
				new Notice("❌ The note is empty and cannot be published.");
				return;
			}

			new ConfirmPublishModal(
				this.app,
				this.nostrService,
				activeFile,
				this
			).open();
		} else {
			new Notice("❗️ No note is currently active. Click into a note.");
		}
	}

	updateRibbonIcon(): void {
		if (this.settings.shortFormEnabled) {
			if (!this.ribbonIconElShortForm) {
				this.ribbonIconElShortForm = this.addRibbonIcon(
					"pencil",
					"Write to Nostr (short form)",
					(evt: MouseEvent) => {
						if (!this.nostrService.hasSignerConfigured()) {
							new Notice(
								"🔑 Please set your private key or Bunker connection in settings before publishing."
							);
							return;
						}

						new ShortFormModal(
							this.app,
							this.nostrService,
							this
						).open();
					}
				);
			}
		} else if (this.ribbonIconElShortForm) {
			this.ribbonIconElShortForm.remove();
			this.ribbonIconElShortForm = null;
		}
	}

	updateStatusBar(): void {
		if (this.settings.statusBarEnabled) {
			if (!this.statusBar) {
				this.statusBar = this.addStatusBarItem();
				this.statusBar.addClass("mod-clickable");
				this.statusBar.addEventListener("click", () => {
					try {
						(this.app as any).setting.open();
						(this.app as any).setting.openTabById("nostr-writer");
					} catch (_) {}
				});
			}

			const isConfigured = this.nostrService?.hasSignerConfigured();
			const signerType = this.settings.signerType === "bunker" ? "Bunker" : "nsec";
			if (isConfigured) {
				this.statusBar.setText(`Nostr 🟣 (${signerType})`);
				setAttributes(this.statusBar, {
					"aria-label": `Nostr Writer: ${signerType} signer configured. Click for settings.`,
					"aria-label-position": "top",
				});
			} else {
				this.statusBar.setText("Nostr ⚪ (Unconfigured)");
				setAttributes(this.statusBar, {
					"aria-label": "Nostr Writer: No signer configured. Click to configure.",
					"aria-label-position": "top",
				});
			}
		} else if (this.statusBar) {
			this.statusBar.remove();
			this.statusBar = null;
		}
	}
}

export function setAttributes(element: any, attributes: any) {
	for (let key in attributes) {
		element.setAttribute(key, attributes[key]);
	}
}

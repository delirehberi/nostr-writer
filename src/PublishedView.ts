import NostrWriterPlugin from "main";
import { ButtonComponent, ItemView, Notice, TFile, WorkspaceLeaf } from "obsidian";
import { nip19 } from "nostr-tools";
import { Event } from "nostr-tools/core";
import { Logger } from "./utils/Logger";

export const PUBLISHED_VIEW = "published-view";

interface LocalPublishedRecord {
	id: string;
	tags: string[][];
	created_at: number;
	filepath?: string;
	profileNickname?: string;
	pubkey?: string;
	publishedToRelays?: string[];
	kind?: number;
}

export class PublishedView extends ItemView {
	plugin: NostrWriterPlugin;
	private refreshDisplay: () => void;
	private activeTab: "relay" | "local" = "relay";
	private isLoading = false;
	private remoteArticles: Event[] = [];

	constructor(leaf: WorkspaceLeaf, plugin: NostrWriterPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.refreshDisplay = () => this.renderView();
	}

	getViewType() {
		return PUBLISHED_VIEW;
	}

	getDisplayText() {
		return "Published Nostr Articles";
	}

	getIcon() {
		return "scroll";
	}

	async onOpen() {
		await this.renderView();
		if (this.activeTab === "relay" && this.remoteArticles.length === 0) {
			await this.fetchRemoteArticles();
		}
	}

	private async fetchRemoteArticles(): Promise<void> {
		if (this.isLoading) return;
		this.isLoading = true;
		await this.renderView();

		try {
			const articles = await this.plugin.nostrService.loadUserArticlesFromRelays();
			this.remoteArticles = articles;
			if (articles.length > 0) {
				new Notice(`✅ Discovered ${articles.length} Nostr long-form articles!`);
			} else {
				new Notice(`Checked relays: No Kind 30023/30024 articles found for this author.`);
			}
		} catch (err: any) {
			Logger.error("Failed to load articles from relays:", err);
			new Notice(`❌ Failed to load articles: ${err.message || err}`);
		} finally {
			this.isLoading = false;
			await this.renderView();
		}
	}

	private async readLocalPublished(): Promise<LocalPublishedRecord[]> {
		const publishedFilePath = `${this.plugin.manifest.dir}/published.json`;
		try {
			const exists = await this.app.vault.adapter.exists(publishedFilePath);
			if (!exists) return [];
			const file = await this.app.vault.adapter.read(publishedFilePath);
			return JSON.parse(file) || [];
		} catch (err) {
			Logger.debug("Error reading published.json:", err);
			return [];
		}
	}

	async renderView(): Promise<void> {
		const container = this.containerEl.children[1];
		container.empty();

		// Banner & Header
		const banner = container.createEl("div", {
			cls: "published-banner-div",
		});
		banner.createEl("h4", { text: "Nostr Articles" });

		const buttonGroup = banner.createEl("div", { cls: "published-button-group" });

		new ButtonComponent(buttonGroup)
			.setIcon("refresh-cw")
			.setCta()
			.setTooltip("Fetch & Refresh from Relays")
			.onClick(async () => {
				new Notice("Fetching articles from relays...");
				await this.fetchRemoteArticles();
			});

		// Tab navigation
		const navDiv = container.createEl("div", { cls: "published-nav-tabs" });
		
		const relayTabBtn = navDiv.createEl("button", {
			text: `All Relay Articles (${this.remoteArticles.length})`,
			cls: this.activeTab === "relay" ? "mod-cta" : "",
		});
		relayTabBtn.onclick = async () => {
			this.activeTab = "relay";
			if (this.remoteArticles.length === 0) {
				await this.fetchRemoteArticles();
			} else {
				await this.renderView();
			}
		};

		const localRecords = await this.readLocalPublished();
		const localTabBtn = navDiv.createEl("button", {
			text: `Vault History (${localRecords.length})`,
			cls: this.activeTab === "local" ? "mod-cta" : "",
		});
		localTabBtn.onclick = async () => {
			this.activeTab = "local";
			await this.renderView();
		};

		if (this.isLoading) {
			const loadingDiv = container.createEl("div", { cls: "published-loading" });
			loadingDiv.createEl("p", { text: "📡 Querying Nostr relays for your long-form articles..." });
			return;
		}

		if (this.activeTab === "relay") {
			await this.renderRelayArticles(container, localRecords);
		} else {
			await this.renderLocalHistory(container, localRecords);
		}
	}

	private async renderRelayArticles(container: Element, localRecords: LocalPublishedRecord[]): Promise<void> {
		if (this.remoteArticles.length === 0) {
			const authorPk = await this.plugin.nostrService.getPublicKey();
			let npubDisplay = "";
			try {
				if (authorPk) npubDisplay = nip19.npubEncode(authorPk);
			} catch (_) {}

			const emptyDiv = container.createEl("div", { cls: "published-card" });
			emptyDiv.createEl("h6", { text: "No remote articles found 📝" });
			emptyDiv.createEl("p", {
				text: "No Kind 30023 (published) or Kind 30024 (draft) articles found on your configured relays for this author public key.",
			});
			if (npubDisplay) {
				emptyDiv.createEl("p", {
					text: `Author Pubkey: ${npubDisplay.substring(0, 16)}...${npubDisplay.substring(npubDisplay.length - 8)}`,
					cls: "published-summary",
				});
			}
			new ButtonComponent(emptyDiv)
				.setButtonText("Fetch from Relays 🔄")
				.setCta()
				.onClick(() => this.fetchRemoteArticles());
			return;
		}

		// Index local records by id and by d-tag for quick lookup
		const localById = new Map<string, LocalPublishedRecord>();
		const localByDTag = new Map<string, LocalPublishedRecord>();
		for (const rec of localRecords) {
			if (rec.id) localById.set(rec.id, rec);
			const dTag = rec.tags?.find((t: string[]) => t[0] === "d")?.[1];
			if (dTag) localByDTag.set(dTag, rec);
		}

		container.createEl("p", { text: `Found ${this.remoteArticles.length} articles on relays ✅` });

		for (const article of this.remoteArticles) {
			const titleTag = article.tags.find((t: string[]) => t[0] === "title");
			const dTag = article.tags.find((t: string[]) => t[0] === "d")?.[1] || "";
			const publishedAtTag = article.tags.find((t: string[]) => t[0] === "published_at");
			const summaryTag = article.tags.find((t: string[]) => t[0] === "summary");

			const title = titleTag ? titleTag[1] : (dTag || "Untitled Article");
			const isDraft = article.kind === 30024;
			const timestamp = publishedAtTag ? Number(publishedAtTag[1]) : article.created_at;
			const publishedDate = new Date(timestamp * 1000).toLocaleString("en-US", {
				year: "numeric",
				month: "short",
				day: "numeric",
				hour: "2-digit",
				minute: "2-digit",
			});

			// Check if exists in vault
			const matchedRecord = localById.get(article.id) || (dTag ? localByDTag.get(dTag) : undefined);
			let fileInVault: TFile | null = null;
			if (matchedRecord?.filepath) {
				const abstractFile = this.app.vault.getAbstractFileByPath(matchedRecord.filepath);
				if (abstractFile instanceof TFile) {
					fileInVault = abstractFile;
				}
			}

			const cardDiv = container.createEl("div", { cls: "published-card" });

			// Header with Title and badges
			const headerDiv = cardDiv.createEl("div", { cls: "published-card-header" });
			headerDiv.createEl("strong", { text: `📜 ${title}` });

			const badgeSpan = headerDiv.createEl("span", {
				cls: isDraft ? "published-badge-draft" : "published-badge-kind",
				text: isDraft ? "Kind 30024 (Draft)" : "Kind 30023",
			});
			badgeSpan.style.marginLeft = "8px";
			badgeSpan.style.fontSize = "11px";

			const statusSpan = headerDiv.createEl("span", {
				cls: fileInVault ? "published-badge-vault" : "published-badge-remote",
				text: fileInVault ? "In Vault 📁" : "Remote Only ☁️",
			});
			statusSpan.style.marginLeft = "8px";
			statusSpan.style.fontSize = "11px";

			if (dTag) {
				cardDiv.createEl("div", {
					text: `Identifier (slug): ${dTag}`,
					cls: "published-profile",
				});
			}

			if (summaryTag && summaryTag[1]) {
				cardDiv.createEl("p", {
					text: summaryTag[1],
					cls: "published-summary",
				});
			}

			const detailsDiv = cardDiv.createEl("div", { cls: "published-details-div" });
			detailsDiv.createEl("p", { text: publishedDate });

			const actionsDiv = detailsDiv.createEl("div", { cls: "published-actions" });

			// Web preview button (njump / habla)
			let webLink = "";
			try {
				if (dTag) {
					const naddr = nip19.naddrEncode({
						kind: article.kind,
						pubkey: article.pubkey,
						identifier: dTag,
					});
					webLink = `https://njump.me/${naddr}`;
				} else {
					const nevent = nip19.neventEncode({
						id: article.id,
						author: article.pubkey,
					});
					webLink = `https://njump.me/${nevent}`;
				}
			} catch (_) {
				webLink = `https://habla.news/a/${article.id}`;
			}

			new ButtonComponent(actionsDiv)
				.setIcon("popup-open")
				.setCta()
				.setTooltip("View Online (njump.me)")
				.onClick(() => {
					window.open(webLink, "_blank");
				});

			// If file exists in vault, show "Go to file", otherwise "Download to Vault"
			if (fileInVault) {
				new ButtonComponent(actionsDiv)
					.setIcon("go-to-file")
					.setCta()
					.setTooltip(`Open in Obsidian (${fileInVault.path})`)
					.onClick(() => {
						this.focusFile(fileInVault!.path);
					});
			} else {
				new ButtonComponent(actionsDiv)
					.setIcon("download")
					.setCta()
					.setTooltip("Download & Import to Obsidian Vault as Markdown")
					.onClick(async () => {
						new Notice(`📥 Downloading "${title}" into vault...`);
						const importResult = await this.plugin.nostrService.importArticleToVault(article);
						if (importResult.success && importResult.file) {
							new Notice(`✅ Downloaded and saved as ${importResult.path}!`);
							this.focusFile(importResult.file.path);
							await this.renderView();
						} else {
							new Notice(`❌ Failed to import: ${importResult.error || "Unknown error"}`);
						}
					});
			}
		}
	}

	private async renderLocalHistory(container: Element, localRecords: LocalPublishedRecord[]): Promise<void> {
		if (localRecords.length === 0) {
			const noPostsDiv = container.createEl("div", { cls: "published-card" });
			noPostsDiv.createEl("h6", { text: "No Local Publish Records 📝" });
			noPostsDiv.createEl("p", { text: "Notes published from this Obsidian vault will appear here." });
			return;
		}

		container.createEl("p", { text: `Total vault published records: ${localRecords.length} ✅` });

		localRecords
			.slice()
			.reverse()
			.forEach((note) => {
				const titleTag = note.tags?.find((tag: string[]) => tag[0] === "title");
				const publishedAtTag = note.tags?.find((tag: string[]) => tag[0] === "published_at");

				const title = titleTag ? titleTag[1] : "Untitled Note";
				const publishedDate = publishedAtTag
					? new Date(Number(publishedAtTag[1]) * 1000).toLocaleString("en-US", {
							year: "numeric",
							month: "long",
							day: "numeric",
							weekday: "long",
							hour: "2-digit",
							minute: "2-digit",
					  })
					: "No Published Date";

				const cardDiv = container.createEl("div", { cls: "published-card" });
				cardDiv.createEl("span", { text: `📜 ${title}` });

				if (this.plugin.settings.multipleProfilesEnabled && note.profileNickname) {
					let displayNickname = note.profileNickname === "default" ? "Default Profile" : note.profileNickname;
					cardDiv.createEl("div", {
						text: `👤 - ${displayNickname}`,
						cls: "published-profile",
					});
				}

				const detailsDiv = cardDiv.createEl("div", { cls: "published-details-div" });
				detailsDiv.createEl("p", { text: `${publishedDate}.` });

				const actionsDiv = detailsDiv.createEl("div", { cls: "published-actions" });

				let target: nip19.EventPointer = {
					id: note.id,
					author: note.pubkey,
					relays: note.publishedToRelays,
				};

				let nevent = "";
				try {
					nevent = nip19.neventEncode(target);
				} catch (_) {}

				new ButtonComponent(actionsDiv)
					.setIcon("popup-open")
					.setCta()
					.setTooltip("View Online")
					.onClick(() => {
						const url = nevent ? `https://njump.me/${nevent}` : `https://habla.news/a/${note.id}`;
						window.open(url, "_blank");
					});

				new ButtonComponent(actionsDiv)
					.setIcon("go-to-file")
					.setCta()
					.setTooltip("Go to file in Obsidian")
					.onClick(() => {
						if (note.filepath == null) {
							new Notice("File path not available");
						} else {
							this.focusFile(note.filepath);
						}
					});
			});
	}

	focusFile = (path: string, shouldSplit = false): void => {
		const targetFile = this.app.vault.getAbstractFileByPath(path);
		if (targetFile && targetFile instanceof TFile) {
			let leaf = this.app.workspace.getLeaf();
			const createLeaf = shouldSplit || leaf?.getViewState().pinned;
			if (createLeaf) {
				leaf = this.app.workspace.getLeaf("tab");
			}
			leaf?.openFile(targetFile);
		} else {
			new Notice(`Cannot find file: ${path}`);
		}
	};
}



import { App, ButtonComponent, Modal, Notice, TFile } from "obsidian";
import NostrWriterPlugin from "../main";
import { EventBuilder } from "./builder";
import { EventTemplate } from "nostr-tools/core";

export interface DryRunParams {
	file?: TFile;
	title: string;
	slug: string;
	summary: string;
	content: string;
	tags: string[];
	publishAsDraft: boolean;
	selectedProfileKey: string;
	targetRelays: string[];
	selectedStorageProvider?: string;
	bannerImageUrl?: string | null;
	imetaTags?: string[][];
	isShortNote?: boolean;
	onBroadcast: () => Promise<void>;
}

export default class DryRunPreviewModal extends Modal {
	plugin: NostrWriterPlugin;
	params: DryRunParams;
	previewEvent: EventTemplate & { pubkey: string; id: string; sig: string };

	constructor(app: App, plugin: NostrWriterPlugin, params: DryRunParams) {
		super(app);
		this.plugin = plugin;
		this.params = params;
	}

	async onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("dry-run-modal-content");

		// Fetch current signer public key for preview
		let previewPubkey = "simulated-pubkey-loading...";
		try {
			const pk = await this.plugin.nostrService.getPublicKey(this.params.selectedProfileKey);
			if (pk) previewPubkey = pk;
		} catch (e) {
			console.error("Could not fetch public key for preview:", e);
		}

		// Build the event template
		if (this.params.isShortNote) {
			const template = EventBuilder.buildShortNoteEvent({
				content: this.params.content,
				createdAt: Math.floor(Date.now() / 1000),
			});
			this.previewEvent = {
				...template,
				pubkey: previewPubkey,
				id: "calculated-upon-signing",
				sig: "calculated-upon-signing",
			};
		} else if (this.params.publishAsDraft) {
			const template = EventBuilder.buildDraftEvent({
				slug: this.params.slug,
				title: this.params.title,
				content: this.params.content,
				summary: this.params.summary || undefined,
				bannerImageUrl: this.params.bannerImageUrl || undefined,
				tags: this.params.tags,
				imetaTags: this.params.imetaTags,
				createdAt: Math.floor(Date.now() / 1000),
			});
			this.previewEvent = {
				...template,
				pubkey: previewPubkey,
				id: "calculated-upon-signing",
				sig: "calculated-upon-signing",
			};
		} else {
			const template = EventBuilder.buildLongFormEvent({
				slug: this.params.slug,
				title: this.params.title,
				content: this.params.content,
				summary: this.params.summary || undefined,
				bannerImageUrl: this.params.bannerImageUrl || undefined,
				tags: this.params.tags,
				imetaTags: this.params.imetaTags,
				createdAt: Math.floor(Date.now() / 1000),
			});
			this.previewEvent = {
				...template,
				pubkey: previewPubkey,
				id: "calculated-upon-signing",
				sig: "calculated-upon-signing",
			};
		}

		// Header
		const header = contentEl.createEl("div", { cls: "dry-run-header" });
		header.createEl("h2", { text: "🔍 Unsigned Event Preview & Dry Run" });
		header.createEl("p", {
			cls: "dry-run-preview-note",
			text: "This is a preview built from the event template. The real id and sig are computed when the event is signed, so the published event will differ in those fields.",
		});

		// Metadata Overview Cards
		const summaryGrid = contentEl.createEl("div", { cls: "dry-run-summary-grid" });

		const kindBadge = summaryGrid.createEl("div", { cls: "dry-run-badge-card" });
		kindBadge.createEl("div", { cls: "dry-run-badge-label", text: "KIND" });
		kindBadge.createEl("div", {
			cls: "dry-run-badge-value",
			text: `${this.previewEvent.kind} (${this.getKindLabel(this.previewEvent.kind)})`,
		});

		if (!this.params.isShortNote) {
			const slugBadge = summaryGrid.createEl("div", { cls: "dry-run-badge-card" });
			slugBadge.createEl("div", { cls: "dry-run-badge-label", text: "IDENTIFIER (d-tag)" });
			slugBadge.createEl("div", { cls: "dry-run-badge-value", text: this.params.slug || "-" });
		}

		const profileBadge = summaryGrid.createEl("div", { cls: "dry-run-badge-card" });
		profileBadge.createEl("div", { cls: "dry-run-badge-label", text: "PROFILE" });
		profileBadge.createEl("div", { cls: "dry-run-badge-value", text: this.params.selectedProfileKey || "default" });

		const relaysBadge = summaryGrid.createEl("div", { cls: "dry-run-badge-card" });
		relaysBadge.createEl("div", { cls: "dry-run-badge-label", text: "TARGET RELAYS" });
		relaysBadge.createEl("div", {
			cls: "dry-run-badge-value",
			text: `${this.params.targetRelays.length} Relays Selected`,
		});

		// Target Relays Details
		const relayDetails = contentEl.createEl("details", { cls: "dry-run-relays-details" });
		relayDetails.createEl("summary", {
			text: `📡 View Target Relays (${this.params.targetRelays.length})`,
		});
		const relayListEl = relayDetails.createEl("ul", { cls: "dry-run-relay-list" });
		if (this.params.targetRelays.length === 0) {
			relayListEl.createEl("li", { text: "⚠️ No relays selected. Post will not be broadcast." });
		} else {
			for (const rUrl of this.params.targetRelays) {
				relayListEl.createEl("li", { text: `🟢 ${rUrl}` });
			}
		}

		// Tags Preview Section
		if (this.params.tags && this.params.tags.length > 0) {
			const tagsContainer = contentEl.createEl("div", { cls: "dry-run-tags-preview" });
			tagsContainer.createEl("span", { cls: "dry-run-tags-label", text: "Tags:" });
			for (const tag of this.params.tags) {
				tagsContainer.createEl("span", { cls: "dry-run-tag-pill", text: `#${tag}` });
			}
		}

		// Formatted JSON Container
		contentEl.createEl("h4", { text: "Unsigned Event Template (JSON)" });
		const jsonWrapper = contentEl.createEl("div", { cls: "dry-run-json-container" });
		const jsonPre = jsonWrapper.createEl("pre", { cls: "dry-run-json-pre" });
		const formattedJson = JSON.stringify(this.previewEvent, null, 2);
		jsonPre.createEl("code", { text: formattedJson });

		// Action Button Bar
		const actionBar = contentEl.createEl("div", { cls: "dry-run-action-bar" });

		new ButtonComponent(actionBar)
			.setButtonText("📋 Copy Event JSON")
			.onClick(async () => {
				try {
					await navigator.clipboard.writeText(formattedJson);
					new Notice("✅ Copied Nostr Event JSON to clipboard!");
				} catch (err) {
					console.error("Clipboard copy failed:", err);
					new Notice("❌ Failed to copy to clipboard");
				}
			});

		let broadcastBtn: ButtonComponent;
		broadcastBtn = new ButtonComponent(actionBar)
			.setButtonText("🚀 Sign & Broadcast")
			.setCta()
			.onClick(async () => {
				if (this.params.targetRelays.length === 0) {
					new Notice("❌ Cannot broadcast: No relays selected.");
					return;
				}
				broadcastBtn.setButtonText("Broadcasting...").setDisabled(true);
				try {
					this.close();
					await this.params.onBroadcast();
				} catch (err) {
					console.error("Broadcast failed:", err);
					new Notice(`❌ Broadcast error: ${err}`);
					broadcastBtn.setButtonText("🚀 Sign & Broadcast").setDisabled(false);
				}
			});

		new ButtonComponent(actionBar)
			.setButtonText("Back to Edit")
			.onClick(() => {
				this.close();
			});
	}

	private getKindLabel(kind: number): string {
		switch (kind) {
			case 30023:
				return "Long-Form Content (NIP-23)";
			case 30024:
				return "Draft Long-Form (NIP-23)";
			case 1:
				return "Short Text Note";
			default:
				return `Kind ${kind}`;
		}
	}
}

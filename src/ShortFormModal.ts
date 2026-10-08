import {
	App,
	ButtonComponent,
	Modal,
	Notice,
	TextAreaComponent,
	Setting,
} from "obsidian";
import NostrService from "./service/NostrService";
import NostrWriterPlugin from "../main";
import DryRunPreviewModal from "./DryRunPreviewModal";

export default class ShortFormModal extends Modal {
	plugin: NostrWriterPlugin;

	constructor(
		app: App,
		private nostrService: NostrService,
		plugin: NostrWriterPlugin
	) {
		super(app);
		this.plugin = plugin;
	}

	async onOpen() {
		let { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("short-form-modal-content");

		contentEl.createEl("h2", { text: `Write a Short Note (Kind 1)` });
		let summaryText = new TextAreaComponent(contentEl)
			.setPlaceholder("What's on your mind? #nostr #bitcoin...")
			.setValue("");

		summaryText.inputEl.setCssStyles({
			width: "100%",
			height: "220px",
			marginBottom: "10px",
			marginTop: "10px",
		});
		summaryText.inputEl.classList.add("short-form-modal-input");

		let selectedProfileKey = "default";
		if (this.plugin.settings.profiles.length > 0 && this.plugin.settings.multipleProfilesEnabled) {
			new Setting(contentEl)
				.setName("Select Profile")
				.setDesc("Select a profile to send this note from.")
				.addDropdown((dropdown) => {
					dropdown.addOption("default", "Default");
					for (const { profileNickname } of this.plugin.settings.profiles) {
						dropdown.addOption(profileNickname, profileNickname);
					}
					dropdown.setValue("default");
					dropdown.onChange(async (value) => {
						selectedProfileKey = value;
						new Notice(`👤 Profile '${selectedProfileKey}' selected`);
					});
				});
		}

		// Relay selection is an advanced option, only shown in developer mode.
		const configuredRelays = this.nostrService.getAllConfiguredRelayUrls();
		const selectedRelays = new Set<string>(configuredRelays);

		if (this.plugin.settings.developerMode) {
			const targetsSection = contentEl.createEl("details", { cls: "nostr-collapsible-section" });
			targetsSection.open = false;

			const targetsSummary = targetsSection.createEl("summary", { cls: "nostr-section-summary" });
			function updateSummaryLabel() {
				targetsSummary.setText(`⚙️ Publish Targets & Relays (${selectedRelays.size}/${configuredRelays.length} active)`);
			}
			updateSummaryLabel();

			const targetsContent = targetsSection.createEl("div", { cls: "nostr-section-content" });

			const relayToolbar = targetsContent.createEl("div", { cls: "nostr-relay-toolbar" });
			relayToolbar.createEl("span", { text: "Relays for this note:" });

			const toolbarButtons = relayToolbar.createEl("div", { cls: "nostr-relay-quick-btns" });
			const selectAllBtn = toolbarButtons.createEl("button", { text: "Select All", cls: "mod-small" });
			const deselectAllBtn = toolbarButtons.createEl("button", { text: "Deselect All", cls: "mod-small" });

			const relayListContainer = targetsContent.createEl("div", { cls: "nostr-relay-checkbox-list" });
			const relayCheckboxes: { url: string; checkbox: HTMLInputElement }[] = [];

			for (const rUrl of configuredRelays) {
				const isConnected = this.nostrService.getRelayInfo(rUrl);
				const row = relayListContainer.createEl("label", { cls: "nostr-relay-checkbox-row" });

				const chk = row.createEl("input", { type: "checkbox" }) as HTMLInputElement;
				chk.checked = selectedRelays.has(rUrl);
				relayCheckboxes.push({ url: rUrl, checkbox: chk });
				chk.addEventListener("change", () => {
					if (chk.checked) {
						selectedRelays.add(rUrl);
					} else {
						selectedRelays.delete(rUrl);
					}
					updateSummaryLabel();
				});
				const relayIcon = row.createEl("span", {
					cls: "nostr-relay-icon",
					text: "📡",
				});

				row.createEl("span", { cls: "nostr-relay-url-label", text: rUrl });
			}

			selectAllBtn.addEventListener("click", (e) => {
				e.preventDefault();
				for (const item of relayCheckboxes) {
					item.checkbox.checked = true;
					selectedRelays.add(item.url);
				}
				updateSummaryLabel();
			});

			deselectAllBtn.addEventListener("click", (e) => {
				e.preventDefault();
				for (const item of relayCheckboxes) {
					item.checkbox.checked = false;
				}
				selectedRelays.clear();
				updateSummaryLabel();
			});
		}

		contentEl.createEl("hr");

		const doPublishShort = async () => {
			const noteMessage = summaryText.getValue().trim();
			if (!noteMessage || noteMessage.length === 0) {
				new Notice("❌ Please enter text to publish to Nostr");
				return;
			}

			if (selectedRelays.size === 0) {
				new Notice("❌ No target relays selected. Please enable at least one relay.");
				return;
			}

			publishButton.setButtonText("Sending...").setDisabled(true);
			previewButton.setDisabled(true);

			try {
				const targetRelaysArray = Array.from(selectedRelays);
				const res = await this.nostrService.publishShortFormNote(
					noteMessage,
					selectedProfileKey,
					targetRelaysArray
				);

				if (res.success) {
					new Notice(`✅ Successfully sent short note to Nostr!`);
					for (let relay of res.publishedRelays) {
						new Notice(`✅ - Sent to ${relay}`);
					}
					summaryText.setValue("");
					this.close();
				} else {
					new Notice(`❌ Failed to send note to Nostr.`);
				}
			} catch (error: any) {
				console.error("Short note publish error:", error);
				new Notice(`❌ Failed to send note: ${error.message || error}`);
			} finally {
				publishButton.setButtonText("Confirm and Send").setDisabled(false);
				previewButton.setDisabled(false);
			}
		};

		// Button container
		const buttonContainer = contentEl.createEl("div", { cls: "nostr-publish-btn-container" });

		const previewButton = new ButtonComponent(buttonContainer)
			.setButtonText("🔍 Preview / Dry Run")
			.onClick(() => {
				const noteMessage = summaryText.getValue().trim();
				if (!noteMessage) {
					new Notice("❌ Please enter message content to preview.");
					return;
				}

				new DryRunPreviewModal(this.app, this.plugin, {
					title: "",
					slug: "",
					summary: "",
					content: noteMessage,
					tags: [],
					publishAsDraft: false,
					selectedProfileKey: selectedProfileKey,
					targetRelays: Array.from(selectedRelays),
					isShortNote: true,
					onBroadcast: doPublishShort,
				}).open();
			});

		const publishButton = new ButtonComponent(buttonContainer)
			.setButtonText(
				this.plugin.settings.multipleProfilesEnabled
					? `Confirm and Send (${selectedProfileKey})`
					: `Confirm and Send`
			)
			.setCta()
			.onClick(async () => {
				await doPublishShort();
			});
	}
}


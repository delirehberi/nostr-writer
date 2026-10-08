import {
	ButtonComponent,
	Modal,
	Notice,
	TFile,
	App,
	Setting,
	TextAreaComponent,
	TextComponent,
} from "obsidian";
import NostrService from "./service/NostrService";
import NostrWriterPlugin from "../main";
import { extractFrontmatterTags, extractBodyHashtags, parseTagInput, normalizeTags } from "./utils/TagExtractor";
import { extractSlug, slugify, validateSlug } from "./utils/SlugUtil";
import DryRunPreviewModal from "./DryRunPreviewModal";

export default class ConfirmPublishModal extends Modal {
	plugin: NostrWriterPlugin;

	constructor(
		app: App,
		private nostrService: NostrService,
		private file: TFile,
		plugin: NostrWriterPlugin
	) {
		super(app);
		this.plugin = plugin;
	}

	async onOpen() {
		let { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("publish-modal-content");

		const frontmatter = this.app.metadataCache.getFileCache(this.file)?.frontmatter;

		if (this.file.extension !== "md") {
			new Notice("❌ Only markdown files can be published.");
			this.close();
			return;
		}

		const frontmatterRegex = /^---\s*[\s\S]*?\s*---\s*/;
		const fullFileContent = await this.app.vault.read(this.file);
		const content = fullFileContent.replace(frontmatterRegex, "").trim();

		const noteWordCount = content.split(/\s+/).filter(Boolean).length;

		// Extract tags safely using TagExtractor
		const frontmatterTags = extractFrontmatterTags(frontmatter);
		const bodyHashtags = extractBodyHashtags(content);
		let noteCategoryTags: string[] = normalizeTags([...frontmatterTags, ...bodyHashtags]);

		const initialTitle = frontmatter?.title || this.file.basename;
		const initialSummary = frontmatter?.summary || "";
		let initialSlug = extractSlug(frontmatter, initialTitle);

		contentEl.createEl("h2", { text: `Publish to Nostr` });
		const titleContainer = contentEl.createEl("div");
		titleContainer.addClass("publish-title-container");
		titleContainer.createEl("p", { text: `${noteWordCount} words` });

		// Title Section
		contentEl.createEl("h6", { text: `Title` });
		let titleText = new TextComponent(contentEl)
			.setPlaceholder(initialTitle)
			.setValue(initialTitle);
		titleText.inputEl.setCssStyles({
			width: "100%",
			marginBottom: "10px",
		});

		// Slug Section (Mandatory d-tag)
		contentEl.createEl("h6", { text: `Slug (Identifier)` });
		const slugContainer = contentEl.createEl("div");
		slugContainer.addClass("publish-title-container");
		slugContainer.createEl("p", {
			text: `Unique identifier used by Nostr clients for this article URL. Letters, numbers, hyphens, and underscores only.`,
		});

		let isSlugManuallyEdited = false;
		let slugText = new TextComponent(contentEl)
			.setPlaceholder("my-article-slug")
			.setValue(initialSlug);
		slugText.inputEl.setCssStyles({
			width: "100%",
			marginBottom: "5px",
		});

		const slugErrorEl = contentEl.createEl("div");
		slugErrorEl.setCssStyles({
			color: "var(--text-error, #e53935)",
			fontSize: "12px",
			marginBottom: "10px",
			display: "none",
		});

		// Auto-sync slug from title if user has not manually edited slug
		titleText.onChange((newTitle) => {
			if (!isSlugManuallyEdited) {
				const autoSlug = slugify(newTitle);
				slugText.setValue(autoSlug);
				updateSlugValidation();
			}
		});

		slugText.inputEl.addEventListener("input", () => {
			isSlugManuallyEdited = true;
			updateSlugValidation();
		});

		// Tags Section
		contentEl.createEl("h6", { text: `Tags` });
		const tagContainer = contentEl.createEl("div");
		tagContainer.addClass("publish-title-container");
		tagContainer.createEl("p", {
			text: `Tags from frontmatter and body (#tag) are listed below. Type tags (comma-separated) and press Enter to add. Click X to remove.`,
		});

		let tagsText = new TextComponent(contentEl).setPlaceholder(
			`Add tags here (e.g. tech, nostr, obsidian) and press Enter`
		);

		const pillsContainer = contentEl.createEl("div");
		pillsContainer.addClass("pills-container");

		function renderPills() {
			pillsContainer.empty();
			noteCategoryTags.forEach((tag) => {
				const pillElement = createPillElement(tag);
				pillsContainer.appendChild(pillElement);
			});
		}

		function addTagsFromInput(inputVal: string) {
			if (!inputVal || inputVal.trim() === "") return;
			const parsed = parseTagInput(inputVal);
			let addedCount = 0;
			for (const tag of parsed) {
				if (!noteCategoryTags.includes(tag)) {
					noteCategoryTags.push(tag);
					addedCount++;
				}
			}
			if (addedCount > 0) {
				renderPills();
			}
			tagsText.setValue("");
		}

		tagsText.inputEl.addEventListener("keydown", (event) => {
			if (event.key === "Enter") {
				event.preventDefault();
				addTagsFromInput(tagsText.getValue());
			}
		});

		tagsText.inputEl.setCssStyles({
			width: "100%",
			marginBottom: "10px",
		});
		tagsText.inputEl.addClass("features");

		renderPills();

		// Summary Section
		contentEl.createEl("h6", { text: `Summary` });
		let summaryText = new TextAreaComponent(contentEl)
			.setPlaceholder("Optional brief summary of your article...")
			.setValue(initialSummary);
		summaryText.inputEl.setCssStyles({
			width: "100%",
			height: "75px",
			marginBottom: "10px",
		});
		summaryText.inputEl.classList.add("publish-modal-input");

		// Banner Image Section
		let selectedBannerImage: any | null = null;

		new Setting(contentEl)
			.setName("Upload Banner Image")
			.setDesc("Optional image to be shown alongside your article's title.")
			.addButton((button) =>
				button
					.setButtonText("Upload")
					.setIcon("upload")
					.setTooltip("Upload an image file for your article banner.")
					.onClick(async () => {
						const input = document.createElement("input");
						input.type = "file";
						input.multiple = false;
						input.click();

						input.addEventListener("change", async () => {
							if (input.files !== null && input.files.length > 0) {
								const file = input.files[0];
								if (file) {
									if (!file.type.startsWith("image/")) {
										new Notice("❌ Invalid file type. Please upload an image.");
										return;
									}

									let maxSizeInBytes = 100 * 1024 * 1024; // 100 MB
									if (file.size > maxSizeInBytes) {
										new Notice("❌ File size exceeds 100 MB limit. Please upload a smaller image.");
										return;
									}
									selectedBannerImage = file;

									imagePreview.src = URL.createObjectURL(selectedBannerImage);
									imagePreview.style.display = "block";
									clearImageButton.style.display = "inline-block";
									imageNameDiv.textContent = selectedBannerImage.name;
									imageNameDiv.style.display = "block";
									new Notice(`✅ Selected banner image: ${file.name}`);
								}
							} else {
								new Notice(`❗️ No file selected.`);
							}
						});
					})
			);

		let imagePreview = contentEl.createEl("img");
		imagePreview.setCssStyles({
			maxWidth: "100%",
			display: "none",
			marginBottom: "5px",
			borderRadius: "4px",
		});

		const imageNameDiv = contentEl.createEl("div");
		imageNameDiv.setCssStyles({
			display: "none",
			fontSize: "12px",
			color: "var(--text-muted)",
			marginBottom: "5px",
		});

		const clearImageButton = contentEl.createEl("div");
		clearImageButton.setCssStyles({
			display: "none",
			background: "none",
			border: "none",
			cursor: "pointer",
			fontSize: "14px",
			color: "var(--text-error, red)",
			marginBottom: "10px",
		});
		clearImageButton.textContent = "❌ Remove image";

		function clearSelectedImage() {
			selectedBannerImage = null;
			imagePreview.src = "";
			imagePreview.style.display = "none";
			imageNameDiv.textContent = "";
			imageNameDiv.style.display = "none";
			clearImageButton.style.display = "none";
		}
		clearImageButton.addEventListener("click", clearSelectedImage);

		// Profile & Draft Settings
		let selectedProfileKey = "default";
		if (this.plugin.settings.profiles.length > 0 && this.plugin.settings.multipleProfilesEnabled) {
			new Setting(contentEl)
				.setName("Select Profile")
				.setDesc("Select a profile to publish this note from.")
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

		let publishAsDraft = false;
		new Setting(contentEl)
			.setName("Publish as a draft")
			.setDesc("Draft notes (Kind 30024) can be edited in compatible Nostr clients.")
			.addToggle((toggle) =>
				toggle.setValue(false).onChange(async (value) => {
					publishAsDraft = value;
					if (publishAsDraft) {
						new Notice(`🗒️ Publishing as draft (Kind 30024).`);
					} else {
						new Notice(`📜 Publishing as final (Kind 30023).`);
					}
				})
			);

		// ==========================================
		// Collapsible "Publish Targets & Relays" Section
		// ==========================================
		const configuredRelays = this.nostrService.getAllConfiguredRelayUrls();
		const selectedRelays = new Set<string>(configuredRelays);
		const providers = this.plugin.settings.imageStorageProviders && this.plugin.settings.imageStorageProviders.length > 0
			? this.plugin.settings.imageStorageProviders
			: ["https://blossom.primal.net", "https://blossom.damus.io"];
		let selectedStorageProvider = this.plugin.settings.selectedImageStorageProvider || providers[0];
		if (!providers.includes(selectedStorageProvider)) {
			selectedStorageProvider = providers[0];
		}

		// Publish targets (relays, media server) are advanced options, only shown in developer mode.
		if (this.plugin.settings.developerMode) {
			const targetsSection = contentEl.createEl("details", { cls: "nostr-collapsible-section" });
			targetsSection.open = false;

			const targetsSummary = targetsSection.createEl("summary", { cls: "nostr-section-summary" });
			function updateSummaryLabel() {
				targetsSummary.setText(`⚙️ Publish Targets & Relays (${selectedRelays.size}/${configuredRelays.length} active)`);
			}
			updateSummaryLabel();

			const targetsContent = targetsSection.createEl("div", { cls: "nostr-section-content" });

			// Media Server Picker
			new Setting(targetsContent)
				.setName("Media / Blossom Server")
				.setDesc("Active media host for article banner & images.")
				.addDropdown((dropdown) => {
					for (const p of providers) {
						dropdown.addOption(p, p);
					}
					dropdown.setValue(selectedStorageProvider);
					dropdown.onChange((val) => {
						selectedStorageProvider = val;
					});
				});

			// Relay Toggle Toolbar
			const relayToolbar = targetsContent.createEl("div", { cls: "nostr-relay-toolbar" });
			relayToolbar.createEl("span", { text: "Relays for this post:" });

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
				chk.addEventListener("change", () => {
					if (chk.checked) {
						selectedRelays.add(rUrl);
					} else {
						selectedRelays.delete(rUrl);
					}
					updateSummaryLabel();
				});
				relayCheckboxes.push({ url: rUrl, checkbox: chk });

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

		// Validation helper
		function updateSlugValidation(): boolean {
			const slugVal = slugText.getValue().trim();
			const validation = validateSlug(slugVal);
			if (!validation.isValid) {
				slugErrorEl.setText(`⚠️ ${validation.error || "Slug is required."}`);
				slugErrorEl.style.display = "block";
				publishButton.setDisabled(true);
				previewButton.setDisabled(true);
				return false;
			} else {
				slugErrorEl.setText("");
				slugErrorEl.style.display = "none";
				publishButton.setDisabled(false);
				previewButton.setDisabled(false);
				return true;
			}
		}

		// Core publish function (shared by Confirm and Dry-Run modal)
		const doPublish = async () => {
			const currentSlug = slugText.getValue().trim();
			const validation = validateSlug(currentSlug);
			if (!validation.isValid) {
				new Notice(`❌ ${validation.error || "A valid slug is required."}`);
				updateSlugValidation();
				return;
			}

			if (selectedRelays.size === 0) {
				new Notice("❌ No target relays selected. Please enable at least one relay.");
				return;
			}

			publishButton.setButtonText("Publishing...").setDisabled(true);
			previewButton.setDisabled(true);

			try {
				const fileContent = content;
				const title = titleText.getValue();
				const summary = summaryText.getValue();
				const targetRelaysArray = Array.from(selectedRelays);

				const res = await this.nostrService.publishNote(
					fileContent,
					this.file,
					summary,
					selectedBannerImage && selectedBannerImage.path ? selectedBannerImage.path : null,
					title,
					noteCategoryTags,
					selectedProfileKey,
					publishAsDraft,
					currentSlug,
					targetRelaysArray,
					selectedStorageProvider
				);

				if (res.success) {
					new Notice(`✅ Successfully published note to Nostr!`);
					for (let relay of res.publishedRelays) {
						new Notice(`✅ - Sent to ${relay}`);
					}
					this.close();
				} else {
					new Notice(`❌ Failed to publish note to Nostr.`);
				}
			} catch (error: any) {
				console.error("Publishing error:", error);
				new Notice(`❌ Error publishing note: ${error.message || error}`);
			} finally {
				publishButton.setButtonText("Confirm and Publish").setDisabled(false);
				previewButton.setDisabled(false);
			}
		};

		// Button Bar Layout
		const buttonContainer = contentEl.createEl("div", { cls: "nostr-publish-btn-container" });

		const previewButton = new ButtonComponent(buttonContainer)
			.setButtonText("🔍 Preview / Dry Run")
			.onClick(() => {
				const currentSlug = slugText.getValue().trim();
				const validation = validateSlug(currentSlug);
				if (!validation.isValid) {
					new Notice(`❌ ${validation.error || "A valid slug is required for preview."}`);
					updateSlugValidation();
					return;
				}

				new DryRunPreviewModal(this.app, this.plugin, {
					file: this.file,
					title: titleText.getValue() || this.file.basename,
					slug: currentSlug,
					summary: summaryText.getValue(),
					content: content,
					tags: noteCategoryTags,
					publishAsDraft: publishAsDraft,
					selectedProfileKey: selectedProfileKey,
					targetRelays: Array.from(selectedRelays),
					selectedStorageProvider: selectedStorageProvider,
					bannerImageUrl: selectedBannerImage ? selectedBannerImage.name : null,
					onBroadcast: doPublish,
				}).open();
			});

		// Dry run is a developer tool, only shown in developer mode.
		if (!this.plugin.settings.developerMode) {
			previewButton.buttonEl.hide();
		}

		const publishButton = new ButtonComponent(buttonContainer)
			.setButtonText("Confirm and Publish")
			.setCta()
			.onClick(async () => {
				if (
					confirm(
						`Are you sure you want to publish this note ${
							publishAsDraft ? "as a draft" : "publicly"
						} to Nostr?`
					)
				) {
					await doPublish();
				}
			});

		// Initial slug validation
		updateSlugValidation();

		function createPillElement(tag: string) {
			const pillElement = document.createElement("div");
			pillElement.className = "pill";
			pillElement.textContent = tag;

			const deleteButton = document.createElement("div");
			deleteButton.className = "delete-button";
			deleteButton.textContent = "x";

			deleteButton.addEventListener("click", () => {
				noteCategoryTags = noteCategoryTags.filter((t) => t !== tag);
				pillElement.remove();
			});

			pillElement.appendChild(deleteButton);
			return pillElement;
		}
	}
}


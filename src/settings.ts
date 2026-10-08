import {
	App,
	Notice,
	PluginSettingTab,
	Setting,
	TextComponent,
	DropdownComponent,
} from "obsidian";
import NostrWriterPlugin from "../main";
import { SignerType, SignerFactory } from "./signer";
import { validateRelayUrl } from "./utils/RelayUtil";
import { normalizeServerUrl } from "./utils/BlossomUtil";
import { Logger } from "./utils/Logger";
import { getPublicKey, generateSecretKey } from "nostr-tools/pure";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { nip19 } from "nostr-tools";

export interface Profile {
	profileNickname: string;
	signerType: SignerType;
	signerTarget: string;
	profilePrivateKey?: string; // Legacy support
}

export interface NostrWriterPluginSettings {
	signerType: SignerType;
	signerTarget: string;
	privateKey: string; // Legacy support
	bunkerClientSecretKey?: string;
	shortFormEnabled: boolean;
	statusBarEnabled: boolean;
	relayConfigEnabled: boolean;
	relayURLs: string[];
	multipleProfilesEnabled: boolean;
	profiles: Profile[];
	imageStorageProviders: string[];
	selectedImageStorageProvider: string;
	premiumStorageEnabled: boolean;
	developerMode: boolean;
}

export class NostrWriterSettingTab extends PluginSettingTab {
	plugin: NostrWriterPlugin;
	private refreshDisplay: () => void;
	private relayUrlInput: TextComponent;
	private newBlossomServerInput: TextComponent;

	constructor(app: App, plugin: NostrWriterPlugin) {
		super(app, plugin);
		this.plugin = plugin;
		this.refreshDisplay = () => this.display();
	}

	display(): void {
		let { containerEl } = this;
		containerEl.empty();

		// Primary Profile / Signer Configuration
		containerEl.createEl("h4", { text: "Default Publishing Identity" });

		let signerType: SignerType = this.plugin.settings.signerType || "nsec";
		let signerTargetInput: TextComponent;
		let signerTargetField: HTMLInputElement;

		new Setting(containerEl)
			.setName("Signer Type")
			.setDesc("Choose between local nsec private key or remote NIP-46 Bunker signer.")
			.addDropdown((dropdown: DropdownComponent) => {
				dropdown
					.addOption("nsec", "Local nsec key")
					.addOption("bunker", "Remote Bunker (NIP-46)")
					.setValue(signerType)
					.onChange(async (value: string) => {
						signerType = value as SignerType;
						this.plugin.settings.signerType = signerType;
						await this.plugin.saveSettings();
						this.refreshDisplay();
					});
			});

		const isNsec = signerType === "nsec";

		new Setting(containerEl)
			.setName(isNsec ? "Nostr Private Key" : "Bunker Connection URI")
			.setDesc(
				isNsec
					? "Enter your nsec1... or 64-character hex private key."
					: "Paste the bunker:// connection URL from your signer app (Amber, nsec.app, ...), then press Connect. See the README for how to get it."
			)
			.addText((text) => {
				signerTargetInput = text;
				const currentVal = this.plugin.settings.signerTarget || this.plugin.settings.privateKey || "";
				text
					.setPlaceholder(isNsec ? "nsec1..." : "bunker://<pubkey>?relay=wss://...&secret=...")
					.setValue(currentVal)
					.onChange(async (value) => {
						// Remote signers need a network lookup, so they are saved with the Connect button.
						if (!isNsec) return;
						const trimmed = value.trim();
						if (await SignerFactory.isValidSignerConfig(signerType, trimmed)) {
							this.plugin.settings.signerTarget = trimmed;
							this.plugin.settings.privateKey = trimmed;
							await this.plugin.saveSettings();
							await this.plugin.startupNostrService();
							new Notice("Private key saved!");
						} else {
							new Notice("Invalid private key (expected nsec1...)", 5000);
						}
					});

				signerTargetField = text.inputEl;
				signerTargetField.type = isNsec ? "password" : "text";
				signerTargetField.style.width = "400px";
			})
			.addButton((button) => {
				if (isNsec) {
					button.buttonEl.hide();
					return;
				}
				button
					.setButtonText("Connect")
					.setCta()
					.setTooltip("Check and save this remote signer connection")
					.onClick(async () => {
						const trimmed = (signerTargetField?.value || "").trim();
						if (!trimmed) {
							new Notice("❌ Paste a bunker:// connection URL first.", 6000);
							return;
						}
						button.setDisabled(true).setButtonText("Checking...");
						try {
							if (await SignerFactory.isValidSignerConfig("bunker", trimmed)) {
								this.plugin.settings.signerTarget = trimmed;
								await this.plugin.saveSettings();
								await this.plugin.startupNostrService();
								new Notice("✅ Bunker connection saved. Approve the request in your signer app if prompted.", 6000);
							} else if (trimmed.includes("@") && !trimmed.includes("://")) {
								new Notice(
									`❌ '${trimmed}' is a normal NIP-05 address, not a signer connection. Copy the bunker:// URL from your signer app instead.`,
									10000
								);
							} else {
								new Notice("❌ Invalid connection. It should look like bunker://<pubkey>?relay=wss://...", 8000);
							}
						} finally {
							button.setDisabled(false).setButtonText("Connect");
						}
					});
			})
			.addButton((button) =>
				button
					.setTooltip(isNsec ? "Copy private key" : "Copy Bunker URI")
					.setIcon("copy")
					.onClick(() => {
						if (signerTargetField && signerTargetField.value) {
							navigator.clipboard.writeText(signerTargetField.value);
							new Notice(isNsec ? "Private Key Copied - Be Careful 🔐" : "Bunker URI Copied 📋");
						}
					})
			)
			.addButton((button) =>
				button
					.setButtonText("Delete")
					.setWarning()
					.setTooltip("Delete this signer configuration")
					.onClick(async () => {
						if (
							confirm(
								`Are you sure you want to delete your default ${isNsec ? "private key" : "bunker configuration"}? This cannot be undone.`
							)
						) {
							this.plugin.settings.signerTarget = "";
							this.plugin.settings.privateKey = "";
							await this.plugin.saveSettings();
							signerTargetInput.setValue("");
							await this.plugin.startupNostrService();
							new Notice("Signer configuration deleted! 🗑");
						}
					})
			);

		if (isNsec) {
			new Setting(containerEl)
				.setName("Show private key")
				.setDesc("Toggle to show/hide the private key.")
				.addToggle((toggle) =>
					toggle.setValue(false).onChange((value) => {
						if (signerTargetField) {
							signerTargetField.type = value ? "text" : "password";
						}
					})
				);
		} else {
			// Bunker mode: display the persistent client identity
			let clientPkHex = "";
			let clientNpub = "";
			try {
				if (this.plugin.settings.bunkerClientSecretKey) {
					const sk = hexToBytes(this.plugin.settings.bunkerClientSecretKey);
					clientPkHex = getPublicKey(sk);
					clientNpub = nip19.npubEncode(clientPkHex);
				}
			} catch (_) {}

			if (clientNpub) {
				new Setting(containerEl)
					.setName("Client Identity (App Pubkey)")
					.setDesc(`Your plugin client ID in Amber / Bunker: ${clientNpub.substring(0, 16)}...${clientNpub.substring(clientNpub.length - 8)}`)
					.addButton((btn) =>
						btn
							.setButtonText("Copy npub")
							.setTooltip("Copy client npub to clipboard")
							.onClick(() => {
								navigator.clipboard.writeText(clientNpub);
								new Notice("Client npub copied! 📋");
							})
					)
					.addButton((btn) =>
						btn
							.setButtonText("Reset Session Key")
							.setWarning()
							.setTooltip("Generate a new local client keypair for Bunker pairing")
							.onClick(async () => {
								if (confirm("Reset local Bunker client keypair? You will need to re-approve the connection in Amber / your Bunker provider.")) {
									this.plugin.settings.bunkerClientSecretKey = bytesToHex(generateSecretKey());
									await this.plugin.saveSettings();
									await this.plugin.startupNostrService();
									this.refreshDisplay();
									new Notice("New Bunker client session generated! 🔄");
								}
							})
					);
			}
		}

		// ==========================================
		// Blossom Media Servers (BUD-01/02)
		// ==========================================
		containerEl.createEl("h4", { text: "Blossom Media Servers" });

		const blossomProviders = this.plugin.settings.imageStorageProviders && this.plugin.settings.imageStorageProviders.length > 0
			? this.plugin.settings.imageStorageProviders
			: ["https://blossom.primal.net", "https://blossom.damus.io"];

		let activeBlossomServer = this.plugin.settings.selectedImageStorageProvider || blossomProviders[0];
		if (!blossomProviders.includes(activeBlossomServer)) {
			activeBlossomServer = blossomProviders[0];
		}

		new Setting(containerEl)
			.setName("Default Blossom Media Server")
			.setDesc("Choose the default Blossom server for hosting article banner and inline images (BUD-01/02).")
			.addDropdown((dropdown) => {
				for (const p of blossomProviders) {
					dropdown.addOption(p, p);
				}
				dropdown.setValue(activeBlossomServer);
				dropdown.onChange(async (val) => {
					this.plugin.settings.selectedImageStorageProvider = val;
					await this.plugin.saveSettings();
					new Notice(`🌸 Default Blossom server set to: ${val}`);
				});
			});

		// Add Blossom Server input
		new Setting(containerEl)
			.setName("Add Blossom Server")
			.setDesc("Add a custom Blossom media server URL (e.g. https://blossom.damus.io)")
			.addText((text) => {
				this.newBlossomServerInput = text;
				text.setPlaceholder("https://blossom.example.com");
			})
			.addButton((btn) => {
				btn.setIcon("plus");
				btn.setCta();
				btn.setTooltip("Add Blossom Server");
				btn.onClick(async () => {
					const inputVal = this.newBlossomServerInput?.getValue()?.trim();
					if (!inputVal) {
						new Notice("❌ Please enter a valid Blossom server URL.");
						return;
					}
					const normalized = normalizeServerUrl(inputVal);
					if (!this.plugin.settings.imageStorageProviders.includes(normalized)) {
						this.plugin.settings.imageStorageProviders.push(normalized);
						await this.plugin.saveSettings();
						new Notice(`✅ Added Blossom server: ${normalized}`);
						this.refreshDisplay();
					} else {
						new Notice("⚠️ Server is already configured.");
					}
				});
			});

		// Blossom servers list
		for (const [idx, server] of blossomProviders.entries()) {
			new Setting(containerEl)
				.setName(`🌸 ${server}`)
				.addButton((btn) => {
					btn.setIcon("trash");
					btn.setTooltip("Remove this Blossom server");
					btn.onClick(async () => {
						if (this.plugin.settings.imageStorageProviders.length <= 1) {
							new Notice("❌ You must have at least one Blossom server configured.");
							return;
						}
						this.plugin.settings.imageStorageProviders.splice(idx, 1);
						if (this.plugin.settings.selectedImageStorageProvider === server) {
							this.plugin.settings.selectedImageStorageProvider = this.plugin.settings.imageStorageProviders[0];
						}
						await this.plugin.saveSettings();
						this.refreshDisplay();
						new Notice("🗑️ Blossom server removed.");
					});
				});
		}

		containerEl.createEl("br");

		// Multi-Profile Support
		new Setting(containerEl)
			.setName("Enable multiple Nostr profiles")
			.setDesc("Enable & add multiple Nostr profiles (nsec or Bunker) to publish from.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.multipleProfilesEnabled)
					.onChange(async (value) => {
						this.plugin.settings.multipleProfilesEnabled = value;
						await this.plugin.saveSettings();
						this.refreshDisplay();
					})
			);

		if (this.plugin.settings.multipleProfilesEnabled) {
			let newProfileNicknameField = "";
			let newProfileTypeField: SignerType = "nsec";
			let newProfileTargetField = "";
			let newProfileTargetInputEl: HTMLInputElement;

			containerEl.createEl("h5", { text: "Additional Nostr Profiles" });

			new Setting(this.containerEl)
				.setName("Add Profile")
				.setDesc("Configure an additional local key or remote Bunker profile.")
				.addText((nicknameInput) => {
					nicknameInput.setPlaceholder("Profile Nickname");
					nicknameInput.onChange((value) => {
						if (value.toLowerCase() !== "default") {
							newProfileNicknameField = value.trim();
						} else {
							new Notice("❌ Cannot name an additional profile 'default'");
						}
					});
				})
				.addDropdown((dropdown) => {
					dropdown
						.addOption("nsec", "nsec")
						.addOption("bunker", "Bunker")
						.setValue("nsec")
						.onChange((val) => {
							newProfileTypeField = val as SignerType;
							if (newProfileTargetInputEl) {
								newProfileTargetInputEl.placeholder = newProfileTypeField === "nsec" ? "nsec1..." : "bunker://...";
								newProfileTargetInputEl.type = newProfileTypeField === "nsec" ? "password" : "text";
							}
						});
				})
				.addText((targetInput) => {
					targetInput.setPlaceholder("nsec1...");
					targetInput.onChange((value) => {
						newProfileTargetField = value.trim();
					});
					newProfileTargetInputEl = targetInput.inputEl;
					newProfileTargetInputEl.type = "password";
					newProfileTargetInputEl.style.width = "220px";
				})
				.addButton((btn) => {
					btn.setIcon("plus");
					btn.setCta();
					btn.setTooltip("Add this profile");
					btn.onClick(async () => {
						if (!newProfileNicknameField || !this.isValidNickname(newProfileNicknameField)) {
							new Notice("❌ Invalid nickname or already in use.");
							return;
						}

						const isValid = await SignerFactory.isValidSignerConfig(newProfileTypeField, newProfileTargetField);
						if (!isValid) {
							new Notice(newProfileTypeField === "nsec" ? "❌ Invalid nsec private key" : "❌ Invalid Bunker URI", 5000);
							return;
						}

						this.plugin.settings.profiles.push({
							profileNickname: newProfileNicknameField,
							signerType: newProfileTypeField,
							signerTarget: newProfileTargetField,
							profilePrivateKey: newProfileTypeField === "nsec" ? newProfileTargetField : undefined,
						});

						await this.plugin.saveSettings();
						this.refreshDisplay();
						await this.plugin.nostrService.reloadMultipleAccounts();
						new Notice(`✅ Profile '${newProfileNicknameField}' added!`);
					});
				});

			for (const [i, profile] of this.plugin.settings.profiles.entries()) {
				const pType = profile.signerType || "nsec";
				new Setting(this.containerEl)
					.setName(`👤 ${profile.profileNickname} (${pType.toUpperCase()})`)
					.addButton((btn) => {
						btn.setIcon("trash");
						btn.setWarning();
						btn.setTooltip("Remove this profile");
						btn.onClick(async () => {
							if (
								confirm(
									`Are you sure you want to delete profile '${profile.profileNickname}'? This cannot be undone.`
								)
							) {
								this.plugin.settings.profiles.splice(i, 1);
								await this.plugin.saveSettings();
								this.refreshDisplay();
								await this.plugin.nostrService.reloadMultipleAccounts();
								new Notice("🗑️ Profile successfully deleted.");
							}
						});
					});
			}
			containerEl.createEl("br");
		}

		new Setting(containerEl)
			.setName("Clear local published history")
			.setDesc("This does not delete your notes from the Nostr network.")
			.addButton((button) =>
				button
					.setButtonText("Clear")
					.setIcon("trash")
					.setTooltip("Delete the local published history")
					.onClick(async () => {
						if (
							confirm(
								"Are you sure you want to delete your local history? This cannot be undone."
							)
						) {
							await this.clearLocalPublishedFile();
							new Notice("🗑️ Published History deleted!");
						}
					})
			);

		new Setting(containerEl)
			.setName("Short form mode")
			.setDesc("Add short form writing button to your menu.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.shortFormEnabled)
					.onChange(async (value) => {
						this.plugin.settings.shortFormEnabled = value;
						await this.plugin.saveSettings();
						this.plugin.updateRibbonIcon();
						new Notice(
							`✅ Short form mode ${value ? "enabled" : "disabled"}`
						);
					})
			);

		// ==========================================
		// Relay Management
		// ==========================================
		new Setting(containerEl)
			.setName("Configure relays")
			.setDesc("Edit the default relay configuration & see details.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.relayConfigEnabled)
					.onChange(async (value) => {
						this.plugin.settings.relayConfigEnabled = value;
						await this.plugin.saveSettings();
						this.refreshDisplay();
					})
			);

		if (this.plugin.settings.relayConfigEnabled) {
			containerEl.createEl("h5", { text: "Relay Configuration" });
			new Setting(this.containerEl)
				.setDesc("Add a relay URL (e.g. wss://relay.damus.io)")
				.setName("Add Relay")
				.addText((relayUrlInput) => {
					this.relayUrlInput = relayUrlInput;
					relayUrlInput.setPlaceholder("wss://fav.relay.com");
				})
				.addButton((btn) => {
					btn.setIcon("plus");
					btn.setCta();
					btn.setTooltip("Add this relay");
					btn.onClick(async () => {
						try {
							const rawUrl = this.relayUrlInput?.getValue()?.trim();
							const validation = validateRelayUrl(rawUrl);
							if (validation.isValid && validation.normalizedUrl) {
								const cleanUrl = validation.normalizedUrl;
								if (!this.plugin.settings.relayURLs.includes(cleanUrl)) {
									this.plugin.settings.relayURLs.push(cleanUrl);
									await this.plugin.saveSettings();
									this.plugin.nostrService.refreshRelayUrls();
									new Notice(`Added ${cleanUrl} to relay configuration.`);
									this.refreshDisplay();
									this.relayUrlInput.setValue("");
								} else {
									new Notice("⚠️ Relay already configured.");
								}
							} else {
								new Notice(`❌ ${validation.error || "Invalid relay URL"}`);
							}
						} catch {
							new Notice("❌ Error adding relay URL");
						}
					});
				});

			for (const [i, url] of this.plugin.settings.relayURLs.entries()) {
				new Setting(this.containerEl)
					.setName(`📡 Relay ${i + 1}`)
					.setDesc(url)
					.addButton((btn) => {
						btn.setIcon("trash");
						btn.setTooltip("Remove this relay");
						btn.onClick(async () => {
							if (
								confirm(
									`Are you sure you want to remove relay ${url}?`
								)
							) {
								this.plugin.settings.relayURLs.splice(i, 1);
								await this.plugin.saveSettings();
								this.plugin.nostrService.refreshRelayUrls();
								this.refreshDisplay();
								new Notice("Relay removed.");
							}
						});
					});
			}
		}

		// ==========================================
		// Debug Logs & Diagnostics
		// ==========================================
		containerEl.createEl("h4", { text: "Debug Logs & Diagnostics" });

		new Setting(containerEl)
			.setName("Developer mode")
			.setDesc("Show advanced options: target relay selection for short notes and the Preview / Dry Run button in publish dialogs.")
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.developerMode).onChange(async (value) => {
					this.plugin.settings.developerMode = value;
					await this.plugin.saveSettings();
				});
			});

		const logSetting = new Setting(this.containerEl)
			.setName("Diagnostic Logs")
			.setDesc("Inspect or copy recent activity, signer handshakes, and relay communication logs.")
			.addButton((btn) => {
				btn.setButtonText("📋 Copy Logs")
					.setTooltip("Copy formatted debug logs to clipboard")
					.onClick(() => {
						const logs = Logger.getFormattedLogs();
						navigator.clipboard.writeText(logs);
						new Notice("📋 Debug logs copied to clipboard!");
					});
			})
			.addButton((btn) => {
				btn.setButtonText("🗑 Clear Logs")
					.setTooltip("Clear in-memory diagnostic logs")
					.onClick(() => {
						Logger.clear();
						this.refreshDisplay();
						new Notice("🧹 Diagnostic logs cleared.");
					});
			});

		const logDetails = containerEl.createEl("details", { cls: "nostr-collapsible-section" });
		logDetails.open = false;
		const logSummary = logDetails.createEl("summary", { cls: "nostr-section-summary" });
		logSummary.setText("📜 View Live Diagnostic Logs");

		const logContainer = logDetails.createEl("div", { cls: "nostr-section-content" });
		const logArea = logContainer.createEl("textarea");
		logArea.value = Logger.getFormattedLogs();
		logArea.readOnly = true;
		logArea.setCssStyles({
			width: "100%",
			height: "180px",
			fontFamily: "monospace",
			fontSize: "11px",
			backgroundColor: "var(--background-secondary)",
			color: "var(--text-normal)",
			borderRadius: "4px",
			padding: "8px",
			border: "1px solid var(--background-modifier-border)",
			resize: "vertical",
		});

		containerEl.createEl("h5", { text: "Support" });
		new Setting(this.containerEl)
			.setDesc(
				"Has this plugin enhanced your workflow? Say thanks as a one-time payment and zap/buy me a coffee."
			)
			.addButton((bt) => {
				bt.setTooltip("Copy 20k sats lightning invoice")
					.setIcon("zap")
					.setCta()
					.onClick(() => {
						if (signerTargetField) {
							navigator.clipboard.writeText(
								"lnbc200u1pjvu03dpp5x20p0q5tdwylg5hsqw3av6qxufah0y64efldazmgad2rsffgda8qdpdfehhxarjypthy6t5v4ezqnmzwd5kg6tpdcs9qmr4va5kucqzzsxqyz5vqsp5w55p4tzawyfz5fasflmsvdfnnappd6hqnw9p7y2p0nl974f0mtkq9qyyssqq6gvpnvvuftqsdqyxzn9wrre3qfkpefzz6kqwssa3pz8l9mzczyq4u7qdc09jpatw9ekln9gh47vxrvx6zg6vlsqw7pq4a7kvj4ku4qpdrflwj"
							);
							new Notice("Lightning Invoice Address Copied!⚡️");
							setTimeout(() => {
								new Notice("Thank You 🤝");
							}, 500);
							setTimeout(() => {
								new Notice("Stay Humble ⚖️");
							}, 1000);
							setTimeout(() => {
								new Notice("Stack Sats ⚡️");
							}, 1500);
						}
					});
			})
			.addButton((button) => {
				button
					.setTooltip("Sponsor on GitHub")
					.setIcon("github")
					.onClick(() =>
						window.open(
							"https://github.com/sponsors/jamesmagoo",
							"_blank"
						)
					);
				button.buttonEl.style.height = "35px";
			})
			.addButton((bt) => {
				const anchor = document.createElement("a");
				anchor.href = "https://www.buymeacoffee.com/jamesmagoo";
				anchor.target = "_blank";

				const img = document.createElement("img");
				img.style.height = "35px";
				img.src =
					"https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png";
				img.alt = "Buy Me A Coffee";
				anchor.appendChild(img);
				bt.buttonEl.replaceWith(anchor);
			});
	}

	isValidNickname(nickname: string): boolean {
		let isValid = true;
		const profilesToCheck = this.plugin.settings.profiles;
		if (profilesToCheck && profilesToCheck.length > 0) {
			for (const profile of profilesToCheck) {
				if (profile.profileNickname === nickname) {
					isValid = false;
					break;
				}
			}
		}
		return isValid;
	}

	async clearLocalPublishedFile(): Promise<void> {
		const pathToPlugin = this.app.vault.configDir + "/plugins/nostr-writer";
		const publishedFilePath = `${pathToPlugin}/published.json`;
		try {
			await this.app.vault.adapter.remove(publishedFilePath);
		} catch (error) {
			console.log(error);
		}
	}
}

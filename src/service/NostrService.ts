import NostrWriterPlugin from "main";
import * as path from "path";
import { SimplePool } from "nostr-tools/pool";
import { Event, VerifiedEvent } from "nostr-tools/core";
import { App, Notice, TFile } from "obsidian";
import { NostrWriterPluginSettings, Profile } from "src/settings";
import ImageUploadService from "./ImageUploadService";
import { NostrSigner, SignerFactory, BunkerSigner } from "../signer";
import { EventBuilder } from "../builder";
import { validateSlug, extractSlug, sanitizeVaultFilename } from "../utils/SlugUtil";
import { sanitizeRelayList, normalizeRelayUrl, validateRelayUrl } from "../utils/RelayUtil";
import { buildImetaTag } from "../utils/BlossomUtil";
import { Logger } from "../utils/Logger";

import { hexToBytes, bytesToHex } from "@noble/hashes/utils";
import { generateSecretKey } from "nostr-tools/pure";

async function withTimeout<T>(promise: Promise<T>, ms: number, errorMsg: string): Promise<T> {
	let timer: any;
	const timeoutPromise = new Promise<T>((_, reject) => {
		timer = setTimeout(() => {
			reject(new Error(errorMsg));
		}, ms);
	});
	try {
		return await Promise.race([promise, timeoutPromise]);
	} finally {
		clearTimeout(timer);
	}
}

export default class NostrService {
	private defaultSigner: NostrSigner | null = null;
	private profileSigners: Map<string, NostrSigner> = new Map();
	private defaultPublicKey: string = "";
	private profiles: Profile[] = [];
	private multipleProfilesEnabled: boolean = false;
	private plugin: NostrWriterPlugin;
	private app: App;
	private relayURLs: string[] = [];
	private imageUploadService: ImageUploadService;

	public static readonly DEFAULT_RELAYS = [
		"wss://nos.lol",
		"wss://relay.damus.io",
		"wss://relay.nostr.band",
		"wss://relayable.org",
		"wss://nostr.rocks",
		"wss://nostr.fmt.wiz.biz",
	];

	constructor(
		plugin: NostrWriterPlugin,
		app: App,
		settings: NostrWriterPluginSettings
	) {
		this.plugin = plugin;
		this.app = app;
		this.imageUploadService = new ImageUploadService(this.plugin, this.app, settings);
		this.relayURLs = [];

		if (settings.multipleProfilesEnabled && settings.profiles) {
			this.profiles = settings.profiles;
			this.multipleProfilesEnabled = true;
		}

		this.initSigners(settings).catch((err) => {
			Logger.error("Failed to initialize signers:", err);
		});

		this.refreshRelayUrls();
	}

	public async initSigners(settings: NostrWriterPluginSettings): Promise<void> {
		this.profileSigners.clear();

		let clientSecretBytes: Uint8Array | undefined;
		if (settings.bunkerClientSecretKey && /^[0-9a-fA-F]{64}$/.test(settings.bunkerClientSecretKey)) {
			try {
				clientSecretBytes = hexToBytes(settings.bunkerClientSecretKey);
			} catch (_) {}
		}

		const defaultTarget = settings.signerTarget || settings.privateKey;
		if (defaultTarget) {
			try {
				this.defaultSigner = await SignerFactory.createSigner({
					type: settings.signerType || "nsec",
					target: defaultTarget,
					clientSecretKey: clientSecretBytes,
				});
				this.defaultPublicKey = await this.defaultSigner.getPublicKey();
				Logger.info(`[NostrService] Initialized default ${settings.signerType || "nsec"} signer (Pubkey: ${this.defaultPublicKey})`);
			} catch (e) {
				Logger.error("Failed to initialize default Nostr signer:", e);
				this.defaultSigner = null;
				this.defaultPublicKey = "";
			}
		}

		if (settings.multipleProfilesEnabled && settings.profiles) {
			for (const profile of settings.profiles) {
				const pTarget = profile.signerTarget || profile.profilePrivateKey;
				if (pTarget) {
					try {
						const signer = await SignerFactory.createSigner({
							type: profile.signerType || "nsec",
							target: pTarget,
							clientSecretKey: clientSecretBytes,
						});
						this.profileSigners.set(profile.profileNickname, signer);
					} catch (e) {
						Logger.error(`Failed to initialize signer for profile '${profile.profileNickname}':`, e);
					}
				}
			}
		}
	}

	public async reloadMultipleAccounts(): Promise<void> {
		this.profiles = this.plugin.settings.profiles || [];
		this.multipleProfilesEnabled = this.plugin.settings.multipleProfilesEnabled;
		await this.initSigners(this.plugin.settings);
	}

	public async getSigner(profileNickname?: string): Promise<NostrSigner | null> {
		if (profileNickname && profileNickname !== "default" && this.multipleProfilesEnabled) {
			const signer = this.profileSigners.get(profileNickname);
			if (signer) return signer;
		}
		return this.defaultSigner;
	}

	public async getPublicKey(profileNickname?: string): Promise<string> {
		const signer = await this.getSigner(profileNickname);
		if (signer) {
			try {
				return await signer.getPublicKey();
			} catch (e) {
				Logger.error("Failed to get public key from signer:", e);
			}
		}
		return this.defaultPublicKey;
	}

	public hasSignerConfigured(): boolean {
		return !!(this.plugin.settings.signerTarget || this.plugin.settings.privateKey);
	}

	public refreshRelayUrls(): void {
		const rawRelays = (!this.plugin.settings.relayURLs || this.plugin.settings.relayURLs.length === 0)
			? NostrService.DEFAULT_RELAYS
			: this.plugin.settings.relayURLs;
		this.relayURLs = sanitizeRelayList(rawRelays);
	}

	public getRelayInfo(relayUrl: string): boolean {
		const normalized = normalizeRelayUrl(relayUrl);
		return normalized !== null;
	}

	public getConnectionStatus(): boolean {
		return this.hasSignerConfigured();
	}

	public getConnectedRelayUrls(): string[] {
		return [...this.relayURLs];
	}

	public getAllConfiguredRelayUrls(): string[] {
		return [...this.relayURLs];
	}

	async publishShortFormNote(
		message: string,
		profileNickname: string,
		targetRelays?: string[]
	): Promise<{ success: boolean; publishedRelays: string[] }> {
		Logger.info(`[NostrService] Sending short form note to Nostr...`);
		if (!message || message.trim() === "") {
			Logger.error("[NostrService] No message to publish");
			return { success: false, publishedRelays: [] };
		}

		const signer = await this.getSigner(profileNickname);
		if (!signer) {
			new Notice("❌ No signer configured for publishing.");
			return { success: false, publishedRelays: [] };
		}

		try {
			const eventTemplate = EventBuilder.buildShortNoteEvent({
				content: message,
			});

			new Notice("⏳ [1/2] Signing short note with signer...");
			Logger.info(`[NostrService] Requesting signature from ${signer.getType()} signer...`);
			const signedEvent = await signer.signEvent(eventTemplate);
			Logger.info(`[NostrService] Short note signed (ID: ${signedEvent.id})`);

			return await this.publishToRelays(signedEvent, "", profileNickname, targetRelays);
		} catch (error: any) {
			Logger.error("Failed to sign or publish short note:", error);
			new Notice(`❌ Signing or publishing error: ${error.message || error}`, 10000);
			return { success: false, publishedRelays: [] };
		}
	}

	async publishNote(
		fileContent: string,
		activeFile: TFile,
		summary: string,
		imageBannerFilePath: string | null,
		title: string,
		userSelectedTags: string[],
		profileNickname: string,
		publishAsDraft: boolean,
		slug?: string,
		targetRelays?: string[],
		selectedImageStorageProvider?: string
	): Promise<{ success: boolean; publishedRelays: string[] }> {
		if (!publishAsDraft) {
			new Notice(`⏳ [1/3] Publishing note '${activeFile.name}' to Nostr...`);
		} else {
			new Notice(`⏳ [1/3] Publishing note '${activeFile.name}' as draft to Nostr...`);
		}

		if (!fileContent || fileContent.trim() === "") {
			Logger.error("[NostrService] No content to publish");
			return { success: false, publishedRelays: [] };
		}

		const signer = await this.getSigner(profileNickname);
		if (!signer) {
			new Notice("❌ No signer configured for publishing.");
			return { success: false, publishedRelays: [] };
		}

		const noteTitle = (title && title.trim()) ? title.trim() : activeFile.basename;
		const finalSlug = (slug && slug.trim()) ? slug.trim() : extractSlug(null, noteTitle);

		const slugValidation = validateSlug(finalSlug);
		if (!slugValidation.isValid) {
			new Notice(`❌ ${slugValidation.error || "A valid slug is required."}`);
			return { success: false, publishedRelays: [] };
		}

		Logger.info(`[NostrService] Starting publishNote: "${noteTitle}" (Slug: "${finalSlug}", Profile: "${profileNickname}", Draft: ${publishAsDraft})`);

		try {
			let bannerImageUrl: string | null = null;
			if (imageBannerFilePath !== null) {
				Logger.info(`[NostrService] Uploading Banner Image: ${imageBannerFilePath}`);
				new Notice("🖼️ Uploading Banner Image...");
				let imageUploadResult = await this.imageUploadService.uploadArticleBannerImage(
					imageBannerFilePath,
					selectedImageStorageProvider,
					signer
				);
				if (imageUploadResult !== null) {
					bannerImageUrl = imageUploadResult;
					Logger.info(`[NostrService] Banner image uploaded: ${bannerImageUrl}`);
					new Notice("✅ Uploaded Banner Image");
				} else {
					Logger.warn(`[NostrService] Problem uploading banner image`);
					new Notice("❌ Problem Uploading Banner Image..");
				}
			}

			// Handle inline images
			const imetaTags: string[][] = [];
			const imagePaths: string[] = [];
			try {
				let vaultResolvedLinks = this.app.metadataCache.resolvedLinks;
				if (vaultResolvedLinks[activeFile.path]) {
					const fileContents = vaultResolvedLinks[activeFile.path];
					for (const filePath of Object.keys(fileContents)) {
						if (this.isImagePath(filePath)) {
							imagePaths.push(filePath);
						}
					}
				}
				if (imagePaths.length > 0) {
					Logger.info(`[NostrService] Found ${imagePaths.length} inline images to upload`);
					new Notice(`✅ Found ${imagePaths.length} inline images - uploading with article...`);
					let imageUploadResult = await this.imageUploadService.uploadImagesToStorageProvider(
						imagePaths,
						selectedImageStorageProvider,
						signer
					);
					if (imageUploadResult.success && imageUploadResult.results && imageUploadResult.results.length > 0) {
						for (const imageTarget of imageUploadResult.results) {
							if (imageTarget.replacementStringURL !== null) {
								fileContent = fileContent.replace(imageTarget.stringToReplace, imageTarget.replacementStringURL);
								if (imageTarget.imetaTag && imageTarget.imetaTag.length > 0) {
									imetaTags.push(imageTarget.imetaTag);
								}
							}
						}
					}
				}
			} catch (e) {
				Logger.error("Problem uploading inline images:", e);
				new Notice("❌ Problem uploading inline images.");
			}

			Logger.info(`[NostrService] Building event template (Kind ${publishAsDraft ? 30024 : 30023})...`);
			const eventTemplate = publishAsDraft
				? EventBuilder.buildDraftEvent({
						slug: finalSlug,
						title: noteTitle,
						content: fileContent,
						summary: summary || undefined,
						bannerImageUrl: bannerImageUrl,
						tags: userSelectedTags,
						imetaTags: imetaTags.length > 0 ? imetaTags : undefined,
				  })
				: EventBuilder.buildLongFormEvent({
						slug: finalSlug,
						title: noteTitle,
						content: fileContent,
						summary: summary || undefined,
						bannerImageUrl: bannerImageUrl,
						tags: userSelectedTags,
						imetaTags: imetaTags.length > 0 ? imetaTags : undefined,
				  });

			new Notice(`⏳ [2/3] Requesting signature from ${signer.getType()} signer...`);
			Logger.info(`[NostrService] Signing event with ${signer.getType()} signer...`);
			const finalEvent = await signer.signEvent(eventTemplate);
			Logger.info(`[NostrService] Event successfully signed (ID: ${finalEvent.id})`);

			return await this.publishToRelays(
				finalEvent,
				activeFile.path,
				profileNickname,
				targetRelays
			);
		} catch (error: any) {
			Logger.error("Failed to publish note:", error);
			new Notice(`❌ Publishing error: ${error.message || error}`, 10000);
			return { success: false, publishedRelays: [] };
		}
	}

	public buildPreviewEvent(params: {
		fileContent: string;
		title: string;
		slug: string;
		summary?: string;
		tags: string[];
		publishAsDraft: boolean;
		bannerImageUrl?: string | null;
		imetaTags?: string[][];
		pubkey?: string;
		createdAt?: number;
	}) {
		const baseParams = {
			slug: params.slug,
			title: params.title,
			content: params.fileContent,
			summary: params.summary || undefined,
			bannerImageUrl: params.bannerImageUrl,
			tags: params.tags,
			imetaTags: params.imetaTags,
			createdAt: params.createdAt || Math.floor(Date.now() / 1000),
		};

		const template = params.publishAsDraft
			? EventBuilder.buildDraftEvent(baseParams)
			: EventBuilder.buildLongFormEvent(baseParams);

		return {
			...template,
			pubkey: params.pubkey || this.defaultPublicKey || "simulated-pubkey-placeholder",
			id: "preview-id-calculated-on-signing",
			sig: "preview-sig-calculated-on-signing",
		};
	}

	getImetaTagForImage(uploadData: any): string[] | null {
		let inlineTag: string[] = [];
		let url = uploadData.url ? uploadData.url : null;
		let mimeType = uploadData.mime ? uploadData.mime : null;
		let ox = uploadData.original_sha256 ? uploadData.original_sha256 : null;
		let size = uploadData.size ? uploadData.size : null;
		let dim = uploadData.dimensionsString ? uploadData.dimensionsString : null;
		let blurhash = uploadData.blurhash ? uploadData.blurhash : null;
		let thumbnail = uploadData.thumbnail ? uploadData.thumbnail : null;

		if (url !== null) {
			inlineTag.push("imeta");
			inlineTag.push(`url ${url}`);
		} else {
			return null;
		}

		if (mimeType !== null) {
			inlineTag.push(`m ${mimeType}`);
		}
		if (ox !== null) {
			inlineTag.push(`ox ${ox}`);
		}
		if (size !== null) {
			inlineTag.push(`size ${size}`);
		}
		if (dim !== null) {
			inlineTag.push(`dim ${dim}`);
		}
		if (blurhash !== null) {
			inlineTag.push(`blurhash ${blurhash}`);
		}
		if (thumbnail !== null) {
			inlineTag.push(`thumb ${thumbnail}`);
		}

		return inlineTag;
	}

	isImagePath(filePath: string): boolean {
		const imageExtensions = [".png", ".jpg", ".jpeg", ".gif", ".bmp", ".svg"];
		const ext = path.extname(filePath).toLowerCase();
		return imageExtensions.includes(ext);
	}

	/**
	 * Returns a sanitized, deduplicated list of all available relays:
	 * configured user relays, bunker signer relays, and default fallback relays.
	 */
	public getUnifiedRelayUrls(): string[] {
		const bunkerRelays: string[] = [];
		if (this.defaultSigner instanceof BunkerSigner) {
			bunkerRelays.push(...this.defaultSigner.getBunkerPointer().relays);
		}
		for (const signer of this.profileSigners.values()) {
			if (signer instanceof BunkerSigner) {
				bunkerRelays.push(...signer.getBunkerPointer().relays);
			}
		}

		return sanitizeRelayList([
			...(this.relayURLs.length > 0 ? this.relayURLs : []),
			...bunkerRelays,
			...NostrService.DEFAULT_RELAYS,
		]);
	}

	/**
	 * Queries multiple relays with timeout and EOSE support, collecting all matching events.
	 */
	async queryRelays(filter: any, maxWaitMs = 8000, targetRelays?: string[]): Promise<Event[]> {
		const pool = new SimplePool();
		const relaysToQuery = (targetRelays && targetRelays.length > 0)
			? sanitizeRelayList(targetRelays)
			: this.getUnifiedRelayUrls();

		try {
			const eventsMap = new Map<string, Event>();

			await new Promise<void>((resolve) => {
				let resolved = false;
				const done = () => {
					if (!resolved) {
						resolved = true;
						resolve();
					}
				};

				const timer = setTimeout(done, maxWaitMs);

				try {
					pool.subscribeMany(
						relaysToQuery,
						[filter],
						{
							maxWait: Math.min(4000, maxWaitMs - 1000),
							onevent(event: Event) {
								if (!eventsMap.has(event.id)) {
									eventsMap.set(event.id, event);
								}
							},
							oneose() {
								clearTimeout(timer);
								done();
							},
							onclose() {
								done();
							},
						}
					);
				} catch (e) {
					clearTimeout(timer);
					done();
				}
			});

			return Array.from(eventsMap.values());
		} catch (e) {
			Logger.error("Failed to query relays:", e);
			return [];
		} finally {
			pool.close(relaysToQuery);
		}
	}

	async getUserBookmarkIDs(targetPubkey?: string): Promise<{ success: boolean; bookmark_event_ids: string[]; longform_event_ids: string[] }> {
		const bookmark_event_ids: string[] = [];
		const longform_event_ids: string[] = [];
		try {
			const pubkey = targetPubkey || (await this.getPublicKey());
			if (!pubkey) {
				return { success: false, bookmark_event_ids, longform_event_ids };
			}
			const events = await this.queryRelays({ kinds: [10003], authors: [pubkey] }, 8000);
			if (events && events.length > 0) {
				for (let event of events) {
					for (const tag of event.tags) {
						if (tag[0] === "e" && tag[1]) {
							bookmark_event_ids.push(tag[1]);
						}
						if (tag[0] === "a" && tag[1]) {
							longform_event_ids.push(tag[1]);
						}
					}
				}
			}
			return { success: true, bookmark_event_ids, longform_event_ids };
		} catch (error) {
			Logger.error("Error occurred while fetching bookmark ids:", error);
			return { success: false, bookmark_event_ids, longform_event_ids };
		}
	}

	async loadUserBookmarks(targetPubkey?: string): Promise<Event[]> {
		let events: Event[] = [];
		try {
			let res = await this.getUserBookmarkIDs(targetPubkey);
			if (res.success) {
				if (res.longform_event_ids.length > 0) {
					for (let atag of res.longform_event_ids) {
						let author = "";
						let eTag = "";
						let parts = atag.split(":");
						if (parts.length >= 2) {
							author = parts[1];
							eTag = parts[2];
						}
						if (author) {
							let articles = await this.queryRelays({ authors: [author], kinds: [30023] }, 6000);
							for (let articleItem of articles) {
								if (articleItem.tags.some((tag: string[]) => tag[0] === "d" && tag[1] === eTag)) {
									events.push(articleItem);
								}
							}
						}
					}
				}
				if (res.bookmark_event_ids.length > 0) {
					let newEvents = await this.queryRelays({ ids: res.bookmark_event_ids, kinds: [1, 30023] }, 6000);
					events.push(...newEvents);
				}
				return events;
			} else {
				Logger.warn("No bookmark IDs returned");
				return [];
			}
		} catch (err) {
			Logger.error("Error occurred while fetching bookmarks:", err);
			return [];
		}
	}

	async loadUserHighlights(targetPubkey?: string): Promise<Event[]> {
		try {
			const pubkey = targetPubkey || (await this.getPublicKey());
			if (!pubkey) {
				Logger.warn("[NostrService] No public key configured to fetch highlights");
				return [];
			}
			Logger.info(`[NostrService] Querying relays for Kind 9802 highlights by author ${pubkey}...`);
			const highlights = await this.queryRelays({ authors: [pubkey], kinds: [9802] }, 8000);
			Logger.info(`[NostrService] Discovered ${highlights.length} highlights for pubkey ${pubkey}`);
			return highlights;
		} catch (err) {
			Logger.error("Error occurred while fetching highlights:", err);
			return [];
		}
	}

	/**
	 * Loads all long-form articles (Kind 30023) and drafts (Kind 30024) authored by the given pubkey
	 * directly from configured Nostr relays. Deduplicates NIP-23 replaceable events by 'd' tag
	 * and resolves orphan/ghost unslugged duplicates.
	 */
	async loadUserArticlesFromRelays(targetPubkey?: string): Promise<Event[]> {
		const targetUrls = this.getUnifiedRelayUrls();

		try {
			const authorPk = targetPubkey || (await this.getPublicKey());
			if (!authorPk) {
				Logger.warn("[NostrService] No public key configured to fetch remote articles");
				return [];
			}

			Logger.info(`[NostrService] Querying ${targetUrls.length} relays for Kind 30023/30024 articles by author ${authorPk}...`);
			
			const receivedEvents: Event[] = [];
			const pool = new SimplePool();

			await new Promise<void>((resolve) => {
				let resolved = false;
				const done = () => {
					if (!resolved) {
						resolved = true;
						resolve();
					}
				};

				const timer = setTimeout(done, 6000);

				try {
					pool.subscribeMany(
						targetUrls,
						[{ authors: [authorPk], kinds: [30023, 30024] }],
						{
							maxWait: 4000,
							onevent(event: Event) {
								receivedEvents.push(event);
							},
							oneose() {
								clearTimeout(timer);
								done();
							},
							onclose() {
								done();
							},
						}
					);
				} catch (e) {
					clearTimeout(timer);
					done();
				}
			});

			pool.close(targetUrls);

			// Phase 1: Deduplicate Parameterized Replaceable Events having a valid 'd' tag (latest created_at wins)
			const sluggedArticlesMap = new Map<string, Event>();
			const unsluggedEvents: Event[] = [];

			for (const event of receivedEvents) {
				const dTag = event.tags.find((t: string[]) => t[0] === "d")?.[1]?.trim() || "";
				if (dTag) {
					const coordKey = `${event.kind}:${dTag}`;
					const existing = sluggedArticlesMap.get(coordKey);
					if (!existing || event.created_at > existing.created_at) {
						sluggedArticlesMap.set(coordKey, event);
					}
				} else {
					unsluggedEvents.push(event);
				}
			}

			// Index normalized titles of slugged articles for ghost resolution
			const sluggedTitles = new Set<string>();
			for (const event of sluggedArticlesMap.values()) {
				const titleTag = event.tags.find((t: string[]) => t[0] === "title")?.[1]?.trim();
				if (titleTag) {
					sluggedTitles.add(titleTag.toLowerCase());
				}
			}

			// Phase 2: Filter unslugged events (discard if a slugged counterpart with the same title already exists)
			const uniqueUnsluggedMap = new Map<string, Event>();
			for (const event of unsluggedEvents) {
				const titleTag = event.tags.find((t: string[]) => t[0] === "title")?.[1]?.trim();
				const normalizedTitle = titleTag ? titleTag.toLowerCase() : "";

				// If there is already a slugged article with this title, discard the unslugged duplicate
				if (normalizedTitle && sluggedTitles.has(normalizedTitle)) {
					Logger.debug(`[NostrService] Discarding unslugged ghost duplicate for article "${titleTag}" (ID: ${event.id})`);
					continue;
				}

				// Keep unique unslugged standalone events by event ID
				const existing = uniqueUnsluggedMap.get(event.id);
				if (!existing || event.created_at > existing.created_at) {
					uniqueUnsluggedMap.set(event.id, event);
				}
			}

			// Phase 3: Combine and sort by created_at descending
			const uniqueArticles = [
				...Array.from(sluggedArticlesMap.values()),
				...Array.from(uniqueUnsluggedMap.values()),
			];
			uniqueArticles.sort((a, b) => b.created_at - a.created_at);

			Logger.info(`[NostrService] Discovered ${uniqueArticles.length} unique long-form articles (${sluggedArticlesMap.size} slugged, ${uniqueUnsluggedMap.size} unslugged) for pubkey ${authorPk}.`);
			return uniqueArticles;
		} catch (err: any) {
			Logger.error("Error fetching user articles from relays:", err);
			return [];
		}
	}

	/**
	 * Imports a remote Nostr article event into the Obsidian vault as a clean Markdown file.
	 * Reconstructs YAML frontmatter (title, slug, summary, image, tags, published_at, nostr_id)
	 * and registers the file into published.json.
	 */
	async importArticleToVault(
		articleEvent: Event,
		profileNickname: string = "default"
	): Promise<{ success: boolean; file: TFile | null; path: string; error?: string }> {
		try {
			const title = articleEvent.tags.find((t: string[]) => t[0] === "title")?.[1] || "";
			const slug = articleEvent.tags.find((t: string[]) => t[0] === "d")?.[1] || "";
			const summary = articleEvent.tags.find((t: string[]) => t[0] === "summary")?.[1] || "";
			const image = articleEvent.tags.find((t: string[]) => t[0] === "image")?.[1] || "";
			const publishedAt = articleEvent.tags.find((t: string[]) => t[0] === "published_at")?.[1] || "";
			const tags = articleEvent.tags.filter((t: string[]) => t[0] === "t" && t[1]).map((t: string[]) => t[1]);

			// Construct clean YAML Frontmatter
			const frontmatterLines: string[] = ["---"];
			if (title) frontmatterLines.push(`title: "${title.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`);
			if (slug) frontmatterLines.push(`slug: "${slug.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`);
			if (summary) frontmatterLines.push(`summary: "${summary.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`);
			if (image) frontmatterLines.push(`image: "${image.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`);
			if (tags.length > 0) {
				frontmatterLines.push("tags:");
				for (const tag of tags) {
					frontmatterLines.push(`  - "${tag.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`);
				}
			}
			if (publishedAt) {
				frontmatterLines.push(`published_at: ${publishedAt}`);
			}
			frontmatterLines.push(`nostr_id: "${articleEvent.id}"`);
			frontmatterLines.push(`nostr_kind: ${articleEvent.kind}`);
			frontmatterLines.push("---");
			frontmatterLines.push("");

			const fullContent = frontmatterLines.join("\n") + (articleEvent.content || "");

			// Compute safe unique vault filename
			const baseName = sanitizeVaultFilename(title || slug || `nostr-article-${articleEvent.id.substring(0, 8)}`);
			let targetPath = `${baseName}.md`;
			let counter = 1;

			while (this.app.vault.getAbstractFileByPath(targetPath) !== null) {
				targetPath = `${baseName}-${counter}.md`;
				counter++;
			}

			Logger.info(`[NostrService] Creating imported article file in vault: ${targetPath}`);
			const createdFile = await this.app.vault.create(targetPath, fullContent);

			if (createdFile instanceof TFile) {
				// Record in published.json so local publishing history is synced
				await this.savePublishedEvent(
					articleEvent,
					createdFile.path,
					this.getUnifiedRelayUrls(),
					profileNickname
				);
				return { success: true, file: createdFile, path: createdFile.path };
			}

			return { success: false, file: null, path: "", error: "Failed to create markdown file in vault" };
		} catch (error: any) {
			Logger.error("Failed to import article into vault:", error);
			return { success: false, file: null, path: "", error: error.message || String(error) };
		}
	}

	async getUserProfile(userHexPubKey: string): Promise<Event | null> {
		try {
			const events = await this.queryRelays({ kinds: [0], authors: [userHexPubKey] }, 6000);
			if (events && events.length > 0) {
				events.sort((a, b) => b.created_at - a.created_at);
				return events[0];
			}
			return null;
		} catch (err) {
			Logger.error("Error occurred while fetching profile:", err);
			return null;
		}
	}

	async getEventFromATag(tagValue: string): Promise<Event | null> {
		try {
			let eventParts = tagValue.split(":");
			if (eventParts.length < 3) return null;
			const kind = parseInt(eventParts[0], 10);
			const author = eventParts[1];
			const dTag = eventParts[2];
			const articles = await this.queryRelays({ kinds: [kind], authors: [author] }, 6000);
			for (let articleItem of articles) {
				if (articleItem.tags.some((tag: string[]) => tag[0] === "d" && tag[1] === dTag)) {
					return articleItem;
				}
			}
			return null;
		} catch (err) {
			Logger.error("Error occurred while fetching event from a tag:", err);
			return null;
		}
	}

	async publishToRelays(
		finalEvent: VerifiedEvent | Event,
		filePath: string,
		profileNickname: string,
		targetRelays?: string[]
	): Promise<{ success: boolean; publishedRelays: string[] }> {
		const targetUrls = (targetRelays && targetRelays.length > 0)
			? sanitizeRelayList(targetRelays)
			: this.getUnifiedRelayUrls();

		Logger.info(`[NostrService] On-demand broadcast of Kind ${finalEvent.kind} event (${finalEvent.id}) to ${targetUrls.length} relays: ${targetUrls.join(", ")}`);
		new Notice(`📡 [3/3] Broadcasting to ${targetUrls.length} relays...`);

		const pool = new SimplePool();

		try {
			const publishingPromises = targetUrls.map(async (url) => {
				try {
					Logger.info(`[NostrService] Publishing to relay: ${url}`);
					const pubs = pool.publish([url], finalEvent);
					await withTimeout(
						Promise.any(pubs),
						12000,
						`Relay ${url} publish timeout (12s)`
					);
					Logger.info(`[NostrService] ✅ Successfully published to ${url}`);
					return { success: true, url };
				} catch (error: any) {
					Logger.warn(`[NostrService] ⚠️ Failed to publish to ${url}: ${error.message || error}`);
					return { success: false, url };
				}
			});

			const results = await Promise.all(publishingPromises);
			const publishedRelays = results
				.filter((result): result is { success: boolean; url: string } => result.success && typeof result.url === "string")
				.map((result) => result.url);

			Logger.info(
				`[NostrService] Published to ${publishedRelays.length} / ${targetUrls.length} relays.`
			);

			if (publishedRelays.length === 0) {
				Logger.error("[NostrService] Event was not accepted by any selected relays.");
				new Notice("❌ Could not publish to any relays. Check your relay connections.", 8000);
				return { success: false, publishedRelays: [] };
			} else {
				if (finalEvent.kind === 30023 && filePath) {
					await this.savePublishedEvent(
						finalEvent,
						filePath,
						publishedRelays,
						profileNickname
					);
				}
				return { success: true, publishedRelays };
			}
		} catch (error: any) {
			Logger.error("An error occurred while publishing to relays:", error);
			new Notice(`❌ Relay error: ${error.message || error}`, 10000);
			return { success: false, publishedRelays: [] };
		} finally {
			pool.close(targetUrls);
		}
	}

	async shutdownRelays() {
		Logger.info("Shutting down Nostr service signers and resources");
		if (this.defaultSigner && this.defaultSigner.close) {
			await this.defaultSigner.close();
		}
		for (const signer of this.profileSigners.values()) {
			if (signer.close) {
				await signer.close();
			}
		}
	}

	async savePublishedEvent(
		finalEvent: Event,
		publishedFilePath: string,
		relays: string[],
		profileNickname: string
	) {
		const publishedDataPath = `${this.plugin.manifest.dir}/published.json`;
		let publishedEvents;
		try {
			const fileContent = await this.app.vault.adapter.read(
				publishedDataPath
			);
			publishedEvents = JSON.parse(fileContent);
		} catch (e) {
			publishedEvents = [];
		}

		const eventWithMetaData = {
			...finalEvent,
			filepath: publishedFilePath,
			publishedToRelays: relays,
			profileNickname: profileNickname,
		};
		publishedEvents.push(eventWithMetaData);
		await this.app.vault.adapter.write(
			publishedDataPath,
			JSON.stringify(publishedEvents)
		);
	}

	isValidURL(url: string): boolean {
		try {
			new URL(url);
			return true;
		} catch (error) {
			return false;
		}
	}
}

import { EventTemplate } from "nostr-tools/core";
import { validateSlug } from "../utils/SlugUtil";
import { extractBodyHashtags, normalizeTags } from "../utils/TagExtractor";

export interface LongFormEventParams {
	slug: string;
	title: string;
	content: string;
	summary?: string;
	bannerImageUrl?: string | null;
	tags?: string[];
	imetaTags?: string[][];
	publishedAt?: number;
	createdAt?: number;
}

export interface DraftEventParams {
	slug: string;
	title: string;
	content: string;
	summary?: string;
	bannerImageUrl?: string | null;
	tags?: string[];
	imetaTags?: string[][];
	createdAt?: number;
}

export interface ShortNoteParams {
	content: string;
	tags?: string[];
	createdAt?: number;
}

export class EventBuilder {
	/**
	 * Builds a NIP-23 Long-form Content Event Template (Kind 30023).
	 *
	 * Mandatory tags:
	 * - `d`: Unique identifier / slug
	 * - `title`: Article title
	 * - `published_at`: Unix timestamp in seconds
	 *
	 * Optional tags:
	 * - `summary`: Short summary / excerpt
	 * - `image`: Banner / cover image URL
	 * - `t`: Topic hashtags
	 * - `imeta`: Inline media metadata
	 */
	public static buildLongFormEvent(params: LongFormEventParams): EventTemplate {
		const slugValidation = validateSlug(params.slug);
		if (!slugValidation.isValid) {
			throw new Error(slugValidation.error || "A valid slug is required for long-form events.");
		}

		const title = params.title?.trim() || "Untitled";
		const createdAt = params.createdAt ?? Math.floor(Date.now() / 1000);
		const publishedAt = params.publishedAt ?? createdAt;

		const tags: string[][] = [
			["d", params.slug.trim()],
			["title", title],
			["published_at", publishedAt.toString()],
		];

		if (params.summary && params.summary.trim()) {
			tags.push(["summary", params.summary.trim()]);
		}

		if (params.bannerImageUrl && params.bannerImageUrl.trim()) {
			tags.push(["image", params.bannerImageUrl.trim()]);
		}

		const normalizedTags = normalizeTags(params.tags || []);
		for (const tag of normalizedTags) {
			tags.push(["t", tag]);
		}

		if (params.imetaTags && Array.isArray(params.imetaTags)) {
			for (const imeta of params.imetaTags) {
				if (Array.isArray(imeta) && imeta.length > 0) {
					tags.push(imeta);
				}
			}
		}

		return {
			kind: 30023,
			created_at: createdAt,
			tags,
			content: params.content,
		};
	}

	/**
	 * Builds a NIP-23 Draft Event Template (Kind 30024).
	 *
	 * Similar to Kind 30023, but represents a draft that is not yet formally published.
	 */
	public static buildDraftEvent(params: DraftEventParams): EventTemplate {
		const slugValidation = validateSlug(params.slug);
		if (!slugValidation.isValid) {
			throw new Error(slugValidation.error || "A valid slug is required for draft events.");
		}

		const title = params.title?.trim() || "Untitled";
		const createdAt = params.createdAt ?? Math.floor(Date.now() / 1000);

		const tags: string[][] = [
			["d", params.slug.trim()],
			["title", title],
		];

		if (params.summary && params.summary.trim()) {
			tags.push(["summary", params.summary.trim()]);
		}

		if (params.bannerImageUrl && params.bannerImageUrl.trim()) {
			tags.push(["image", params.bannerImageUrl.trim()]);
		}

		const normalizedTags = normalizeTags(params.tags || []);
		for (const tag of normalizedTags) {
			tags.push(["t", tag]);
		}

		if (params.imetaTags && Array.isArray(params.imetaTags)) {
			for (const imeta of params.imetaTags) {
				if (Array.isArray(imeta) && imeta.length > 0) {
					tags.push(imeta);
				}
			}
		}

		return {
			kind: 30024,
			created_at: createdAt,
			tags,
			content: params.content,
		};
	}

	/**
	 * Builds a Kind 1 Short Note Event Template.
	 *
	 * Extracts hashtags from the content and adds them as `t` tags.
	 * Kind 1 events do NOT use 'd' identifier tags.
	 */
	public static buildShortNoteEvent(params: ShortNoteParams): EventTemplate {
		if (!params.content || params.content.trim() === "") {
			throw new Error("Short note content cannot be empty.");
		}

		const createdAt = params.createdAt ?? Math.floor(Date.now() / 1000);
		const bodyTags = extractBodyHashtags(params.content);
		const combinedTags = normalizeTags([...(params.tags || []), ...bodyTags]);

		const tags: string[][] = [];
		for (const tag of combinedTags) {
			tags.push(["t", tag]);
		}

		return {
			kind: 1,
			created_at: createdAt,
			tags,
			content: params.content,
		};
	}
}

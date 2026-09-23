/**
 * Utility functions for generating, sanitizing, and validating URL-safe slugs (NIP-23 'd' tags).
 */

const TURKISH_CHAR_MAP: Record<string, string> = {
	"İ": "i",
	"I": "i",
	"ı": "i",
	"ğ": "g",
	"Ğ": "g",
	"ü": "u",
	"Ü": "u",
	"ş": "s",
	"Ş": "s",
	"ö": "o",
	"Ö": "o",
	"ç": "c",
	"Ç": "c",
};

/**
 * Replaces Turkish characters with their Latin counterparts.
 */
export function replaceTurkishChars(text: string): string {
	return text.replace(/[İIığĞüÜşŞöÖçÇ]/g, (char) => TURKISH_CHAR_MAP[char] || char);
}

/**
 * Converts a string (such as an article title) into a URL-safe kebab-case slug.
 *
 * Handles Turkish specific casing (e.g., 'İstanbul' -> 'istanbul', 'Iğdır' -> 'igdir')
 * and unicode diacritics.
 */
export function slugify(text: string): string {
	if (!text || typeof text !== "string") {
		return "";
	}

	let result = replaceTurkishChars(text.trim());

	// Decompose unicode to separate base letters from diacritical marks
	result = result.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

	// Lowercase the result
	result = result.toLowerCase();

	// Replace non-alphanumeric characters with hyphens
	result = result.replace(/[^a-z0-9_-]+/g, "-");

	// Deduplicate hyphens and trim leading/trailing hyphens or underscores
	result = result.replace(/--+/g, "-").replace(/^-+|-+$/g, "");

	return result;
}

/**
 * Sanitizes an existing slug input to ensure it meets slug requirements.
 */
export function sanitizeSlug(slug: string): string {
	return slugify(slug);
}

export interface SlugValidationResult {
	isValid: boolean;
	error?: string;
}

/**
 * Validates whether a slug is valid and non-empty.
 * Slugs are strictly required for NIP-23 articles and drafts.
 */
export function validateSlug(slug: string): SlugValidationResult {
	if (!slug || slug.trim() === "") {
		return {
			isValid: false,
			error: "Slug is required to publish.",
		};
	}

	const trimmed = slug.trim();
	if (!/^[a-z0-9-_]+$/i.test(trimmed)) {
		return {
			isValid: false,
			error: "Slug may only contain letters, numbers, hyphens, and underscores.",
		};
	}

	return { isValid: true };
}

/**
 * Extracts a slug from frontmatter (using `slug` or `d` properties),
 * falling back to slugifying the default title.
 */
export function extractSlug(frontmatter: any, defaultTitle: string): string {
	if (frontmatter) {
		const rawSlug = frontmatter.slug || frontmatter.d;
		if (typeof rawSlug === "string" && rawSlug.trim() !== "") {
			return sanitizeSlug(rawSlug);
		}
	}

	return slugify(defaultTitle);
}

/**
 * Sanitizes an article title or slug to make it a safe Obsidian vault filename across OS filesystems.
 * Removes illegal filesystem characters: / \ : * ? " < > | and control characters.
 */
export function sanitizeVaultFilename(title: string): string {
	if (!title || typeof title !== "string") {
		return "nostr-article";
	}

	let clean = title
		.replace(/[\/\\:*?"<>|\x00-\x1f\x80-\x9f]/g, "")
		.replace(/\s+/g, " ")
		.trim()
		.replace(/^\.+|\.+$/g, "");

	if (!clean) {
		return "nostr-article";
	}

	// Limit filename length to 120 characters for safety
	if (clean.length > 120) {
		clean = clean.substring(0, 120).trim();
	}

	return clean;
}


/**
 * Utility functions for extracting, parsing, and normalizing tags from frontmatter and markdown body.
 */

/**
 * Normalizes a list of tag strings:
 * - Trims whitespace
 * - Strips leading '#' characters
 * - Converts to lowercase
 * - Strips invalid characters
 * - Deduplicates entries while preserving original order
 */
export function normalizeTags(tags: (string | number)[]): string[] {
	if (!Array.isArray(tags)) {
		return [];
	}

	const seen = new Set<string>();
	const result: string[] = [];

	for (const item of tags) {
		if (item === null || item === undefined) continue;

		let tag = String(item).trim();

		// Strip HTML tags (<...>)
		tag = tag.replace(/<[^>]*>/g, "");

		// Strip leading hash symbols if present
		while (tag.startsWith("#")) {
			tag = tag.slice(1).trim();
		}

		// Convert to lowercase
		tag = tag.toLowerCase();

		// Remove any remaining invalid whitespace or control characters
		tag = tag.replace(/\s+/g, "-");

		// Strip non-alphanumeric/hyphen/underscore/slash characters for tag safety
		tag = tag.replace(/[^a-z0-9_\-\/]/g, "");

		if (tag.length > 0 && !seen.has(tag)) {
			seen.add(tag);
			result.push(tag);
		}
	}

	return result;
}

/**
 * Extracts and normalizes tags from frontmatter metadata.
 * Supports:
 * - Array of tags: `tags: ["nostr", "writer"]`
 * - Comma-separated string: `tags: "nostr, writer, obsidian"`
 * - Space-separated string: `tags: "#nostr #writer"`
 * - Single tag: `tag: "nostr"` or `tags: "nostr"`
 */
export function extractFrontmatterTags(frontmatter: any): string[] {
	if (!frontmatter) {
		return [];
	}

	const rawTags = frontmatter.tags ?? frontmatter.tag;
	if (!rawTags) {
		return [];
	}

	if (Array.isArray(rawTags)) {
		return normalizeTags(rawTags);
	}

	if (typeof rawTags === "string") {
		return parseTagInput(rawTags);
	}

	if (typeof rawTags === "number") {
		return normalizeTags([String(rawTags)]);
	}

	return [];
}

/**
 * Safely parses body hashtags from markdown text, strictly excluding:
 * - Markdown headings (`# Heading`, `## Heading 2`, etc.)
 * - Fenced code blocks (``` and ~~~)
 * - Inline code blocks (`code`)
 * - Math blocks ($$ ... $$ and $ ... $)
 * - HTML tags (<...>)
 * - Markdown links and URLs
 */
export function extractBodyHashtags(markdown: string): string[] {
	if (!markdown || typeof markdown !== "string") {
		return [];
	}

	let cleaned = markdown;

	// Strip YAML frontmatter if present
	cleaned = cleaned.replace(/^---[\s\S]*?---\s*/m, "");

	// Strip fenced code blocks (``` ... ``` or ~~~ ... ~~~)
	cleaned = cleaned.replace(/```[\s\S]*?```/g, " ");
	cleaned = cleaned.replace(/~~~[\s\S]*?~~~/g, " ");

	// Strip inline code blocks (` ... `)
	cleaned = cleaned.replace(/`[^`\n]+`/g, " ");

	// Strip math blocks ($$ ... $$ and $ ... $)
	cleaned = cleaned.replace(/\$\$[\s\S]*?\$\$/g, " ");
	cleaned = cleaned.replace(/\$[^$\n]+\$/g, " ");

	// Strip markdown headers (^# Heading, ^## Heading, etc.)
	cleaned = cleaned.replace(/^#{1,6}\s+.*$/gm, " ");

	// Strip markdown links [text](url) - keep text, strip url
	cleaned = cleaned.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

	// Strip HTML tags
	cleaned = cleaned.replace(/<[^>]+>/g, " ");

	// Strip URLs
	cleaned = cleaned.replace(/https?:\/\/[^\s]+/g, " ");

	// Match remaining genuine hashtags: #word (starting at beginning of line or preceded by whitespace/punctuation)
	const hashtagRegex = /(?:^|[\s(.,!?;:])#([a-zA-Z0-9_\-\/]+)/g;
	const tags: string[] = [];
	let match: RegExpExecArray | null;

	while ((match = hashtagRegex.exec(cleaned)) !== null) {
		if (match[1]) {
			tags.push(match[1]);
		}
	}

	return normalizeTags(tags);
}

/**
 * Parses user input from tags input fields (comma or space separated).
 * Example: `"nostr, bitcoin, obsidian writing"` -> `["nostr", "bitcoin", "obsidian", "writing"]`
 * or `"tag1, tag2"` -> `["tag1", "tag2"]`
 */
export function parseTagInput(input: string): string[] {
	if (!input || typeof input !== "string") {
		return [];
	}

	// If contains commas, split by comma; else split by whitespace
	let parts: string[];
	if (input.includes(",")) {
		parts = input.split(",");
	} else {
		parts = input.split(/\s+/);
	}

	return normalizeTags(parts);
}

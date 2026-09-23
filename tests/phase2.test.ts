import * as assert from "assert";
import { slugify, replaceTurkishChars, validateSlug, extractSlug, sanitizeSlug } from "../src/utils/SlugUtil";
import { extractFrontmatterTags, extractBodyHashtags, parseTagInput, normalizeTags } from "../src/utils/TagExtractor";
import { EventBuilder } from "../src/builder";

console.log("==========================================");
console.log("RUNNING PHASE 2 UNIT TESTS");
console.log("==========================================");

let passed = 0;
let failed = 0;

function it(name: string, fn: () => void) {
	try {
		fn();
		console.log(`  ✅ PASS: ${name}`);
		passed++;
	} catch (err: any) {
		console.error(`  ❌ FAIL: ${name}`);
		console.error(`     Error: ${err.message}`);
		failed++;
	}
}

// ==========================================
// 1. TURKISH CHARACTER & SLUG TESTS
// ==========================================
console.log("\n--- 1. Slug & Turkish Character Conversion ---");

it("properly converts Turkish uppercase and lowercase characters", () => {
	assert.strictEqual(replaceTurkishChars("İSTANBUL"), "iSTANBUL");
	assert.strictEqual(replaceTurkishChars("istanbul"), "istanbul");
	assert.strictEqual(replaceTurkishChars("IĞDIR"), "igDiR");
	assert.strictEqual(replaceTurkishChars("ığdır"), "igdir");
	assert.strictEqual(replaceTurkishChars("Şeker Çiçek"), "seker cicek");
	assert.strictEqual(replaceTurkishChars("öğe ve güneş"), "oge ve gunes");
});

it("slugifies titles with Turkish characters into clean kebab-case", () => {
	assert.strictEqual(slugify("İstanbul ve Çevresi"), "istanbul-ve-cevresi");
	assert.strictEqual(slugify("IĞDIR'da Çığ Düştü!"), "igdir-da-cig-dustu");
	assert.strictEqual(slugify("Türkçe Karakterler: Ğ, Ü, Ş, İ, Ö, Ç"), "turkce-karakterler-g-u-s-i-o-c");
	assert.strictEqual(slugify("Örnek Yazı: Nostr Nedir? (2026 Rehberi)"), "ornek-yazi-nostr-nedir-2026-rehberi");
});

it("slugifies titles with foreign accents and diacritics", () => {
	assert.strictEqual(slugify("Crème brûlée à la vanille"), "creme-brulee-a-la-vanille");
	assert.strictEqual(slugify("Señor Niño & El Niño"), "senor-nino-el-nino");
});

it("validates mandatory slugs", () => {
	const emptyRes = validateSlug("");
	assert.strictEqual(emptyRes.isValid, false);
	assert.ok(emptyRes.error?.includes("required"));

	const wsRes = validateSlug("   ");
	assert.strictEqual(wsRes.isValid, false);

	const invalidCharRes = validateSlug("hello world!");
	assert.strictEqual(invalidCharRes.isValid, false);

	const validSlug1 = validateSlug("my-first-post");
	assert.strictEqual(validSlug1.isValid, true);

	const validSlug2 = validateSlug("article_2026-draft");
	assert.strictEqual(validSlug2.isValid, true);
});

it("extracts slug from frontmatter override or falls back to title", () => {
	assert.strictEqual(extractSlug({ slug: "custom-slug-override" }, "My Title"), "custom-slug-override");
	assert.strictEqual(extractSlug({ d: "my-d-tag" }, "My Title"), "my-d-tag");
	assert.strictEqual(extractSlug({}, "My Clean Note Title!"), "my-clean-note-title");
	assert.strictEqual(extractSlug(null, "Obsidian to Nostr"), "obsidian-to-nostr");
});

// ==========================================
// 2. TAG EXTRACTION TESTS
// ==========================================
console.log("\n--- 2. Tag Extraction Subsystem ---");

it("normalizes, deduplicates, and lowercases tags", () => {
	const tags = normalizeTags(["#Nostr", "NOSTR", "  Bitcoin  ", "#bitcoin", "Web3", ""]);
	assert.deepStrictEqual(tags, ["nostr", "bitcoin", "web3"]);
});

it("extracts frontmatter tags defined as array, string, or single tag", () => {
	assert.deepStrictEqual(
		extractFrontmatterTags({ tags: ["nostr", "writer", "guide"] }),
		["nostr", "writer", "guide"]
	);
	assert.deepStrictEqual(
		extractFrontmatterTags({ tags: "nostr, writer, obsidian" }),
		["nostr", "writer", "obsidian"]
	);
	assert.deepStrictEqual(
		extractFrontmatterTags({ tags: "#bitcoin #crypto #nostr" }),
		["bitcoin", "crypto", "nostr"]
	);
	assert.deepStrictEqual(
		extractFrontmatterTags({ tag: "single-tag" }),
		["single-tag"]
	);
	assert.deepStrictEqual(extractFrontmatterTags(null), []);
	assert.deepStrictEqual(extractFrontmatterTags({}), []);
});

it("safely extracts body hashtags while ignoring markdown headers, code blocks, math, and links", () => {
	const markdown = `
---
title: Sample Post
tags: frontmatter-tag
---

# Heading 1 Should Not Be A Tag
## Heading 2 With #Hash Should Not Be A Tag
### Third Level Heading

Here is some regular text with a genuine #bitcoin and #nostr_writer hashtag!

\`\`\`python
# This is a python comment, NOT a hashtag
def hello():
    # Another #code_tag in block
    return 1
\`\`\`

Here is an inline code \`#not_a_tag\` and a math block $$ #math_tag $$ and inline $#math_formula$.
And a markdown link [click here](#heading-anchor) and url https://example.com/#url-hash.

Ending note with #decentralized tag.
`;

	const tags = extractBodyHashtags(markdown);
	assert.deepStrictEqual(tags, ["bitcoin", "nostr_writer", "decentralized"]);
});

it("parses user comma-separated tag inputs into clean badges", () => {
	assert.deepStrictEqual(
		parseTagInput("nostr, bitcoin, dev-tools, obsidian"),
		["nostr", "bitcoin", "dev-tools", "obsidian"]
	);
	assert.deepStrictEqual(
		parseTagInput(" #tag1 , #TAG2 , tag3 "),
		["tag1", "tag2", "tag3"]
	);
});

// ==========================================
// 3. EVENT BUILDER ENGINE TESTS
// ==========================================
console.log("\n--- 3. Event Builder Engine ---");

it("builds valid NIP-23 Kind 30023 long-form event templates", () => {
	const template = EventBuilder.buildLongFormEvent({
		slug: "my-nip23-article",
		title: "Understanding NIP-23",
		content: "# My Article\n\nContent here...",
		summary: "A comprehensive guide to Nostr long-form content.",
		bannerImageUrl: "https://blossom.server/banner.png",
		tags: ["nostr", "nip23", "guide"],
		imetaTags: [
			["imeta", "url https://blossom.server/img.jpg", "m image/jpeg", "ox 12345"],
		],
		createdAt: 1700000000,
	});

	assert.strictEqual(template.kind, 30023);
	assert.strictEqual(template.created_at, 1700000000);
	assert.strictEqual(template.content, "# My Article\n\nContent here...");

	// Verify required tags
	assert.ok(template.tags.some((t) => t[0] === "d" && t[1] === "my-nip23-article"));
	assert.ok(template.tags.some((t) => t[0] === "title" && t[1] === "Understanding NIP-23"));
	assert.ok(template.tags.some((t) => t[0] === "published_at" && t[1] === "1700000000"));
	assert.ok(template.tags.some((t) => t[0] === "summary" && t[1] === "A comprehensive guide to Nostr long-form content."));
	assert.ok(template.tags.some((t) => t[0] === "image" && t[1] === "https://blossom.server/banner.png"));
	assert.ok(template.tags.some((t) => t[0] === "t" && t[1] === "nostr"));
	assert.ok(template.tags.some((t) => t[0] === "t" && t[1] === "nip23"));
	assert.ok(template.tags.some((t) => t[0] === "imeta" && t[1] === "url https://blossom.server/img.jpg"));
});

it("throws an error when building long-form event with missing or invalid slug", () => {
	assert.throws(() => {
		EventBuilder.buildLongFormEvent({
			slug: "",
			title: "No Slug Title",
			content: "Some content",
		});
	}, /Slug is required/);

	assert.throws(() => {
		EventBuilder.buildLongFormEvent({
			slug: "invalid slug with spaces!",
			title: "Invalid Slug Title",
			content: "Some content",
		});
	}, /letters, numbers, hyphens/);
});

it("builds valid NIP-23 Kind 30024 draft event templates", () => {
	const template = EventBuilder.buildDraftEvent({
		slug: "my-draft-note",
		title: "Draft Article",
		content: "Draft in progress...",
		tags: ["draft", "idea"],
		createdAt: 1700000000,
	});

	assert.strictEqual(template.kind, 30024);
	assert.strictEqual(template.created_at, 1700000000);
	assert.ok(template.tags.some((t) => t[0] === "d" && t[1] === "my-draft-note"));
	assert.ok(template.tags.some((t) => t[0] === "title" && t[1] === "Draft Article"));
	assert.ok(template.tags.some((t) => t[0] === "t" && t[1] === "draft"));
	assert.ok(template.tags.some((t) => t[0] === "t" && t[1] === "idea"));
});

it("builds valid Kind 1 short note events without d-tags and with body hashtags", () => {
	const template = EventBuilder.buildShortNoteEvent({
		content: "Hello Nostr! Exploring #bitcoin and #nostr today.",
		createdAt: 1700000000,
	});

	assert.strictEqual(template.kind, 1);
	assert.strictEqual(template.created_at, 1700000000);
	assert.strictEqual(template.content, "Hello Nostr! Exploring #bitcoin and #nostr today.");

	// No 'd' tag should be in kind 1
	assert.ok(!template.tags.some((t) => t[0] === "d"));

	// Should extract 't' tags from content
	assert.ok(template.tags.some((t) => t[0] === "t" && t[1] === "bitcoin"));
	assert.ok(template.tags.some((t) => t[0] === "t" && t[1] === "nostr"));
});

it("throws an error when building short note with empty content", () => {
	assert.throws(() => {
		EventBuilder.buildShortNoteEvent({
			content: "   ",
		});
	}, /Short note content cannot be empty/);
});

console.log("\n==========================================");
console.log(`TEST RESULTS: ${passed} passed, ${failed} failed`);
console.log("==========================================");

if (failed > 0) {
	process.exit(1);
}

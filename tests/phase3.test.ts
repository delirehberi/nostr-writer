import * as assert from "assert";
import { EventBuilder } from "../src/builder";
import { validateSlug, extractSlug } from "../src/utils/SlugUtil";
import { normalizeTags, parseTagInput } from "../src/utils/TagExtractor";

console.log("==========================================");
console.log("RUNNING PHASE 3 UNIT TESTS");
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
// 1. RELAY FILTERING & TARGET SELECTION TESTS
// ==========================================
console.log("\n--- 1. Relay Target Filtering Subsystem ---");

function filterTargetRelays(connectedRelays: { url: string; connected: boolean }[], targetRelays?: string[]) {
	let relaysToPublish = connectedRelays;
	if (targetRelays && targetRelays.length > 0) {
		relaysToPublish = connectedRelays.filter((relay) => {
			const rUrl = relay.url.replace(/\/$/, "");
			return targetRelays.some((target) => target.replace(/\/$/, "") === rUrl);
		});
	}
	return relaysToPublish.filter((r) => r.connected).map((r) => r.url);
}

it("filters connected relays according to user target selection in popup", () => {
	const mockConnected = [
		{ url: "wss://nos.lol", connected: true },
		{ url: "wss://relay.damus.io", connected: true },
		{ url: "wss://relay.nostr.band", connected: true },
		{ url: "wss://offline.relay.com", connected: false },
	];

	// Selected only nos.lol and relay.nostr.band
	const result = filterTargetRelays(mockConnected, ["wss://nos.lol", "wss://relay.nostr.band"]);
	assert.deepStrictEqual(result, ["wss://nos.lol", "wss://relay.nostr.band"]);

	// Handles trailing slashes gracefully
	const resultTrailing = filterTargetRelays(mockConnected, ["wss://nos.lol/"]);
	assert.deepStrictEqual(resultTrailing, ["wss://nos.lol"]);

	// Empty target array or undefined broadcasts to all connected relays
	const resultAll = filterTargetRelays(mockConnected, undefined);
	assert.deepStrictEqual(resultAll, ["wss://nos.lol", "wss://relay.damus.io", "wss://relay.nostr.band"]);
});

// ==========================================
// 2. DRY-RUN PREVIEW EVENT GENERATION TESTS
// ==========================================
console.log("\n--- 2. Dry-Run / Preview Event Generation ---");

function buildPreviewEvent(params: {
	fileContent: string;
	title: string;
	slug: string;
	summary?: string;
	tags: string[];
	publishAsDraft: boolean;
	bannerImageUrl?: string | null;
	pubkey: string;
}) {
	const baseParams = {
		slug: params.slug,
		title: params.title,
		content: params.fileContent,
		summary: params.summary,
		bannerImageUrl: params.bannerImageUrl,
		tags: params.tags,
		createdAt: 1710000000,
	};

	const template = params.publishAsDraft
		? EventBuilder.buildDraftEvent(baseParams)
		: EventBuilder.buildLongFormEvent(baseParams);

	return {
		...template,
		pubkey: params.pubkey,
		id: "calculated-upon-signing",
		sig: "calculated-upon-signing",
	};
}

it("generates complete preview JSON for Kind 30023 Long-Form event", () => {
	const preview = buildPreviewEvent({
		fileContent: "# Hello World\n\nNostr long form content.",
		title: "My Preview Post",
		slug: "my-preview-post",
		summary: "Brief summary of post",
		tags: ["nostr", "preview", "obsidian"],
		publishAsDraft: false,
		bannerImageUrl: "https://blossom.server/header.jpg",
		pubkey: "npub_preview_hex_key_1234567890",
	});

	assert.strictEqual(preview.kind, 30023);
	assert.strictEqual(preview.pubkey, "npub_preview_hex_key_1234567890");
	assert.strictEqual(preview.content, "# Hello World\n\nNostr long form content.");
	assert.ok(preview.tags.some((t) => t[0] === "d" && t[1] === "my-preview-post"));
	assert.ok(preview.tags.some((t) => t[0] === "title" && t[1] === "My Preview Post"));
	assert.ok(preview.tags.some((t) => t[0] === "summary" && t[1] === "Brief summary of post"));
	assert.ok(preview.tags.some((t) => t[0] === "image" && t[1] === "https://blossom.server/header.jpg"));
	assert.ok(preview.tags.some((t) => t[0] === "t" && t[1] === "nostr"));
	assert.ok(preview.tags.some((t) => t[0] === "t" && t[1] === "preview"));
	assert.ok(preview.tags.some((t) => t[0] === "t" && t[1] === "obsidian"));

	// Check JSON serializability
	const serialized = JSON.stringify(preview);
	const parsed = JSON.parse(serialized);
	assert.strictEqual(parsed.kind, 30023);
	assert.strictEqual(parsed.pubkey, "npub_preview_hex_key_1234567890");
});

it("generates complete preview JSON for Kind 30024 Draft event", () => {
	const preview = buildPreviewEvent({
		fileContent: "Draft content...",
		title: "Draft Title",
		slug: "draft-slug",
		tags: ["draft"],
		publishAsDraft: true,
		pubkey: "hex_key_abc",
	});

	assert.strictEqual(preview.kind, 30024);
	assert.strictEqual(preview.pubkey, "hex_key_abc");
	assert.ok(preview.tags.some((t) => t[0] === "d" && t[1] === "draft-slug"));
	assert.ok(preview.tags.some((t) => t[0] === "title" && t[1] === "Draft Title"));
});

it("generates complete preview JSON for Kind 1 Short Note event", () => {
	const template = EventBuilder.buildShortNoteEvent({
		content: "Short note preview for #bitcoin and #nostr!",
		createdAt: 1710000000,
	});

	const preview = {
		...template,
		pubkey: "hex_key_short",
		id: "calculated-upon-signing",
		sig: "calculated-upon-signing",
	};

	assert.strictEqual(preview.kind, 1);
	assert.strictEqual(preview.pubkey, "hex_key_short");
	assert.ok(preview.tags.some((t) => t[0] === "t" && t[1] === "bitcoin"));
	assert.ok(preview.tags.some((t) => t[0] === "t" && t[1] === "nostr"));
	assert.ok(!preview.tags.some((t) => t[0] === "d"));
});

// ==========================================
// 3. IN-POPUP DATA INTEGRITY & VALIDATION
// ==========================================
console.log("\n--- 3. Popup State Validation & Data Flow ---");

it("validates that slug is required and formatted before dry-run or publish", () => {
	const invalidSlug = "Invalid Slug with Spaces!";
	const validSlug = "valid-slug-123";

	assert.strictEqual(validateSlug(invalidSlug).isValid, false);
	assert.strictEqual(validateSlug(validSlug).isValid, true);
	assert.strictEqual(validateSlug("").isValid, false);
});

it("handles multi-tag CSV and hashtag parsing during modal interaction", () => {
	const input = "nostr, #lightning, decentralized-web, #freedom";
	const parsed = parseTagInput(input);
	const normalized = normalizeTags(parsed);

	assert.deepStrictEqual(normalized, ["nostr", "lightning", "decentralized-web", "freedom"]);
});

console.log("\n==========================================");
console.log(`TEST RESULTS: ${passed} passed, ${failed} failed`);
console.log("==========================================");

if (failed > 0) {
	process.exit(1);
}

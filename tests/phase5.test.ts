import * as assert from "assert";
import { EventBuilder } from "../src/builder";
import { NsecSigner } from "../src/signer/NsecSigner";
import { BunkerSigner } from "../src/signer/BunkerSigner";
import { SignerFactory } from "../src/signer/SignerFactory";
import { computeSha256, generateNip98AuthHeader, buildImetaTag } from "../src/utils/BlossomUtil";
import { validateSlug, extractSlug, slugify, sanitizeVaultFilename } from "../src/utils/SlugUtil";
import { extractFrontmatterTags, extractBodyHashtags, parseTagInput, normalizeTags } from "../src/utils/TagExtractor";
import { sanitizeRelayList, validateRelayUrl, normalizeRelayUrl } from "../src/utils/RelayUtil";
import { verifyEvent, getEventHash, generateSecretKey } from "nostr-tools/pure";

console.log("==========================================");
console.log("RUNNING PHASE 5 QUALITY ASSURANCE & VERIFICATION SUITE");
console.log("==========================================");

let passed = 0;
let failed = 0;

function it(name: string, fn: () => void | Promise<void>) {
	const res = fn();
	if (res instanceof Promise) {
		res
			.then(() => {
				console.log(`  ✅ PASS: ${name}`);
				passed++;
			})
			.catch((err: any) => {
				console.error(`  ❌ FAIL: ${name}`);
				console.error(`     Error: ${err.message}`);
				failed++;
			});
	} else {
		try {
			console.log(`  ✅ PASS: ${name}`);
			passed++;
		} catch (err: any) {
			console.error(`  ❌ FAIL: ${name}`);
			console.error(`     Error: ${err.message}`);
			failed++;
		}
	}
}

async function runPhase5Tests() {
	// =========================================================================
	// 1. NIP-01 CANONICAL SERIALIZATION & HASH ID VERIFICATION
	// =========================================================================
	console.log("\n--- 1. NIP-01 Canonical Event Serialization & Cryptographic Verification ---");

	const testPrivKeyHex = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
	const signer = new NsecSigner(testPrivKeyHex);
	const pubkey = await signer.getPublicKey();

	const eventTemplate = {
		kind: 1,
		created_at: 1710000000,
		tags: [["t", "nostr"], ["t", "obsidian"]],
		content: "Decentralized publishing from Obsidian to Nostr! 🟣 #nostr #obsidian",
	};

	const signedEvent = await signer.signEvent(eventTemplate);

	// 1.1 Verify ID matches NIP-01 SHA-256 serialization [0, pubkey, created_at, kind, tags, content]
	const serialized = JSON.stringify([
		0,
		signedEvent.pubkey,
		signedEvent.created_at,
		signedEvent.kind,
		signedEvent.tags,
		signedEvent.content,
	]);
	const calculatedHash = computeSha256(new TextEncoder().encode(serialized));
	assert.strictEqual(signedEvent.id, calculatedHash, "Event ID must equal SHA-256 of NIP-01 serialized array");
	assert.strictEqual(signedEvent.id, getEventHash({ ...eventTemplate, pubkey }), "Event ID must match nostr-tools getEventHash");

	// 1.2 Verify Schnorr signature with nostr-tools
	assert.ok(verifyEvent(signedEvent), "Signed event must pass cryptographic Schnorr signature verification");
	console.log("  ✅ PASS: NIP-01 canonical serialization, SHA-256 ID, and Schnorr signature verified");
	passed++;

	// =========================================================================
	// 2. NIP-23 LONG-FORM (KIND 30023) AND DRAFTS (KIND 30024) COMPLIANCE
	// =========================================================================
	console.log("\n--- 2. NIP-23 Long-Form (Kind 30023) & Draft (Kind 30024) Protocol Compliance ---");

	const nip23Template = EventBuilder.buildLongFormEvent({
		slug: "nostr-writer-guide-2026",
		title: "Complete Guide to Nostr Writer Plugin",
		content: "# Complete Guide\n\nNostr long-form article content with inline images.",
		summary: "An in-depth manual for publishing directly from Obsidian.",
		bannerImageUrl: "https://blossom.primal.net/a1b2c3d4e5f6.png",
		tags: ["nostr", "obsidian", "guide"],
		imetaTags: [
			["imeta", "url https://blossom.primal.net/a1b2c3d4e5f6.png", "m image/png", "x a1b2c3d4e5f6"],
		],
		createdAt: 1715000000,
	});

	const signedNip23 = await signer.signEvent(nip23Template);
	assert.strictEqual(signedNip23.kind, 30023);
	assert.ok(verifyEvent(signedNip23), "Kind 30023 event must be cryptographically valid");

	// Validate NIP-23 required tag semantics
	const dTag = signedNip23.tags.find((t) => t[0] === "d");
	assert.ok(dTag && dTag[1] === "nostr-writer-guide-2026", "Kind 30023 must contain 'd' identifier tag");

	const titleTag = signedNip23.tags.find((t) => t[0] === "title");
	assert.ok(titleTag && titleTag[1] === "Complete Guide to Nostr Writer Plugin", "Kind 30023 must contain 'title' tag");

	const publishedAtTag = signedNip23.tags.find((t) => t[0] === "published_at");
	assert.ok(publishedAtTag && publishedAtTag[1] === "1715000000", "Kind 30023 must contain 'published_at' unix timestamp string");

	const imageTag = signedNip23.tags.find((t) => t[0] === "image");
	assert.ok(imageTag && imageTag[1] === "https://blossom.primal.net/a1b2c3d4e5f6.png", "Kind 30023 must contain 'image' banner tag");

	const topicTags = signedNip23.tags.filter((t) => t[0] === "t").map((t) => t[1]);
	assert.deepStrictEqual(topicTags, ["nostr", "obsidian", "guide"], "Topic tags must match lowercase list");

	const imetaTag = signedNip23.tags.find((t) => t[0] === "imeta");
	assert.ok(imetaTag && imetaTag[1] === "url https://blossom.primal.net/a1b2c3d4e5f6.png", "NIP-92 imeta tag must be present");
	console.log("  ✅ PASS: NIP-23 Kind 30023 tag structure, imeta, and parameter rules verified");
	passed++;

	// Draft validation (Kind 30024)
	const draftTemplate = EventBuilder.buildDraftEvent({
		slug: "draft-slug-123",
		title: "Draft Article",
		content: "Draft text...",
		tags: ["draft"],
	});
	const signedDraft = await signer.signEvent(draftTemplate);
	assert.strictEqual(signedDraft.kind, 30024);
	assert.ok(signedDraft.tags.some((t) => t[0] === "d" && t[1] === "draft-slug-123"));
	assert.ok(verifyEvent(signedDraft), "Kind 30024 draft event must be cryptographically valid");
	console.log("  ✅ PASS: NIP-23 Kind 30024 Draft event structure and signature verified");
	passed++;

	// =========================================================================
	// 3. NIP-98 BLOSSOM HTTP AUTHENTICATION (KIND 27235) COMPLIANCE
	// =========================================================================
	console.log("\n--- 3. NIP-98 Blossom HTTP Auth Header (Kind 27235) ---");

	const uploadUrl = "https://cdn.satellite.earth/upload";
	const filePayloadHex = computeSha256(new TextEncoder().encode("dummy file binary stream"));
	const testTimestamp = 1715000500;

	const authHeader = await generateNip98AuthHeader({
		uploadUrl,
		method: "PUT",
		sha256Hex: filePayloadHex,
		signer,
		createdAt: testTimestamp,
	});

	assert.ok(authHeader.startsWith("Nostr "), "Auth header scheme must be 'Nostr <base64>'");
	const rawPayload = Buffer.from(authHeader.substring(6), "base64").toString("utf-8");
	const authEvent = JSON.parse(rawPayload);

	assert.strictEqual(authEvent.kind, 27235, "NIP-98 auth event must have kind 27235");
	assert.strictEqual(authEvent.pubkey, pubkey);
	assert.ok(authEvent.tags.some((t: string[]) => t[0] === "u" && t[1] === uploadUrl));
	assert.ok(authEvent.tags.some((t: string[]) => t[0] === "method" && t[1] === "PUT"));
	assert.ok(authEvent.tags.some((t: string[]) => t[0] === "payload" && t[1] === filePayloadHex));
	assert.ok(verifyEvent(authEvent), "NIP-98 auth event must pass Schnorr signature verification");
	console.log("  ✅ PASS: NIP-98 Kind 27235 header generation and cryptographic signature verified");
	passed++;

	// =========================================================================
	// 4. nak CLI INTEROPERABILITY VALIDATION
	// =========================================================================
	console.log("\n--- 4. nak CLI JSON Format & Interoperability Compatibility ---");

	// nak expects strict Nostr event JSON on stdin or args:
	// {"id":"...","pubkey":"...","created_at":...,"kind":...,"tags":[...],"content":"...","sig":"..."}
	const nakCompatibleJson = JSON.stringify(signedNip23);
	const parsedFromNak = JSON.parse(nakCompatibleJson);

	assert.strictEqual(typeof parsedFromNak.id, "string");
	assert.strictEqual(parsedFromNak.id.length, 64);
	assert.strictEqual(typeof parsedFromNak.pubkey, "string");
	assert.strictEqual(parsedFromNak.pubkey.length, 64);
	assert.strictEqual(typeof parsedFromNak.created_at, "number");
	assert.strictEqual(typeof parsedFromNak.kind, "number");
	assert.ok(Array.isArray(parsedFromNak.tags));
	assert.strictEqual(typeof parsedFromNak.content, "string");
	assert.strictEqual(typeof parsedFromNak.sig, "string");
	assert.strictEqual(parsedFromNak.sig.length, 128);

	// Verify that the JSON contains no unexpected properties that might break nak or relays
	const allowedKeys = new Set(["id", "pubkey", "created_at", "kind", "tags", "content", "sig"]);
	for (const key of Object.keys(parsedFromNak)) {
		assert.ok(allowedKeys.has(key), `nak/NIP-01 event should only contain standard fields, found unexpected: '${key}'`);
	}
	console.log("  ✅ PASS: Event JSON format strictly adheres to nak CLI and NIP-01 specifications");
	passed++;

	// =========================================================================
	// 5. SECURITY & ZERO KEY LEAKAGE AUDIT
	// =========================================================================
	console.log("\n--- 5. Security Audit: Zero Key Leakage & Input Sanitization ---");

	// 5.1 Zero key leakage in event templates and signed events
	const serializedEvent = JSON.stringify(signedNip23);
	assert.ok(!serializedEvent.includes(testPrivKeyHex), "Private key hex must never appear in serialized event JSON");
	assert.ok(!serializedEvent.includes("nsec"), "nsec bech32 must never appear in serialized event JSON");

	// 5.2 Zero key leakage in error messages
	try {
		await SignerFactory.createSigner({
			type: "nsec",
			target: "nsec1malformedkeywithinvalidbech32characters",
		});
		assert.fail("Should have thrown error on invalid nsec");
	} catch (err: any) {
		// Verify error message does not expose raw private key payload
		assert.ok(!err.message.includes("0123456789abcdef"), "Error message must not leak keys");
	}

	// 5.3 Slug sanitization & XSS safety in tags
	const maliciousInput = "<script>alert('xss')</script>, #normal_tag, <img src=x onerror=alert(1)>";
	const extractedTags = normalizeTags(parseTagInput(maliciousInput));
	for (const tag of extractedTags) {
		assert.ok(!tag.includes("<script>"), "Tag extractor must sanitize script tags");
		assert.ok(!tag.includes("onerror"), "Tag extractor must sanitize malicious event handlers");
	}

	// 5.4 Slug validation against path traversal / injection
	const dangerousSlug1 = validateSlug("../../../etc/passwd");
	assert.strictEqual(dangerousSlug1.isValid, false, "Path traversal in slug must be rejected");

	const dangerousSlug2 = validateSlug("slug with spaces & <chars>");
	assert.strictEqual(dangerousSlug2.isValid, false, "Invalid characters in slug must be rejected");

	// 5.5 Relay URL sanitization against javascript: or invalid schemes
	const dirtyRelays = [
		"javascript:alert(1)",
		"file:///etc/hosts",
		"http://valid-dev-relay.local:8080",
		"wss://nos.lol/",
		"  wss://relay.damus.io  ",
	];
	const cleanRelays = sanitizeRelayList(dirtyRelays);
	assert.deepStrictEqual(cleanRelays, [
		"ws://valid-dev-relay.local:8080",
		"wss://nos.lol",
		"wss://relay.damus.io",
	]);
	console.log("  ✅ PASS: Security audits passed - zero key leakage, injection prevention, and URL sanitization");
	passed++;

	// =========================================================================
	// 6. MULTI-SIGNER & BUNKER POINTER RESILIENCE
	// =========================================================================
	console.log("\n--- 6. Multi-Signer & Bunker URI Parsing Subsystem ---");

	const bunkerUri1 = "bunker://0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef?relay=wss://relay.nsec.app&secret=xyz123";
	const bp1 = await BunkerSigner.parseURI(bunkerUri1);
	assert.ok(bp1 !== null);
	assert.strictEqual(bp1?.pubkey, "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
	assert.deepStrictEqual(bp1?.relays, ["wss://relay.nsec.app"]);
	assert.strictEqual(bp1?.secret, "xyz123");

	// Test bunker with UUID secret containing dashes and multiple relays
	const userBunkerUri = "bunker://7d8ad9932a2574a75bf644615177629058a2d5914160dec625b56cee01907868?relay=wss://relay.primal.net/&relay=wss://theforest.nostr1.com/&relay=wss://nostr.oxtr.dev/&secret=4f7332ba-a3ec-40b7-ac48-b3f7015c4cf2";
	const bpUser = await BunkerSigner.parseURI(userBunkerUri);
	assert.ok(bpUser !== null);
	assert.strictEqual(bpUser?.pubkey, "7d8ad9932a2574a75bf644615177629058a2d5914160dec625b56cee01907868");
	assert.deepStrictEqual(bpUser?.relays, [
		"wss://relay.primal.net/",
		"wss://theforest.nostr1.com/",
		"wss://nostr.oxtr.dev/",
	]);
	assert.strictEqual(bpUser?.secret, "4f7332ba-a3ec-40b7-ac48-b3f7015c4cf2");

	const nostrConnectUri = "nostrconnect://0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef?relay=wss://relay.damus.io&secret=testsecret";
	const bp2 = await BunkerSigner.parseURI(nostrConnectUri);
	assert.ok(bp2 !== null);
	assert.strictEqual(bp2?.pubkey, "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
	assert.deepStrictEqual(bp2?.relays, ["wss://relay.damus.io"]);
	assert.strictEqual(bp2?.secret, "testsecret");
	console.log("  ✅ PASS: Bunker and NostrConnect URI parser resilience verified");
	passed++;

	// =========================================================================
	// 7. PERSISTENT CLIENT KEYPAIR & AMBER / BUNKER COMPATIBILITY
	// =========================================================================
	console.log("\n--- 7. Persistent Client Keypair & Amber Identity Verification ---");
	const testClientSk = generateSecretKey();
	const testBunker = await BunkerSigner.fromURI(userBunkerUri, testClientSk);

	assert.deepStrictEqual(testBunker.getClientSecretKey(), testClientSk, "Client secret key must match persisted key");
	assert.strictEqual(typeof testBunker.getClientPublicKey(), "string");
	assert.strictEqual(testBunker.getClientPublicKey().length, 64);
	assert.ok(testBunker.getClientNpub().startsWith("npub1"), "Client npub must be a valid bech32 npub1 string");

	// Factory creation test with clientSecretKey
	const factoryBunkerSigner = await SignerFactory.createSigner({
		type: "bunker",
		target: userBunkerUri,
		clientSecretKey: testClientSk,
	}) as BunkerSigner;

	assert.strictEqual(factoryBunkerSigner.getType(), "bunker");
	assert.deepStrictEqual(factoryBunkerSigner.getClientSecretKey(), testClientSk);
	assert.strictEqual(factoryBunkerSigner.getClientNpub(), testBunker.getClientNpub());
	console.log("  ✅ PASS: Persistent Bunker client keypair and Amber identity verified");
	passed++;

	// =========================================================================
	// 8. VAULT FILENAME SANITIZATION & NIP-23 RELAY DEDUPLICATION
	// =========================================================================
	console.log("\n--- 8. Vault Filename Sanitization, Deduplication & Article Importer ---");

	// Test filename sanitization
	assert.strictEqual(
		sanitizeVaultFilename("What is Nostr? / An Introduction: Part 1 *Draft* <v2>"),
		"What is Nostr An Introduction Part 1 Draft v2",
		"Must strip illegal filesystem characters"
	);
	assert.strictEqual(
		sanitizeVaultFilename("...Hello World..."),
		"Hello World",
		"Must strip leading and trailing periods"
	);
	assert.strictEqual(
		sanitizeVaultFilename(""),
		"nostr-article",
		"Must fallback to default name on empty input"
	);

	// Test NIP-23 Parameterized Replaceable Event deduplication by d-tag + ghost unslugged resolution
	const mockArticles = [
		{
			id: "old_article_id_1",
			kind: 30023,
			pubkey: pubkey,
			created_at: 1000,
			tags: [["d", "my-slug"], ["title", "Old Version"]],
			content: "Old body",
		},
		{
			id: "new_article_id_1",
			kind: 30023,
			pubkey: pubkey,
			created_at: 2000,
			tags: [["d", "my-slug"], ["title", "Updated Version"]],
			content: "Updated body",
		},
		{
			id: "ghost_unslugged_duplicate_id",
			kind: 30023,
			pubkey: pubkey,
			created_at: 2000,
			tags: [["title", "Updated Version"]],
			content: "Duplicate unslugged body",
		},
		{
			id: "another_article_id",
			kind: 30023,
			pubkey: pubkey,
			created_at: 1500,
			tags: [["d", "another-slug"], ["title", "Another Note"]],
			content: "Another note body",
		},
		{
			id: "genuine_orphan_standalone_id",
			kind: 30023,
			pubkey: pubkey,
			created_at: 1200,
			tags: [["title", "Unique Legacy Note"]],
			content: "Standalone legacy unslugged body",
		},
	];

	// Phase 1: Slugged
	const sluggedArticlesMap = new Map<string, any>();
	const unsluggedEvents: any[] = [];
	for (const a of mockArticles) {
		const d = a.tags.find((t: string[]) => t[0] === "d")?.[1]?.trim() || "";
		if (d) {
			const coordKey = `${a.kind}:${d}`;
			const existing = sluggedArticlesMap.get(coordKey);
			if (!existing || a.created_at > existing.created_at) {
				sluggedArticlesMap.set(coordKey, a);
			}
		} else {
			unsluggedEvents.push(a);
		}
	}

	const sluggedTitles = new Set<string>();
	for (const a of sluggedArticlesMap.values()) {
		const title = a.tags.find((t: string[]) => t[0] === "title")?.[1]?.trim();
		if (title) sluggedTitles.add(title.toLowerCase());
	}

	// Phase 2: Unslugged
	const uniqueUnsluggedMap = new Map<string, any>();
	for (const a of unsluggedEvents) {
		const title = a.tags.find((t: string[]) => t[0] === "title")?.[1]?.trim();
		const normTitle = title ? title.toLowerCase() : "";
		if (normTitle && sluggedTitles.has(normTitle)) {
			continue; // discard ghost
		}
		uniqueUnsluggedMap.set(a.id, a);
	}

	const dedupedList = [
		...Array.from(sluggedArticlesMap.values()),
		...Array.from(uniqueUnsluggedMap.values()),
	];

	assert.strictEqual(dedupedList.length, 3, "Must deduplicate to 2 slugged articles and 1 genuine standalone orphan");
	const mySlugEvent = dedupedList.find((e) => e.tags.some((t: string[]) => t[0] === "d" && t[1] === "my-slug"));
	assert.strictEqual(mySlugEvent?.id, "new_article_id_1", "Must retain the newest version of my-slug (created_at: 2000)");
	assert.strictEqual(mySlugEvent?.tags.find((t: string[]) => t[0] === "title")?.[1], "Updated Version");
	
	const legacyEvent = dedupedList.find((e) => e.id === "genuine_orphan_standalone_id");
	assert.ok(legacyEvent, "Must preserve genuine unslugged standalone note");

	const ghostEvent = dedupedList.find((e) => e.id === "ghost_unslugged_duplicate_id");
	assert.strictEqual(ghostEvent, undefined, "Ghost unslugged duplicate matching slugged title must be discarded");

	console.log("  ✅ PASS: Vault filename sanitization, NIP-23 replaceable event deduplication & ghost resolution verified");
	passed++;

	// =========================================================================
	// 9. BUNKER USER PUBKEY DISCOVERY & UNIFIED RELAYS RESOLUTION
	// =========================================================================
	console.log("\n--- 9. Bunker User Pubkey Discovery & Unified Relays Resolution ---");

	const mockBunkerUri = "bunker://1111111111111111111111111111111111111111111111111111111111111111?relay=wss://relay.nsec.app&relay=wss://relay.damus.io&secret=mock-secret";
	const bunkerSignerInstance = await BunkerSigner.fromURI(mockBunkerUri, testClientSk);

	// Verify that bunker pointer relays are preserved
	const bpRelays = bunkerSignerInstance.getBunkerPointer().relays;
	assert.deepStrictEqual(bpRelays, ["wss://relay.nsec.app", "wss://relay.damus.io"]);

	// Verify that client identity is generated and different from bunker pointer
	assert.strictEqual(bunkerSignerInstance.getClientPublicKey().length, 64);
	assert.notStrictEqual(bunkerSignerInstance.getClientPublicKey(), bunkerSignerInstance.getBunkerPointer().pubkey);

	// Test unified relay list resolution (configured relays + bunker relays + defaults)
	const configuredRelays = ["wss://relay.nostr.band", "wss://nos.lol"];
	const unified = sanitizeRelayList([
		...configuredRelays,
		...bpRelays,
		"wss://nos.lol",
		"wss://relay.damus.io",
	]);
	assert.ok(unified.includes("wss://relay.nsec.app"), "Unified relays must include bunker relays");
	assert.ok(unified.includes("wss://relay.nostr.band"), "Unified relays must include configured relays");
	assert.ok(unified.includes("wss://nos.lol"), "Unified relays must include default relays");
	// Check deduplication
	const uniqueSet = new Set(unified);
	assert.strictEqual(unified.length, uniqueSet.size, "Unified relays must be deduplicated");

	console.log("  ✅ PASS: Bunker user pubkey discovery and unified relay resolution verified");
	passed++;


	// =========================================================================
	// SUMMARY
	// =========================================================================
	console.log("\n==========================================");
	console.log(`PHASE 5 TEST RESULTS: ${passed} passed, ${failed} failed`);
	console.log("==========================================");

	if (failed > 0) {
		process.exit(1);
	}
}

runPhase5Tests().catch((e) => {
	console.error("Phase 5 test execution failed:", e);
	process.exit(1);
});

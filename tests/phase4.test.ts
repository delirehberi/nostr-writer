import * as assert from "assert";
import {
	computeSha256,
	normalizeServerUrl,
	generateNip98AuthHeader,
	buildImetaTag,
	getMimeTypeFromFileName,
	BlossomBlobDescriptor,
} from "../src/utils/BlossomUtil";
import {
	normalizeRelayUrl,
	validateRelayUrl,
	sanitizeRelayList,
} from "../src/utils/RelayUtil";
import { NsecSigner } from "../src/signer/NsecSigner";
import { verifyEvent } from "nostr-tools/pure";

console.log("==========================================");
console.log("RUNNING PHASE 4 UNIT TESTS");
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

async function runTests() {
	// ==========================================
	// 1. SHA-256 COMPUTATION TESTS
	// ==========================================
	console.log("\n--- 1. SHA-256 Computation & MIME Types ---");

	// Known test vector: SHA-256 of "hello world"
	// b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9
	const textEncoder = new TextEncoder();
	const helloBytes = textEncoder.encode("hello world");
	const hash = computeSha256(helloBytes);
	assert.strictEqual(hash, "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9");

	// SHA-256 of empty string:
	// e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
	const emptyHash = computeSha256(new Uint8Array(0));
	assert.strictEqual(emptyHash, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");

	// MIME detection
	assert.strictEqual(getMimeTypeFromFileName("image.png"), "image/png");
	assert.strictEqual(getMimeTypeFromFileName("photo.JPG"), "image/jpeg");
	assert.strictEqual(getMimeTypeFromFileName("photo.jpeg"), "image/jpeg");
	assert.strictEqual(getMimeTypeFromFileName("graphic.webp"), "image/webp");
	assert.strictEqual(getMimeTypeFromFileName("anim.gif"), "image/gif");
	assert.strictEqual(getMimeTypeFromFileName("vector.svg"), "image/svg+xml");
	assert.strictEqual(getMimeTypeFromFileName("unknown.xyz"), "application/octet-stream");
	console.log("  ✅ PASS: SHA-256 computation and MIME detection");
	passed += 3;

	// ==========================================
	// 2. SERVER URL NORMALIZATION TESTS
	// ==========================================
	console.log("\n--- 2. Blossom Server URL Normalization ---");

	assert.strictEqual(normalizeServerUrl("blossom.primal.net"), "https://blossom.primal.net");
	assert.strictEqual(normalizeServerUrl("https://blossom.damus.io/"), "https://blossom.damus.io");
	assert.strictEqual(normalizeServerUrl("http://localhost:8080/"), "http://localhost:8080");
	assert.strictEqual(normalizeServerUrl("  https://cdn.satellite.earth/path/  "), "https://cdn.satellite.earth/path");
	assert.strictEqual(normalizeServerUrl(""), "https://blossom.primal.net");
	console.log("  ✅ PASS: Blossom server URL normalization");
	passed++;

	// ==========================================
	// 3. NIP-98 AUTH HEADER GENERATION TESTS
	// ==========================================
	console.log("\n--- 3. NIP-98 HTTP Auth Header Generation ---");

	// Test private key (hex)
	const testPrivKeyHex = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
	const signer = new NsecSigner(testPrivKeyHex);
	const expectedPubkey = await signer.getPublicKey();

	const uploadUrl = "https://blossom.primal.net/upload";
	const payloadHash = "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9";
	const testCreatedAt = 1710000000;

	const authHeader = await generateNip98AuthHeader({
		uploadUrl,
		method: "PUT",
		sha256Hex: payloadHash,
		signer,
		createdAt: testCreatedAt,
	});

	assert.ok(authHeader.startsWith("Nostr "));
	const base64Token = authHeader.slice(6);
	const jsonStr = Buffer.from(base64Token, "base64").toString("utf-8");
	const authEvent = JSON.parse(jsonStr);

	assert.strictEqual(authEvent.kind, 27235);
	assert.strictEqual(authEvent.pubkey, expectedPubkey);
	assert.strictEqual(authEvent.created_at, testCreatedAt);
	assert.ok(authEvent.tags.some((t: string[]) => t[0] === "u" && t[1] === uploadUrl));
	assert.ok(authEvent.tags.some((t: string[]) => t[0] === "method" && t[1] === "PUT"));
	assert.ok(authEvent.tags.some((t: string[]) => t[0] === "payload" && t[1] === payloadHash));

	// Verify cryptographic signature of the NIP-98 event
	assert.ok(verifyEvent(authEvent));
	console.log("  ✅ PASS: NIP-98 Auth header contains verified Kind 27235 event with u/method/payload tags");
	passed++;

	// ==========================================
	// 4. NIP-92 IMETA TAG BUILDER TESTS
	// ==========================================
	console.log("\n--- 4. NIP-92 imeta Tag Construction ---");

	const descriptor: BlossomBlobDescriptor = {
		url: "https://blossom.primal.net/b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9.png",
		sha256: "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
		size: 204800,
		type: "image/png",
		dim: "1920x1080",
		blurhash: "L6Pj0^jE.AyE_3t7t7R**0o#DgR4",
	};

	const imetaTag = buildImetaTag(descriptor);
	assert.strictEqual(imetaTag[0], "imeta");
	assert.strictEqual(imetaTag[1], "url https://blossom.primal.net/b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9.png");
	assert.ok(imetaTag.includes("m image/png"));
	assert.ok(imetaTag.includes("x b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"));
	assert.ok(imetaTag.includes("size 204800"));
	assert.ok(imetaTag.includes("dim 1920x1080"));
	assert.ok(imetaTag.includes("blurhash L6Pj0^jE.AyE_3t7t7R**0o#DgR4"));
	console.log("  ✅ PASS: NIP-92 imeta tag properly formatted from Blossom descriptor");
	passed++;

	// ==========================================
	// 5. RELAY NORMALIZATION & SANITIZATION TESTS
	// ==========================================
	console.log("\n--- 5. Relay URL Normalization, Validation, & Deduplication ---");

	// Normalization
	assert.strictEqual(normalizeRelayUrl("wss://relay.damus.io/"), "wss://relay.damus.io");
	assert.strictEqual(normalizeRelayUrl("  relay.nostr.band  "), "wss://relay.nostr.band");
	assert.strictEqual(normalizeRelayUrl("http://localhost:8080/relay"), "ws://localhost:8080/relay");
	assert.strictEqual(normalizeRelayUrl("https://nos.lol"), "wss://nos.lol");
	assert.strictEqual(normalizeRelayUrl(""), null);
	assert.strictEqual(normalizeRelayUrl("not-a-url"), null);

	// Validation
	const val1 = validateRelayUrl("wss://nos.lol");
	assert.strictEqual(val1.isValid, true);
	assert.strictEqual(val1.normalizedUrl, "wss://nos.lol");

	const val2 = validateRelayUrl("invalid host !#$");
	assert.strictEqual(val2.isValid, false);

	// Sanitization & Deduplication
	const rawList = [
		"wss://nos.lol/",
		"  wss://nos.lol  ",
		"relay.damus.io",
		"wss://relay.damus.io/",
		"invalid-bad-url",
		"wss://relay.nostr.band",
		"",
	];

	const sanitized = sanitizeRelayList(rawList);
	assert.deepStrictEqual(sanitized, [
		"wss://nos.lol",
		"wss://relay.damus.io",
		"wss://relay.nostr.band",
	]);
	console.log("  ✅ PASS: Relay URL normalization, validation, and list deduplication");
	passed += 3;

	console.log("\n==========================================");
	console.log(`TEST RESULTS: ${passed} passed, ${failed} failed`);
	console.log("==========================================");

	if (failed > 0) {
		process.exit(1);
	}
}

runTests().catch((e) => {
	console.error("Test execution failed:", e);
	process.exit(1);
});

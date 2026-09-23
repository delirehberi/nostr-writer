import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import { NostrSigner } from "../signer";

export interface BlossomBlobDescriptor {
	url: string;
	sha256: string;
	size?: number;
	type?: string;
	uploaded?: number;
	dim?: string;
	blurhash?: string;
	thumb?: string;
	alt?: string;
}

/**
 * Computes the lowercase 64-character SHA-256 hex hash of an ArrayBuffer or Uint8Array.
 */
export function computeSha256(data: ArrayBuffer | Uint8Array): string {
	const uint8 = data instanceof Uint8Array ? data : new Uint8Array(data);
	const hashBytes = sha256(uint8);
	return bytesToHex(hashBytes).toLowerCase();
}

/**
 * Normalizes a Blossom server URL to a clean HTTPS origin without trailing slashes.
 */
export function normalizeServerUrl(serverUrl: string): string {
	let trimmed = serverUrl.trim();
	if (!trimmed) {
		return "https://blossom.primal.net";
	}

	if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
		trimmed = `https://${trimmed}`;
	}

	try {
		const urlObj = new URL(trimmed);
		let clean = `${urlObj.protocol}//${urlObj.host}${urlObj.pathname}`.replace(/\/+$/, "");
		return clean;
	} catch (_) {
		return trimmed.replace(/\/+$/, "");
	}
}

/**
 * Encodes a UTF-8 string to Base64 in both browser and Node.js environments.
 */
export function encodeBase64(str: string): string {
	if (typeof Buffer !== "undefined") {
		return Buffer.from(str, "utf-8").toString("base64");
	}
	return btoa(unescape(encodeURIComponent(str)));
}

/**
 * Generates a NIP-98 HTTP Auth header for Blossom PUT /upload requests.
 * Header format: `Nostr <base64-encoded-kind-27235-event>`
 */
export async function generateNip98AuthHeader(params: {
	uploadUrl: string;
	method?: string;
	sha256Hex?: string;
	signer: NostrSigner;
	createdAt?: number;
}): Promise<string> {
	const method = (params.method || "PUT").toUpperCase();
	const createdAt = params.createdAt ?? Math.floor(Date.now() / 1000);

	const tags: string[][] = [
		["u", params.uploadUrl],
		["method", method],
	];

	if (params.sha256Hex) {
		tags.push(["payload", params.sha256Hex.toLowerCase()]);
	}

	const authEventTemplate = {
		kind: 27235,
		created_at: createdAt,
		tags,
		content: "",
	};

	const signedAuthEvent = await params.signer.signEvent(authEventTemplate);
	const jsonString = JSON.stringify(signedAuthEvent);
	const base64Token = encodeBase64(jsonString);

	return `Nostr ${base64Token}`;
}

/**
 * Builds a standardized NIP-92 `imeta` tag array from a Blossom blob descriptor.
 * Format: `["imeta", "url https://...", "m image/png", "x <sha256>", "size 12345", ...]`
 */
export function buildImetaTag(blob: BlossomBlobDescriptor): string[] {
	if (!blob || !blob.url) {
		throw new Error("Cannot build imeta tag without a valid blob URL.");
	}

	const imeta: string[] = ["imeta", `url ${blob.url}`];

	if (blob.type) {
		imeta.push(`m ${blob.type}`);
	}

	if (blob.sha256) {
		imeta.push(`x ${blob.sha256.toLowerCase()}`);
	}

	if (typeof blob.size === "number" && !isNaN(blob.size) && blob.size > 0) {
		imeta.push(`size ${blob.size}`);
	}

	if (blob.dim) {
		imeta.push(`dim ${blob.dim}`);
	}

	if (blob.blurhash) {
		imeta.push(`blurhash ${blob.blurhash}`);
	}

	if (blob.thumb) {
		imeta.push(`thumb ${blob.thumb}`);
	}

	if (blob.alt) {
		imeta.push(`alt ${blob.alt}`);
	}

	return imeta;
}

/**
 * Infers a MIME type from a file name extension.
 */
export function getMimeTypeFromFileName(fileName: string): string {
	const lower = fileName.toLowerCase();
	if (lower.endsWith(".png")) return "image/png";
	if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
	if (lower.endsWith(".gif")) return "image/gif";
	if (lower.endsWith(".webp")) return "image/webp";
	if (lower.endsWith(".svg")) return "image/svg+xml";
	if (lower.endsWith(".bmp")) return "image/bmp";
	if (lower.endsWith(".avif")) return "image/avif";
	return "application/octet-stream";
}

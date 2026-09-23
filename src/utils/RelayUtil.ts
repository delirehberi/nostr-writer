/**
 * Relay URL normalization and sanitization utilities.
 */

export interface RelayValidationResult {
	isValid: boolean;
	error?: string;
	normalizedUrl?: string;
}

/**
 * Normalizes a Nostr relay URL to a clean `wss://` or `ws://` endpoint without trailing slashes.
 * Returns null if the URL is invalid.
 */
export function normalizeRelayUrl(rawUrl: string): string | null {
	if (!rawUrl || typeof rawUrl !== "string") {
		return null;
	}

	let trimmed = rawUrl.trim();
	if (!trimmed) {
		return null;
	}

	// Default to wss:// if no protocol is given
	if (!trimmed.startsWith("wss://") && !trimmed.startsWith("ws://")) {
		// If protocol-relative or wrong protocol
		if (trimmed.startsWith("http://")) {
			trimmed = `ws://${trimmed.slice(7)}`;
		} else if (trimmed.startsWith("https://")) {
			trimmed = `wss://${trimmed.slice(8)}`;
		} else if (trimmed.startsWith("//")) {
			trimmed = `wss:${trimmed}`;
		} else {
			trimmed = `wss://${trimmed}`;
		}
	}

	try {
		const parsed = new URL(trimmed);
		if (parsed.protocol !== "wss:" && parsed.protocol !== "ws:") {
			return null;
		}

		if (!parsed.hostname || parsed.hostname.length < 3) {
			return null;
		}

		const host = parsed.hostname.toLowerCase();
		if (!isValidRelayHost(host)) {
			return null;
		}

		const pathname = parsed.pathname && parsed.pathname !== "/" ? parsed.pathname.replace(/\/+$/, "") : "";
		const search = parsed.search || "";
		const port = parsed.port ? `:${parsed.port}` : "";

		return `${parsed.protocol}//${host}${port}${pathname}${search}`;
	} catch (_) {
		return null;
	}
}

/**
 * Checks if a hostname is a valid domain, IP address, or localhost.
 */
export function isValidRelayHost(host: string): boolean {
	if (!host || host.length < 3) return false;
	if (host === "localhost") return true;
	// IPv4 check
	if (/^(\d{1,3}\.){3}\d{1,3}$/.test(host)) return true;
	// IPv6 check
	if (host.startsWith("[") && host.endsWith("]")) return true;
	// Standard domain with at least one dot
	if (host.includes(".") && !host.startsWith(".") && !host.endsWith(".")) {
		const parts = host.split(".");
		return parts.length >= 2 && parts.every(p => p.length > 0 && /^[a-z0-9-]+$/i.test(p));
	}
	return false;
}

/**
 * Validates a Nostr relay URL and returns a structured validation result.
 */
export function validateRelayUrl(rawUrl: string): RelayValidationResult {
	if (!rawUrl || rawUrl.trim() === "") {
		return { isValid: false, error: "Relay URL cannot be empty." };
	}

	const normalized = normalizeRelayUrl(rawUrl);
	if (!normalized) {
		return {
			isValid: false,
			error: "Invalid relay URL. Must start with wss:// or ws:// with a valid host.",
		};
	}

	return { isValid: true, normalizedUrl: normalized };
}

/**
 * Sanitizes and deduplicates an array of relay URLs.
 */
export function sanitizeRelayList(rawUrls: string[]): string[] {
	if (!Array.isArray(rawUrls)) {
		return [];
	}

	const seen = new Set<string>();
	const result: string[] = [];

	for (const url of rawUrls) {
		const normalized = normalizeRelayUrl(url);
		if (normalized && !seen.has(normalized)) {
			seen.add(normalized);
			result.push(normalized);
		}
	}

	return result;
}

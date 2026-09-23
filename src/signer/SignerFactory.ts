import { NostrSigner, SignerType } from "./NostrSigner";
import { NsecSigner } from "./NsecSigner";
import { BunkerSigner } from "./BunkerSigner";
import { decode } from "nostr-tools/nip19";

export interface SignerConfig {
	type: SignerType;
	target: string;
	clientSecretKey?: Uint8Array;
}

export class SignerFactory {
	/**
	 * Creates a NostrSigner from a SignerConfig.
	 */
	public static async createSigner(config: SignerConfig): Promise<NostrSigner> {
		if (!config || !config.target) {
			throw new Error("Signer target cannot be empty.");
		}

		const type = config.type || "nsec";

		if (type === "nsec") {
			return new NsecSigner(config.target);
		} else if (type === "bunker") {
			return await BunkerSigner.fromURI(config.target, config.clientSecretKey);
		}

		throw new Error(`Unsupported signer type: ${type}`);
	}

	/**
	 * Checks whether a given string is a valid nsec or 64-char hex private key.
	 */
	public static isValidNsec(key: string): boolean {
		if (!key || typeof key !== "string") return false;
		const trimmed = key.trim();
		if (trimmed.startsWith("nsec1")) {
			try {
				const decoded = decode(trimmed);
				return decoded.type === "nsec" && decoded.data instanceof Uint8Array && decoded.data.length === 32;
			} catch (_) {
				return false;
			}
		}
		return /^[0-9a-fA-F]{64}$/.test(trimmed);
	}

	/**
	 * Checks whether a given string is a valid bunker:// or nostrconnect:// URI or NIP-05.
	 */
	public static async isValidBunkerUri(uri: string): Promise<boolean> {
		if (!uri || typeof uri !== "string") return false;
		try {
			const bp = await BunkerSigner.parseURI(uri);
			return bp !== null && Array.isArray(bp.relays) && bp.relays.length > 0 && typeof bp.pubkey === "string";
		} catch (_) {
			return false;
		}
	}

	/**
	 * Validates a signer configuration.
	 */
	public static async isValidSignerConfig(type: SignerType, target: string): Promise<boolean> {
		if (type === "nsec") {
			return SignerFactory.isValidNsec(target);
		} else if (type === "bunker") {
			return await SignerFactory.isValidBunkerUri(target);
		}
		return false;
	}
}

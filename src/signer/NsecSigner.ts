import { EventTemplate, UnsignedEvent, VerifiedEvent } from "nostr-tools/core";
import { finalizeEvent, getPublicKey } from "nostr-tools/pure";
import { decode } from "nostr-tools/nip19";
import { hexToBytes } from "@noble/hashes/utils";
import { NostrSigner, SignerType } from "./NostrSigner";

export class NsecSigner implements NostrSigner {
	private secretKey: Uint8Array;
	private publicKey: string;

	constructor(key: string | Uint8Array) {
		this.secretKey = this.normalizeSecretKey(key);
		if (this.secretKey.length !== 32) {
			throw new Error("Invalid secret key length. Expected 32 bytes.");
		}
		this.publicKey = getPublicKey(this.secretKey);
	}

	private normalizeSecretKey(key: string | Uint8Array): Uint8Array {
		if (key instanceof Uint8Array) {
			return key;
		}

		if (typeof key === "string") {
			const trimmed = key.trim();
			if (trimmed.startsWith("nsec1")) {
				const decoded = decode(trimmed);
				if (decoded.type === "nsec" && decoded.data instanceof Uint8Array) {
					return decoded.data;
				}
				throw new Error("Invalid nsec encoding.");
			}

			// Check if 64-character hex string
			if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
				return hexToBytes(trimmed);
			}
		}

		throw new Error("Invalid private key format. Must be an nsec1... bech32 string or 64-char hex.");
	}

	public getType(): SignerType {
		return "nsec";
	}

	public async getPublicKey(): Promise<string> {
		return this.publicKey;
	}

	public async signEvent(eventTemplate: EventTemplate | UnsignedEvent): Promise<VerifiedEvent> {
		return finalizeEvent(eventTemplate as EventTemplate, this.secretKey);
	}

	public getRawSecretKey(): Uint8Array {
		return this.secretKey;
	}
}

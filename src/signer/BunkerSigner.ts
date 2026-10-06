import { EventTemplate, UnsignedEvent, VerifiedEvent } from "nostr-tools/core";
import { BunkerPointer, BunkerSigner as Nip46BunkerSigner, parseBunkerInput } from "nostr-tools/nip46";
import { generateSecretKey, getPublicKey, verifyEvent, getEventHash } from "nostr-tools/pure";
import { NostrSigner, SignerType } from "./NostrSigner";
import { decode, npubEncode } from "nostr-tools/nip19";
import { Logger } from "../utils/Logger";

function safeNotice(msg: string, timeout?: number): void {
	try {
		const obsidian = require("obsidian");
		if (obsidian && obsidian.Notice) {
			new obsidian.Notice(msg, timeout);
		}
	} catch (_) {}
}

async function withTimeout<T>(promise: Promise<T>, ms: number, errorMsg: string): Promise<T> {
	let timer: any;
	const timeoutPromise = new Promise<T>((_, reject) => {
		timer = setTimeout(() => {
			reject(new Error(errorMsg));
		}, ms);
	});
	try {
		return await Promise.race([promise, timeoutPromise]);
	} finally {
		clearTimeout(timer);
	}
}

export class BunkerSigner implements NostrSigner {
	private remoteSigner: Nip46BunkerSigner | null = null;
	private clientSecretKey: Uint8Array;
	private bunkerPointer: BunkerPointer;
	private isConnected = false;
	private userPubkey: string = "";

	constructor(bunkerPointer: BunkerPointer, clientSecretKey?: Uint8Array) {
		this.bunkerPointer = bunkerPointer;
		this.clientSecretKey = clientSecretKey || generateSecretKey();
	}

	public static async fromURI(uri: string, clientSecretKey?: Uint8Array): Promise<BunkerSigner> {
		const bp = await BunkerSigner.parseURI(uri);
		if (!bp) {
			throw new Error(`Failed to parse bunker connection URI: ${uri}`);
		}
		return new BunkerSigner(bp, clientSecretKey);
	}

	public static async parseURI(uri: string): Promise<BunkerPointer | null> {
		const trimmed = uri.trim();
		if (trimmed.startsWith("nostrconnect://") || trimmed.startsWith("bunker://")) {
			try {
				const withoutScheme = trimmed.replace(/^(nostrconnect|bunker):\/\//, "");
				const qIndex = withoutScheme.indexOf("?");
				let rawPubkey = qIndex !== -1 ? withoutScheme.substring(0, qIndex) : withoutScheme;
				const queryString = qIndex !== -1 ? withoutScheme.substring(qIndex + 1) : "";

				rawPubkey = rawPubkey.replace(/\/+$/, "");

				// Support npub1 bech32 pubkeys in bunker URI
				if (rawPubkey.startsWith("npub1")) {
					try {
						const decoded = decode(rawPubkey);
						if (decoded.type === "npub" && typeof decoded.data === "string") {
							rawPubkey = decoded.data;
						}
					} catch (_) {
						// Ignore decoding failure, let regex check fail
					}
				}

				if (!/^[0-9a-fA-F]{64}$/.test(rawPubkey)) {
					return null;
				}

				const searchParams = new URLSearchParams(queryString);
				const relays = searchParams.getAll("relay");
				const secret = searchParams.get("secret");

				return {
					pubkey: rawPubkey.toLowerCase(),
					relays,
					secret,
				};
			} catch (e) {
				Logger.error("Failed to parse bunker/nostrconnect URI:", e);
				return null;
			}
		}

		return await parseBunkerInput(trimmed);
	}

	public getClientSecretKey(): Uint8Array {
		return this.clientSecretKey;
	}

	public getClientPublicKey(): string {
		return getPublicKey(this.clientSecretKey);
	}

	public getClientNpub(): string {
		try {
			return npubEncode(this.getClientPublicKey());
		} catch (_) {
			return this.getClientPublicKey();
		}
	}

	private async ensureConnected(): Promise<Nip46BunkerSigner> {
		if (this.remoteSigner && this.isConnected) {
			return this.remoteSigner;
		}

		if (!this.remoteSigner) {
			Logger.info(`[BunkerSigner] Initializing Nip46BunkerSigner for target ${this.bunkerPointer.pubkey} with client ${this.getClientNpub()} on relays: ${this.bunkerPointer.relays.join(", ")}`);
			this.remoteSigner = new Nip46BunkerSigner(this.clientSecretKey, this.bunkerPointer, {
				onauth: (url: string) => {
					Logger.warn(`[BunkerSigner] Bunker requested authentication URL: ${url}`);
					safeNotice(`🔐 Bunker requires authentication! Opening auth URL...`, 10000);
					if (typeof window !== "undefined" && window.open) {
						window.open(url, "_blank");
					}
				},
			});
		}

		Logger.info(`[BunkerSigner] Connecting to remote bunker (${this.bunkerPointer.pubkey}) with client pubkey ${this.getClientPublicKey()}...`);
		
		const requestedPerms = "sign_event,nip04_encrypt,nip04_decrypt,nip44_encrypt,nip44_decrypt,get_public_key,get_relays";
		let initialConnectError: any = null;
		let handshakeOk = false;

		try {
			// Send connect RPC with client pubkey and requested permissions
			await withTimeout(
				(this.remoteSigner as any).sendRequest("connect", [
					this.getClientPublicKey(),
					this.bunkerPointer.secret || "",
					requestedPerms,
				]),
				35000,
				`Connection to Bunker (${this.bunkerPointer.pubkey}) timed out after 35s. Please open Amber (or your bunker signer) and approve the connection request.`
			);
			this.isConnected = true;
			handshakeOk = true;
			Logger.info(`[BunkerSigner] Connected successfully via connect handshake!`);
		} catch (error: any) {
			initialConnectError = error;
			Logger.warn(`[BunkerSigner] Primary connect request returned (${error.message}), attempting fallback handshake or get_public_key verification...`);
			
			// Fallback attempt: try nostr-tools standard connect parameter shape [clientPubkey, secret]
			try {
				await withTimeout(
					(this.remoteSigner as any).sendRequest("connect", [
						this.getClientPublicKey(),
						this.bunkerPointer.secret || "",
					]),
					15000,
					`Secondary connect handshake timed out.`
				);
				this.isConnected = true;
				handshakeOk = true;
				Logger.info(`[BunkerSigner] Connected via secondary handshake!`);
			} catch (_) {
				// If connect rejected (e.g. secret was one-time and already consumed, or Amber already paired), check get_public_key
			}
		}

		// Verify connection liveness and discover actual user signing public key
		try {
			const userPk = await withTimeout(
				(this.remoteSigner as any).sendRequest("get_public_key", []),
				20000,
				`Liveness check (get_public_key) timed out after 20s. Please ensure Amber / remote signer is running.`
			);
			const parsedPk = BunkerSigner.parsePublicKeyResponse(userPk);
			if (parsedPk) {
				this.userPubkey = parsedPk;
				this.isConnected = true;
				Logger.info(`[BunkerSigner] Discovered user signing pubkey: ${this.userPubkey}`);
			} else {
				throw new Error(`Invalid get_public_key response from bunker: ${userPk}`);
			}
		} catch (pkError: any) {
			Logger.error(`[BunkerSigner] Failed to query user public key from bunker:`, pkError);
			const errStr = (pkError.message || initialConnectError?.message || String(pkError)).toLowerCase();
			if (errStr.includes("no permission") || errStr.includes("unauthorized") || errStr.includes("denied")) {
				throw new Error(
					`Bunker returned 'no permission'. Please open Amber (or your signer app) and make sure you approve the connection request for client app (${this.getClientNpub()}).`
				);
			}
			if (handshakeOk) {
				// Paired successfully but this bunker answers get_public_key in an unexpected way;
				// keep going with the pointer pubkey. signEvent() adopts the real pubkey from the signed event.
				Logger.warn(`[BunkerSigner] get_public_key unusable (${pkError.message || pkError}); continuing with bunker pointer pubkey`);
				this.isConnected = true;
				return this.remoteSigner;
			}
			throw new Error(`Failed to connect to remote bunker (${this.bunkerPointer.pubkey}): ${pkError.message || initialConnectError?.message || pkError}`);
		}

		return this.remoteSigner;
	}

	/** Accepts a 64-char hex pubkey or an npub; returns lowercase hex, or null for anything else (e.g. "ack"). */
	private static parsePublicKeyResponse(res: unknown): string | null {
		if (typeof res !== "string") return null;
		const v = res.trim();
		if (/^[0-9a-fA-F]{64}$/.test(v)) return v.toLowerCase();
		if (v.startsWith("npub1")) {
			try {
				const d = decode(v);
				if (d.type === "npub" && typeof d.data === "string") return d.data;
			} catch (_) {}
		}
		return null;
	}

	public getType(): SignerType {
		return "bunker";
	}

	public async getPublicKey(): Promise<string> {
		if (this.userPubkey) {
			return this.userPubkey;
		}
		try {
			await this.ensureConnected();
			if (this.userPubkey) {
				return this.userPubkey;
			}
		} catch (e: any) {
			Logger.warn(`[BunkerSigner] Could not retrieve user pubkey from bunker (${e.message || e}), falling back to pointer pubkey`);
		}
		return this.userPubkey || this.bunkerPointer.pubkey;
	}

	public async signEvent(eventTemplate: EventTemplate | UnsignedEvent): Promise<VerifiedEvent> {
		Logger.info(`[BunkerSigner] Requesting signature from Bunker for Kind ${eventTemplate.kind} event...`);
		const signer = await this.ensureConnected();

		const eventToSign = {
			...eventTemplate,
			pubkey: (eventTemplate as any).pubkey || this.userPubkey || this.bunkerPointer.pubkey,
		};
		
		let resp: any;
		try {
			resp = await withTimeout(
				(signer as any).sendRequest("sign_event", [JSON.stringify(eventToSign)]),
				45000,
				`Bunker signing timed out after 45s. Please open Amber or your signer app and approve the signing request.`
			);
		} catch (signErr: any) {
			const errStr = (signErr.message || String(signErr)).toLowerCase();
			if (errStr.includes("no permission") || errStr.includes("unauthorized") || errStr.includes("denied")) {
				throw new Error(
					`Bunker denied signing (no permission). Please open Amber and approve the signing request or check permissions for client ${this.getClientNpub()}.`
				);
			}
			throw signErr;
		}

		let signed: any;
		try {
			signed = typeof resp === "string" ? JSON.parse(resp) : resp;
		} catch (err: any) {
			Logger.error(`[BunkerSigner] Failed to parse bunker sign_event response:`, resp);
			throw new Error(`Invalid JSON response from bunker: ${resp}`);
		}

		if (!signed || typeof signed !== "object") {
			throw new Error(`Empty or invalid response from bunker: ${JSON.stringify(signed)}`);
		}

		// Ensure id is present or compute it
		if (!signed.id) {
			signed.id = getEventHash(signed);
		}

		// Verify cryptographic validity (Schnorr signature over secp256k1)
		if (verifyEvent(signed)) {
			this.userPubkey = signed.pubkey;
			Logger.info(`[BunkerSigner] Successfully signed and verified event (Kind ${signed.kind}, ID: ${signed.id}, Pubkey: ${signed.pubkey})`);
			return signed as VerifiedEvent;
		} else {
			Logger.error(`[BunkerSigner] Event returned from bunker failed Schnorr verification:`, signed);
			throw new Error(`Event returned from bunker failed cryptographic verification: ${JSON.stringify(signed)}`);
		}
	}

	public async ping(): Promise<boolean> {
		try {
			const signer = await this.ensureConnected();
			const res = await (signer as any).sendRequest("get_public_key", []);
			return BunkerSigner.parsePublicKeyResponse(res) !== null;
		} catch (e: any) {
			Logger.error("Bunker liveness check failed:", e.message || e);
			return false;
		}
	}

	public async close(): Promise<void> {
		if (this.remoteSigner) {
			try {
				await this.remoteSigner.close();
			} catch (e) {
				Logger.error("Error closing bunker signer:", e);
			}
			this.remoteSigner = null;
			this.isConnected = false;
		}
	}

	public getBunkerPointer(): BunkerPointer {
		return this.bunkerPointer;
	}
}


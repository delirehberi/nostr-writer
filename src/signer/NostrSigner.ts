import { EventTemplate, UnsignedEvent, VerifiedEvent } from "nostr-tools/core";

export type SignerType = "nsec" | "bunker";

export interface NostrSigner {
	/**
	 * Returns the type of signer (local nsec or remote bunker).
	 */
	getType(): SignerType;

	/**
	 * Returns the hex-encoded 32-byte public key of the signer.
	 */
	getPublicKey(): Promise<string>;

	/**
	 * Signs a Nostr event template and returns a verified Nostr event.
	 */
	signEvent(eventTemplate: EventTemplate | UnsignedEvent): Promise<VerifiedEvent>;

	/**
	 * Closes any open connections or subscriptions associated with the signer.
	 */
	close?(): Promise<void>;

	/**
	 * Health check / ping for remote signers.
	 */
	ping?(): Promise<boolean>;
}

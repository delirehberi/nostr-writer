import NostrWriterPlugin from "main";
import { App, Notice, FileSystemAdapter, TFile, normalizePath, requestUrl } from "obsidian";
import { NostrWriterPluginSettings } from "src/settings";
import { NostrSigner } from "../signer";
import {
	BlossomBlobDescriptor,
	buildImetaTag,
	computeSha256,
	generateNip98AuthHeader,
	getMimeTypeFromFileName,
	normalizeServerUrl,
} from "../utils/BlossomUtil";

export interface ImageUploadResultItem {
	filePath: string;
	stringToReplace: string;
	replacementStringURL: string;
	imetaTag: string[];
	blobDescriptor: BlossomBlobDescriptor;
}

export interface ImageUploadBatchResult {
	success: boolean;
	results: ImageUploadResultItem[];
}

export default class ImageUploadService {
	private plugin: NostrWriterPlugin;
	private app: App;
	private defaultServer: string;

	constructor(plugin: NostrWriterPlugin, app: App, settings: NostrWriterPluginSettings) {
		this.plugin = plugin;
		this.app = app;
		this.defaultServer = normalizeServerUrl(
			settings.selectedImageStorageProvider || "https://blossom.primal.net"
		);
	}

	/**
	 * Uploads a single binary blob to a Blossom media server using BUD-01/02 and NIP-98 authentication.
	 */
	public async uploadBlob(
		data: ArrayBuffer,
		mimeType: string,
		serverUrl?: string,
		signer?: NostrSigner | null
	): Promise<BlossomBlobDescriptor | null> {
		const targetServer = normalizeServerUrl(serverUrl || this.defaultServer);
		const uploadUrl = `${targetServer}/upload`;

		try {
			const sha256Hex = computeSha256(data);
			const headers: Record<string, string> = {
				"Content-Type": mimeType,
			};

			if (signer) {
				try {
					const authHeader = await generateNip98AuthHeader({
						uploadUrl,
						method: "PUT",
						sha256Hex,
						signer,
					});
					headers["Authorization"] = authHeader;
				} catch (authErr) {
					console.warn("Failed to generate NIP-98 auth header, proceeding without auth:", authErr);
				}
			}

			const response = await requestUrl({
				url: uploadUrl,
				method: "PUT",
				headers,
				body: data,
			});

			if (response.status >= 200 && response.status < 300) {
				let descriptor: BlossomBlobDescriptor;
				try {
					descriptor = response.json;
				} catch (_) {
					descriptor = {
						url: `${targetServer}/${sha256Hex}`,
						sha256: sha256Hex,
					};
				}

				// Fill in fallback metadata if server returned partial response
				if (!descriptor.url) {
					descriptor.url = `${targetServer}/${sha256Hex}`;
				}
				if (!descriptor.sha256) {
					descriptor.sha256 = sha256Hex;
				}
				if (!descriptor.type) {
					descriptor.type = mimeType;
				}
				if (!descriptor.size) {
					descriptor.size = data.byteLength;
				}

				// Check headers for dimensions (BUD-02 extension)
				const dimHeader = response.headers?.["x-dimensions"] || response.headers?.["dimensions"];
				if (dimHeader && !descriptor.dim) {
					descriptor.dim = dimHeader;
				}

				return descriptor;
			} else {
				console.error(`Blossom upload failed with status ${response.status}:`, response.text);
				return null;
			}
		} catch (error) {
			console.error(`Blossom upload error to ${uploadUrl}:`, error);
			return null;
		}
	}

	/**
	 * Uploads an article banner image from a local file path.
	 */
	async uploadArticleBannerImage(
		imageFilePath: string,
		serverUrl?: string,
		signer?: NostrSigner | null
	): Promise<string | null> {
		try {
			const path = normalizePath(imageFilePath);
			let imageBuffer: ArrayBuffer | null = null;

			// Check if file is in vault first
			const abstractFile = this.app.vault.getAbstractFileByPath(path);
			if (abstractFile instanceof TFile) {
				imageBuffer = await this.app.vault.readBinary(abstractFile);
			} else {
				// Otherwise read directly from filesystem
				imageBuffer = await FileSystemAdapter.readLocalFile(path);
			}

			if (!imageBuffer) {
				new Notice("❌ Could not read banner image file.");
				return null;
			}

			if (this.isFileSizeOverLimit(imageBuffer)) {
				return null;
			}

			const mimeType = getMimeTypeFromFileName(path);
			new Notice("⏳ Uploading Banner Image to Blossom server...");
			const descriptor = await this.uploadBlob(imageBuffer, mimeType, serverUrl, signer);

			if (descriptor && descriptor.url) {
				return descriptor.url;
			}
		} catch (error) {
			console.error(`Problem with banner image file upload:`, error);
		}
		return null;
	}

	/**
	 * Uploads an array of vault image files to the Blossom media server and returns replacement URLs & imeta tags.
	 */
	async uploadImagesToStorageProvider(
		imageFilePaths: string[],
		serverUrl?: string,
		signer?: NostrSigner | null
	): Promise<ImageUploadBatchResult> {
		const uploadResults: ImageUploadResultItem[] = [];
		let success = true;

		for (const imagePath of imageFilePaths) {
			try {
				const imageFile = this.app.vault.getAbstractFileByPath(imagePath);
				if (imageFile instanceof TFile) {
					const imageBinary = await this.app.vault.readBinary(imageFile);

					if (this.isFileSizeOverLimit(imageBinary)) {
						continue;
					}

					const mimeType = getMimeTypeFromFileName(imageFile.name);
					const descriptor = await this.uploadBlob(imageBinary, mimeType, serverUrl, signer);

					if (descriptor && descriptor.url) {
						const imeta = buildImetaTag(descriptor);
						uploadResults.push({
							filePath: imagePath,
							stringToReplace: `![[${imageFile.name}]]`,
							replacementStringURL: descriptor.url,
							imetaTag: imeta,
							blobDescriptor: descriptor,
						});
						new Notice(`✅ Uploaded ${imageFile.name}`);
					} else {
						new Notice(`❌ Problem uploading ${imageFile.name}`);
						success = false;
					}
				}
			} catch (error) {
				new Notice(`❌ Problem uploading image`);
				console.error(`Problem uploading image ${imagePath}:`, error);
				success = false;
			}
		}

		return { success, results: uploadResults };
	}

	/**
	 * Checks if file size exceeds the Blossom limit (100MB).
	 */
	isFileSizeOverLimit(file: ArrayBuffer): boolean {
		const maxSizeInBytes = 100 * 1024 * 1024; // 100 MB
		if (file.byteLength > maxSizeInBytes) {
			new Notice("❌ Inline image size exceeds 100 MB limit. Will not upload.");
			return true;
		}
		return false;
	}
}

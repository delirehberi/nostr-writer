/**
 * Live diagnostic logger for Nostr Writer.
 * Maintains an in-memory ring buffer of recent logs and mirrors to console with [NostrWriter] prefix.
 */

export interface LogEntry {
	timestamp: string;
	level: "info" | "warn" | "error" | "debug";
	message: string;
	details?: any;
}

export class Logger {
	private static readonly MAX_ENTRIES = 100;
	private static logs: LogEntry[] = [];
	private static listeners: ((entry: LogEntry) => void)[] = [];

	private static formatTimestamp(): string {
		const now = new Date();
		return now.toISOString().replace("T", " ").replace("Z", "");
	}

	public static log(message: string, details?: any): void {
		Logger.addEntry("info", message, details);
		if (details !== undefined) {
			console.log(`[NostrWriter] ${message}`, details);
		} else {
			console.log(`[NostrWriter] ${message}`);
		}
	}

	public static info(message: string, details?: any): void {
		Logger.log(message, details);
	}

	public static warn(message: string, details?: any): void {
		Logger.addEntry("warn", message, details);
		if (details !== undefined) {
			console.warn(`[NostrWriter] ⚠️ ${message}`, details);
		} else {
			console.warn(`[NostrWriter] ⚠️ ${message}`);
		}
	}

	public static error(message: string, details?: any): void {
		Logger.addEntry("error", message, details);
		if (details !== undefined) {
			console.error(`[NostrWriter] ❌ ${message}`, details);
		} else {
			console.error(`[NostrWriter] ❌ ${message}`);
		}
	}

	public static debug(message: string, details?: any): void {
		Logger.addEntry("debug", message, details);
		if (details !== undefined) {
			console.debug(`[NostrWriter] 🔍 ${message}`, details);
		} else {
			console.debug(`[NostrWriter] 🔍 ${message}`);
		}
	}

	private static addEntry(level: "info" | "warn" | "error" | "debug", message: string, details?: any): void {
		const entry: LogEntry = {
			timestamp: Logger.formatTimestamp(),
			level,
			message,
			details,
		};

		Logger.logs.push(entry);
		if (Logger.logs.length > Logger.MAX_ENTRIES) {
			Logger.logs.shift();
		}

		for (const listener of Logger.listeners) {
			try {
				listener(entry);
			} catch (_) {}
		}
	}

	public static getLogs(): LogEntry[] {
		return [...Logger.logs];
	}

	public static getFormattedLogs(): string {
		if (Logger.logs.length === 0) {
			return "No logs recorded yet.";
		}
		return Logger.logs
			.map((l) => {
				const detailStr = l.details ? `\n   ${typeof l.details === "object" ? JSON.stringify(l.details, null, 2) : String(l.details)}` : "";
				return `[${l.timestamp}] [${l.level.toUpperCase()}] ${l.message}${detailStr}`;
			})
			.join("\n");
	}

	public static clear(): void {
		Logger.logs = [];
	}

	public static subscribe(listener: (entry: LogEntry) => void): () => void {
		Logger.listeners.push(listener);
		return () => {
			Logger.listeners = Logger.listeners.filter((l) => l !== listener);
		};
	}
}

const MAX_TEXT_LENGTH = 500;

const DEFAULT_MIN_BUY_IN = 100;
const DEFAULT_MAX_BUY_IN = 5000;

/**
 * Strip control characters and limit length.
 */
export function sanitizeText(input: string): string {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional stripping
	const cleaned = input.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
	return cleaned.slice(0, MAX_TEXT_LENGTH);
}

/**
 * Extract user ID from Slack mention format: <@U12345> or <@U12345|name> -> U12345
 * Returns null if invalid format.
 */
export function parseSlackUserId(mention: string): string | null {
	const match = mention.match(/^<@([A-Z0-9]+)(?:\|[^>]*)?>$/);
	return match ? match[1] : null;
}

/**
 * Parse and validate a buy-in amount string.
 * Must be a positive integer between minBuyIn and maxBuyIn.
 */
export function parseBuyIn(
	text: string,
	minBuyIn = DEFAULT_MIN_BUY_IN,
	maxBuyIn = DEFAULT_MAX_BUY_IN,
): number | null {
	const trimmed = text.trim();
	if (!/^\d+$/.test(trimmed)) return null;

	const value = Number.parseInt(trimmed, 10);
	if (!Number.isFinite(value) || value <= 0) return null;

	if (value < minBuyIn || value > maxBuyIn) return null;

	return value;
}

/**
 * Parse transfer arguments: "<@U12345> 500" -> { userId: "U12345", amount: 500 }
 */
export function parseTransferArgs(
	text: string,
): { userId: string; amount: number } | null {
	const trimmed = text.trim();
	const mentionMatch = trimmed.match(
		/^<@([A-Z0-9]+)(?:\|[^>]*)?>(?:\s+(.+))?$/,
	);
	if (!mentionMatch) return null;

	const userId = mentionMatch[1];
	const amountStr = mentionMatch[2]?.trim();
	if (!amountStr) return null;

	if (!/^\d+$/.test(amountStr)) return null;
	const amount = Number.parseInt(amountStr, 10);
	if (!Number.isFinite(amount) || amount <= 0) return null;

	return { userId, amount };
}

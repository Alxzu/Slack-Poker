import { afterAll, beforeAll, describe, expect, test } from "bun:test";

// Set encryption key before importing the module
// 64 hex chars = 256 bits
const TEST_KEY =
	"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

let originalKey: string | undefined;

beforeAll(() => {
	originalKey = process.env.ENCRYPTION_KEY;
	process.env.ENCRYPTION_KEY = TEST_KEY;
});

afterAll(() => {
	if (originalKey !== undefined) {
		process.env.ENCRYPTION_KEY = originalKey;
	} else {
		delete process.env.ENCRYPTION_KEY;
	}
});

// Dynamic import to ensure env is set before module loads
async function getCrypto() {
	// Force fresh module load by clearing cached key
	// The module caches _key internally, so we use a fresh import each time
	// Since bun caches modules, we rely on the key being set before first import
	const { encrypt, decrypt } = await import("../../src/utils/crypto");
	return { encrypt, decrypt };
}

describe("AES-256-GCM encryption/decryption", () => {
	test("encrypt then decrypt roundtrip returns original text", async () => {
		const { encrypt, decrypt } = await getCrypto();

		const plaintext = "Hello, Slack Poker!";
		const encrypted = await encrypt(plaintext);
		const decrypted = await decrypt(encrypted);

		expect(decrypted).toBe(plaintext);
	});

	test("different plaintexts produce different ciphertexts", async () => {
		const { encrypt } = await getCrypto();

		const enc1 = await encrypt("message one");
		const enc2 = await encrypt("message two");

		// Convert to hex for comparison
		const hex1 = Buffer.from(enc1).toString("hex");
		const hex2 = Buffer.from(enc2).toString("hex");

		expect(hex1).not.toBe(hex2);
	});

	test("encrypt produces different output each time (random IV)", async () => {
		const { encrypt } = await getCrypto();

		const plaintext = "same message";
		const enc1 = await encrypt(plaintext);
		const enc2 = await encrypt(plaintext);

		const hex1 = Buffer.from(enc1).toString("hex");
		const hex2 = Buffer.from(enc2).toString("hex");

		// Same plaintext, different ciphertext due to random IV
		expect(hex1).not.toBe(hex2);
	});

	test("decrypt with wrong data throws", async () => {
		const { decrypt } = await getCrypto();

		// Garbage data should fail decryption
		const garbage = new Uint8Array(32);
		crypto.getRandomValues(garbage);

		expect(decrypt(garbage)).rejects.toThrow();
	});

	test("works with JSON data (hole cards serialization)", async () => {
		const { encrypt, decrypt } = await getCrypto();

		const holeCards = [
			{ rank: "A", suit: "spades" },
			{ rank: "K", suit: "hearts" },
		];
		const json = JSON.stringify(holeCards);

		const encrypted = await encrypt(json);
		const decrypted = await decrypt(encrypted);
		const parsed = JSON.parse(decrypted);

		expect(parsed).toEqual(holeCards);
	});

	test("handles empty string", async () => {
		const { encrypt, decrypt } = await getCrypto();

		const encrypted = await encrypt("");
		const decrypted = await decrypt(encrypted);

		expect(decrypted).toBe("");
	});

	test("handles unicode content", async () => {
		const { encrypt, decrypt } = await getCrypto();

		const plaintext = "Poker :spades: :hearts: :diamonds: :clubs:";
		const encrypted = await encrypt(plaintext);
		const decrypted = await decrypt(encrypted);

		expect(decrypted).toBe(plaintext);
	});
});

const ALGORITHM = "AES-GCM";
const IV_LENGTH = 12;
const KEY_LENGTH = 32; // 256 bits

let _key: CryptoKey | null = null;

async function getKey(): Promise<CryptoKey> {
	if (!_key) {
		const keyHex = process.env.ENCRYPTION_KEY;
		if (!keyHex || keyHex.length < 64) {
			throw new Error("ENCRYPTION_KEY must be a 256-bit hex string (64 chars)");
		}
		const keyBytes = new Uint8Array(KEY_LENGTH);
		for (let i = 0; i < KEY_LENGTH; i++) {
			keyBytes[i] = parseInt(keyHex.slice(i * 2, i * 2 + 2), 16);
		}
		_key = await crypto.subtle.importKey("raw", keyBytes, ALGORITHM, false, ["encrypt", "decrypt"]);
	}
	return _key;
}

export async function encrypt(plaintext: string): Promise<Uint8Array> {
	const key = await getKey();
	const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
	const encoded = new TextEncoder().encode(plaintext);
	const ciphertext = await crypto.subtle.encrypt({ name: ALGORITHM, iv }, key, encoded);

	// Prepend IV to ciphertext
	const result = new Uint8Array(IV_LENGTH + ciphertext.byteLength);
	result.set(iv, 0);
	result.set(new Uint8Array(ciphertext), IV_LENGTH);
	return result;
}

export async function decrypt(data: Uint8Array): Promise<string> {
	const key = await getKey();
	const iv = data.slice(0, IV_LENGTH);
	const ciphertext = data.slice(IV_LENGTH);
	const decrypted = await crypto.subtle.decrypt({ name: ALGORITHM, iv }, key, ciphertext);
	return new TextDecoder().decode(decrypted);
}

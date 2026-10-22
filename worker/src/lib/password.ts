/**
 * Password hashing with Web Crypto's PBKDF2-SHA256: native code (no WASM),
 * and the 100,000 iterations are the most Workers allow. It runs in the World
 * object, whose CPU limit is 30 s; the Worker's 10 ms would not cover it.
 *
 * Stored as `pbkdf2$<iterations>$<salt>$<hash>`, base64url, so the cost can
 * go up later without breaking old hashes.
 */
const ITERATIONS = 100_000;
const SALT_BYTES = 16;
const HASH_BITS = 256;

const encoder = new TextEncoder();

function toBase64Url(bytes: ArrayBuffer | Uint8Array): string {
    let binary = "";
    for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
    const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

async function derive(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<ArrayBuffer> {
    const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
    return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, HASH_BITS);
}

export async function hashPassword(password: string): Promise<string> {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
    const hash = await derive(password, salt, ITERATIONS);
    return `pbkdf2$${ITERATIONS}$${toBase64Url(salt)}$${toBase64Url(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
    const [scheme, iterations, salt, hash] = stored.split("$");
    if (scheme !== "pbkdf2" || !iterations || !salt || !hash) throw new Error("Invalid stored password format");
    const expected = fromBase64Url(hash);
    const actual = new Uint8Array(await derive(password, fromBase64Url(salt), Number(iterations)));
    return actual.byteLength === expected.byteLength && crypto.subtle.timingSafeEqual(actual, expected);
}

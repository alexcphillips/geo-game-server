/**
 * A 32-bit seed the server can always recompute from `key`, but nobody
 * without the secret can predict (the Express server's
 * HMAC-SHA256, first 4 bytes little-endian), so spawns are stable and
 * checkable, yet can't be scouted from the app's code. Async (Web Crypto):
 * work it out before a transaction, not inside one.
 */
const keys = new Map<string, Promise<CryptoKey>>();

function keyFor(secret: string): Promise<CryptoKey> {
    let key = keys.get(secret);
    if (!key) {
        key = crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
        keys.set(secret, key);
    }
    return key;
}

export async function secretSeed(secret: string, key: string): Promise<number> {
    const mac = await crypto.subtle.sign("HMAC", await keyFor(secret), new TextEncoder().encode(key));
    return new DataView(mac).getUint32(0, true);
}

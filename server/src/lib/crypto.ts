import crypto from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(crypto.scrypt);
const KEY_LENGTH = 64;

/** Returns a `salt:hash` string for `geo.players.password_hash`. */
export async function hashPassword(password: string) {
    const salt = crypto.randomBytes(16).toString("hex");
    const pwHash = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer;
    return `${salt}:${pwHash.toString("hex")}`;
}

export async function comparePassword(password: string, storedHash: string) {
    const [salt, hash] = storedHash.split(":");
    if (!salt || !hash) throw new Error("Invalid stored password format");
    const pwHash = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer;
    return crypto.timingSafeEqual(Buffer.from(hash, "hex"), pwHash);
}

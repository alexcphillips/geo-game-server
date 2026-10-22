import { createHmac } from "node:crypto";
import { ENV } from "../config/env";

/** geo-game's server secret. */
export const GEO_SECRET = ENV.GEO_JWT_SECRET;

/**
 * A 32-bit seed the server can always recompute from `key`, but nobody
 * without the secret can predict — so spawns are stable and checkable, yet
 * can't be scouted from the app's code.
 */
export function secretSeed(key: string): number {
    return createHmac("sha256", GEO_SECRET).update(key).digest().readUInt32LE(0);
}

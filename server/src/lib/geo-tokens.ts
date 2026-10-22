import { createHash, randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";
import type { GeoTokenPayload } from "@geo/shared";
import { GEO_SECRET as SECRET } from "./geo-secret";

/**
 * geo-game tokens. Signed with geo-game's own secret and audience.
 */
const AUDIENCE = "geo-game";

export const GEO_TOKENS = {
    ACCESS_TTL: "1h",
    REFRESH_TTL_DAYS: 180,
} as const;

export function signAccessToken(playerId: string): string {
    return jwt.sign({ playerId } satisfies GeoTokenPayload, SECRET, {
        audience: AUDIENCE,
        expiresIn: GEO_TOKENS.ACCESS_TTL,
    });
}

/** Throws if absent, expired, forged, or meant for another audience. */
export function verifyAccessToken(token: string): GeoTokenPayload {
    const payload = jwt.verify(token, SECRET, { audience: AUDIENCE });
    if (typeof payload !== "object" || typeof payload.playerId !== "string") {
        throw new Error("Malformed geo token");
    }
    return { playerId: payload.playerId };
}

/** A new opaque refresh token, and the hash that gets stored. */
export function newRefreshToken(): { token: string; hash: string } {
    const token = randomBytes(32).toString("base64url");
    return { token, hash: hashRefreshToken(token) };
}

export function hashRefreshToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
}

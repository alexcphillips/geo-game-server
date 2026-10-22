import { jwtVerify, SignJWT } from "jose";
import type { GeoTokenPayload } from "@geo/shared";

/** geo-game tokens: HS256 with geo-game's own secret and audience. */
const AUDIENCE = "geo-game";

export const TOKENS = {
    ACCESS_TTL: "1h",
    REFRESH_TTL_DAYS: 180,
} as const;

const keyOf = (secret: string) => new TextEncoder().encode(secret);

export async function signAccessToken(secret: string, playerId: string): Promise<string> {
    return new SignJWT({ playerId } satisfies GeoTokenPayload)
        .setProtectedHeader({ alg: "HS256" })
        .setAudience(AUDIENCE)
        .setIssuedAt()
        .setExpirationTime(TOKENS.ACCESS_TTL)
        .sign(keyOf(secret));
}

/** Throws if absent, expired, forged, or meant for another audience. */
export async function verifyAccessToken(secret: string, token: string): Promise<GeoTokenPayload> {
    const { payload } = await jwtVerify(token, keyOf(secret), { audience: AUDIENCE, algorithms: ["HS256"] });
    if (typeof payload.playerId !== "string") throw new Error("Malformed geo token");
    return { playerId: payload.playerId };
}

/** A new opaque refresh token, and the hash that gets stored. */
export async function newRefreshToken(): Promise<{ token: string; hash: string }> {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    const token = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    return { token, hash: await hashRefreshToken(token) };
}

export async function hashRefreshToken(token: string): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

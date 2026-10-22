import type { GeoPlayer } from "@geo/shared";
import type { Db } from "../../db/db";
import { TOKENS } from "../../lib/tokens";
import {
    DISPLAY_NAME_TAKEN,
    EMAIL_TAKEN,
    FIND_CREDENTIALS_BY_EMAIL,
    FIND_PLAYER,
    FIND_REFRESH_TOKEN,
    INSERT_PLAYER,
    INSERT_REFRESH_TOKEN,
    REVOKE_ALL_FOR_PLAYER,
    REVOKE_REFRESH_TOKEN,
    REVOKE_REFRESH_TOKEN_BY_HASH,
} from "./accounts.sql.ts";
import type { CredentialsRow, PlayerRow, RefreshTokenRow } from "./accounts.types";

const DAY_MS = 24 * 60 * 60_000;

export function toPlayer(row: PlayerRow): GeoPlayer {
    return {
        id: row.id,
        displayName: row.display_name,
        coins: row.coins,
        bankCoins: row.bank_coins,
        role: row.role,
        createdAt: new Date(row.created_at).toISOString(),
    };
}

/** The player with this email, and their password hash, if there is one. */
export function findCredentials(db: Db, email: string): CredentialsRow | undefined {
    return db.one<CredentialsRow>(FIND_CREDENTIALS_BY_EMAIL, email);
}

/** Stores a new refresh token for the player (its hash only). */
export function storeRefreshToken(db: Db, playerId: string, tokenHash: string) {
    const now = Date.now();
    db.run(INSERT_REFRESH_TOKEN, tokenHash, playerId, now, now + TOKENS.REFRESH_TTL_DAYS * DAY_MS);
}

export type RegisterResult = { ok: true; player: PlayerRow } | { ok: false; taken: "email" | "displayName" };

/**
 * Makes a player and stores their first refresh token, all or nothing. The
 * checks and the insert run together, so two sign-ups racing for a name
 * can't both win.
 */
export function register(
    db: Db,
    input: { email: string; passwordHash: string; displayName: string; refreshTokenHash: string },
): RegisterResult {
    return db.transaction(() => {
        if (db.one(EMAIL_TAKEN, input.email)) return { ok: false, taken: "email" };
        if (db.one(DISPLAY_NAME_TAKEN, input.displayName)) return { ok: false, taken: "displayName" };
        const player = db.one<PlayerRow>(INSERT_PLAYER, crypto.randomUUID(), input.email, input.passwordHash, input.displayName, Date.now());
        if (!player) throw new Error("Player insert returned nothing");
        // TODO(session 2): the starter kit, once inventory, wardrobe and hands are here.
        storeRefreshToken(db, player.id, input.refreshTokenHash);
        return { ok: true, player };
    });
}

export type RefreshResult = { ok: true; player: PlayerRow } | { ok: false; reason: "unknown" | "expired" | "reused" };

/**
 * Swaps a refresh token for a new one; the old one stops working. Using an
 * already-swapped token again means it was copied, so every session for that
 * player is ended.
 */
export function rotateRefreshToken(db: Db, oldHash: string, newHash: string): RefreshResult {
    return db.transaction(() => {
        const stored = db.one<RefreshTokenRow>(FIND_REFRESH_TOKEN, oldHash);
        if (!stored) return { ok: false, reason: "unknown" };
        const now = Date.now();
        if (stored.revoked_at !== null) {
            db.run(REVOKE_ALL_FOR_PLAYER, now, stored.player_id);
            return { ok: false, reason: "reused" };
        }
        if (stored.expires_at <= now) return { ok: false, reason: "expired" };

        const player = db.one<PlayerRow>(FIND_PLAYER, stored.player_id);
        if (!player) return { ok: false, reason: "unknown" };
        db.run(REVOKE_REFRESH_TOKEN, now, stored.token_hash);
        storeRefreshToken(db, player.id, newHash);
        return { ok: true, player };
    });
}

/** Ends one session. An unknown or already-ended token is not an error. */
export function revokeSession(db: Db, tokenHash: string) {
    db.run(REVOKE_REFRESH_TOKEN_BY_HASH, Date.now(), tokenHash);
}

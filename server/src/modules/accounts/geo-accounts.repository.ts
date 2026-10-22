import type { GeoEquipmentSlot, GeoSession } from "@geo/shared";
import { CONTENT } from "../../content";
import { withTransaction, type TxQuery } from "../../db/transaction";
import { GEO_TOKENS, hashRefreshToken, newRefreshToken, signAccessToken } from "../../lib/geo-tokens";
import * as playerRepository from "../player/geo-player.repository";
import * as wardrobeRepository from "../wardrobe/geo-wardrobe.repository";
import { FIND_PLAYER } from "../player/geo-player.sql";
import type { PlayerRow } from "../player/geo-player.types";
import { query } from "../../db";
import {
    FIND_CREDENTIALS_BY_EMAIL,
    FIND_REFRESH_TOKEN_FOR_UPDATE,
    INSERT_PLAYER,
    INSERT_REFRESH_TOKEN,
    REVOKE_ALL_FOR_PLAYER,
    REVOKE_REFRESH_TOKEN,
    REVOKE_REFRESH_TOKEN_BY_HASH,
} from "./geo-accounts.sql";
import { STARTER_KIT } from "./geo-starter-kit";
import type { CredentialsRow, RefreshTokenRow } from "./geo-accounts.types";

async function issueSession(tx: TxQuery, row: PlayerRow): Promise<GeoSession> {
    const refresh = newRefreshToken();
    await tx(INSERT_REFRESH_TOKEN, [row.id, refresh.hash, GEO_TOKENS.REFRESH_TTL_DAYS]);
    return {
        accessToken: signAccessToken(row.id),
        refreshToken: refresh.token,
        player: playerRepository.toPlayer(row),
    };
}

/** The player with this email, and their password hash, if there is one. */
export async function findCredentials(email: string): Promise<CredentialsRow | undefined> {
    const [row] = await query<CredentialsRow>(FIND_CREDENTIALS_BY_EMAIL, [email]);
    return row;
}

/** Signs in a player whose password has already been checked. */
export async function signIn(row: PlayerRow): Promise<GeoSession> {
    return withTransaction((tx) => issueSession(tx, row));
}

/**
 * Makes a player, with the starter kit, and signs them in. Throws Postgres'
 * unique violation (23505) when the email or name is taken.
 */
export async function register(input: { email: string; passwordHash: string; displayName: string }): Promise<GeoSession> {
    return withTransaction(async (tx) => {
        const [created] = await tx<PlayerRow>(INSERT_PLAYER, [input.email, input.passwordHash, input.displayName]);
        if (!created) throw new Error("Player insert returned nothing");
        await grantStarterKit(tx, created.id);
        return issueSession(tx, created);
    });
}

export async function grantStarterKit(tx: TxQuery, playerId: string) {
    const inventoryIds = await playerRepository.grantItems(tx, playerId, STARTER_KIT.items);
    const granted = await playerRepository.findInventoryByIds(playerId, inventoryIds, tx);

    // Each starter loadout is saved in the wardrobe, and the first is worn.
    for (const [slot, loadout] of STARTER_KIT.loadouts.entries()) {
        const equipment: Partial<Record<GeoEquipmentSlot, string>> = {};
        for (const [kind, itemId] of Object.entries(loadout.equip)) {
            const entry = granted.find((g) => g.item_id === itemId);
            // A ring kind goes in the first ring slot.
            if (entry) equipment[(kind === "ring" ? "ring1" : kind) as GeoEquipmentSlot] = entry.id;
        }
        await wardrobeRepository.insertLoadout(tx, playerId, slot, loadout.name, equipment, null, loadout.autoFor ?? null);
    }
    await wardrobeRepository.wearLoadout(tx, playerId, 0);

    for (const skill of STARTER_KIT.handSkills) {
        const hand = granted
            .filter((g) => {
                const item = CONTENT.items[g.item_id];
                return item?.kind === "card" && CONTENT.cards[item.cardId]?.skill === skill;
            })
            .map((g) => g.id);
        await playerRepository.setHand(tx, playerId, skill, hand);
    }

    for (const [slot, { itemId, quantity }] of STARTER_KIT.lunchbox.entries()) {
        await playerRepository.setLunchboxSlot(tx, playerId, slot, itemId, quantity);
    }
    for (const [slot, { itemId, quantity }] of STARTER_KIT.bait.entries()) {
        await playerRepository.setBaitSlot(tx, playerId, slot, itemId, quantity);
    }
}

export type RefreshResult =
    | { ok: true; session: GeoSession }
    | { ok: false; reason: "unknown" | "expired" | "reused" };

/**
 * Swaps a refresh token for a new pair; the old one stops working. Using an
 * already-swapped token again means it was copied, so every session for that
 * player is ended.
 */
export async function refreshSession(token: string): Promise<RefreshResult> {
    return withTransaction(async (tx) => {
        const [stored] = await tx<RefreshTokenRow>(FIND_REFRESH_TOKEN_FOR_UPDATE, [hashRefreshToken(token)]);
        if (!stored) return { ok: false, reason: "unknown" };

        if (stored.revoked_at) {
            await tx(REVOKE_ALL_FOR_PLAYER, [stored.player_id]);
            return { ok: false, reason: "reused" };
        }
        if (stored.expires_at.getTime() <= Date.now()) return { ok: false, reason: "expired" };

        await tx(REVOKE_REFRESH_TOKEN, [stored.id]);
        const [player] = await tx<PlayerRow>(FIND_PLAYER, [stored.player_id]);
        if (!player) return { ok: false, reason: "unknown" };
        return { ok: true, session: await issueSession(tx, player) };
    });
}

/** Ends one session. An unknown or already-ended token is not an error. */
export async function revokeSession(token: string): Promise<void> {
    await withTransaction((tx) => tx(REVOKE_REFRESH_TOKEN_BY_HASH, [hashRefreshToken(token)]));
}

/** Ends every session a player has, e.g. when an admin locks them out. */
export async function revokeAllSessions(tx: TxQuery, playerId: string): Promise<void> {
    await tx(REVOKE_ALL_FOR_PLAYER, [playerId]);
}

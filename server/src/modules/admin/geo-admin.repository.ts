import { GEO_SOCKET_CLOSE, type GeoAdminAuditEntry, type GeoAdminLedgerEntry, type GeoAdminPlayer, type GeoRole } from "@geo/shared";
import { query } from "../../db";
import { afterCommit, type TxQuery } from "../../db/transaction";
import * as socketHub from "../../realtime/geo-socket-hub";
import {
    FIND_ADMIN_PLAYER,
    FIND_ALWAYS_SEA_CREATURES,
    FIND_AUDIT,
    FIND_LEDGER,
    FIND_PLAYERS,
    INSERT_AUDIT,
    SET_ALWAYS_SEA_CREATURES,
    SET_BANNED,
    SET_ROLE,
} from "./geo-admin.sql";
import type { AdminPlayerRow, AuditRow, LedgerRow } from "./geo-admin.types";

function toAdminPlayer(row: AdminPlayerRow): GeoAdminPlayer {
    return {
        id: row.id,
        displayName: row.display_name,
        email: row.email,
        role: row.role,
        coins: Number(row.coins),
        bannedAt: row.banned_at?.toISOString() ?? null,
        createdAt: row.created_at.toISOString(),
    };
}

export async function findPlayers(search: string | null): Promise<GeoAdminPlayer[]> {
    const pattern = search ? `%${search.replace(/[%_\\]/g, (c) => `\\${c}`)}%` : null;
    return (await query<AdminPlayerRow>(FIND_PLAYERS, [pattern])).map(toAdminPlayer);
}

export async function findPlayer(playerId: string, tx: TxQuery = query): Promise<GeoAdminPlayer | null> {
    const [row] = await tx<AdminPlayerRow>(FIND_ADMIN_PLAYER, [playerId]);
    return row ? toAdminPlayer(row) : null;
}

export async function findLedger(playerId: string): Promise<GeoAdminLedgerEntry[]> {
    return (await query<LedgerRow>(FIND_LEDGER, [playerId])).map((row) => ({
        delta: Number(row.delta),
        reason: row.reason,
        reference: row.reference,
        createdAt: row.created_at.toISOString(),
    }));
}

export async function setRole(tx: TxQuery, playerId: string, role: GeoRole): Promise<boolean> {
    return (await tx(SET_ROLE, [playerId, role])).length > 0;
}

/** A ban also closes the player's geo sockets once it commits, so pushes and presence stop at once. */
export async function setBanned(tx: TxQuery, playerId: string, banned: boolean): Promise<boolean> {
    const found = (await tx(SET_BANNED, [playerId, banned])).length > 0;
    if (found && banned) afterCommit(tx, () => socketHub.disconnect(playerId, GEO_SOCKET_CLOSE.banned, "Suspended"));
    return found;
}

/** Records what an admin did. Call inside the change's own transaction. */
export async function audit(
    tx: TxQuery,
    adminId: string,
    action: string,
    target: string | null,
    details: Record<string, unknown> | null = null,
) {
    await tx(INSERT_AUDIT, [adminId, action, target, details]);
}

export async function findAudit(): Promise<GeoAdminAuditEntry[]> {
    return (await query<AuditRow>(FIND_AUDIT)).map((row) => ({
        id: Number(row.id),
        admin: row.admin,
        action: row.action,
        target: row.target,
        details: row.details,
        createdAt: row.created_at.toISOString(),
    }));
}

export async function findAlwaysSeaCreatures(playerId: string, tx: TxQuery = query): Promise<boolean> {
    const [row] = await tx<{ always_sea_creatures: boolean }>(FIND_ALWAYS_SEA_CREATURES, [playerId]);
    return row?.always_sea_creatures ?? false;
}

export async function setAlwaysSeaCreatures(tx: TxQuery, playerId: string, always: boolean) {
    await tx(SET_ALWAYS_SEA_CREATURES, [playerId, always]);
}

import type { GeoAdminAuditEntry, GeoAdminEconomy, GeoAdminLedgerEntry, GeoAdminPlayer, GeoRole } from "@geo/shared";
import type { Db } from "../../db/db";
import { SUM_HELD_ALL, SUM_UNCOLLECTED_ALL } from "../market/market.sql.ts";
import {
    FIND_ADMIN_PLAYER,
    FIND_ALL_PLAYERS,
    FIND_ALWAYS_SEA_CREATURES,
    FIND_AUDIT,
    FIND_LEDGER,
    INSERT_AUDIT,
    LEDGER_LAST_DAY,
    LEDGER_MISMATCHES,
    SEARCH_PLAYERS,
    SET_ALWAYS_SEA_CREATURES,
    SET_BANNED,
    SET_ROLE,
    SET_ROLE_BY_EMAIL,
    SUM_PURSES,
} from "./admin.sql.ts";
import type { AdminPlayerRecord, AuditRecord, LedgerRecord } from "./admin.types";

/** Game-admin reads and writes. */

const iso = (ms: number) => new Date(ms).toISOString();

function toAdminPlayer(row: AdminPlayerRecord): GeoAdminPlayer {
    return {
        id: row.id,
        displayName: row.display_name,
        email: row.email,
        role: row.role,
        coins: row.coins,
        bannedAt: row.banned_at === null ? null : iso(row.banned_at),
        createdAt: iso(row.created_at),
    };
}

export function findPlayers(db: Db, search: string | null): GeoAdminPlayer[] {
    const rows = search
        ? db.all<AdminPlayerRecord>(SEARCH_PLAYERS, `%${search.replace(/[%_\\]/g, (c) => `\\${c}`)}%`)
        : db.all<AdminPlayerRecord>(FIND_ALL_PLAYERS);
    return rows.map(toAdminPlayer);
}

export function findPlayer(db: Db, playerId: string): GeoAdminPlayer | null {
    const row = db.one<AdminPlayerRecord>(FIND_ADMIN_PLAYER, playerId);
    return row ? toAdminPlayer(row) : null;
}

export function findLedger(db: Db, playerId: string): GeoAdminLedgerEntry[] {
    return db
        .all<LedgerRecord>(FIND_LEDGER, playerId)
        .map((row) => ({ delta: row.delta, reason: row.reason, reference: row.reference, createdAt: iso(row.created_at) }));
}

export function setRole(db: Db, playerId: string, role: GeoRole): boolean {
    return Boolean(db.one(SET_ROLE, role, playerId));
}

/** By email, for the first admin (the ops secret). The player's name, or null if there's no such account. */
export function setRoleByEmail(db: Db, email: string, role: GeoRole): string | null {
    return db.one<{ display_name: string }>(SET_ROLE_BY_EMAIL, role, email)?.display_name ?? null;
}

export function setBanned(db: Db, playerId: string, banned: boolean): boolean {
    return Boolean(db.one(SET_BANNED, banned ? Date.now() : null, playerId));
}

/** Records what an admin did. Call inside the change's own transaction. */
export function audit(db: Db, adminId: string, action: string, target: string | null, details: Record<string, unknown> | null = null) {
    db.run(INSERT_AUDIT, adminId, action, target, details && JSON.stringify(details), Date.now());
}

export function findAudit(db: Db): GeoAdminAuditEntry[] {
    return db.all<AuditRecord>(FIND_AUDIT).map((row) => ({
        id: row.id,
        admin: row.admin,
        action: row.action,
        target: row.target,
        details: row.details === null ? null : (JSON.parse(row.details) as Record<string, unknown>),
        createdAt: iso(row.created_at),
    }));
}

export function findEconomy(db: Db): GeoAdminEconomy {
    const total = (sql: string, ...params: number[]) => db.one<{ total: number }>(sql, ...params)?.total ?? 0;
    return {
        coinsInPurses: total(SUM_PURSES),
        coinsInBids: total(SUM_HELD_ALL),
        coinsUncollected: total(SUM_UNCOLLECTED_ALL),
        lastDay: db.all<{ reason: string; delta: number; count: number }>(LEDGER_LAST_DAY, Date.now() - 24 * 3_600_000),
        ledgerMismatches: db
            .all<{ id: string; display_name: string; coins: number; ledger: number }>(LEDGER_MISMATCHES)
            .map((row) => ({ playerId: row.id, displayName: row.display_name, coins: row.coins, ledger: row.ledger })),
    };
}

export function findAlwaysSeaCreatures(db: Db, playerId: string): boolean {
    return db.one<{ always_sea_creatures: number }>(FIND_ALWAYS_SEA_CREATURES, playerId)?.always_sea_creatures === 1;
}

export function setAlwaysSeaCreatures(db: Db, playerId: string, always: boolean) {
    db.run(SET_ALWAYS_SEA_CREATURES, always ? 1 : 0, playerId);
}

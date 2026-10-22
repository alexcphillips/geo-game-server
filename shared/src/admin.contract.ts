import type { GeoRole } from "./auth.contract";
import type { GeoInventoryEntry } from "./player.contract";

/**
 * Game-admin tools, behind `/geo/admin`. Only players whose geo role is
 * `admin` get in; every change is written to an audit log.
 */

/** A row in the admin's player list. */
export type GeoAdminPlayer = {
    id: string;
    displayName: string;
    /** The account's email: admins need to tell people apart. */
    email: string;
    role: GeoRole;
    coins: number;
    bannedAt: string | null;
    createdAt: string;
};

export type GeoAdminLedgerEntry = {
    delta: number;
    reason: string;
    reference: string | null;
    createdAt: string;
};

/** `GET /geo/admin/players/:playerId`. */
export type GeoAdminPlayerDetail = GeoAdminPlayer & {
    inventory: GeoInventoryEntry[];
    /** Newest first, the last 100. */
    ledger: GeoAdminLedgerEntry[];
};

/** `PUT /geo/admin/players/:playerId/role`. */
export type GeoAdminSetRoleRequest = { role: GeoRole };

/** `POST /geo/admin/players/:playerId/ban`. A ban also ends every session. */
export type GeoAdminBanRequest = { banned: boolean };

/** `POST /geo/admin/players/:playerId/coins`. Negative takes coins, never below 0. */
export type GeoAdminCoinsRequest = { amount: number; note?: string };

/** `POST /geo/admin/players/:playerId/items`. */
export type GeoAdminGrantItemRequest = { itemId: string; quantity: number };

/**
 * `GET` / `PUT /geo/admin/fishing/sea-creatures`: while `always` is on, every
 * bite the calling admin strikes is a sea creature (where the water has any:
 * never in a puddle). Theirs alone, and only while they're an admin.
 */
export type GeoAdminSeaCreatures = { always: boolean };

/** `GET /geo/admin/economy`: where coins came from and went, by reason. */
export type GeoAdminEconomy = {
    /** Every player's spendable coins, together. */
    coinsInPurses: number;
    /** Coins held by live bids. */
    coinsInBids: number;
    /** Sale coins waiting to be collected. */
    coinsUncollected: number;
    /** Last 24 hours, by ledger reason: positive made coins, negative removed them. */
    lastDay: { reason: string; delta: number; count: number }[];
    /**
     * Players whose coins don't equal the sum of their ledger: each one is a
     * coin movement that skipped the ledger, i.e. a bug. Should be empty.
     */
    ledgerMismatches: { playerId: string; displayName: string; coins: number; ledger: number }[];
};

/** One row of the audit log: `GET /geo/admin/audit`. */
export type GeoAdminAuditEntry = {
    id: number;
    admin: string;
    action: string;
    /** What it was done to, e.g. a player id. */
    target: string | null;
    details: Record<string, unknown> | null;
    createdAt: string;
};

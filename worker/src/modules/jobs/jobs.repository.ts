import type { Db } from "../../db/db";
import { ADD_DUE, CLEAR_DUE, DELETE_OLD_REFRESH_TOKENS, FIND_DUE, FIND_DUE_AT, NEXT_DUE, SET_DUE } from "./jobs.sql.ts";

/**
 * The `due` table: what must happen at a time with nobody acting, by key
 * (`battle:<id>`, `dungeon:<id>`, `cleanup`, `farm-weeks`). It replaces the
 * Express server's 15 s tick (jobs.ts) and in-process timers (lib/wake.ts):
 * the World keeps one alarm at the soonest row (world.ts), and src/jobs.ts
 * runs what's due. A row survives a restart, so nothing is dropped.
 */

/** Books `key` for `at` (ms), or clears it for null. Exact: a later time replaces a sooner one. */
export function schedule(db: Db, key: string, at: number | null) {
    if (at === null) db.run(CLEAR_DUE, key);
    else db.run(SET_DUE, key, Math.round(at));
}

/** Books `key` for `at` unless it's already booked, keeping that time. */
export function scheduleOnce(db: Db, key: string, at: number) {
    db.run(ADD_DUE, key, Math.round(at));
}

/** When `key` is booked for, or null. */
export function dueAt(db: Db, key: string): number | null {
    return db.one<{ at: number }>(FIND_DUE_AT, key)?.at ?? null;
}

/** Keys due by `now`, soonest first, at most `limit`. */
export function findDue(db: Db, now: number, limit: number): { key: string; at: number }[] {
    return db.all<{ key: string; at: number }>(FIND_DUE, now, limit);
}

/** The soonest booked time, or null. */
export function nextDue(db: Db): number | null {
    return db.one<{ at: number | null }>(NEXT_DUE)?.at ?? null;
}

const WEEK_MS = 7 * 24 * 3_600_000;

export function deleteOldRefreshTokens(db: Db, now: number) {
    db.run(DELETE_OLD_REFRESH_TOKENS, now - WEEK_MS, now - WEEK_MS);
}

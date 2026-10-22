import type { GeoRole, GeoSocketServerMessage } from "@geo/shared";
import type { World } from "../app";
import { findOwnLobby } from "../modules/dungeons/dungeons.repository";
import { findActiveRunId, loadRun, RECONNECT_MS, viewFor, wakeKey } from "../modules/dungeon-runs/dungeon-runs.fights";
import { countBadges, tellFriends } from "../modules/friends/friends.repository";
import { dueAt, schedule } from "../modules/jobs/jobs.repository";
import { findPlayerBattle, findRecentSharedRun, settleBattleClock } from "../modules/runs/runs.repository";
import { CLEAR_GONE, FIND_GONE, SET_GONE } from "./presence.sql.ts";

/**
 * What the socket hub means to the game: the snapshots a socket gets when it
 * signs in, and what a player coming or going changes. From the Express
 * server's `onOnline` / `onOffline` listeners (friends, dungeon runs, Runs).
 */

const FIND_ACCESS = `SELECT role, banned_at FROM players WHERE id = ?;`;

export function socketAccess(world: World, playerId: string): "ok" | "banned" | "unknown" {
    const row = world.db.one<{ role: GeoRole; banned_at: number | null }>(FIND_ACCESS, playerId);
    if (!row) return "unknown";
    return row.banned_at === null ? "ok" : "banned";
}

/** Badges and their lobby always (null says "none"); their dungeon run and shared fight if any. Reads only. */
export function snapshotsFor(world: World, playerId: string): GeoSocketServerMessage[] {
    const { db } = world;
    const messages: GeoSocketServerMessage[] = [
        { type: "badges", badges: countBadges(db, playerId) },
        { type: "lobby", lobby: findOwnLobby(db, playerId) },
    ];
    const dungeonRunId = findActiveRunId(db, playerId);
    const dungeonRun = dungeonRunId ? loadRun(db, dungeonRunId) : undefined;
    if (dungeonRun) messages.push({ type: "dungeonRun", dungeonRun: viewFor(dungeonRun, playerId) });
    const run = findRecentSharedRun(db, playerId);
    if (run) messages.push({ type: "run", run });
    return messages;
}

/** A `gone` row older than this is from a party long over: not trusted (a fresh drop writes a new one). */
const GONE_TRUSTED_MS = 24 * 3_600_000;

/** Since when the player has been gone, as saved when they dropped mid-party; null if not saved. */
export function goneSince(world: World, playerId: string, now = Date.now()): number | null {
    const since = world.db.one<{ since: number }>(FIND_GONE, playerId)?.since ?? null;
    return since !== null && since > now - GONE_TRUSTED_MS ? since : null;
}

/** Back: friends see it, and their turn goes out to its full length again. */
export function cameOnline(world: World, playerId: string, now = Date.now()) {
    world.db.transaction(() => {
        world.db.run(CLEAR_GONE, playerId);
        tellFriends(world, playerId);
        const battleId = findPlayerBattle(world.db, playerId);
        if (battleId) settleBattleClock(world, battleId, now);
    });
}

/**
 * Gone (since `since`, when their last socket closed): friends see it, their
 * turn's clock comes in, and their dungeon run looks again once the
 * reconnect window is up. In a party or a shared fight, when they went is
 * saved (`gone`), so a World woken from hibernation still knows.
 */
export function wentOffline(world: World, playerId: string, since: number, now = Date.now()) {
    const { db } = world;
    db.transaction(() => {
        tellFriends(world, playerId);
        const battleId = findPlayerBattle(db, playerId);
        const dungeonRunId = findActiveRunId(db, playerId);
        if (battleId || dungeonRunId) db.run(SET_GONE, playerId, since);
        if (battleId) settleBattleClock(world, battleId, now);
        if (!dungeonRunId) return;
        const key = wakeKey(dungeonRunId);
        const at = since + RECONNECT_MS;
        const booked = dueAt(db, key);
        if (booked === null || at < booked) schedule(db, key, at);
    });
}

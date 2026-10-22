import { distanceMetres, type GeoPoint, type GeoSpawn } from "@geo/shared";
import { CONTENT } from "../../../../server/src/content";
import { createRng, randomSeed } from "../../../../server/src/engine/rng";
import {
    MAX_SPAWNS,
    randomPointNear,
    rollLifetimeMs,
    rollSpawn,
    SPAWN_RULES,
    type NearPlaces,
} from "../../../../server/src/world/spawns";
import { advanceTravel, spendTravel } from "../../../../server/src/world/travel";
import type { World } from "../../app";
import type { Db } from "../../db/db";
import * as questsRepository from "../quests/quests.repository";
import { CLAIM_SPAWN, DELETE_SPAWNS, FIND_LIVE_SPAWN, FIND_SPAWNS, INSERT_SPAWN } from "./world.sql.ts";
import type { SpawnRow, TravelMemory } from "./world.types";

/**
 * Each player's spawns, from server/src/modules/world/geo-world.repository.ts.
 * Rows are written only when a spawn appears, is beaten or goes; where the
 * player walks and when they left a spawn's reach stay in World memory.
 */

const OUT_OF_REACH_MS = SPAWN_RULES.outOfReachSeconds * 1000;
const RESPAWN_AFTER_WIN_MS = SPAWN_RULES.respawnAfterWinSeconds * 1000;
const SPAWN_GAP_MS = SPAWN_RULES.spawnGapSeconds * 1000;

function memoryOf(world: World, playerId: string): TravelMemory {
    let memory = world.travel.get(playerId);
    if (!memory) {
        memory = { travel: null, lastSpawnedAt: 0, outOfReachSince: new Map() };
        world.travel.set(playerId, memory);
    }
    return memory;
}

/**
 * When it leaves: its lifetime, or sooner once the player has walked away
 * from it, or a minute after it's beaten.
 */
function despawnTime(row: SpawnRow, outOfReachSince: number | undefined): number {
    let time = row.despawns_at;
    if (outOfReachSince !== undefined) time = Math.min(time, outOfReachSince + OUT_OF_REACH_MS);
    if (row.claimed_at !== null) time = Math.min(time, row.claimed_at + RESPAWN_AFTER_WIN_MS);
    return time;
}

function toSpawn(row: SpawnRow, outOfReachSince: number | undefined): GeoSpawn {
    return {
        id: row.id,
        enemyId: row.enemy_id,
        sprite: CONTENT.enemies[row.enemy_id]?.sprite ?? row.enemy_id,
        latitude: row.latitude,
        longitude: row.longitude,
        // The app refetches at the soonest of these, so a spawn walked away
        // from leaves the map on time.
        despawnsAt: new Date(despawnTime(row, outOfReachSince)).toISOString(),
    };
}

function insertSpawn(db: Db, playerId: string, enemyId: string, point: GeoPoint, lifetimeMs: number, now: number): SpawnRow | undefined {
    // Lifetimes are rolled as fractional ms; the column is whole ms.
    const despawnsAt = Math.round(now + lifetimeMs);
    return db.one<SpawnRow>(INSERT_SPAWN, playerId, crypto.randomUUID(), enemyId, point.latitude, point.longitude, despawnsAt, now);
}

/**
 * The player's spawns around `here`, after tidying them. A spawn the player
 * has walked out of reach of starts a countdown (cancelled if they come back)
 * and despawns when it ends; so do ones past their lifetime. Then new ones
 * are placed within reach: one per walk distance banked (up to MAX_SPAWNS,
 * straight away), else, if under this window's count (`windowCount`), one
 * once spawnGapSeconds have passed since the last one made, so a sitting
 * player's spawns trickle in. Beaten spawns (for a minute) and ones counting
 * down keep their slot. Beaten ones aren't listed.
 */
export function spawnsAround(
    world: World,
    playerId: string,
    here: GeoPoint,
    now: number,
    /** The nearest place of each habitat, which pull their own enemies. */
    near: NearPlaces,
    /** How many spawns this player has this window (secret-seeded, worked out by the caller). */
    windowCount: number,
    /** Dev only: top up to MAX_SPAWNS rather than this window's roll. */
    fill = false,
): GeoSpawn[] {
    const { db } = world;
    const memory = memoryOf(world, playerId);
    return db.transaction(() => {
        const rows = db.all<SpawnRow>(FIND_SPAWNS, playerId);

        // A copy, kept only if the transaction commits.
        const away = new Map(memory.outOfReachSince);
        for (const row of rows) {
            const inReach = distanceMetres(here, row) <= SPAWN_RULES.reachMetres;
            if (!inReach && !away.has(row.id)) away.set(row.id, now);
            if (inReach) away.delete(row.id);
        }

        const gone = rows.filter((row) => despawnTime(row, away.get(row.id)) <= now);
        if (gone.length > 0) db.run(DELETE_SPAWNS, playerId, JSON.stringify(gone.map((row) => row.id)));
        const kept = rows.filter((row) => !gone.includes(row));
        // Forget countdowns for spawns no longer there (gone now, or deleted elsewhere).
        const keptIds = new Set(kept.map((row) => row.id));
        for (const id of away.keys()) if (!keptIds.has(id)) away.delete(id);

        const walked = spendTravel(advanceTravel(memory.travel, here, now), MAX_SPAWNS - kept.length);
        // From the last spawn made, not the newest still here: one walked or
        // driven away from has gone, but the gap still runs.
        const lastSpawnedAt = Math.max(memory.lastSpawnedAt, ...kept.map((row) => row.created_at));
        const trickle = Math.min(1, windowCount - kept.length, now - lastSpawnedAt >= SPAWN_GAP_MS ? 1 : 0);
        const missing = fill ? MAX_SPAWNS - kept.length : Math.max(walked.spawns, trickle);

        const rng = createRng(randomSeed());
        const tier = missing > 0 ? questsRepository.findOpenTier(db, playerId) : 1;
        const questTargets = missing > 0 ? questsRepository.findKillTargets(db, playerId) : [];
        for (let i = 0; i < missing; i++) {
            const { enemyId, point } = rollSpawn(rng, here, near, tier, questTargets);
            const row = insertSpawn(db, playerId, enemyId, point, rollLifetimeMs(rng), now);
            if (row) kept.push(row);
        }

        // Memory changes only once the writes have gone through.
        memory.travel = walked.travel;
        memory.lastSpawnedAt = missing > 0 ? now : lastSpawnedAt;
        memory.outOfReachSince = away;
        return kept.filter((row) => row.claimed_at === null).map((row) => toSpawn(row, away.get(row.id)));
    });
}

/** Dev only: one more spawn of `enemyId` within reach, whatever the count. */
export function addSpawn(db: Db, playerId: string, enemyId: string, here: GeoPoint, now: number) {
    const rng = createRng(randomSeed());
    insertSpawn(db, playerId, enemyId, randomPointNear(here, rng), rollLifetimeMs(rng), now);
}

/** One of the player's spawns that can still be fought, or null. */
export function findLiveSpawn(world: World, playerId: string, spawnId: string, now: number): GeoSpawn | null {
    const row = world.db.one<SpawnRow>(FIND_LIVE_SPAWN, playerId, spawnId, now);
    return row ? toSpawn(row, world.travel.get(playerId)?.outOfReachSince.get(row.id)) : null;
}

export function claimSpawn(db: Db, playerId: string, spawnId: string, now: number) {
    db.run(CLAIM_SPAWN, now, playerId, spawnId);
}

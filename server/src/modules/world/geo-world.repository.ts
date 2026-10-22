import { distanceMetres, type GeoPoint, type GeoSpawn } from "@geo/shared";
import { CONTENT } from "../../content";
import { withTransaction, type TxQuery } from "../../db/transaction";
import { createRng, randomSeed } from "../../engine/rng";
import {
    advanceTravel,
    MAX_SPAWNS,
    randomPointNear,
    rollLifetimeMs,
    rollSpawn,
    spawnCountFor,
    spendTravel,
    SPAWN_RULES,
    type NearPlaces,
    type Travel,
} from "../../world";
import * as questsRepository from "../quests/geo-quests.repository";
import {
    CLAIM_SPAWN,
    DELETE_SPAWNS,
    FIND_LIVE_SPAWN,
    FIND_SPAWNS,
    FIND_TRAVEL,
    INSERT_SPAWN,
    LOCK_PLAYER,
    SAVE_TRAVEL,
    SET_OUT_OF_REACH,
} from "./geo-world.sql";
import type { SpawnRow, TravelRow } from "./geo-world.types";

const OUT_OF_REACH_MS = SPAWN_RULES.outOfReachSeconds * 1000;
const RESPAWN_AFTER_WIN_MS = SPAWN_RULES.respawnAfterWinSeconds * 1000;
const SPAWN_GAP_MS = SPAWN_RULES.spawnGapSeconds * 1000;

/**
 * When it leaves: its lifetime, or sooner once the player has walked away
 * from it, or a minute after it's beaten.
 */
function despawnTime(row: SpawnRow): number {
    let time = row.despawns_at.getTime();
    if (row.out_of_reach_since) time = Math.min(time, row.out_of_reach_since.getTime() + OUT_OF_REACH_MS);
    if (row.claimed_at) time = Math.min(time, row.claimed_at.getTime() + RESPAWN_AFTER_WIN_MS);
    return time;
}

function toSpawn(row: SpawnRow): GeoSpawn {
    return {
        id: row.id,
        enemyId: row.enemy_id,
        sprite: CONTENT.enemies[row.enemy_id]?.sprite ?? row.enemy_id,
        latitude: row.latitude,
        longitude: row.longitude,
        // The app refetches at the soonest of these, so a spawn walked away
        // from leaves the map on time.
        despawnsAt: new Date(despawnTime(row)).toISOString(),
    };
}

/**
 * The player's spawns around `here`, after tidying them. A spawn the player
 * has walked out of reach of starts a countdown (cancelled if they come back)
 * and despawns when it ends; so do ones past their lifetime. Then new ones
 * are placed within reach: one per walk distance banked (up to MAX_SPAWNS,
 * straight away), else — if under this window's count — one once
 * spawnGapSeconds have passed since the last one made, so a sitting player's spawns
 * trickle in rather than refilling at once. Beaten spawns (for a minute) and ones
 * counting down keep their slot. Beaten ones aren't listed.
 */
export async function spawnsAround(
    playerId: string,
    here: GeoPoint,
    now: number,
    /** The nearest place of each habitat, which pull their own enemies. */
    near: NearPlaces,
    /** Dev only: top up to MAX_SPAWNS rather than this window's roll. */
    fill = false,
): Promise<GeoSpawn[]> {
    return withTransaction(async (tx) => {
        await tx(LOCK_PLAYER, [playerId]);
        const rows = await tx<SpawnRow>(FIND_SPAWNS, [playerId]);

        const inReach = (row: SpawnRow) => distanceMetres(here, row) <= SPAWN_RULES.reachMetres;
        const leaving = rows.filter((row) => !inReach(row) && !row.out_of_reach_since);
        const back = rows.filter((row) => inReach(row) && row.out_of_reach_since);
        for (const [changed, since] of [
            [leaving, new Date(now)],
            [back, null],
        ] as const) {
            if (changed.length === 0) continue;
            await tx(SET_OUT_OF_REACH, [playerId, changed.map((row) => row.id), since]);
            for (const row of changed) row.out_of_reach_since = since;
        }

        const gone = rows.filter((row) => despawnTime(row) <= now);
        if (gone.length > 0) await tx(DELETE_SPAWNS, [playerId, gone.map((row) => row.id)]);
        const kept = rows.filter((row) => !gone.includes(row));

        const [travelRow] = await tx<TravelRow>(FIND_TRAVEL, [playerId]);
        const walked = spendTravel(advanceTravel(toTravel(travelRow), here, now), MAX_SPAWNS - kept.length);
        // From the last spawn made, not the newest still here: one walked or
        // driven away from has gone, but the gap still runs.
        const lastSpawnedAt = Math.max(
            travelRow?.last_spawned_at?.getTime() ?? 0,
            ...kept.map((row) => row.created_at.getTime()),
        );
        const trickle = Math.min(1, spawnCountFor(playerId, now) - kept.length, now - lastSpawnedAt >= SPAWN_GAP_MS ? 1 : 0);
        const missing = fill ? MAX_SPAWNS - kept.length : Math.max(walked.spawns, trickle);

        const { travel } = walked;
        await tx(SAVE_TRAVEL, [
            playerId,
            travel.latitude,
            travel.longitude,
            new Date(travel.at),
            travel.bankedMetres,
            new Date(missing > 0 ? now : lastSpawnedAt),
        ]);

        const rng = createRng(randomSeed());
        const tier = missing > 0 ? await questsRepository.findOpenTier(tx, playerId) : 1;
        const questTargets = missing > 0 ? await questsRepository.findKillTargets(tx, playerId) : [];
        for (let i = 0; i < missing; i++) {
            const { enemyId, point } = rollSpawn(rng, here, near, tier, questTargets);
            const [row] = await tx<SpawnRow>(INSERT_SPAWN, [
                playerId,
                enemyId,
                point.latitude,
                point.longitude,
                new Date(now + rollLifetimeMs(rng)),
                new Date(now),
            ]);
            if (row) kept.push(row);
        }

        return kept.filter((row) => row.claimed_at === null).map(toSpawn);
    });
}

function toTravel(row: TravelRow | undefined): Travel | null {
    if (!row) return null;
    return { latitude: row.latitude, longitude: row.longitude, at: row.seen_at.getTime(), bankedMetres: row.banked_metres };
}

/** Dev only: one more spawn of `enemyId` within reach, whatever the count. */
export async function addSpawn(playerId: string, enemyId: string, here: GeoPoint, now: number): Promise<void> {
    await withTransaction(async (tx) => {
        await tx(LOCK_PLAYER, [playerId]);
        const rng = createRng(randomSeed());
        const point = randomPointNear(here, rng);
        await tx(INSERT_SPAWN, [
            playerId,
            enemyId,
            point.latitude,
            point.longitude,
            new Date(now + rollLifetimeMs(rng)),
            new Date(now),
        ]);
    });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One of the player's spawns that can still be fought, or null. */
export async function findLiveSpawn(tx: TxQuery, playerId: string, spawnId: string): Promise<GeoSpawn | null> {
    // A malformed id would make Postgres throw on the uuid cast.
    if (!UUID.test(spawnId)) return null;
    const [row] = await tx<SpawnRow>(FIND_LIVE_SPAWN, [playerId, spawnId]);
    return row ? toSpawn(row) : null;
}

export async function claimSpawn(tx: TxQuery, playerId: string, spawnId: string) {
    await tx(CLAIM_SPAWN, [playerId, spawnId]);
}

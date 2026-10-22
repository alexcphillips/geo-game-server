import type { GeoRewards, GeoRunStatus } from "@geo/shared";
import type { BattleState } from "../../../../game/src/engine/engine.types";

/** A `runs` row as SQLite returns it: JSON as text, booleans as 0/1, times in ms. */
export type RunRecord = {
    id: string;
    player_id: string;
    kind: string;
    status: GeoRunStatus;
    enemy_ids: string;
    /** The spawn being fought; null for dev fights started by enemy id. */
    spawn_id: string | null;
    state: string;
    rewards: string | null;
    coins_lost: number | null;
    /** Fought at full health, leaving the player's own as it was (a dungeon's). */
    keeps_health: number;
    /** The dungeon this is the boss fight of; null for any other Run. */
    dungeon_id: string | null;
    /** The dungeon run this is a room fight of, and the room; null outside dungeon maps. */
    dungeon_run_id: string | null;
    dungeon_room: number | null;
    /** A shared fight's group; null for a solo one. */
    battle_id: string | null;
    /** This player's combatant in the battle; null = the solo "player". */
    combatant_id: string | null;
    /** Shared fights: when the current turn began, and when it's skipped. */
    turn_started_at: number | null;
    turn_deadline: number | null;
    /** Saves so far; the app drops a push older than what it shows. */
    version: number;
};

/** A combat Run, read. */
export type RunRow = Omit<RunRecord, "kind" | "enemy_ids" | "state" | "rewards" | "keeps_health"> & {
    /** Fishing Runs share the table with their own state; code that may meet one checks `kind` first. */
    kind: "combat";
    enemy_ids: string[];
    state: BattleState;
    rewards: GeoRewards | null;
    keeps_health: boolean;
};

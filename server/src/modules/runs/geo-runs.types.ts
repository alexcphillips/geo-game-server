import type { GeoRewards, GeoRunStatus } from "@geo/shared";
import type { BattleState } from "../../engine/engine.types";

export type RunRow = {
    id: string;
    player_id: string;
    /**
     * Fishing Runs share the table (`modules/fishing`) with their own state;
     * code that may meet one checks `kind` as a string first.
     */
    kind: "combat";
    status: GeoRunStatus;
    enemy_ids: string[];
    /** The spawn being fought; null for dev fights started by enemy id. */
    spawn_id: string | null;
    state: BattleState;
    rewards: GeoRewards | null;
    /** BIGINT arrives as a string. */
    coins_lost: string | null;
    /** Fought at full health, leaving the player's own as it was (a dungeon's). */
    keeps_health: boolean;
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
    turn_started_at: Date | null;
    turn_deadline: Date | null;
    /** Saves so far; the app drops a push older than what it shows. */
    version: number;
};

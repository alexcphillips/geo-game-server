import type { GeoRewards, GeoRunStatus } from "@geo/shared";
import type { BattleState } from "../../../../server/src/engine/engine.types";

/** A `runs` row as SQLite returns it: JSON as text, booleans as 0/1, times in ms. */
export type RunRecord = {
    id: string;
    player_id: string;
    kind: string;
    status: GeoRunStatus;
    enemy_ids: string;
    spawn_id: string | null;
    state: string;
    rewards: string | null;
    coins_lost: number | null;
    keeps_health: number;
    dungeon_id: string | null;
    dungeon_run_id: string | null;
    dungeon_room: number | null;
    battle_id: string | null;
    combatant_id: string | null;
    turn_started_at: number | null;
    turn_deadline: number | null;
    version: number;
};

/** A combat Run, read. See server/src/modules/runs/geo-runs.types.ts for what each field means. */
export type RunRow = Omit<RunRecord, "kind" | "enemy_ids" | "state" | "rewards" | "keeps_health"> & {
    /** Fishing Runs share the table with their own state; code that may meet one checks `kind` first. */
    kind: "combat";
    enemy_ids: string[];
    state: BattleState;
    rewards: GeoRewards | null;
    keeps_health: boolean;
};

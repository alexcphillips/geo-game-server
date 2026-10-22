import type { GeoDungeonRunStatus } from "@geo/shared";
import type { DungeonMap } from "../../../../game/src/dungeons/dungeon-map";
import type { MemberState, PartyState } from "../../../../game/src/dungeons/dungeon-run";

/** A `dungeon_runs` row as SQLite returns it: `map` and `state` are JSON. */
export type DungeonRunRecord = { id: string; dungeon_id: string; status: GeoDungeonRunStatus; map: string; state: string; version: number };

export type DungeonRunRow = {
    id: string;
    dungeon_id: string;
    status: GeoDungeonRunStatus;
    /** The map as rolled at the start; never re-derived from the data files. */
    map: DungeonMap;
    state: PartyState;
    version: number;
};

export type DungeonMemberRecord = { player_id: string; display_name: string; status: GeoDungeonRunStatus; state: string };

export type DungeonMemberRow = {
    player_id: string;
    display_name: string;
    status: GeoDungeonRunStatus;
    state: MemberState;
    /** What's stored, as loaded or last saved: a save writes only a member who changed, and the status only when it did. */
    saved: { status: GeoDungeonRunStatus; state: string };
};

/** A party's run with everyone in it, as one unit to change and save. */
export type LoadedRun = { row: DungeonRunRow; members: DungeonMemberRow[] };

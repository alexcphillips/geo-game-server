import type { GeoDungeonRunStatus } from "@geo/shared";
import type { DungeonMap } from "../../dungeons/dungeon-map";
import type { MemberState, PartyState } from "../../dungeons/dungeon-run";

export type DungeonRunRow = {
    id: string;
    dungeon_id: string;
    status: GeoDungeonRunStatus;
    /** The map as rolled at the start; never re-derived from the data files. */
    map: DungeonMap;
    state: PartyState;
    version: number;
};

export type DungeonMemberRow = {
    player_id: string;
    display_name: string;
    status: GeoDungeonRunStatus;
    state: MemberState;
};

/** A party's run with everyone in it, as one unit to change and save. */
export type LoadedRun = { row: DungeonRunRow; members: DungeonMemberRow[] };

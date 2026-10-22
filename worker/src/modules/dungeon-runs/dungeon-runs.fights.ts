import { GEO_DUNGEON_RECONNECT_SECONDS, type GeoDungeonRunStatus, type GeoDungeonRunView, type GeoRoomStyle } from "@geo/shared";
import { rollPools, type RolledChest } from "../../../../game/src/combat/combatants";
import { CONTENT, type DungeonDef } from "../../../../game/src/content";
import type { DungeonScoreRules } from "../../../../game/src/dungeons/dungeon-map";
import {
    holdsUp,
    markDone,
    nextReadyDeadline,
    scoreOf,
    settleReadyUp,
    toDungeonRunView,
    type MemberState,
    type PartyMember,
    type PartyState,
} from "../../../../game/src/dungeons/dungeon-run";
import { createRng } from "../../../../game/src/engine/rng";
import { AppError } from "../../../../game/src/http/AppError";
import type { World } from "../../app";
import type { Db } from "../../db/db";
import * as chestsRepository from "../chests/chests.repository";
import { schedule } from "../jobs/jobs.repository";
import { recordQuestEvents } from "../quests/quests.repository";
import { FIND_ACTIVE_RUN_ID, FIND_DUNGEON_RUN, FIND_MEMBERS, UPDATE_DUNGEON_RUN, UPDATE_MEMBER, UPDATE_MEMBER_STATE } from "./dungeon-runs.sql.ts";
import type { DungeonMemberRecord, DungeonMemberRow, DungeonRunRecord, LoadedRun } from "./dungeon-runs.types";

/**
 * What the rest of the game needs from dungeon runs without importing the
 * Run code (which imports this): loading and saving a party's run, the in-a-dungeon check, the hook a room fight calls
 * when it ends, and the view.
 */

/** Defaults for a dungeon gone from the content since the run started. */
const FALLBACK_RULES: DungeonScoreRules = { chestScores: { gold: 40, ruby: 70, void: 90 }, penalties: { failedPuzzle: 20, death: 15 } };

export const rulesOf = (dungeon: DungeonDef | undefined): DungeonScoreRules =>
    dungeon ? { chestScores: dungeon.chestScores, penalties: dungeon.penalties } : FALLBACK_RULES;

function styleOf(id: string): GeoRoomStyle | undefined {
    const style = CONTENT.roomStyles[id];
    if (!style) return undefined;
    const { corner, radius, rough, wall, inset, tone } = style;
    return { corner, radius, rough, wall, inset, tone };
}

export const RECONNECT_MS = GEO_DUNGEON_RECONNECT_SECONDS * 1000;

/** The scheduler's key for a run's next wake (src/jobs.ts). */
export const wakeKey = (dungeonRunId: string) => `dungeon:${dungeonRunId}`;

export const partyMembers = (run: LoadedRun): PartyMember[] =>
    run.members.map((member) => ({ playerId: member.player_id, name: member.display_name, status: member.status, state: member.state }));

/** The run as one member may see it. */
export function viewFor(run: LoadedRun, playerId: string): GeoDungeonRunView {
    const { row } = run;
    const dungeon = CONTENT.dungeons[row.dungeon_id];
    return toDungeonRunView(
        { id: row.id, dungeonId: row.dungeon_id, dungeonName: dungeon?.name ?? row.dungeon_id, version: row.version },
        row.map,
        row.state,
        partyMembers(run),
        playerId,
        rulesOf(dungeon),
        styleOf,
    );
}

/** The run with everyone in it. */
export function loadRun(db: Db, dungeonRunId: string): LoadedRun | undefined {
    const row = db.one<DungeonRunRecord>(FIND_DUNGEON_RUN, dungeonRunId);
    if (!row) return undefined;
    return {
        row: { ...row, map: JSON.parse(row.map) as LoadedRun["row"]["map"], state: JSON.parse(row.state) as PartyState },
        members: db
            .all<DungeonMemberRecord>(FIND_MEMBERS, dungeonRunId)
            .map((member) => ({
                ...member,
                state: JSON.parse(member.state) as MemberState,
                saved: { status: member.status, state: member.state },
            })),
    };
}

export function memberOf(run: LoadedRun, playerId: string): DungeonMemberRow {
    const member = run.members.find((m) => m.player_id === playerId);
    if (!member) throw AppError.notFound("Dungeon run not found");
    return member;
}

/** Over once nobody is left in it: won if anyone beat the boss. */
function runStatus(members: DungeonMemberRow[]): GeoDungeonRunStatus {
    if (members.some((member) => member.status === "active")) return "active";
    return members.some((member) => member.status === "won") ? "won" : "failed";
}

/**
 * When the run next needs settling with nobody acting (ms), or null: now,
 * if the ready-up has moved on (a straggler's fight ended, someone's out);
 * else the next ready-up deadline, or a player offline long enough to stop
 * holding things up (only with someone else still in).
 */
export function nextWake(world: World, run: LoadedRun, now = Date.now()): number | null {
    if (run.row.status !== "active") return null;
    const members = partyMembers(run);
    if (settleReadyUp(run.row.map, run.row.state, members, now).changed) return now;
    const times: number[] = [];
    const deadline = nextReadyDeadline(members);
    if (deadline !== null) times.push(deadline);
    if (members.filter((member) => member.status === "active").length >= 2) {
        for (const member of members) {
            const off = world.hub.offlineSince(member.playerId);
            if (off !== null && holdsUp(run.row.map, run.row.state, member)) times.push(off + RECONNECT_MS);
        }
    }
    return times.length > 0 ? Math.min(...times) : null;
}

/** Books the run's next wake with the scheduler (none once it's over). */
export function bookWake(world: World, run: LoadedRun) {
    schedule(world.db, wakeKey(run.row.id), nextWake(world, run));
}

/**
 * Saves the party's side and every member who changed, moves the version
 * on, books the next wake, and pushes everyone their view once the
 * transaction commits. Updates `run` in place (status, version), so it can
 * be viewed after.
 */
export function saveRun(world: World, run: LoadedRun) {
    const { db } = world;
    const now = Date.now();
    run.row.status = runStatus(run.members);
    const saved = db.one<{ version: number }>(UPDATE_DUNGEON_RUN, run.row.id, run.row.status, JSON.stringify(run.row.state), now);
    run.row.version = saved!.version;
    for (const member of run.members) {
        const state = JSON.stringify(member.state);
        if (member.status !== member.saved.status) db.run(UPDATE_MEMBER, run.row.id, member.player_id, member.status, state, now);
        else if (state !== member.saved.state) db.run(UPDATE_MEMBER_STATE, state, run.row.id, member.player_id);
        member.saved = { status: member.status, state };
    }
    bookWake(world, run);
    db.afterCommit(() => pushRun(world, run));
}

/**
 * Sends each connected member their own view. Runs straight after the
 * commit, in the same synchronous turn, so `run` is what was saved (its last
 * save, when one transaction saves twice).
 */
function pushRun(world: World, run: LoadedRun) {
    for (const member of run.members) {
        if (world.hub.isConnected(member.player_id)) {
            world.hub.publish(member.player_id, { type: "dungeonRun", dungeonRun: viewFor(run, member.player_id) });
        }
    }
}

/** The id of the dungeon run the player is still in, if any. */
export function findActiveRunId(db: Db, playerId: string): string | undefined {
    return db.one<{ id: string }>(FIND_ACTIVE_RUN_ID, playerId)?.id;
}

/** The run the player is still in, if any. */
export function findActive(db: Db, playerId: string): LoadedRun | undefined {
    const id = findActiveRunId(db, playerId);
    return id ? loadRun(db, id) : undefined;
}

/** Refuses while the player is in a dungeon, e.g. a spawn fight or fishing. */
export function assertNotInDungeon(db: Db, playerId: string, message = "You're in a dungeon. Finish or leave it first.") {
    if (findActiveRunId(db, playerId)) throw AppError.badRequest(message);
}

/**
 * A room fight has ended (from its own turn, a flee, or a leave). Win: the
 * room is done (for everyone, unless it's the fighter's own), and the boss
 * ends the dungeon for the fighter, with chests. Defeat: the fighter is out.
 * Fled: back to the room they came from, damage kept. `health` is what the
 * fight left. In the fight's transaction.
 */
export function dungeonFightOver(
    world: World,
    fight: { id: string; player_id: string; dungeon_run_id: string | null; dungeon_room: number | null },
    outcome: "victory" | "defeat" | "fled",
    health: number,
) {
    if (!fight.dungeon_run_id || fight.dungeon_room === null) return;
    const run = loadRun(world.db, fight.dungeon_run_id);
    const member = run?.members.find((m) => m.player_id === fight.player_id);
    // A fight that ends as it starts arrives before the run has noted it.
    if (!run || !member || member.status !== "active" || (member.state.fight && member.state.fight.runId !== fight.id)) return;
    applyFightOver(world, run, member, { runId: fight.id, room: fight.dungeon_room }, outcome, health);
    saveRun(world, run);
}

/** `dungeonFightOver` on a run already loaded; the caller saves it. */
export function applyFightOver(
    world: World,
    run: LoadedRun,
    member: DungeonMemberRow,
    fight: { runId: string; room: number },
    outcome: "victory" | "defeat" | "fled",
    health: number,
) {
    member.state = { ...member.state, fight: null, health: Math.max(0, health) };
    const room = run.row.map.rooms[fight.room]!;
    if (outcome === "victory") {
        const marked = markDone(run.row.map, run.row.state, member.state, room.id);
        run.row.state = marked.party;
        member.state = marked.member;
        if (room.kind === "boss") finishWon(world, run, member, fight.runId);
    } else if (outcome === "defeat") {
        run.row.state = { ...run.row.state, deaths: run.row.state.deaths + 1 };
        member.state = { ...member.state, health: 0, outReason: "died" };
        member.status = "failed";
    } else if (room.kind === "boss") {
        // No backing out of the boss and coming again.
        member.state = { ...member.state, outReason: "fledBoss" };
        member.status = "failed";
    } else {
        member.state = { ...member.state, current: member.state.previous };
    }
}

/** The member beat the boss: the party's score so far picks their chests; they go to the Chests tab, and it counts for quests. */
function finishWon(world: World, run: LoadedRun, member: DungeonMemberRow, bossRunId: string) {
    const dungeon = CONTENT.dungeons[run.row.dungeon_id];
    const party = run.row.state;
    const { chests: tiers } = scoreOf(run.row.map, party, run.members.map((m) => m.state), rulesOf(dungeon));
    const rng = createRng(party.seed, party.draws);
    const chests: RolledChest[] = tiers.flatMap((tier) => {
        const pools = dungeon?.chests[tier];
        if (!pools) return [];
        const { name, cost } = CONTENT.chestTiers[tier];
        return [{ tier, name, cost, items: rollPools(pools, rng) }];
    });
    run.row.state = { ...party, draws: rng.draws() };
    if (chests.length > 0) {
        const source = { kind: "dungeon" as const, name: dungeon?.name ?? run.row.dungeon_id };
        const selection = chestsRepository.createSelection(world, member.player_id, source, bossRunId, chests);
        member.state = { ...member.state, chestSelectionId: selection.id };
    }
    recordQuestEvents(world.db, member.player_id, [{ type: "dungeon", dungeonId: run.row.dungeon_id }]);
    member.status = "won";
}

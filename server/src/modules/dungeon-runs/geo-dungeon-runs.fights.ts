import type { GeoDungeonRunStatus, GeoDungeonRunView, GeoRoomStyle } from "@geo/shared";
import { query } from "../../db";
import { AppError } from "../../http/AppError";
import { rollPools, type RolledChest } from "../../combat/combatants";
import { CONTENT, type DungeonDef } from "../../content";
import { afterCommit, type TxQuery } from "../../db/transaction";
import type { DungeonScoreRules } from "../../dungeons/dungeon-map";
import { GEO_DUNGEON_RECONNECT_SECONDS } from "@geo/shared";
import {
    holdsUp,
    markDone,
    nextReadyDeadline,
    scoreOf,
    settleReadyUp,
    toDungeonRunView,
    type PartyMember,
} from "../../dungeons/dungeon-run";
import { createRng } from "../../engine/rng";
import * as socketHub from "../../realtime/geo-socket-hub";
import * as chestsRepository from "../chests/geo-chests.repository";
import * as questsRepository from "../quests/geo-quests.repository";
import { wakeRunAt } from "./geo-dungeon-runs.clock";
import {
    FIND_ACTIVE_RUN_ID,
    FIND_DUNGEON_RUN,
    FIND_DUNGEON_RUN_FOR_UPDATE,
    FIND_MEMBERS,
    SET_WAKE,
    UPDATE_DUNGEON_RUN,
    UPDATE_MEMBER,
} from "./geo-dungeon-runs.sql";
import type { DungeonMemberRow, DungeonRunRow, LoadedRun } from "./geo-dungeon-runs.types";

/**
 * What the rest of geo-game needs from dungeon runs without importing the
 * Run code (which imports this): loading and saving a party's run, the
 * in-a-dungeon check, the hook a room fight calls when it ends, the view,
 * and pushing it to the party.
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

/** The run with everyone in it. `lock`: hold the run row for the rest of the transaction. */
export async function loadRun(tx: TxQuery, dungeonRunId: string, lock: boolean): Promise<LoadedRun | undefined> {
    const [row] = await tx<DungeonRunRow>(lock ? FIND_DUNGEON_RUN_FOR_UPDATE : FIND_DUNGEON_RUN, [dungeonRunId]);
    if (!row) return undefined;
    return { row, members: await tx<DungeonMemberRow>(FIND_MEMBERS, [dungeonRunId]) };
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
export function nextWake(run: LoadedRun, now = Date.now()): number | null {
    if (run.row.status !== "active") return null;
    const members = partyMembers(run);
    if (settleReadyUp(run.row.map, run.row.state, members, now).changed) return now;
    const times: number[] = [];
    const deadline = nextReadyDeadline(members);
    if (deadline !== null) times.push(deadline);
    if (members.filter((member) => member.status === "active").length >= 2) {
        for (const member of members) {
            const off = socketHub.offlineSince(member.playerId);
            if (off !== null && holdsUp(run.row.map, run.row.state, member)) times.push(off + RECONNECT_MS);
        }
    }
    return times.length > 0 ? Math.min(...times) : null;
}

/** Books the next wake: on the row, for the job after a restart, and as a timer once committed. */
export async function bookWake(tx: TxQuery, run: LoadedRun, wake = nextWake(run)): Promise<void> {
    await tx(SET_WAKE, [run.row.id, wake]);
    scheduleWake(tx, run.row.id, wake);
}

function scheduleWake(tx: TxQuery, dungeonRunId: string, wake: number | null) {
    if (wake !== null) afterCommit(tx, () => wakeRunAt(dungeonRunId, wake));
}

/**
 * Saves the party's side and every member's, moves the version on, books
 * the next wake, and pushes everyone their view once the transaction
 * commits. Updates `run` in place (status, version), so it can be viewed after.
 */
export async function saveRun(tx: TxQuery, run: LoadedRun): Promise<void> {
    run.row.status = runStatus(run.members);
    const wake = nextWake(run);
    const [saved] = await tx<{ version: number }>(UPDATE_DUNGEON_RUN, [run.row.id, run.row.status, run.row.state, wake]);
    run.row.version = saved!.version;
    for (const member of run.members) await tx(UPDATE_MEMBER, [run.row.id, member.player_id, member.status, member.state]);
    const id = run.row.id;
    afterCommit(tx, () => pushRun(id));
    scheduleWake(tx, id, wake);
}

/** Sends each member their own view, read fresh after the change committed. */
export async function pushRun(dungeonRunId: string): Promise<void> {
    const run = await loadRun(query, dungeonRunId, false);
    if (!run) return;
    for (const member of run.members) {
        if (socketHub.isConnected(member.player_id)) socketHub.publish(member.player_id, { type: "dungeonRun", dungeonRun: viewFor(run, member.player_id) });
    }
}

/** The id of the dungeon run the player is still in, if any. */
export async function findActiveRunId(tx: TxQuery, playerId: string): Promise<string | undefined> {
    const [found] = await tx<{ id: string }>(FIND_ACTIVE_RUN_ID, [playerId]);
    return found?.id;
}

/** The run the player is still in, locked, if any. */
export async function findActiveForUpdate(tx: TxQuery, playerId: string): Promise<LoadedRun | undefined> {
    const id = await findActiveRunId(tx, playerId);
    return id ? loadRun(tx, id, true) : undefined;
}

/** Refuses while the player is in a dungeon, e.g. a spawn fight or fishing. The caller holds the player lock. */
export async function assertNotInDungeon(tx: TxQuery, playerId: string, message = "You're in a dungeon. Finish or leave it first.") {
    if (await findActiveRunId(tx, playerId)) throw AppError.badRequest(message);
}

/**
 * A room fight has ended (from its own turn, a flee, or a leave). Win: the
 * room is done (for everyone, unless it's the fighter's own), and the boss
 * ends the dungeon for the fighter, with chests. Defeat: the fighter is out.
 * Fled: back to the room they came from, damage kept. `health` is what the
 * fight left. In the fight's transaction, which holds the fighter's lock.
 */
export async function dungeonFightOver(
    tx: TxQuery,
    fight: { id: string; player_id: string; dungeon_run_id: string | null; dungeon_room: number | null },
    outcome: "victory" | "defeat" | "fled",
    health: number,
): Promise<void> {
    if (!fight.dungeon_run_id || fight.dungeon_room === null) return;
    const run = await loadRun(tx, fight.dungeon_run_id, true);
    const member = run?.members.find((m) => m.player_id === fight.player_id);
    // A fight that ends as it starts arrives before the run has noted it.
    if (!run || !member || member.status !== "active" || (member.state.fight && member.state.fight.runId !== fight.id)) return;
    await applyFightOver(tx, run, member, { runId: fight.id, room: fight.dungeon_room }, outcome, health);
    await saveRun(tx, run);
}

/** `dungeonFightOver` on a run already loaded and locked; the caller saves it. */
export async function applyFightOver(
    tx: TxQuery,
    run: LoadedRun,
    member: DungeonMemberRow,
    fight: { runId: string; room: number },
    outcome: "victory" | "defeat" | "fled",
    health: number,
): Promise<void> {
    member.state = { ...member.state, fight: null, health: Math.max(0, health) };
    const room = run.row.map.rooms[fight.room]!;
    if (outcome === "victory") {
        const marked = markDone(run.row.map, run.row.state, member.state, room.id);
        run.row.state = marked.party;
        member.state = marked.member;
        if (room.kind === "boss") await finishWon(tx, run, member, fight.runId);
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
async function finishWon(tx: TxQuery, run: LoadedRun, member: DungeonMemberRow, bossRunId: string) {
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
        const selection = await chestsRepository.createSelection(tx, member.player_id, source, bossRunId, chests);
        member.state = { ...member.state, chestSelectionId: selection.id };
    }
    await questsRepository.recordQuestEvents(tx, member.player_id, [{ type: "dungeon", dungeonId: run.row.dungeon_id }]);
    member.status = "won";
}

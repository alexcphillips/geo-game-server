import type { GeoDungeonRunResponse, GeoDungeonRunView, GeoRunResponse } from "@geo/shared";
import { query } from "../../db";
import { AppError } from "../../http/AppError";
import { rollPools, type Drop } from "../../combat/combatants";
import { CONTENT, type DungeonDef } from "../../content";
import { withTransaction, type TxQuery } from "../../db/transaction";
import { rollMap } from "../../dungeons/dungeon-map";
import {
    bossRoomOf,
    holdsUp,
    isDone,
    isLocked,
    makePuzzle,
    markDone,
    moveProblem,
    newMemberState,
    newPartyState,
    perspective,
    settleReadyUp,
} from "../../dungeons/dungeon-run";
import { createRng, randomSeed } from "../../engine/rng";
import * as socketHub from "../../realtime/geo-socket-hub";
import { playerMaxHealth } from "../../world/global-effects";
import * as fishingRepository from "../fishing/geo-fishing.repository";
import * as playerRepository from "../player/geo-player.repository";
import * as runsRepository from "../runs/geo-runs.repository";
import { ABANDON_STALE_RUNS, FIND_ACTIVE_RUN } from "../runs/geo-runs.sql";
import type { RunRow } from "../runs/geo-runs.types";
import { setSettler, wakeRunAt } from "./geo-dungeon-runs.clock";
import {
    applyFightOver,
    bookWake,
    dungeonFightOver,
    findActiveRunId,
    loadRun,
    memberOf,
    partyMembers,
    RECONNECT_MS,
    saveRun,
    viewFor,
} from "./geo-dungeon-runs.fights";
import { END_FIGHT, FIND_DUE_RUNS, FIND_FIGHT, FIND_MEMBER_IDS, INSERT_DUNGEON_RUN, INSERT_MEMBER } from "./geo-dungeon-runs.sql";
import type { DungeonMemberRow, DungeonRunRow, LoadedRun } from "./geo-dungeon-runs.types";

/** PLACEHOLDER: an event room is a healing spring for a quarter of max health, until events are designed. */
const SPRING_HEAL_SHARE = 0.25;

/**
 * Refuses a player who can't go into a dungeon right now: in a fight,
 * already in a dungeon, an empty combat hand. A fishing spot is left, as for
 * any fight. The caller holds the player lock.
 */
export async function assertCanEnter(tx: TxQuery, playerId: string): Promise<void> {
    await tx(ABANDON_STALE_RUNS, [playerId, runsRepository.ABANDON_AFTER_MINUTES]);
    const [active] = await tx<RunRow>(FIND_ACTIVE_RUN, [playerId]);
    if (active && (active.kind as string) === "fishing") await fishingRepository.endOpenFishing(tx, active);
    else if (active) throw AppError.badRequest("You're already in a Run. Finish or flee it first.");
    if (await findActiveRunId(tx, playerId)) throw AppError.badRequest("You're already in a dungeon");
    if ((await playerRepository.findHand(playerId, "combat", tx)).length === 0) throw AppError.badRequest("Your combat hand is empty");
}

/**
 * Opens one dungeon run for the whole party in the start's transaction: one
 * map rolled on the server, everyone at the entrance at full health. Each
 * player has passed `assertCanEnter` under their own lock. `playerIds` in
 * lobby order. Returns each player's view.
 */
export async function openPartyRun(tx: TxQuery, dungeon: DungeonDef, lobbyId: string, playerIds: string[]): Promise<LoadedRun> {
    const seed = randomSeed();
    const rng = createRng(seed);
    const layout = dungeon.layouts[Math.floor(rng.next() * dungeon.layouts.length)]!;
    const map = rollMap(dungeon, layout, rng.next);
    const [row] = await tx<DungeonRunRow>(INSERT_DUNGEON_RUN, [dungeon.id, lobbyId, map, newPartyState(map, seed, rng.draws())]);
    if (!row) throw new Error("Dungeon run insert returned nothing");
    for (const [seat, playerId] of playerIds.entries()) {
        await tx(INSERT_MEMBER, [row.id, playerId, newMemberState(map, await playerMaxHealth(playerId, tx)), seat]);
    }
    const run = await loadRun(tx, row.id, true);
    // Saved once more so the party hears it started (the version moves on, too).
    await saveRun(tx, run!);
    return run!;
}

/**
 * Locks everyone in the party (in id order, so two of these can't deadlock),
 * then the run. Every dungeon action takes this, because settling can touch
 * any member: start their boss fight, end their room fight, put them out.
 */
async function lockParty(tx: TxQuery, dungeonRunId: string): Promise<LoadedRun | undefined> {
    const ids = await tx<{ player_id: string }>(FIND_MEMBER_IDS, [dungeonRunId]);
    for (const { player_id } of ids) await playerRepository.lockPlayer(tx, player_id);
    return loadRun(tx, dungeonRunId, true);
}

/** Ends a member's room fight from outside it, as a flee: what it left of their health is kept. */
async function endFightAsFled(tx: TxQuery, run: LoadedRun, member: DungeonMemberRow, alreadyOver: boolean) {
    const fight = member.state.fight!;
    if (!alreadyOver) await tx(END_FIGHT, [fight.runId]);
    const [found] = await tx<Pick<RunRow, "status" | "state">>(FIND_FIGHT, [fight.runId]);
    const health = found?.state.combatants.find((c) => c.side === "player")?.health ?? member.state.health;
    await applyFightOver(tx, run, member, fight, "fled", health);
}

/**
 * Brings the run up to `now`; true if anything changed (the caller saves).
 * - A room fight the Run code ended out of sight (left too long) is caught
 *   up on as fled, so the room isn't held for a fight that's over.
 * - With anyone else still in, a member with no socket for
 *   GEO_DUNGEON_RECONNECT_SECONDS lets go of what they hold: their room
 *   fight is fled, and they step back out of the boss room or a puzzle room.
 * - The ready-up clock: started, stopped, run out (that member's out); when
 *   everyone still in is ready, the boss starts for all of them.
 */
async function settle(tx: TxQuery, run: LoadedRun, now = Date.now()): Promise<{ changed: boolean; bossFights: Map<string, GeoRunResponse> }> {
    const bossFights = new Map<string, GeoRunResponse>();
    if (run.row.status !== "active") return { changed: false, bossFights };
    let changed = false;
    for (const member of run.members) {
        const fight = member.state.fight;
        if (member.status !== "active" || !fight) continue;
        const [found] = await tx<Pick<RunRow, "status">>(FIND_FIGHT, [fight.runId]);
        if (found?.status === "active") continue;
        await endFightAsFled(tx, run, member, true);
        changed = true;
    }

    const map = run.row.map;
    if (run.members.filter((member) => member.status === "active").length >= 2) {
        for (const member of run.members) {
            const off = socketHub.offlineSince(member.player_id);
            const asParty = partyMembers(run).find((m) => m.playerId === member.player_id)!;
            if (off === null || now < off + RECONNECT_MS || !holdsUp(map, run.row.state, asParty)) continue;
            if (member.state.fight) await endFightAsFled(tx, run, member, false);
            else member.state = { ...member.state, current: member.state.previous };
            changed = true;
        }
    }

    const ready = settleReadyUp(map, run.row.state, partyMembers(run), now);
    for (const settled of ready.members) {
        const member = memberOf(run, settled.playerId);
        member.status = settled.status;
        member.state = settled.state;
    }
    if (ready.start) await startBoss(tx, run, now, bossFights);
    return { changed: changed || ready.changed, bossFights };
}

/**
 * Everyone still in is in the boss room: the boss starts for all of them at
 * once, in one shared fight. Nobody else can go in after. One who can't
 * fight (it won't open for them) is out. Each one's fight goes into
 * `opened`, by player. Anyone the opening already put down is out here,
 * since the fight's own hook can't see this unsaved change.
 */
async function startBoss(tx: TxQuery, run: LoadedRun, now: number, opened: Map<string, GeoRunResponse>) {
    const dungeon = CONTENT.dungeons[run.row.dungeon_id];
    const boss = bossRoomOf(run.row.map);
    if (!dungeon || !boss) return;
    run.row.state = { ...run.row.state, bossStartedAt: now };
    const going = run.members.filter((member) => member.status === "active");
    const { opened: fights, refused } = await runsRepository.openSharedCombatRun(
        tx,
        going.map((member) => ({ playerId: member.player_id, startHealth: member.state.health })),
        {
            enemyId: dungeon.boss,
            spawnId: null,
            enemyModifiers: dungeon.bossModifiers,
            keepsHealth: true,
            dungeonRunId: run.row.id,
            dungeonRoom: boss.id,
        },
    );
    for (const member of going) {
        const fight = fights.get(member.player_id);
        if (!fight || refused.includes(member.player_id)) {
            member.status = "failed";
            member.state = { ...member.state, outReason: "missedBoss" };
            continue;
        }
        opened.set(member.player_id, fight);
        if (fight.run.status === "active") member.state = { ...member.state, fight: { runId: fight.run.id, room: boss.id } };
        else {
            const you = fight.run.combatants.find((c) => c.id === fight.run.you);
            const outcome = fight.run.status === "victory" ? "victory" : fight.run.status === "fled" ? "fled" : "defeat";
            await applyFightOver(tx, run, member, { runId: fight.run.id, room: boss.id }, outcome, you?.health ?? 0);
        }
    }
}

/** Locks the party and its run, settled to now. Refuses a player who isn't in it. */
async function lockRun(tx: TxQuery, playerId: string, dungeonRunId: string): Promise<{ run: LoadedRun; me: DungeonMemberRow; changed: boolean }> {
    const run = await lockParty(tx, dungeonRunId);
    if (!run) throw AppError.notFound("Dungeon run not found");
    const me = memberOf(run, playerId);
    await tx(ABANDON_STALE_RUNS, [playerId, runsRepository.ABANDON_AFTER_MINUTES]);
    return { run, me, changed: (await settle(tx, run)).changed };
}

/**
 * Settles a run nobody is acting on: the ready-up clock or the reconnect
 * window came due. From the run's timer and the job's sweep.
 */
export async function settleRun(dungeonRunId: string): Promise<void> {
    await withTransaction(async (tx) => {
        const run = await lockParty(tx, dungeonRunId);
        if (!run || run.row.status !== "active") return;
        if ((await settle(tx, run)).changed) await saveRun(tx, run);
        else await bookWake(tx, run);
    });
}
setSettler(settleRun);

/** The job's sweep: runs whose wake is due (a restart dropped their timers). */
export async function settleDueRuns(): Promise<void> {
    for (const { id } of await query<{ id: string }>(FIND_DUE_RUNS)) await settleRun(id);
}

// A player went offline: if they're in a party, look again once the reconnect window (from when they dropped) is up.
socketHub.onOffline((playerId) => {
    void findActiveRunId(query, playerId)
        .then((id) => id && wakeRunAt(id, (socketHub.offlineSince(playerId) ?? Date.now()) + RECONNECT_MS))
        .catch((error: unknown) => console.error("geo: offline wake failed", error));
});

function response(run: LoadedRun, playerId: string, extra: Partial<Omit<GeoDungeonRunResponse, "dungeonRun">> = {}): GeoDungeonRunResponse {
    return { dungeonRun: viewFor(run, playerId), fight: null, found: [], notes: [], ...extra };
}

/** The dungeon run the player is still in, or null; for picking it back up after a restart. */
export async function findActive(playerId: string): Promise<GeoDungeonRunResponse | null> {
    return withTransaction(async (tx) => {
        const id = await findActiveRunId(tx, playerId);
        if (!id) return null;
        const { run, changed } = await lockRun(tx, playerId, id);
        if (changed) await saveRun(tx, run);
        // Settling may have just put them out.
        return response(run, playerId);
    });
}

/** One of the player's dungeon runs, over or not: how it ended, after the last fight. */
export async function findOne(playerId: string, dungeonRunId: string): Promise<GeoDungeonRunResponse> {
    return withTransaction(async (tx) => {
        const { run, changed } = await lockRun(tx, playerId, dungeonRunId);
        if (changed) await saveRun(tx, run);
        return response(run, playerId);
    });
}

/** The player's view, for the socket's snapshot on connect. No locks; null if they're not in a dungeon. */
export async function findActiveView(tx: TxQuery, playerId: string): Promise<GeoDungeonRunView | null> {
    const id = await findActiveRunId(tx, playerId);
    const run = id ? await loadRun(tx, id, false) : undefined;
    return run ? viewFor(run, playerId) : null;
}

function pickEnemy(dungeon: DungeonDef, kind: string, next: () => number): string {
    const pool = kind === "star" ? dungeon.starEnemies : kind === "miniboss" ? dungeon.minibossEnemies : dungeon.encounterEnemies;
    return pool[Math.floor(next() * pool.length)]!;
}

/**
 * Walks into a room. Every rule is checked here: a door from where anyone
 * in the party has been, nothing blocking the way, nobody else fighting or
 * puzzling in there, the boss sealed until every star room is cleared (and
 * closed once its fight starts), and the key for a locked room (one is used
 * up). What's inside happens at once: a fight starts, loot goes into the
 * inventory, a puzzle appears. The boss room is the ready-up: being there is
 * being ready, and the last one in starts the boss for everyone.
 */
export async function move(playerId: string, dungeonRunId: string, roomId: number): Promise<GeoDungeonRunResponse> {
    return withTransaction(async (tx) => {
        const { run, me } = await lockRun(tx, playerId, dungeonRunId);
        if (me.status !== "active") throw AppError.badRequest("That dungeon is over");
        const dungeon = CONTENT.dungeons[run.row.dungeon_id];
        if (!dungeon) throw AppError.badRequest("That dungeon no longer exists");
        const map = run.row.map;
        const others = partyMembers(run).filter((member) => member.playerId !== playerId);
        const problem = moveProblem(map, perspective(run.row.state, me.state), roomId, others);
        if (problem) throw AppError.badRequest(problem);

        const room = map.rooms[roomId]!;
        const notes: string[] = [];
        const found: Drop[] = [];
        if (isLocked(room, perspective(run.row.state, me.state))) {
            await playerRepository.takeItems(tx, playerId, room.lock!, 1);
            me.state = { ...me.state, unlocked: [...me.state.unlocked, room.id] };
            notes.push(`You used a ${CONTENT.items[room.lock!]?.name ?? "key"}. Only you can go past this door.`);
        }
        me.state = { ...me.state, previous: me.state.current, current: room.id };
        if (!run.row.state.visited.includes(room.id)) run.row.state = { ...run.row.state, visited: [...run.row.state.visited, room.id] };

        const rng = createRng(run.row.state.seed, run.row.state.draws);
        const done = (id: number) => {
            const marked = markDone(map, run.row.state, me.state, id);
            run.row.state = marked.party;
            me.state = marked.member;
        };
        let fightTarget: runsRepository.RunTarget | null = null;
        if (!isDone(room, perspective(run.row.state, me.state))) {
            switch (room.kind) {
                case "encounter":
                case "star":
                case "miniboss":
                    fightTarget = { enemyId: pickEnemy(dungeon, room.kind, rng.next), spawnId: null, keepsHealth: true };
                    break;
                case "boss":
                    notes.push("You're ready. The boss starts when everyone still in is here.");
                    break;
                case "loot": {
                    const items = rollPools(dungeon.roomLoot, rng);
                    await playerRepository.grantItems(tx, playerId, items);
                    found.push(...items);
                    done(room.id);
                    break;
                }
                case "event": {
                    const healed = Math.min(me.state.maxHealth - me.state.health, Math.round(me.state.maxHealth * SPRING_HEAL_SHARE));
                    me.state = { ...me.state, health: me.state.health + healed };
                    notes.push(healed > 0 ? `A healing spring: +${healed} health.` : "A healing spring. You're already at full health.");
                    done(room.id);
                    break;
                }
                case "puzzle":
                    if (!run.row.state.puzzles[room.id]) {
                        run.row.state = { ...run.row.state, puzzles: { ...run.row.state.puzzles, [room.id]: makePuzzle(rng.next) } };
                    }
                    notes.push("A puzzle. One answer, one try, for the whole party.");
                    break;
                default:
                    break;
            }
        }
        run.row.state = { ...run.row.state, draws: rng.draws() };
        // The last one into the boss room starts it, theirs included.
        const { bossFights } = await settle(tx, run);
        await saveRun(tx, run);

        let fight: GeoRunResponse | null = bossFights.get(playerId) ?? null;
        if (fightTarget) {
            fight = await runsRepository.openCombatRun(tx, playerId, {
                ...fightTarget,
                dungeonRunId: run.row.id,
                dungeonRoom: room.id,
                startHealth: me.state.health,
            });
            if (fight.run.status === "active") {
                me.state = { ...me.state, fight: { runId: fight.run.id, room: room.id } };
                await saveRun(tx, run);
            } else {
                const fighter = { id: fight.run.id, player_id: playerId, dungeon_run_id: run.row.id, dungeon_room: room.id };
                await dungeonFightOver(tx, fighter, fight.run.status === "victory" ? "victory" : "defeat", me.state.health);
            }
        }
        const fresh = await loadRun(tx, run.row.id, true);
        return response(fresh!, playerId, { fight, found, notes });
    });
}

/** Answers the puzzle in the player's room: one try, right or wrong, for the whole party. */
export async function answerPuzzle(playerId: string, dungeonRunId: string, answer: number): Promise<GeoDungeonRunResponse> {
    return withTransaction(async (tx) => {
        const { run, me } = await lockRun(tx, playerId, dungeonRunId);
        if (me.status !== "active") throw AppError.badRequest("That dungeon is over");
        const roomId = me.state.current;
        const puzzle = run.row.state.puzzles[roomId];
        if (!puzzle) throw AppError.badRequest("There's no puzzle here");
        if (puzzle.result) throw AppError.badRequest("That puzzle has had its one try");
        if (!Number.isInteger(answer) || answer < 0 || answer >= puzzle.options.length) throw AppError.badRequest("Pick one of the options");

        const result = answer === puzzle.answer ? "solved" : "failed";
        run.row.state = { ...run.row.state, puzzles: { ...run.row.state.puzzles, [roomId]: { ...puzzle, result } } };
        const marked = markDone(run.row.map, run.row.state, me.state, roomId);
        run.row.state = marked.party;
        me.state = marked.member;
        await saveRun(tx, run);
        const note = result === "solved" ? "Solved." : `Wrong: it was ${puzzle.options[puzzle.answer]}. The Void chest is gone.`;
        return response(run, playerId, { notes: [note] });
    });
}

/** Leaves the dungeon: it counts as failing it, for you; the others play on. A fight going on ends there. */
export async function leave(playerId: string, dungeonRunId: string): Promise<GeoDungeonRunResponse> {
    return withTransaction(async (tx) => {
        const { run, me } = await lockRun(tx, playerId, dungeonRunId);
        if (me.status !== "active") throw AppError.badRequest("That dungeon is over");
        if (me.state.fight) await tx(END_FIGHT, [me.state.fight.runId]);
        me.status = "failed";
        me.state = { ...me.state, fight: null, onClockSince: null, outReason: "left" };
        // One fewer to wait for: the rest may all be ready now.
        await settle(tx, run);
        await saveRun(tx, run);
        return response(run, playerId, { notes: ["You left the dungeon. No chests this time; your purse is safe."] });
    });
}

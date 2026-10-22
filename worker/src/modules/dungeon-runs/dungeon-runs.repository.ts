import type { GeoDungeonRunResponse, GeoRunResponse } from "@geo/shared";
import { rollPools, type Drop } from "../../../../server/src/combat/combatants";
import { CONTENT, type DungeonDef } from "../../../../server/src/content";
import { rollMap } from "../../../../server/src/dungeons/dungeon-map";
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
} from "../../../../server/src/dungeons/dungeon-run";
import type { BattleState } from "../../../../server/src/engine/engine.types";
import { createRng, randomSeed } from "../../../../server/src/engine/rng";
import { AppError } from "../../../../server/src/http/AppError";
import type { World } from "../../app";
import { endOpenFishing } from "../fishing/fishing.repository";
import * as playerRepository from "../player/player.repository";
import * as runsRepository from "../runs/runs.repository";
import type { RunRecord } from "../runs/runs.types";
import {
    applyFightOver,
    bookWake,
    findActiveRunId,
    loadRun,
    memberOf,
    partyMembers,
    RECONNECT_MS,
    saveRun,
    viewFor,
} from "./dungeon-runs.fights";
import { END_FIGHT, FIND_FIGHT, INSERT_DUNGEON_RUN, INSERT_MEMBER } from "./dungeon-runs.sql.ts";
import type { DungeonMemberRow, DungeonRunRecord, LoadedRun } from "./dungeon-runs.types";

/**
 * A started dungeon's map, walked room by room by the whole party, from
 * server/src/modules/dungeon-runs/geo-dungeon-runs.repository.ts. Each
 * function runs inside the caller's transaction: one party action is one
 * transaction, which is all the locking the party needs.
 */

/** PLACEHOLDER: an event room is a healing spring for a quarter of max health, until events are designed. */
const SPRING_HEAL_SHARE = 0.25;

/**
 * Refuses a player who can't go into a dungeon right now: in a fight,
 * already in a dungeon, an empty combat hand. A fishing spot is left, as for
 * any fight.
 */
export function assertCanEnter(world: World, playerId: string) {
    const { db } = world;
    const active = runsRepository.findLiveRun(db, playerId);
    if (active?.kind === "fishing") endOpenFishing(db, active);
    else if (active) throw AppError.badRequest("You're already in a Run. Finish or flee it first.");
    if (findActiveRunId(db, playerId)) throw AppError.badRequest("You're already in a dungeon");
    if (playerRepository.findHand(db, playerId, "combat").length === 0) throw AppError.badRequest("Your combat hand is empty");
}

/**
 * Opens one dungeon run for the whole party in the start's transaction: one
 * map rolled on the server, everyone at the entrance at full health. Each
 * player has passed `assertCanEnter`. `playerIds` in lobby order.
 */
export function openPartyRun(world: World, dungeon: DungeonDef, lobbyId: string, playerIds: string[]): LoadedRun {
    const { db } = world;
    const seed = randomSeed();
    const rng = createRng(seed);
    const layout = dungeon.layouts[Math.floor(rng.next() * dungeon.layouts.length)]!;
    const map = rollMap(dungeon, layout, rng.next);
    const row = db.one<DungeonRunRecord>(
        INSERT_DUNGEON_RUN,
        crypto.randomUUID(),
        dungeon.id,
        lobbyId,
        JSON.stringify(map),
        JSON.stringify(newPartyState(map, seed, rng.draws())),
        Date.now(),
    );
    if (!row) throw new Error("Dungeon run insert returned nothing");
    for (const [seat, playerId] of playerIds.entries()) {
        db.run(INSERT_MEMBER, row.id, playerId, JSON.stringify(newMemberState(map, playerRepository.playerMaxHealth(db, playerId))), seat);
    }
    const run = loadRun(db, row.id)!;
    // Saved once more so the party hears it started (the version moves on, too).
    saveRun(world, run);
    return run;
}

/** A room fight's status, and the health its player has left in it. */
function findFight(world: World, runId: string): { status: string; health: number | undefined } | undefined {
    const found = world.db.one<Pick<RunRecord, "status" | "state">>(FIND_FIGHT, runId);
    if (!found) return undefined;
    const state = JSON.parse(found.state) as BattleState;
    return { status: found.status, health: state.combatants.find((c) => c.side === "player")?.health };
}

/** Ends a member's room fight from outside it, as a flee: what it left of their health is kept. */
function endFightAsFled(world: World, run: LoadedRun, member: DungeonMemberRow, alreadyOver: boolean) {
    const fight = member.state.fight!;
    if (!alreadyOver) world.db.run(END_FIGHT, Date.now(), fight.runId);
    applyFightOver(world, run, member, fight, "fled", findFight(world, fight.runId)?.health ?? member.state.health);
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
function settle(world: World, run: LoadedRun, now = Date.now()): { changed: boolean; bossFights: Map<string, GeoRunResponse> } {
    const bossFights = new Map<string, GeoRunResponse>();
    if (run.row.status !== "active") return { changed: false, bossFights };
    let changed = false;
    for (const member of run.members) {
        const fight = member.state.fight;
        if (member.status !== "active" || !fight) continue;
        if (findFight(world, fight.runId)?.status === "active") continue;
        endFightAsFled(world, run, member, true);
        changed = true;
    }

    const map = run.row.map;
    if (run.members.filter((member) => member.status === "active").length >= 2) {
        for (const member of run.members) {
            const off = world.hub.offlineSince(member.player_id);
            const asParty = partyMembers(run).find((m) => m.playerId === member.player_id)!;
            if (off === null || now < off + RECONNECT_MS || !holdsUp(map, run.row.state, asParty)) continue;
            if (member.state.fight) endFightAsFled(world, run, member, false);
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
    if (ready.start) startBoss(world, run, now, bossFights);
    return { changed: changed || ready.changed, bossFights };
}

/**
 * Everyone still in is in the boss room: the boss starts for all of them at
 * once, in one shared fight. Nobody else can go in after. One who can't
 * fight (it won't open for them) is out. Each one's fight goes into
 * `opened`, by player. Anyone the opening already put down is out here,
 * since the fight's own hook can't see this unsaved change.
 */
function startBoss(world: World, run: LoadedRun, now: number, opened: Map<string, GeoRunResponse>) {
    const dungeon = CONTENT.dungeons[run.row.dungeon_id];
    const boss = bossRoomOf(run.row.map);
    if (!dungeon || !boss) return;
    run.row.state = { ...run.row.state, bossStartedAt: now };
    const going = run.members.filter((member) => member.status === "active");
    const { opened: fights, refused } = runsRepository.openSharedCombatRun(
        world,
        going.map((member) => ({ playerId: member.player_id, startHealth: member.state.health })),
        { enemyId: dungeon.boss, spawnId: null, enemyModifiers: dungeon.bossModifiers, keepsHealth: true, dungeonRunId: run.row.id, dungeonRoom: boss.id },
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
            applyFightOver(world, run, member, { runId: fight.run.id, room: boss.id }, outcome, you?.health ?? 0);
        }
    }
}

/** The party's run, settled to now. Refuses a player who isn't in it. */
function openRun(world: World, playerId: string, dungeonRunId: string): { run: LoadedRun; me: DungeonMemberRow; changed: boolean } {
    const run = loadRun(world.db, dungeonRunId);
    if (!run) throw AppError.notFound("Dungeon run not found");
    const me = memberOf(run, playerId);
    runsRepository.endStaleRun(world.db, playerId);
    return { run, me, changed: settle(world, run).changed };
}

/**
 * Settles a run nobody is acting on: the ready-up clock or the reconnect
 * window came due. The scheduler's `dungeon:<id>` job (src/jobs.ts).
 */
export function settleRun(world: World, dungeonRunId: string, now = Date.now()) {
    const run = loadRun(world.db, dungeonRunId);
    if (!run || run.row.status !== "active") return;
    if (settle(world, run, now).changed) saveRun(world, run);
    else bookWake(world, run);
}

function response(run: LoadedRun, playerId: string, extra: Partial<Omit<GeoDungeonRunResponse, "dungeonRun">> = {}): GeoDungeonRunResponse {
    return { dungeonRun: viewFor(run, playerId), fight: null, found: [], notes: [], ...extra };
}

/** The dungeon run the player is still in, or null; for picking it back up after a restart. */
export function findActive(world: World, playerId: string): GeoDungeonRunResponse | null {
    const id = findActiveRunId(world.db, playerId);
    if (!id) return null;
    const { run, changed } = openRun(world, playerId, id);
    if (changed) saveRun(world, run);
    // Settling may have just put them out.
    return response(run, playerId);
}

/** One of the player's dungeon runs, over or not: how it ended, after the last fight. */
export function findOne(world: World, playerId: string, dungeonRunId: string): GeoDungeonRunResponse {
    const { run, changed } = openRun(world, playerId, dungeonRunId);
    if (changed) saveRun(world, run);
    return response(run, playerId);
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
export function move(world: World, playerId: string, dungeonRunId: string, roomId: number): GeoDungeonRunResponse {
    const { db } = world;
    const { run, me } = openRun(world, playerId, dungeonRunId);
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
        playerRepository.takeItems(db, playerId, room.lock!, 1);
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
                playerRepository.grantItems(db, playerId, items);
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
    const { bossFights } = settle(world, run);

    let fight: GeoRunResponse | null = bossFights.get(playerId) ?? null;
    if (fightTarget) {
        // Told here, on this copy of the run, rather than by the fight: the
        // fight's own hook would load the run as stored, without this move.
        const target = { ...fightTarget, dungeonRunId: run.row.id, dungeonRoom: room.id, startHealth: me.state.health };
        const opened = runsRepository.openCombatRun(world, playerId, target, { tellDungeon: false });
        fight = opened;
        if (opened.run.status === "active") me.state = { ...me.state, fight: { runId: opened.run.id, room: room.id } };
        else {
            // Over as it opened.
            const you = opened.run.combatants.find((c) => c.id === opened.run.you);
            const outcome = opened.run.status === "victory" ? "victory" : opened.run.status === "fled" ? "fled" : "defeat";
            applyFightOver(world, run, me, { runId: opened.run.id, room: room.id }, outcome, you?.health ?? me.state.health);
        }
    }
    saveRun(world, run);
    return response(run, playerId, { fight, found, notes });
}

/** Answers the puzzle in the player's room: one try, right or wrong, for the whole party. */
export function answerPuzzle(world: World, playerId: string, dungeonRunId: string, answer: number): GeoDungeonRunResponse {
    const { run, me } = openRun(world, playerId, dungeonRunId);
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
    saveRun(world, run);
    const note = result === "solved" ? "Solved." : `Wrong: it was ${puzzle.options[puzzle.answer]}. The Void chest is gone.`;
    return response(run, playerId, { notes: [note] });
}

/** Leaves the dungeon: it counts as failing it, for you; the others play on. A fight going on ends there. */
export function leave(world: World, playerId: string, dungeonRunId: string): GeoDungeonRunResponse {
    const { run, me } = openRun(world, playerId, dungeonRunId);
    if (me.status !== "active") throw AppError.badRequest("That dungeon is over");
    if (me.state.fight) world.db.run(END_FIGHT, Date.now(), me.state.fight.runId);
    me.status = "failed";
    me.state = { ...me.state, fight: null, onClockSince: null, outReason: "left" };
    // One fewer to wait for: the rest may all be ready now.
    settle(world, run);
    saveRun(world, run);
    return response(run, playerId, { notes: ["You left the dungeon. No chests this time; your purse is safe."] });
}

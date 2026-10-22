import {
    GEO_DUNGEON_READY_SECONDS,
    type GeoDungeonDoor,
    type GeoDungeonOutReason,
    type GeoDungeonPartyMember,
    type GeoDungeonPuzzle,
    type GeoDungeonReadyUp,
    type GeoDungeonRoom,
    type GeoDungeonRunStatus,
    type GeoDungeonRunView,
    type GeoRoomStyle,
} from "@geo/shared";
import { dungeonScore, PASSABLE_KINDS, type DungeonMap, type DungeonScoreRules, type MapRoom } from "./dungeon-map";

/**
 * A party's walk through one rolled dungeon map. Pure: the repository
 * (`modules/dungeon-runs`) loads and saves it.
 *
 * Split in two. `PartyState` is the map's shared side: what anyone has
 * explored, the rooms cleared for everyone (fights, star and gold rooms,
 * puzzles), deaths for the score, the RNG. `MemberState` is each player's
 * own: where they are, their health, the doors they unlocked, their loot
 * and event rooms and everything in their key wings. `perspective` merges
 * the two into one player's `DungeonRunState`, which every rule below reads.
 */

export type DungeonPuzzleState = {
    prompt: string;
    options: string[];
    /** Index into `options`. Never sent to the app. */
    answer: number;
    result: "solved" | "failed" | null;
};

export type PartyState = {
    /** Rooms anyone has been in. */
    visited: number[];
    /** Shared rooms (see `isShared`) cleared or solved by anyone. */
    done: number[];
    /** By room id. Shared: a puzzle has one try for the whole party. */
    puzzles: Record<string, DungeonPuzzleState>;
    deaths: number;
    /** When the boss fight began (ms); after that nobody else goes in. Absent on runs from before the ready-up. */
    bossStartedAt?: number | null;
    /** The run's own RNG (enemy picks, loot, puzzles), resumed from `draws`. */
    seed: number;
    draws: number;
};

export type MemberState = {
    current: number;
    /** Where a fled fight sends you back to. */
    previous: number;
    /** Your own rooms done: loot, events, and anything in your key wings. */
    done: number[];
    /** Locked rooms you opened with a key. */
    unlocked: number[];
    health: number;
    maxHealth: number;
    /** The combat Run you're in, and its room. Claims the room. */
    fight: { runId: string; room: number } | null;
    chestSelectionId: string | null;
    /** The ready-up clock's been on you since (ms): you're out at this plus GEO_DUNGEON_READY_SECONDS. */
    onClockSince?: number | null;
    /** Why you're out, once you are. */
    outReason?: GeoDungeonOutReason | null;
};

/** One player's view of the run: the party's state with theirs on top. */
export type DungeonRunState = Omit<PartyState, "done"> & Omit<MemberState, "done"> & { done: number[] };

/** Someone in the party, with their own state. */
export type PartyMember = { playerId: string; name: string; status: GeoDungeonRunStatus; state: MemberState };

/**
 * Done once for everyone: fights, star and gold rooms, puzzles. Loot and
 * events are each player's own, and so is everything in a key wing (each
 * opener gets their own copy) and, until the shared boss fight, the boss.
 */
export const isShared = (room: MapRoom) => room.wingOf.length === 0 && !["loot", "event", "boss"].includes(room.kind);

export function newPartyState(map: DungeonMap, seed: number, draws: number): PartyState {
    return { visited: [map.entrance], done: [], puzzles: {}, deaths: 0, bossStartedAt: null, seed, draws };
}

export function newMemberState(map: DungeonMap, maxHealth: number): MemberState {
    return {
        current: map.entrance,
        previous: map.entrance,
        done: [],
        unlocked: [],
        health: maxHealth,
        maxHealth,
        fight: null,
        chestSelectionId: null,
        onClockSince: null,
        outReason: null,
    };
}

export function perspective(party: PartyState, member: MemberState): DungeonRunState {
    return { ...party, ...member, done: [...party.done, ...member.done] };
}

/** Marks a room done where it belongs: for the party, or for this member. */
export function markDone(map: DungeonMap, party: PartyState, member: MemberState, roomId: number): { party: PartyState; member: MemberState } {
    const room = map.rooms[roomId]!;
    if (isShared(room)) return { party: party.done.includes(roomId) ? party : { ...party, done: [...party.done, roomId] }, member };
    return { party, member: member.done.includes(roomId) ? member : { ...member, done: [...member.done, roomId] } };
}

/**
 * Someone else holds the room: fighting in it, or at its puzzle. One
 * player at a time, until the shared fight; their name, or null.
 */
export function busyWith(map: DungeonMap, puzzles: PartyState["puzzles"], others: PartyMember[], roomId: number): string | null {
    const room = map.rooms[roomId];
    if (!room) return null;
    for (const other of others) {
        if (other.status !== "active") continue;
        if (other.state.fight?.room === roomId) return other.name;
        const puzzle = puzzles[roomId];
        if (room.kind === "puzzle" && other.state.current === roomId && puzzle && puzzle.result === null) return other.name;
    }
    return null;
}

export const READY_CLOCK_MS = GEO_DUNGEON_READY_SECONDS * 1000;

export const bossRoomOf = (map: DungeonMap) => map.rooms.find((room) => room.kind === "boss");

/** Waiting in the boss room for it to start. */
export function isReady(map: DungeonMap, party: PartyState, member: PartyMember): boolean {
    return member.status === "active" && !party.bossStartedAt && !member.state.fight && member.state.current === bossRoomOf(map)?.id;
}

/** How many of `active` must be ready to start the clock on the rest: half, rounded up. */
export const readyNeeded = (active: number) => Math.ceil(active / 2);

/**
 * Moves the ready-up on to `now`. Once enough are ready, the clock starts
 * on everyone else who isn't in a room fight (theirs starts when it ends);
 * below that, it stops for everyone. A straggler whose time is up is out,
 * which can leave everyone still in ready: then `start`, and the caller
 * opens the boss for the ready ones. Pure; returns new members.
 */
export function settleReadyUp(map: DungeonMap, party: PartyState, members: PartyMember[], now: number) {
    const next = members.map((member) => ({ ...member, state: { ...member.state } }));
    const missed: string[] = [];
    let changed = false;
    const setClock = (member: PartyMember, since: number | null) => {
        if ((member.state.onClockSince ?? null) === since) return;
        member.state.onClockSince = since;
        changed = true;
    };
    if (party.bossStartedAt || !bossRoomOf(map)) return { members: next, missed, start: false, changed };

    // Someone running out of time leaves fewer still in, which can change the rest: go round until nothing does.
    for (;;) {
        const active = next.filter((member) => member.status === "active");
        if (active.length === 0) return { members: next, missed, start: false, changed };
        const ready = active.filter((member) => isReady(map, party, member));
        if (ready.length === active.length) {
            for (const member of active) setClock(member, null);
            return { members: next, missed, start: true, changed: true };
        }
        const clockOn = ready.length > 0 && ready.length >= readyNeeded(active.length);
        let someoneOut = false;
        for (const member of active) {
            if (ready.includes(member)) {
                setClock(member, null);
                continue;
            }
            setClock(member, clockOn && !member.state.fight ? (member.state.onClockSince ?? now) : null);
            const since = member.state.onClockSince ?? null;
            if (since !== null && now >= since + READY_CLOCK_MS) {
                member.status = "failed";
                member.state.onClockSince = null;
                member.state.outReason = "missedBoss";
                missed.push(member.playerId);
                someoneOut = true;
                changed = true;
            }
        }
        if (!someoneOut) return { members: next, missed, start: false, changed };
    }
}

/**
 * Something a player offline would hold up: a room fight (not the boss's,
 * which nobody waits on), a place in the ready-up, or a puzzle room no one
 * else can enter. The reconnect window lets go of these.
 */
export function holdsUp(map: DungeonMap, party: PartyState, member: PartyMember): boolean {
    if (member.status !== "active") return false;
    const fight = member.state.fight;
    if (fight) return map.rooms[fight.room]?.kind !== "boss";
    if (isReady(map, party, member)) return true;
    const puzzle = party.puzzles[member.state.current];
    return map.rooms[member.state.current]?.kind === "puzzle" && puzzle !== undefined && puzzle.result === null;
}

/** When the ready-up clock next runs out on someone (ms), or null. */
export function nextReadyDeadline(members: PartyMember[]): number | null {
    const at = members.flatMap((member) =>
        member.status === "active" && member.state.onClockSince != null ? [member.state.onClockSince + READY_CLOCK_MS] : [],
    );
    return at.length > 0 ? Math.min(...at) : null;
}

/** Inside a key wing the player hasn't opened (the locked room itself still shows). */
export const isHidden = (room: MapRoom, state: DungeonRunState) => room.wingOf.some((lock) => lock !== room.id && !state.unlocked.includes(lock));
export const isDone = (room: MapRoom, state: DungeonRunState) => state.done.includes(room.id);
export const isLocked = (room: MapRoom, state: DungeonRunState) => room.lock !== null && !state.unlocked.includes(room.id);
/** You can walk through it: it never blocks, or it's done. */
export const isPassable = (room: MapRoom, state: DungeonRunState) => PASSABLE_KINDS.includes(room.kind) || isDone(room, state);

/** Visited, seen (next to a visited room, or the boss room), or under fog (null: never sent). */
export function visibility(map: DungeonMap, state: DungeonRunState, room: MapRoom): GeoDungeonRoom["seen"] | null {
    if (isHidden(room, state)) return null;
    if (state.visited.includes(room.id)) return "visited";
    if (room.kind === "boss") return "seen";
    return map.adjacent[room.id]!.some((id) => state.visited.includes(id) && !isHidden(map.rooms[id]!, state)) ? "seen" : null;
}

export function stars(map: DungeonMap, state: DungeonRunState) {
    const all = map.rooms.filter((room) => room.kind === "star");
    return { cleared: all.filter((room) => isDone(room, state)).length, total: all.length };
}

/**
 * Why the player can't walk into `roomId` now, or null if they can (a lock
 * still needs its key). `others`: the rest of the party, who may be busy there.
 */
export function moveProblem(map: DungeonMap, state: DungeonRunState, roomId: number, others: PartyMember[] = []): string | null {
    if (state.fight) return "Finish the fight first";
    const room = map.rooms[roomId];
    if (!room || visibility(map, state, room) === null) return "You can't see a way there";
    if (room.id === state.current) return "You're already there";
    const reachable = map.adjacent[room.id]!.some((id) => {
        const from = map.rooms[id]!;
        return state.visited.includes(id) && !isHidden(from, state) && isPassable(from, state);
    });
    if (!reachable) return "Something blocks the way. Clear the room before it first.";
    const busy = busyWith(map, state.puzzles, others, room.id);
    if (busy) return `${busy} is in there. Wait until they're done.`;
    if (room.kind === "boss") {
        if (state.bossStartedAt) return "The boss fight has started. There's no joining it now.";
        const { cleared, total } = stars(map, state);
        if (cleared < total) return `The boss's door is sealed: ${cleared} of ${total} star rooms cleared`;
    }
    return null;
}

/**
 * PLACEHOLDER: the one puzzle type until puzzles are designed. A number
 * sequence with four choices, made from the run's RNG.
 */
export function makePuzzle(next: () => number): DungeonPuzzleState {
    const roll = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
    const start = roll(2, 9);
    const step = roll(2, 7);
    const terms = [0, 1, 2, 3].map((index) => start + step * index);
    const correct = start + step * 4;
    const wrong = new Set<number>();
    for (const offset of [step, -step, 1, -1, 2, step * 2]) {
        if (wrong.size === 3) break;
        const value = correct + offset;
        if (value > 0 && value !== correct) wrong.add(value);
    }
    const options = [correct, ...wrong];
    for (let i = options.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [options[i], options[j]] = [options[j]!, options[i]!];
    }
    return { prompt: `What comes next? ${terms.join(", ")}, …`, options: options.map(String), answer: options.indexOf(correct), result: null };
}

/** The party's score: shared rooms, plus loot and event rooms once anyone did them. */
export function scoreOf(map: DungeonMap, party: PartyState, members: MemberState[], rules: DungeonScoreRules) {
    return dungeonScore(
        map,
        {
            done: (room) => party.done.includes(room.id) || members.some((member) => member.done.includes(room.id)),
            puzzleResult: (room) => party.puzzles[room.id]?.result ?? null,
            deaths: party.deaths,
        },
        rules,
    );
}

/** The map as one member may see it: no fogged rooms, no puzzle answers, no one behind another's locked door. */
export function toDungeonRunView(
    run: { id: string; dungeonId: string; dungeonName: string; version: number },
    map: DungeonMap,
    party: PartyState,
    members: PartyMember[],
    viewerId: string,
    rules: DungeonScoreRules,
    styleOf: (id: string) => GeoRoomStyle | undefined,
): GeoDungeonRunView {
    const viewer = members.find((member) => member.playerId === viewerId);
    if (!viewer) throw new Error(`${viewerId} isn't in dungeon run ${run.id}`);
    const others = members.filter((member) => member !== viewer);
    const state = perspective(party, viewer.state);
    const rooms: GeoDungeonRoom[] = map.rooms.flatMap((room) => {
        const seen = visibility(map, state, room);
        if (!seen) return [];
        return [
            {
                id: room.id,
                cells: room.cells,
                kind: room.kind,
                name: room.name,
                style: room.style,
                seen,
                done: isDone(room, state),
                locked: isLocked(room, state),
                busyWith: busyWith(map, party.puzzles, others, room.id),
            },
        ];
    });
    const shown = new Set(rooms.map((room) => room.id));
    const doors: GeoDungeonDoor[] = map.doors.flatMap((door) => {
        const [a, b] = door.rooms;
        if (!shown.has(a) || !shown.has(b)) return [];
        const into = (lock: MapRoom, other: MapRoom) => isLocked(lock, state) && !other.wingOf.includes(lock.id);
        const roomA = map.rooms[a]!;
        const roomB = map.rooms[b]!;
        return [{ a: door.a, b: door.b, rooms: door.rooms, locked: into(roomA, roomB) || into(roomB, roomA) }];
    });
    const styles: Record<string, GeoRoomStyle> = {};
    for (const room of rooms) {
        const style = room.style ? styleOf(room.style) : undefined;
        if (room.style && style) styles[room.style] = style;
    }
    const deadlineOf = (member: PartyMember) =>
        member.status === "active" && member.state.onClockSince != null ? new Date(member.state.onClockSince + READY_CLOCK_MS).toISOString() : null;
    const partyView: GeoDungeonPartyMember[] = members.map((member) => ({
        displayName: member.name,
        isYou: member === viewer,
        status: member.status,
        outReason: member.state.outReason ?? null,
        isReady: isReady(map, party, member),
        readyDeadline: deadlineOf(member),
        roomId: member.status === "active" && shown.has(member.state.current) ? member.state.current : null,
        isFighting: member.status === "active" && member.state.fight !== null,
        health: member.state.health,
        maxHealth: member.state.maxHealth,
    }));
    const pending = state.puzzles[state.current];
    const puzzle: GeoDungeonPuzzle | null =
        pending && pending.result === null ? { roomId: state.current, prompt: pending.prompt, options: pending.options } : null;
    const { score, chests } = scoreOf(map, party, members.map((member) => member.state), rules);
    const active = members.filter((member) => member.status === "active");
    const readyCount = active.filter((member) => isReady(map, party, member)).length;
    const youAreReady = isReady(map, party, viewer);
    const readyUp: GeoDungeonReadyUp | null =
        viewer.status === "active" && !party.bossStartedAt && (readyCount > 0 || youAreReady)
            ? {
                  ready: readyCount,
                  total: active.length,
                  needed: readyNeeded(active.length),
                  clockRunning: readyCount >= readyNeeded(active.length) && readyCount < active.length,
                  youAreReady,
                  yourDeadline: deadlineOf(viewer),
              }
            : null;
    return {
        id: run.id,
        dungeonId: run.dungeonId,
        dungeonName: run.dungeonName,
        status: viewer.status,
        outReason: viewer.state.outReason ?? null,
        version: run.version,
        party: partyView,
        cols: map.cols,
        rows: map.rows,
        rooms,
        doors,
        styles,
        currentRoom: state.current,
        health: state.health,
        maxHealth: state.maxHealth,
        stars: stars(map, state),
        fightRunId: state.fight?.runId ?? null,
        readyUp,
        bossStarted: Boolean(party.bossStartedAt),
        serverTime: new Date().toISOString(),
        puzzle,
        score,
        chestTiers: chests,
        chestSelectionId: state.chestSelectionId,
    };
}

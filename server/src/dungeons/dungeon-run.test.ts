import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildMap, parseLayoutMap, type DungeonMapRules } from "./dungeon-map";
import {
    isPassable,
    makePuzzle,
    markDone,
    moveProblem,
    newMemberState,
    newPartyState,
    perspective,
    READY_CLOCK_MS,
    scoreOf,
    settleReadyUp,
    toDungeonRunView,
    visibility,
    type DungeonRunState,
    type MemberState,
    type PartyMember,
    type PartyState,
} from "./dungeon-run";

const rules: DungeonMapRules = {
    id: "test",
    stars: 1,
    minibosses: 0,
    roomStyle: null,
    rooms: { gate: { kind: "encounter", name: "Gate", style: null, lock: "test-key" } },
    pool: [],
};
const scoring = { chestScores: { gold: 40, ruby: 70, void: 90 }, penalties: { failedPuzzle: 20, death: 15 } };

//   B-a-p
//     |
//   s-E-k-w      k is locked; w is its wing.
const { map } = buildMap(
    rules,
    {
        id: "t",
        dungeon: "test",
        map: parseLayoutMap(`
            B-a-p
              |
            s-E-k-w
        `),
        legend: { B: "boss", a: "encounter", p: "puzzle", s: "star", E: "entrance", k: "gate", w: "loot" },
        place: [],
        roomStyle: null,
        mirror: false,
    },
    { pick: () => 0 },
);
const id = (key: string) => map.rooms.find((room) => room.key === key)!.id;
const fresh = (): DungeonRunState => perspective(newPartyState(map, 1, 0), newMemberState(map, 100));
const run = { id: "r", dungeonId: "test", dungeonName: "Test", version: 1 };
const member = (playerId: string, state: MemberState, status: PartyMember["status"] = "active"): PartyMember => ({ playerId, name: playerId, status, state });
/** A solo run's view: everything in `state` counted as the party's. */
const view = (state: DungeonRunState) => {
    const { visited, done, puzzles, deaths, seed, draws, ...own } = state;
    return toDungeonRunView(run, map, { visited, done, puzzles, deaths, seed, draws }, [member("me", { ...own, done: [] })], "me", scoring, () => undefined);
};

describe("dungeon runs", () => {
    it("starts at the entrance seeing its neighbours and the boss, nothing else", () => {
        const shown = view(fresh()).rooms.map((room) => [map.rooms[room.id]!.key, room.seen]);
        assert.deepEqual(new Map(shown as [string, string][]), new Map([["B", "seen"], ["a", "seen"], ["s", "seen"], ["E", "visited"], ["k", "seen"]]));
        // The wing behind the lock is never sent before it's opened.
        assert.equal(visibility(map, fresh(), map.rooms[id("w")]!), null);
    });

    it("refuses moves the rules don't allow", () => {
        const state = fresh();
        assert.equal(moveProblem(map, state, id("p")), "You can't see a way there");
        assert.match(moveProblem(map, state, id("B"))!, /blocks the way/);
        const pastTheFight = { ...state, visited: [id("E"), id("a")], done: [id("a")] };
        assert.match(moveProblem(map, pastTheFight, id("B"))!, /sealed: 0 of 1/);
        assert.equal(moveProblem(map, { ...pastTheFight, done: [id("a"), id("s")] }, id("B")), null);
        assert.equal(moveProblem(map, state, id("E")), "You're already there");
        assert.equal(moveProblem(map, state, id("s")), null);
        assert.equal(moveProblem(map, { ...state, fight: { runId: "x", room: id("s") } }, id("k")), "Finish the fight first");
    });

    it("an unfinished fight or puzzle blocks the rooms past it; loot doesn't", () => {
        // In the fight room without having cleared it: the puzzle beyond is out of reach.
        const state: DungeonRunState = { ...fresh(), current: id("a"), visited: [id("E"), id("a")] };
        assert.match(moveProblem(map, state, id("p"))!, /blocks the way/);
        assert.equal(moveProblem(map, { ...state, done: [id("a")] }, id("p")), null);
        assert.ok(isPassable(map.rooms[id("w")]!, state));
    });

    it("never sends a puzzle's answer", () => {
        const puzzle = makePuzzle(() => 0.3);
        assert.equal(puzzle.options.length, 4);
        assert.equal(new Set(puzzle.options).size, 4);
        const state: DungeonRunState = { ...fresh(), current: id("p"), visited: [id("E"), id("p")], puzzles: { [id("p")]: puzzle } };
        const shown = view(state);
        assert.deepEqual(shown.puzzle, { roomId: id("p"), prompt: puzzle.prompt, options: puzzle.options });
        assert.ok(!JSON.stringify(shown).includes('"answer"'));
    });

    it("marks the door into a locked room until it's opened", () => {
        const locked = view(fresh()).doors.find((door) => door.rooms.includes(id("k")))!;
        assert.equal(locked.locked, true);
        const opened = view({ ...fresh(), unlocked: [id("k")] }).doors.find((door) => door.rooms.includes(id("k")))!;
        assert.equal(opened.locked, false);
    });

    describe("in a party", () => {
        const party = (over: Partial<PartyState> = {}): PartyState => ({ ...newPartyState(map, 1, 0), ...over });
        const at = (roomId: number, over: Partial<MemberState> = {}): MemberState => ({ ...newMemberState(map, 100), current: roomId, ...over });
        const viewFor = (viewer: string, shared: PartyState, members: PartyMember[]) => toDungeonRunView(run, map, shared, members, viewer, scoring, () => undefined);

        it("shares what anyone explored and cleared; loot is each player's own but counts once for the score", () => {
            let shared = party({ visited: [id("E"), id("a")] });
            let ann = at(id("a"));
            ({ party: shared, member: ann } = markDone(map, shared, ann, id("a")));
            assert.deepEqual(shared.done, [id("a")]);
            const bob = at(id("E"));
            const seenByBob = viewFor("bob", shared, [member("ann", ann), member("bob", bob)]);
            assert.ok(seenByBob.rooms.some((room) => room.id === id("p")), "Bob sees past the room Ann cleared");
            assert.equal(seenByBob.rooms.find((room) => room.id === id("a"))!.done, true);
            assert.equal(moveProblem(map, perspective(shared, bob), id("p")), null, "and can walk there");

            // Ann's loot room: done for her, not for Bob; the score counts it once.
            const opened = markDone(map, shared, { ...ann, unlocked: [id("k")] }, id("w"));
            assert.deepEqual(opened.party.done, [id("a")]);
            assert.deepEqual(opened.member.done, [id("w")]);
            // Wing rooms never count; an optional room done by any one member does.
            assert.equal(scoreOf(map, shared, [opened.member, bob], scoring).score, scoreOf(map, shared, [ann, bob], scoring).score);
            const noOne = scoreOf(map, party(), [bob], scoring).earned;
            assert.equal(scoreOf(map, party(), [{ ...bob, done: [id("a")] }, at(id("E"))], scoring).earned, noOne + 1);
        });

        it("keeps a key wing to whoever opened it, them included in the party list", () => {
            const shared = party({ visited: [id("E"), id("k"), id("w")] });
            const ann = at(id("w"), { unlocked: [id("k")] });
            const bob = at(id("E"));
            const members = [member("ann", ann), member("bob", bob)];
            const bobs = viewFor("bob", shared, members);
            assert.ok(!bobs.rooms.some((room) => room.id === id("w")));
            assert.equal(bobs.party.find((m) => m.displayName === "ann")!.roomId, null);
            assert.ok(bobs.rooms.find((room) => room.id === id("k"))!.locked, "the door is still locked for Bob");
            const anns = viewFor("ann", shared, members);
            assert.equal(anns.party.find((m) => m.isYou)!.roomId, id("w"));
        });

        it("lets one player at a time into a fight or a puzzle", () => {
            const fighting = member("ann", at(id("s"), { fight: { runId: "x", room: id("s") } }));
            const bob = perspective(party(), at(id("E")));
            assert.equal(moveProblem(map, bob, id("s"), [fighting]), "ann is in there. Wait until they're done.");
            assert.equal(moveProblem(map, bob, id("s"), [{ ...fighting, status: "failed" }]), null, "not once they're out");
            assert.equal(viewFor("bob", party(), [fighting, member("bob", at(id("E")))]).rooms.find((room) => room.id === id("s"))!.busyWith, "ann");

            const puzzle = makePuzzle(() => 0.3);
            const shared = party({ visited: [id("E"), id("a"), id("p")], done: [id("a")], puzzles: { [id("p")]: puzzle } });
            const solving = member("ann", at(id("p")));
            assert.match(moveProblem(map, perspective(shared, at(id("a"))), id("p"), [solving])!, /ann is in there/);
            const solved = { ...shared, puzzles: { [id("p")]: { ...puzzle, result: "solved" as const } } };
            assert.equal(moveProblem(map, perspective(solved, at(id("a"))), id("p"), [solving]), null);
        });
    });

    describe("the boss's ready-up", () => {
        const now = 1_000_000;
        const party = (over: Partial<PartyState> = {}): PartyState => ({ ...newPartyState(map, 1, 0), ...over });
        const at = (roomId: number, over: Partial<MemberState> = {}): MemberState => ({ ...newMemberState(map, 100), current: roomId, ...over });
        const boss = id("B");
        const byId = (members: PartyMember[], playerId: string) => members.find((m) => m.playerId === playerId)!;

        it("starts the clock once half are ready, on everyone not in a fight", () => {
            const members = [member("ann", at(boss)), member("bob", at(id("E"))), member("cat", at(id("s"), { fight: { runId: "x", room: id("s") } })), member("dan", at(id("E")))];
            const one = settleReadyUp(map, party(), members, now);
            assert.equal(byId(one.members, "bob").state.onClockSince, null, "1 of 4 isn't enough");

            members[1] = member("bob", at(boss));
            const two = settleReadyUp(map, party(), members, now);
            assert.equal(byId(two.members, "dan").state.onClockSince, now);
            assert.equal(byId(two.members, "cat").state.onClockSince, null, "off the clock while fighting");
            assert.equal(two.start, false);
        });

        it("puts out whoever's time runs out, then starts when everyone left is ready", () => {
            const members = [member("ann", at(boss)), member("bob", at(id("E"), { onClockSince: now - READY_CLOCK_MS }))];
            const settled = settleReadyUp(map, party(), members, now);
            assert.deepEqual(settled.missed, ["bob"]);
            assert.equal(byId(settled.members, "bob").status, "failed");
            assert.equal(byId(settled.members, "bob").state.outReason, "missedBoss");
            assert.equal(settled.start, true);
            assert.equal(settleReadyUp(map, party(), members, now - 1).start, false, "not a moment early");
        });

        it("stops the clock when a ready player walks out", () => {
            const members = [member("ann", at(id("a"))), member("bob", at(id("E"), { onClockSince: now - 5000 }))];
            const settled = settleReadyUp(map, party(), members, now);
            assert.equal(byId(settled.members, "bob").state.onClockSince, null);
            assert.equal(settled.changed, true);
        });

        it("starts at once when everyone's in, solo included, and never again after", () => {
            assert.equal(settleReadyUp(map, party(), [member("ann", at(boss))], now).start, true);
            assert.equal(settleReadyUp(map, party(), [member("ann", at(boss)), member("bob", at(boss))], now).start, true);
            assert.equal(settleReadyUp(map, party({ bossStartedAt: now }), [member("ann", at(boss))], now).start, false);
            const started = perspective(party({ bossStartedAt: now, visited: [id("E"), id("a")], done: [id("a"), id("s")] }), at(id("a")));
            assert.match(moveProblem(map, started, boss)!, /has started/);
        });

        it("shows the clock to whoever it's on", () => {
            const members = [member("ann", at(boss)), member("bob", at(id("E"), { onClockSince: now }))];
            const bobs = toDungeonRunView(run, map, party(), members, "bob", scoring, () => undefined);
            assert.deepEqual(bobs.readyUp, {
                ready: 1,
                total: 2,
                needed: 1,
                clockRunning: true,
                youAreReady: false,
                yourDeadline: new Date(now + READY_CLOCK_MS).toISOString(),
            });
            assert.deepEqual(bobs.party.map((m) => m.isReady), [true, false]);
        });
    });
});

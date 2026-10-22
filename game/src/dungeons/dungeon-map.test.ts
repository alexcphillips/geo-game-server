import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CONTENT } from "../content";
import { createRng } from "../engine/rng";
import { buildMap, dungeonScore, layoutProblems, parseLayoutMap, rollMap, type DungeonLayoutDef, type DungeonMapRules, type DungeonRoomRef } from "./dungeon-map";

const rules = (overrides: Partial<DungeonMapRules> = {}): DungeonMapRules => ({
    id: "test",
    stars: 1,
    minibosses: 0,
    roomStyle: "base",
    rooms: { gate: { kind: "encounter", name: "Gate", style: null, lock: "test-key" } },
    pool: [{ room: "encounter", weight: 1, max: null }],
    ...overrides,
});

const layout = (map: string, legend: Record<string, DungeonRoomRef>, place: DungeonLayoutDef["place"] = []): DungeonLayoutDef => ({
    id: "test-layout",
    dungeon: "test",
    map: parseLayoutMap(map),
    legend,
    place,
    roomStyle: null,
    mirror: true,
});

const first = () => 0;

describe("dungeon maps", () => {
    it("parses rooms, big rooms, slots and doors", () => {
        const parsed = parseLayoutMap(`
            1-a-a
              |
            s-E
        `);
        assert.deepEqual(parsed.problems, []);
        assert.equal(parsed.cols, 3);
        assert.equal(parsed.rows, 2);
        assert.deepEqual(parsed.grid, [["1", "a", "a"], ["s", "E", null]]);
        assert.equal(parsed.doors.length, 4);

        const { map, problems } = buildMap(rules(), layout(`
            1-a-a
              |
            s-E
        `, { a: "encounter", s: "star", E: "entrance" }, [{ room: "boss", at: ["1"], chance: 1 }]), { pick: first });
        assert.deepEqual(problems, []);
        assert.equal(map.rooms.length, 4);
        assert.deepEqual(map.rooms.find((room) => room.key === "a")!.cells.length, 2);
        assert.equal(map.rooms.find((room) => room.slot === "1")!.kind, "boss");
        assert.equal(map.rooms.find((room) => room.key === "a")!.style, "base");
    });

    it("names misplaced characters by line and column", () => {
        const parsed = parseLayoutMap("a b\n|\n a");
        assert.ok(parsed.problems.some((problem) => problem.includes("line 3, column 2")), parsed.problems.join("\n"));
    });

    it("marks everything behind a locked room as its wing", () => {
        const { map, problems } = buildMap(rules(), layout(`
            B-c-k-w
              |   |
            s-E   x
        `, { B: "boss", c: "encounter", s: "star", E: "entrance", k: "gate", w: "encounter", x: "loot" }), { pick: first });
        assert.deepEqual(problems, []);
        const gate = map.rooms.find((room) => room.key === "k")!;
        const wing = map.rooms.filter((room) => room.wingOf.includes(gate.id)).map((room) => room.key).sort();
        assert.deepEqual(wing, ["k", "w", "x"]);
    });

    it("rolls the same map from the same seed, and sometimes mirrors it", () => {
        const def = CONTENT.dungeons["slime-pits"]!;
        const roll = (seed: number) => rollMap(def, def.layouts[0]!, createRng(seed).next);
        assert.deepEqual(roll(42), roll(42));
        const mirrored = Array.from({ length: 40 }, (_, seed) => roll(seed).mirrored);
        assert.ok(mirrored.includes(true) && mirrored.includes(false));
        for (let seed = 0; seed < 40; seed++) {
            const map = roll(seed);
            assert.equal(map.rooms.filter((room) => room.kind === "boss").length, 1);
            assert.ok(map.rooms.every((room) => room.source !== "unfilled"));
            // The entrance never leaves the bottom line, mirrored or not.
            assert.ok(map.rooms[map.entrance]!.cells.some(([, y]) => y === map.rows - 1));
        }
    });

    it("finds problems in any placement, not just the first", () => {
        const bad = layout(`
            1-a-2
              |
            s-E
        `, { a: "encounter", s: "star", E: "entrance" }, [
            { room: "boss", at: ["1", "2"], chance: 1 },
        ]);
        assert.deepEqual(layoutProblems(rules(), bad), []);
        // Slot 2 becomes 2×1: the boss can land there.
        const big = layout(`
            1-a-2-2
              |
            s-E
        `, { a: "encounter", s: "star", E: "entrance" }, [{ room: "boss", at: ["1", "2"], chance: 1 }]);
        assert.ok(layoutProblems(rules(), big).some((problem) => problem.includes("must be 1×1")));
    });

    it("rejects broken layouts", () => {
        const problems = layoutProblems(
            rules({ stars: 2, pool: [{ room: "star", weight: 1, max: null }] }),
            layout(`
                B-k-s   q
                  |
                E-c
                  |
                  z
            `, { B: "boss", k: "gate", s: "star", c: "encounter", E: "entrance", q: "loot" }),
        );
        const has = (text: string) => assert.ok(problems.some((problem) => problem.includes(text)), `${text}\n  ${problems.join("\n  ")}`);
        has("pool has a star room");
        has('"z" is on the map but not in rooms');
        has("has 1 star room(s)");
        has('star "s" is inside the wing');
        has('loot "q" can\'t be reached');
        has("entrance must be on the bottom line");
    });

    it("scores from the rolled map: 1 per optional room, 2 per puzzle, 3 per gold room, minus penalties", () => {
        const { map } = buildMap(rules({ minibosses: 1 }), layout(`
            B-a-p-g-k-w
                  |
              s-E-l
        `, { B: "boss", a: "encounter", p: "puzzle", g: "miniboss", k: "gate", w: "loot", s: "star", E: "entrance", l: "loot" }), { pick: first });
        const byKey = (key: string) => map.rooms.find((room) => room.key === key)!;
        const scoring = { chestScores: { gold: 40, ruby: 70, void: 90 }, penalties: { failedPuzzle: 20, death: 15 } };
        // Best: a + l (1 each), p (2), g (3) = 7. The wing's loot (w) never counts.
        const all = dungeonScore(map, { done: () => true, puzzleResult: () => "solved", deaths: 0 }, scoring);
        assert.deepEqual([all.best, all.score, all.chests], [7, 100, ["plain", "gold", "ruby", "void"]]);
        const failed = dungeonScore(map, { done: (room) => room !== byKey("a"), puzzleResult: () => "failed", deaths: 1 }, scoring);
        // 4 of 7 = 57, -20 failed puzzle, -15 death = 22.
        assert.deepEqual([failed.score, failed.chests], [22, ["plain"]]);
    });

    it("the real layouts are all valid", () => {
        for (const dungeon of Object.values(CONTENT.dungeons)) {
            for (const each of dungeon.layouts) assert.deepEqual(layoutProblems(dungeon, each), [], each.id);
        }
    });
});

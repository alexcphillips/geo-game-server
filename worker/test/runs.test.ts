import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
    GEO_API_PATHS,
    GEO_RUN_TURN_SECONDS,
    type GeoChestsResponse,
    type GeoDeathResponse,
    type GeoFishingAction,
    type GeoFishingRunView,
    type GeoMeResponse,
    type GeoOpenChestResponse,
    type GeoRunResponse,
    type GeoRunView,
} from "@geo/shared";
import { runDueJobs } from "../src/jobs";
import { createSelection } from "../src/modules/chests/chests.repository";
import { dueAt, schedule } from "../src/modules/jobs/jobs.repository";
import { addCoins } from "../src/modules/player/player.repository";
import { battleKey, openSharedCombatRun } from "../src/modules/runs/runs.repository";
import type { World } from "../src/world";
import { amountOf, call, inWorld, newPlayer, path, rowsWrittenBy, world } from "./helpers";

/** Fights, fishing, chests and the World's clock, end to end in workerd: ported from server/src/dev/geo-smoke.ts and its fishing and chests smokes. */

const runs = GEO_API_PATHS.runs;
const startFight = (token: string) => call<GeoRunResponse>("POST", runs.start, token, { kind: "combat", enemyId: "spider" });
const playCard = (token: string, run: GeoRunView) => {
    const card = run.hand.find((c) => c.playable && c.chargesLeft > 0) ?? run.hand.find((c) => c.chargesLeft > 0);
    if (!card) throw new Error("No card left to play");
    return call<GeoRunResponse>("POST", path(runs.turns, { runId: run.id }), token, { inventoryId: card.inventoryId });
};

/** Plays the fight to its end, a card a turn. */
async function fightOut(token: string, run: GeoRunView): Promise<GeoRunView> {
    for (let turns = 0; run.status === "active" && turns < 40; turns++) {
        const turn = await playCard(token, run);
        expect(turn.status, JSON.stringify(turn.body)).toBe(200);
        run = turn.body.run;
    }
    return run;
}

describe("combat Runs", () => {
    it("plays a fight to a win: loot, coins and XP saved, charges spent, a turn within its write budget", async () => {
        // A new player beats a spider nearly always; a few tries make it certain.
        for (let attempt = 0; attempt < 5; attempt++) {
            const { token, me } = await newPlayer("fighter");
            const started = await startFight(token);
            expect(started.status).toBe(201);
            expect(started.body.run.status).toBe("active");

            // A turn writes the Run, the card's charges, and the player's health when it changed.
            let run = started.body.run;
            const written = await rowsWrittenBy(async () => (run = (await playCard(token, run)).body.run));
            if (run.status === "active") expect(written).toBeLessThanOrEqual(3);

            run = await fightOut(token, run);
            if (run.status !== "victory") continue;
            expect(run.rewards?.xp[0]).toEqual({ skill: "combat", amount: 40 });
            const after = await me();
            expect(after.skillXp.combat).toBe(40);
            expect(after.player.coins).toBe(run.rewards!.coins);
            for (const drop of run.rewards!.items) expect(amountOf(after, drop.itemId)).toBeGreaterThanOrEqual(drop.quantity);
            for (const card of run.hand) expect(after.inventory.find((row) => row.id === card.inventoryId)?.chargesLeft).toBe(card.chargesLeft);
            expect((await call("GET", runs.active, token)).body).toBeNull();
            return;
        }
        throw new Error("No win in five fights");
    });

    it("allows one Run at a time, and no eating between fights during one", async () => {
        const { token } = await newPlayer("busy");
        const started = await startFight(token);
        expect(started.status).toBe(201);
        expect((await startFight(token)).status).toBe(400);
        const eat = await call<{ error: string }>("POST", path(GEO_API_PATHS.me.eatLunchbox, { slot: 0 }), token);
        expect(eat.status).toBe(400);
        expect(eat.body.error).toMatch(/turn in the fight/);
        const active = await call<GeoRunResponse>("GET", runs.active, token);
        expect(active.body.run.id).toBe(started.body.run.id);
    });

    it("flees: the Run ends and its damage stays", async () => {
        const { token, me } = await newPlayer("flee");
        const run = (await startFight(token)).body.run;
        const fled = await call<GeoRunResponse>("POST", path(runs.flee, { runId: run.id }), token);
        expect(fled.body.run.status).toBe("fled");
        expect((await call("POST", path(runs.flee, { runId: run.id }), token)).status).toBe(400);
        expect((await call("POST", path(runs.flee, { runId: crypto.randomUUID() }), token)).status).toBe(404);
        expect((await me()).health.current).toBe(fled.body.run.combatants.find((c) => c.id === fled.body.run.you)!.health);
    });

    it("ends a Run left too long, so it no longer holds the hand", async () => {
        const { token, id } = await newPlayer("stale");
        const run = (await startFight(token)).body.run;
        await inWorld((db) => db.run(`UPDATE runs SET updated_at = 0 WHERE id = ?;`, run.id));
        expect((await call("GET", runs.active, token)).body).toBeNull();
        expect(await inWorld((db) => db.one<{ status: string }>(`SELECT status FROM runs WHERE id = ?;`, run.id)?.status)).toBe("fled");
        expect((await playCard(token, run)).status).toBe(400);
        // The hand is free again.
        const hand = await inWorld((db) => db.one<{ inventory_ids: string }>(`SELECT inventory_ids FROM hands WHERE player_id = ? AND skill = 'combat';`, id));
        expect((await call("PUT", path(GEO_API_PATHS.me.hand, { skill: "combat" }), token, { inventoryIds: JSON.parse(hand!.inventory_ids) })).status).toBe(200);
    });

    it("eats from the lunchbox between fights", async () => {
        const { token, id, me } = await newPlayer("hungry");
        await inWorld((db) => db.run(`UPDATE players SET health = 10 WHERE id = ?;`, id));
        const ate = await call<GeoMeResponse>("POST", path(GEO_API_PATHS.me.eatLunchbox, { slot: 0 }), token);
        expect(ate.status).toBe(200);
        expect(ate.body.health.current).toBeGreaterThan(10);
        expect(ate.body.lunchbox.contents[0]).toMatchObject({ itemId: "bread", quantity: 4 });
        expect((await call("POST", path(GEO_API_PATHS.me.eatLunchbox, { slot: 3 }), token)).status).toBe(400);
        expect((await me()).health).toEqual(ate.body.health);
    });

    it("dev kill: every carried coin goes, and the fight ends as a defeat", async () => {
        const { token, id, me } = await newPlayer("doomed");
        await inWorld((db) => addCoins(db, id, 30, "admin-grant", "test"));
        const run = (await startFight(token)).body.run;
        const died = await call<GeoDeathResponse>("POST", GEO_API_PATHS.dev.kill, token);
        expect(died.body).toEqual({ cause: "admin-kill", coinsLost: 30 });
        expect((await me()).player.coins).toBe(0);
        expect(await inWorld((db) => db.one<{ status: string }>(`SELECT status FROM runs WHERE id = ?;`, run.id)?.status)).toBe("defeat");
    });
});

describe("shared fights and the clock", () => {
    it("books a shared fight's turn clock, and skips the turn when it runs out", async () => {
        const a = await newPlayer("party");
        const b = await newPlayer("party");
        const opened = await inWorld((_db, instance) =>
            openSharedCombatRun(
                instance.state,
                [
                    { playerId: a.id, startHealth: 100 },
                    { playerId: b.id, startHealth: 100 },
                ],
                { enemyId: "spider", spawnId: null, keepsHealth: true },
            ),
        );
        expect(opened.refused).toEqual([]);
        const run = opened.opened.get(a.id)!.run;
        const battleId = await inWorld((db) => db.one<{ battle_id: string }>(`SELECT battle_id FROM runs WHERE id = ?;`, run.id)!.battle_id);
        const deadline = await inWorld((db) => dueAt(db, battleKey(battleId)));
        expect(deadline).toBe(Date.parse(run.turnDeadline!));
        expect(deadline! - Date.now()).toBeGreaterThan((GEO_RUN_TURN_SECONDS - 5) * 1000);

        const before = await call<GeoRunResponse>("GET", runs.active, a.token);
        await inWorld((_db, instance) => runDueJobs(instance.state, deadline! + 1));
        const after = await call<GeoRunResponse>("GET", runs.active, a.token);
        expect(after.body.run.version).toBeGreaterThan(before.body.run.version);
        expect(after.body.run.currentActor).not.toBe(before.body.run.currentActor);
        // The next turn's clock is booked.
        expect(await inWorld((db) => dueAt(db, battleKey(battleId)))).toBeGreaterThan(deadline!);
    });

    it("sets the alarm at the soonest due row and runs what's due when it goes off", async () => {
        await newPlayer("clock");
        await inWorld((db) => {
            db.run(`INSERT INTO refresh_tokens (token_hash, player_id, created_at, expires_at) SELECT 'old-token', id, 0, 0 FROM players LIMIT 1;`);
            schedule(db, "cleanup", Date.now());
        });
        // Any request re-arms the alarm. It's already due, so Miniflare may
        // run it on its own first; either way the job's work shows up.
        await call("GET", runs.active);
        await runDurableObjectAlarm(world());
        const tokenGone = async () => !(await inWorld((db) => db.one(`SELECT 1 FROM refresh_tokens WHERE token_hash = 'old-token';`)));
        for (let tries = 0; tries < 50 && !(await tokenGone()); tries++) await new Promise((resolve) => setTimeout(resolve, 20));
        expect(await tokenGone()).toBe(true);
        const next = await inWorld((db) => dueAt(db, "cleanup"));
        expect(next! - Date.now()).toBeGreaterThan(23 * 3_600_000);
        const armed = await runInDurableObject(world(), (_instance: World, state) => state.storage.getAlarm());
        expect(armed).toBe(await inWorld((db) => db.one<{ at: number }>(`SELECT min(at) AS at FROM due;`)!.at));
    });

    it("nests transactions as savepoints, and runs after-commit work only on commit", async () => {
        const ran: string[] = [];
        await inWorld((db) => {
            schedule(db, "test:outer", 5);
            try {
                db.transaction(() => {
                    schedule(db, "test:inner", 5);
                    db.afterCommit(() => ran.push("inner"));
                    throw new Error("undo the inner one");
                });
            } catch {
                // The outer one carries on.
            }
            db.afterCommit(() => ran.push("outer"));
            expect(ran).toEqual([]);
        });
        expect(await inWorld((db) => [dueAt(db, "test:outer"), dueAt(db, "test:inner")])).toEqual([5, null]);
        // The inner one's work was queued before it threw; it runs with the outer commit.
        expect(ran).toContain("outer");
        await inWorld((db) => {
            schedule(db, "test:outer", null);
            schedule(db, "test:inner", null);
        });
    });
});

describe("chests", () => {
    it("lists a pending selection without its contents, and opens one chest of it", async () => {
        const { token, id, me } = await newPlayer("chests");
        await inWorld((_db, instance) =>
            createSelection(instance.state, id, { kind: "combat", name: "Test Spider" }, null, [
                { tier: "gold", name: "Gold Chest", cost: 0, items: [{ itemId: "bread", quantity: 3 }] },
                { tier: "ruby", name: "Ruby Chest", cost: 500, items: [{ itemId: "bread", quantity: 9 }] },
            ]),
        );
        const listed = await call<GeoChestsResponse>("GET", GEO_API_PATHS.chests.root, token);
        const selection = listed.body.pending[0]!;
        expect(selection.chests).toEqual([
            { tier: "gold", name: "Gold Chest", cost: 0 },
            { tier: "ruby", name: "Ruby Chest", cost: 500 },
        ]);
        const open = (index: number) => call<GeoOpenChestResponse>("POST", path(GEO_API_PATHS.chests.open, { selectionId: selection.id }), token, { index });
        expect((await open(1)).status).toBe(400);
        expect((await open(5)).status).toBe(400);
        const breadBefore = amountOf(await me(), "bread");
        const opened = await open(0);
        expect(opened.body.selection.opened?.items).toEqual([{ itemId: "bread", quantity: 3 }]);
        expect(amountOf(await me(), "bread")).toBe(breadBefore + 3);
        expect((await open(0)).status).toBe(400);
        const after = await call<GeoChestsResponse>("GET", GEO_API_PATHS.chests.root, token);
        expect(after.body.pending).toEqual([]);
        expect(after.body.history[0]?.id).toBe(selection.id);
    });
});

describe("fishing", () => {
    it("casts, fights a fish with the starter hand, and lands it: bait, charges, fish and XP saved", async () => {
        const { token, me } = await newPlayer("angler");
        expect((await call("POST", GEO_API_PATHS.fishing.start, token, { tier: "ocean-ish" })).status).toBe(400);
        let run = (await call<GeoFishingRunView>("POST", GEO_API_PATHS.fishing.start, token, { tier: "pond" })).body;
        expect(run.phase).toBe("ready");
        // Auto-swap put the rod on.
        expect(run.rod.name).toBeTruthy();
        const resumed = await call<GeoFishingRunView>("POST", GEO_API_PATHS.fishing.start, token, { tier: "pond" });
        expect(resumed.body.id).toBe(run.id);
        expect((await call("PUT", path(GEO_API_PATHS.me.hand, { skill: "fishing" }), token, { inventoryIds: [] })).status).toBe(400);

        const act = async (action: GeoFishingAction) => {
            const response = await call<GeoFishingRunView>("POST", path(GEO_API_PATHS.fishing.actions, { runId: run.id }), token, action);
            expect(response.status, JSON.stringify(response.body)).toBe(200);
            run = response.body;
        };
        let landed: Extract<GeoFishingRunView["outcome"], { kind: "landed" }> | null = null;
        let casts = 0;
        for (; !landed; casts++) {
            expect(casts).toBeLessThan(20);
            await act({ type: "cast" });
            while (run.phase !== "over") {
                if (run.phase === "waiting") await act({ type: "strike" });
                else if (run.phase === "creature") await act({ type: "cutLine" });
                else {
                    const f = run.fight!;
                    const pick = f.distance <= 2 ? "fish.gaff" : f.tension > f.zoneHigh ? "fish.slack" : "fish.reel";
                    await act({ type: "play", inventoryId: run.hand.find((c) => c.cardId === pick)!.inventoryId });
                }
            }
            if (run.outcome?.kind === "landed") landed = run.outcome;
        }
        const after = await me();
        expect(amountOf(after, landed.itemId)).toBeGreaterThanOrEqual(1);
        expect(after.skillXp.fishing).toBeGreaterThanOrEqual(landed.xp);
        // A cast takes one worm, unless a perk saves it.
        const worms = after.bait.contents.reduce((sum, slot) => sum + slot.quantity, 0);
        expect(worms).toBeGreaterThanOrEqual(20 - casts);
        expect(worms).toBeLessThanOrEqual(20);
        for (const card of run.hand) expect(after.inventory.find((row) => row.id === card.inventoryId)?.chargesLeft).toBe(card.chargesLeft);

        // Walking off to a fight leaves the spot.
        expect((await startFight(token)).status).toBe(201);
        expect((await call("POST", path(GEO_API_PATHS.fishing.actions, { runId: run.id }), token, { type: "cast" })).status).toBe(400);
    });

    it("leaves the spot", async () => {
        const { token } = await newPlayer("leaver");
        const run = (await call<GeoFishingRunView>("POST", GEO_API_PATHS.fishing.start, token, { tier: "pond" })).body;
        expect((await call("POST", path(GEO_API_PATHS.fishing.leave, { runId: run.id }), token)).status).toBe(204);
        expect((await call("POST", path(GEO_API_PATHS.fishing.leave, { runId: run.id }), token)).status).toBe(400);
        expect((await call("PUT", path(GEO_API_PATHS.me.hand, { skill: "fishing" }), token, { inventoryIds: [] })).status).toBe(200);
    });
});

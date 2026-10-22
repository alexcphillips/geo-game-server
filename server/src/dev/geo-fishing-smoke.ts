import assert from "node:assert/strict";
import {
    GEO_API_PATHS,
    type GeoAdminSeaCreatures,
    type GeoFishingAction,
    type GeoFishingRunView,
    type GeoMeResponse,
    type GeoRunResponse,
} from "@geo/shared";
import { CONTENT } from "../content";
import { startSmokeServer, step } from "./smoke-kit";

/**
 * End-to-end check of a fishing Run against the local database: the starter
 * fishing hand and worms, a cast spending one bait, charges spent per card, a
 * landed fish in the inventory with its XP, the hand locked mid-Run, Soulbound
 * fish refused by the Market and vendors, and leaving. `npm run smoke:geo-fishing`.
 */
const { call, registerPlayer, grant, makeAdmin, stop } = await startSmokeServer();

const me = async (token: string) => (await call<GeoMeResponse>("GET", GEO_API_PATHS.me.root, token)).body;
const baitLeft = (body: GeoMeResponse) => body.bait.contents.reduce((sum, slot) => sum + slot.quantity, 0);
const actPath = (runId: string) => GEO_API_PATHS.fishing.actions.replace(":runId", runId);

try {
    const player = await registerPlayer("fishing");
    const token = player.accessToken;

    const start = await me(token);
    assert.equal(start.hands.fishing?.length, 4, "a starter fishing hand");
    assert.equal(baitLeft(start), 20, "20 worms packed");
    step("starter kit: four fishing cards in the fishing hand, 20 worms in the bait slot");

    // Rods are held in the main hand: the starter Fishing loadout has the Twig Rod.
    assert.equal((await call("POST", GEO_API_PATHS.me.wearLoadout.replace(":slot", "1"), token)).status, 200);
    const refused = await call("POST", GEO_API_PATHS.fishing.start, token, { tier: "ocean-ish" });
    assert.equal(refused.status, 400);
    let run = (await call<GeoFishingRunView>("POST", GEO_API_PATHS.fishing.start, token, { tier: "pond" })).body;
    assert.equal(run.phase, "ready");
    assert.equal(run.hand.length, 4);
    const resumed = (await call<GeoFishingRunView>("POST", GEO_API_PATHS.fishing.start, token, { tier: "pond" })).body;
    assert.equal(resumed.id, run.id, "opening again resumes the same Run");
    step("open a fishing Run at a pond; opening again resumes it");

    const handChange = await call("PUT", GEO_API_PATHS.me.hand.replace(":skill", "fishing"), token, { inventoryIds: [] });
    assert.equal(handChange.status, 400, "the fishing hand is locked mid-Run");
    step("the fishing hand can't change mid-Run");

    const act = async (action: GeoFishingAction) => {
        const response = await call<GeoFishingRunView>("POST", actPath(run.id), token, action);
        assert.equal(response.status, 200, JSON.stringify(response.body));
        run = response.body;
        return run;
    };

    // Cast until something lands, with the playground's simple policy.
    let casts = 0;
    let cardsPlayed = 0;
    let baitUsed = 0;
    let landed: Extract<GeoFishingRunView["outcome"], { kind: "landed" }> | null = null;
    while (!landed) {
        assert.ok(casts < 20, "landed nothing in 20 casts");
        const before = baitLeft(await me(token));
        await act({ type: "cast" });
        casts++;
        const used = before - baitLeft(await me(token));
        // A mayor's Bait Lover can save one.
        assert.ok(used === 1 || used === 0, "at most one bait per cast");
        baitUsed += used;
        // `act` reassigns `run`; read the phase fresh each time.
        const phase = () => run.phase as GeoFishingRunView["phase"];
        while (phase() !== "over") {
            if (phase() === "waiting") await act({ type: "strike" });
            else if (phase() === "creature") await act({ type: "cutLine" });
            else {
                const f = run.fight!;
                const pick = f.distance <= 2 ? "fish.gaff" : f.tension > f.zoneHigh ? "fish.slack" : "fish.reel";
                const card = run.hand.find((c) => c.cardId === pick)!;
                await act({ type: "play", inventoryId: card.inventoryId });
                cardsPlayed++;
            }
        }
        if (run.outcome?.kind === "landed" && cardsPlayed > 0) landed = run.outcome;
    }
    assert.ok(baitUsed > 0 || casts < 3, "bait is spent");
    step(`each cast spends one worm (${baitUsed} used, ${casts} cast${casts === 1 ? "" : "s"}, ${cardsPlayed} cards played)`);

    const after = await me(token);
    const caught = after.inventory.find((entry) => entry.itemId === landed.itemId);
    assert.ok(caught, `${landed.itemId} is in the inventory`);
    assert.ok((after.skillXp.fishing ?? 0) >= landed.xp, "fishing XP");
    

    for (const card of run.hand) {
        const entry = after.inventory.find((e) => e.id === card.inventoryId);
        assert.equal(entry?.chargesLeft, card.chargesLeft, "charges saved");
    }
    step(`landed a ${landed.tier ?? "regular"} ${landed.name} (${landed.how}): in the inventory, +${landed.xp} fishing XP, charges saved`);

    // A combat Run started from here leaves the fishing spot.
    const fight = await call<GeoRunResponse>("POST", GEO_API_PATHS.runs.start, token, { kind: "combat", enemyId: "spider" });
    if (fight.status === 201) {
        const gone = await call("POST", actPath(run.id), token, { type: "cast" });
        assert.equal(gone.status, 400, "the fishing Run ended when the fight started");
        await call("POST", GEO_API_PATHS.runs.flee.replace(":runId", fight.body.run.id), token);
        step("starting a fight leaves the fishing spot");
    }

    // Sea creatures: cast with chum (3× the creature chance) until one bites.
    // Fish are let go (leave and come back) to keep it quick.
    await grant(player.player.id, [{ itemId: "bloody-bait", quantity: 1000 }]);
    const baitPath = GEO_API_PATHS.me.baitSlot.replace(":slot", "0");
    // Bait is restocked at camp.
    const CAMP = { latitude: 51.507, longitude: -0.128 };
    assert.equal((await call("PUT", GEO_API_PATHS.me.camp, token, { position: CAMP })).status, 200);
    run = (await call<GeoFishingRunView>("POST", GEO_API_PATHS.fishing.start, token, { tier: "open" })).body;
    let bites = 0;
    while (run.phase !== "creature") {
        assert.ok(bites < 600, "no sea creature in 600 bites with chum");
        if (run.phase === "fight") {
            await call("POST", GEO_API_PATHS.fishing.leave.replace(":runId", run.id), token);
            run = (await call<GeoFishingRunView>("POST", GEO_API_PATHS.fishing.start, token, { tier: "open" })).body;
        }
        if (run.phase === "ready" || run.phase === "over") {
            if (baitLeft(await me(token)) === 0 || run.baitItemId !== "bloody-bait") {
                const packed = await call("PUT", baitPath, token, { itemId: "bloody-bait", quantity: 25, position: CAMP });
                assert.equal(packed.status, 200, JSON.stringify(packed.body));
            }
            await act({ type: "cast" });
            continue;
        }
        if (run.phase === "waiting") {
            bites++;
            await act({ type: "strike" });
        }
    }
    step(`a sea creature bit after ${bites} chum bite${bites === 1 ? "" : "s"}`);

    // No combat hand: the fight is refused, and it's still on the line.
    const combatHand = (await me(token)).hands.combat ?? [];
    const handPath = GEO_API_PATHS.me.hand.replace(":skill", "combat");
    await call("PUT", handPath, token, { inventoryIds: [] });
    const noHand = await call<{ error: string }>("POST", actPath(run.id), token, { type: "fightCreature" });
    assert.equal(noHand.status, 400, JSON.stringify(noHand.body));
    const still = (await call<GeoFishingRunView>("POST", GEO_API_PATHS.fishing.start, token, { tier: "open" })).body;
    assert.equal(still.id, run.id);
    assert.equal(still.phase, "creature", "refused: the creature is still on the line");
    assert.equal((await call("GET", GEO_API_PATHS.runs.active, token)).body, null, "and no fight started");
    step(`fighting it with an empty combat hand is refused ("${noHand.body.error}"), creature still hooked`);

    await call("PUT", handPath, token, { inventoryIds: combatHand });
    await act({ type: "fightCreature" });
    assert.equal(run.phase, "over");
    assert.deepEqual(run.outcome, { kind: "creature", enemyId: "kraken", name: "Kraken" });
    const gone = await call("POST", actPath(run.id), token, { type: "cast" });
    assert.equal(gone.status, 400, "the fishing Run is over");
    const active = (await call<GeoRunResponse | null>("GET", GEO_API_PATHS.runs.active, token)).body;
    assert.ok(active, "a combat Run started");
    assert.equal(active.run.status, "active");
    const kraken = active.run.combatants.find((c) => c.side === "enemy");
    assert.equal(kraken?.name, "Kraken");
    assert.equal(kraken?.maxHealth, CONTENT.enemies.kraken!.stats.maxHealth);
    step("fighting it ends the fishing Run and opens a combat Run against a Kraken");

    const turnsPath = GEO_API_PATHS.runs.turns.replace(":runId", active.run.id);
    const turn = await call<GeoRunResponse>("POST", turnsPath, token, { inventoryId: active.run.hand[0]!.inventoryId });
    assert.equal(turn.status, 200, JSON.stringify(turn.body));
    const hurt = turn.body.run.combatants.find((c) => c.side === "enemy")!;
    assert.ok(hurt.health + hurt.guard < kraken!.maxHealth + kraken!.guard || turn.body.log.length > 0, "the turn did something");
    await call("POST", GEO_API_PATHS.runs.flee.replace(":runId", active.run.id), token);
    step(`played a turn against the Kraken (${hurt.health}/${hurt.maxHealth} health), then fled`);

    // The admin switch: every bite is a sea creature.
    const switchPath = GEO_API_PATHS.admin.seaCreatures;
    assert.equal((await call("PUT", switchPath, token, { always: true })).status, 403, "admins only");
    await makeAdmin(player.player.id);
    assert.deepEqual((await call<GeoAdminSeaCreatures>("GET", switchPath, token)).body, { always: false });
    assert.deepEqual((await call<GeoAdminSeaCreatures>("PUT", switchPath, token, { always: true })).body, { always: true });
    await call("PUT", baitPath, token, { itemId: "worm-bait", quantity: 10 });
    run = (await call<GeoFishingRunView>("POST", GEO_API_PATHS.fishing.start, token, { tier: "open" })).body;
    const strikeBite = async () => {
        await act({ type: "cast" });
        if (run.phase === "waiting") await act({ type: "strike" });
    };
    for (let i = 0; i < 3; i++) {
        await strikeBite();
        if (run.phase === "over") continue; // spooked by an early strike
        assert.equal(run.phase, "creature", "with the switch on, every bite is a sea creature");
        await act({ type: "cutLine" });
    }
    await strikeBite();
    assert.equal(run.phase, "creature");
    await act({ type: "fightCreature" });
    const forced = (await call<GeoRunResponse | null>("GET", GEO_API_PATHS.runs.active, token)).body;
    assert.equal(forced?.run.combatants.find((c) => c.side === "enemy")?.name, "Kraken", "and fighting it starts the combat Run");
    await call("POST", GEO_API_PATHS.runs.flee.replace(":runId", forced!.run.id), token);
    assert.deepEqual((await call<GeoAdminSeaCreatures>("PUT", switchPath, token, { always: false })).body, { always: false });
    step("an admin's switch makes every bite a sea creature, which still opens a Kraken fight; switched off again");

    // Soulbound fish stay put.
    const [silverId] = await grant(player.player.id, [{ itemId: "fish.salmon.silver", quantity: 1 }]);
    const listing = await call("POST", GEO_API_PATHS.market.listings, token, {
        inventoryId: silverId,
        quantity: 1,
        type: "bin",
        price: 100,
    });
    assert.equal(listing.status, 400, JSON.stringify(listing.body));
    const sale = await call("POST", GEO_API_PATHS.vendors.sell.replace(":vendorId", "angler"), token, {
        inventoryId: silverId,
        quantity: 1,
    });
    assert.equal(sale.status, 400, JSON.stringify(sale.body));
    step("a Soulbound Silver Salmon can't be listed or sold");

    const reopened = (await call<GeoFishingRunView>("POST", GEO_API_PATHS.fishing.start, token, { tier: "pond" })).body;
    const left = await call("POST", GEO_API_PATHS.fishing.leave.replace(":runId", reopened.id), token);
    assert.equal(left.status, 204);
    const afterLeave = await call("POST", actPath(reopened.id), token, { type: "cast" });
    assert.equal(afterLeave.status, 400);
    step("leaving ends the Run");

    console.log("\nFishing smoke passed.");
} finally {
    await stop();
}

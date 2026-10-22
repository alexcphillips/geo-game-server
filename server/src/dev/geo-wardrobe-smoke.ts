import assert from "node:assert/strict";
import {
    GEO_API_PATHS,
    type GeoFishingRunView,
    type GeoMeResponse,
    type GeoRunResponse,
} from "@geo/shared";
import { GAME_CONFIG } from "../content";
import { startSmokeServer, step } from "./smoke-kit";

/**
 * End-to-end check of the wardrobe against the local database: the starter
 * loadouts, wearing one, the active loadout following gear changes, the rod
 * in the main hand, buying slots, and auto-swap wearing the
 * tagged loadout as a fishing Run or a fight starts. `npm run smoke:geo-wardrobe`.
 */
const { call, registerPlayer, sql, coins, stop } = await startSmokeServer();

try {
    const { accessToken: token, player } = await registerPlayer("wardrobe");
    const me = async () => (await call<GeoMeResponse>("GET", GEO_API_PATHS.me.root, token)).body;
    const itemOf = (state: GeoMeResponse, inventoryId: string | undefined) =>
        state.inventory.find((entry) => entry.id === inventoryId)?.itemId;
    const slotPath = (path: string, slot: number) => path.replace(":slot", String(slot));
    const wear = (slot: number) => call<{ error: string }>("POST", slotPath(GEO_API_PATHS.me.wearLoadout, slot), token);
    const startFishing = () => call<GeoFishingRunView & { error: string }>("POST", GEO_API_PATHS.fishing.start, token, { tier: "pond" });
    const leaveFishing = (runId: string) => call("POST", GEO_API_PATHS.fishing.leave.replace(":runId", runId), token);

    let state = await me();
    assert.equal(state.wardrobe.slots, GAME_CONFIG.wardrobe.startingSlots);
    assert.deepEqual(
        state.wardrobe.loadouts.map((loadout) => loadout.name),
        ["Combat", "Fishing"],
    );
    assert.equal(state.wardrobe.activeSlot, 0);
    assert.equal(itemOf(state, state.equipment.mainHand), "bronze-dagger");
    assert.equal(itemOf(state, state.wardrobe.loadouts[1]?.equipment.mainHand), "twig-rod");
    assert.deepEqual(state.wardrobe.loadouts.map((loadout) => loadout.autoFor), ["combat", "fishing"]);
    step("a new player has Combat (worn) and Fishing loadouts, tagged for auto-swap");

    const freeSwap = await startFishing();
    assert.equal(freeSwap.status, 201, JSON.stringify(freeSwap.body));
    state = await me();
    assert.equal(state.wardrobe.activeSlot, 1);
    assert.equal(itemOf(state, state.equipment.mainHand), "twig-rod");
    await leaveFishing(freeSwap.body.id);
    assert.equal((await wear(0)).status, 200);
    step("fishing in combat gear wears Fishing");

    assert.equal((await call("PUT", slotPath(GEO_API_PATHS.me.loadoutAuto, 1), token, { autoFor: null })).status, 200);
    const untagged = await startFishing();
    assert.equal(untagged.status, 201, JSON.stringify(untagged.body));
    assert.equal((await me()).wardrobe.activeSlot, 1);
    await leaveFishing(untagged.body.id);
    assert.equal((await wear(0)).status, 200);
    assert.equal((await call("PUT", slotPath(GEO_API_PATHS.me.loadoutAuto, 1), token, { autoFor: "fishing" })).status, 200);
    step("none tagged for fishing: the first loadout with a rod is worn; fishing tags are free");

    assert.equal((await wear(1)).status, 200);
    state = await me();
    assert.equal(state.wardrobe.activeSlot, 1);
    assert.equal(itemOf(state, state.equipment.mainHand), "twig-rod");
    const fishing = await startFishing();
    assert.equal(fishing.status, 201, JSON.stringify(fishing.body));
    const midRun = await wear(0);
    assert.equal(midRun.status, 400);
    assert.match(midRun.body.error, /mid-Run/);
    await leaveFishing(fishing.body.id);
    step("wearing Fishing puts the rod in hand; fishing works; switching mid-Run is refused");

    assert.equal((await wear(0)).status, 200);
    const rodId = state.equipment.mainHand!;
    assert.equal((await call("PUT", GEO_API_PATHS.me.equipmentSlot.replace(":slot", "offHand"), token, { inventoryId: null })).status, 200);
    assert.equal((await call("PUT", GEO_API_PATHS.me.equipmentSlot.replace(":slot", "mainHand"), token, { inventoryId: rodId })).status, 200);
    state = await me();
    assert.equal(state.wardrobe.loadouts[0]?.equipment.mainHand, rodId);
    assert.equal(itemOf(state, state.wardrobe.loadouts[1]?.equipment.mainHand), "twig-rod");
    step("changing gear updates the active loadout only; one rod can be in two loadouts");

    const dagger = state.inventory.find((entry) => entry.itemId === "bronze-dagger")!;
    await call("PUT", GEO_API_PATHS.me.equipmentSlot.replace(":slot", "mainHand"), token, { inventoryId: dagger.id });
    const renamed = await call("PUT", slotPath(GEO_API_PATHS.me.loadout, 0), token, { name: "  Fight  ", save: false });
    assert.equal(renamed.status, 200);
    assert.equal((await me()).wardrobe.loadouts[0]?.name, "Fight");
    assert.equal((await call("PUT", slotPath(GEO_API_PATHS.me.loadout, 0), token, { name: "", save: false })).status, 400);
    assert.equal((await call("PUT", slotPath(GEO_API_PATHS.me.loadout, 2), token, { name: "Nope", save: false })).status, 404);
    assert.equal((await wear(GAME_CONFIG.wardrobe.startingSlots)).status, 400);
    step("rename; empty names, renaming an empty slot and slots not owned: refused");

    const { slotCost } = GAME_CONFIG.wardrobe;
    assert.equal((await call("POST", GEO_API_PATHS.me.buyLoadoutSlot, token)).status, 400);
    await coins(player.id, slotCost.first);
    const before = (await me()).player.coins;
    assert.equal((await call("POST", GEO_API_PATHS.me.buyLoadoutSlot, token)).status, 200);
    state = await me();
    assert.equal(state.player.coins, before - slotCost.first);
    assert.equal(state.wardrobe.slots, GAME_CONFIG.wardrobe.startingSlots + 1);
    assert.equal(state.wardrobe.nextSlotCost, slotCost.first + slotCost.step);
    step("a slot refused without the coins, then bought; the next slot costs more");

    for (const [slot, autoFor] of [[0, "combat"], [1, "fishing"]] as const) {
        assert.equal((await call("PUT", slotPath(GEO_API_PATHS.me.loadoutAuto, slot), token, { autoFor })).status, 200);
    }
    // The fishing tag moves to slot 0 and back: one loadout per activity.
    await call("PUT", slotPath(GEO_API_PATHS.me.loadoutAuto, 0), token, { autoFor: "fishing" });
    assert.equal((await me()).wardrobe.loadouts[1]?.autoFor, null);
    await call("PUT", slotPath(GEO_API_PATHS.me.loadoutAuto, 1), token, { autoFor: "fishing" });
    await call("PUT", slotPath(GEO_API_PATHS.me.loadoutAuto, 0), token, { autoFor: "combat" });
    step("tags: one loadout per activity");

    const swapped = await startFishing();
    assert.equal(swapped.status, 201, JSON.stringify(swapped.body));
    state = await me();
    assert.equal(state.wardrobe.activeSlot, 1);
    assert.equal(itemOf(state, state.equipment.mainHand), "twig-rod");
    step("starting a fishing Run in combat gear swaps to the Fishing loadout");

    const fight = await call<GeoRunResponse>("POST", GEO_API_PATHS.runs.start, token, { kind: "combat", enemyId: "spider" });
    assert.equal(fight.status, 201, JSON.stringify(fight.body));
    state = await me();
    assert.equal(state.wardrobe.activeSlot, 0);
    assert.equal(itemOf(state, state.equipment.mainHand), "bronze-dagger");
    await call("POST", GEO_API_PATHS.runs.flee.replace(":runId", fight.body.run.id), token);
    step("then starting a fight swaps back to the Combat loadout");

    const saved = await call("PUT", slotPath(GEO_API_PATHS.me.loadout, 3), token, { name: "Spare", save: true });
    assert.equal(saved.status, 200);
    assert.equal((await me()).wardrobe.activeSlot, 3);
    assert.equal((await call("DELETE", slotPath(GEO_API_PATHS.me.loadout, 3), token)).status, 200);
    state = await me();
    assert.equal(state.wardrobe.activeSlot, null);
    assert.equal(state.wardrobe.loadouts.length, 2);
    assert.equal(itemOf(state, state.equipment.mainHand), "bronze-dagger", "clearing a loadout leaves the gear on");
    step("save into the bought slot makes it active; clearing it leaves nothing active");

    const rows = await sql<{ coins: number; ledger: number }>(
        `SELECT p.coins, COALESCE((SELECT SUM(delta) FROM coin_ledger WHERE player_id = p.id), 0) AS ledger
         FROM players p WHERE p.id = ?`,
        [player.id],
    );
    const [balances] = rows;
    assert.ok(balances);
    assert.equal(Number(balances.coins), Number(balances.ledger));
    step("coins match the ledger");
} finally {
    await stop();
}

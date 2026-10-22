import assert from "node:assert/strict";
import { GEO_API_PATHS, type GeoFarmAction, type GeoFarmView, type GeoInboxResponse, type GeoMeResponse } from "@geo/shared";
import { CONTENT, FARMING } from "../content";
import { weekEndsAt } from "../farming/farm";
import { startSmokeServer, step } from "./smoke-kit";

/**
 * End-to-end check of the farm against the local database: the starter
 * farming hand and seeds, a farm made on first look, planting spending a
 * seed, Labor enforced, the farm taking turns on its own while away (and
 * waiting after a few), a harvest into the inventory with
 * its XP, a card charge spent, a pest swatted for its drop, a tile bought
 * with coins, a mutation turned in at the Research Lab, an order delivered,
 * a structure placed and picked up, and a Shrine offering.
 * `npm run smoke:geo-farming`.
 */
const { call, registerPlayer, grant, sql, coins, farmWeeks, stop } = await startSmokeServer();

const me = async (token: string) => (await call<GeoMeResponse>("GET", GEO_API_PATHS.me.root, token)).body;
const MID = 40;

try {
    const player = await registerPlayer("farming");
    const token = player.accessToken;
    const playerId = (await me(token)).player.id;

    const start = await me(token);
    assert.equal(start.hands.farming?.length, 5, "a starter farming hand");
    const held = (inventory: GeoMeResponse["inventory"], itemId: string) =>
        inventory.filter((entry) => entry.itemId === itemId).reduce((sum, entry) => sum + entry.quantity, 0);
    assert.equal(held(start.inventory, "wheat-seeds"), 12);
    assert.equal(held(start.inventory, "carrot-seeds"), 6);
    step("starter kit: five farming cards in hand, wheat and carrot seeds in the inventory");

    let farm = (await call<GeoFarmView>("GET", GEO_API_PATHS.farm.root, token)).body;
    assert.equal(farm.tiles.filter((tile) => tile.owned).length, 9);
    assert.equal(farm.playsLeft, 5);
    assert.equal(farm.turn, 0);
    assert.equal(farm.hand.length, 5);
    step("first look makes a 3×3 farm with 5 card plays, its clock just started");

    const act = async (action: GeoFarmAction, status = 200) => {
        const response = await call<GeoFarmView>("POST", GEO_API_PATHS.farm.actions, token, action);
        assert.equal(response.status, status, JSON.stringify(response.body));
        if (status === 200) farm = response.body;
        return response;
    };
    /**
     * Skips the clock: sets the farm's clock `turns` turns back, then looks,
     * so they play. Placeholder weather is keyed by the real 12h period, so
     * every skip in one run would share a sky: a fresh weather seed varies it.
     */
    const passTurns = async (turns: number) => {
        const startedAt = new Date(Date.now() - turns * FARMING.turnHours * 3_600_000 - 60_000).toISOString();
        await sql(`UPDATE farms SET state = json_set(state, '$.accruedAt', ?, '$.weatherSeed', ?) WHERE player_id = ?`, [
            startedAt,
            Math.floor(Math.random() * 4_294_967_296),
            playerId,
        ]);
        farm = (await call<GeoFarmView>("GET", GEO_API_PATHS.farm.root, token)).body;
    };

    await act({ type: "plant", tile: MID, itemId: "wheat-seeds" });
    assert.equal(held((await me(token)).inventory, "wheat-seeds"), 11);
    assert.equal(farm.tiles[MID]!.crop?.cropId, "wheat");
    await act({ type: "plant", tile: MID, itemId: "wheat-seeds" }, 400);
    await act({ type: "plant", tile: 0, itemId: "wheat-seeds" }, 400);
    step("planting takes a seed; occupied and locked tiles are refused");

    const sky = farm.hand.find((card) => card.cardId === "farm.read-sky")!;
    await act({ type: "play", inventoryId: sky.inventoryId, tile: 0 });
    assert.equal(farm.playsLeft, 4);
    assert.ok(farm.hand.find((card) => card.inventoryId === sky.inventoryId)!.played);
    await act({ type: "play", inventoryId: sky.inventoryId, tile: 0 }, 400);
    step("a card plays once a cycle, out of 5 plays");

    await passTurns(1);
    assert.equal(farm.turn, 1);
    assert.equal(farm.playsLeft, 5);
    assert.ok(!farm.hand.some((card) => card.played));
    assert.match(farm.log[0]!, /ran 1 cycle\./);
    await passTurns(10);
    assert.equal(farm.turn, 1 + FARMING.maxTurnsAway);
    assert.match(farm.log[0]!, /then waited for you/);
    assert.ok(new Date(farm.nextTurnAt).getTime() > Date.now() + (FARMING.turnHours - 1) * 3_600_000, "the clock restarts on the look");
    step(`the farm takes turns on its own, readying the hand, and waits after ${FARMING.maxTurnsAway} away`);

    // A turn at a time until the wheat is ripe (no watering: only heatwaves stall it).
    for (let guard = 0; !farm.tiles[MID]!.crop?.ripe; guard++) {
        assert.ok(guard < 20, "wheat never ripened");
        // Ripe wheat left two turns can rot; clear it.
        if (farm.tiles[MID]!.crop?.rotten) await act({ type: "clear", tile: MID });
        // Pests can eat the wheat: plant again.
        if (!farm.tiles[MID]!.crop) await act({ type: "plant", tile: MID, itemId: "wheat-seeds" });
        // Pests may come for the wheat: swat the one on it before it acts (once a cycle).
        const swat = farm.hand.find((card) => card.cardId === "farm.swat")!;
        const onWheat = farm.pests.find((pest) => pest.tile === MID);
        if (onWheat && !swat.played) await act({ type: "play", inventoryId: swat.inventoryId, tile: MID });
        await passTurns(1);
    }
    // Pests swatted on the way gave XP too: count only the harvest's.
    const xpBefore = (await me(token)).skillXp.farming ?? 0;
    await act({ type: "harvest", tile: MID });
    const wheat = farm.gained.find((gain) => gain.itemId === "wheat");
    assert.ok(wheat && wheat.quantity >= 1, "harvested wheat");
    const after = await me(token);
    assert.ok(after.inventory.some((entry) => entry.itemId === "wheat" && entry.quantity === wheat.quantity));
    assert.equal(after.skillXp.farming, xpBefore + CONTENT.crops.wheat!.xp);
    step(`harvesting is free: ${wheat.quantity} wheat into the inventory, with farming XP`);

    const mouse = { id: 999, pestId: "field-mouse", tile: MID, age: 0, intent: { kind: "move", tile: MID } };
    await sql(`UPDATE farms SET state = json_set(state, '$.pests', json(?), '$.played', json('[]')) WHERE player_id = ?`, [JSON.stringify([mouse]), playerId]);
    const swat = farm.hand.find((card) => card.cardId === "farm.swat")!;
    await act({ type: "play", inventoryId: swat.inventoryId, tile: MID });
    assert.equal(farm.pests.length, 0);
    assert.equal(farm.hand.find((card) => card.inventoryId === swat.inventoryId)!.chargesLeft, swat.chargesLeft - 1);
    assert.ok(farm.gained.some((gain) => gain.itemId === "mouse-tail"));
    assert.ok((await me(token)).inventory.some((entry) => entry.itemId === "mouse-tail"));
    await act({ type: "play", inventoryId: swat.inventoryId, tile: MID }, 400);
    step("the Swat card clears a pest, its drop into the inventory and a charge spent");

    const edge = MID - 2;
    await act({ type: "unlock", tile: edge }, 400);
    await coins(playerId, 1000, "vendor-sell");
    await act({ type: "unlock", tile: edge });
    assert.ok(farm.tiles[edge]!.owned);
    assert.equal((await me(token)).player.coins, 1000 - 50);
    step("a tile next to the farm costs coins, refused without them");

    const coinsBefore = (await me(token)).player.coins;
    assert.equal(farm.lab.found.length, 0);
    assert.equal(farm.lab.total, Object.keys(CONTENT.mutations).length);
    await grant(playerId, [{ itemId: "emberwheat", quantity: 1 }]);
    farm = (await call<GeoFarmView>("GET", GEO_API_PATHS.farm.root, token)).body;
    assert.deepEqual(farm.lab.ready.map((entry) => entry.mutationId), ["emberwheat"]);
    farm = (await call<GeoFarmView>("POST", GEO_API_PATHS.farm.lab, token, { mutationId: "emberwheat" })).body;
    assert.deepEqual(farm.lab.found.map((entry) => entry.mutationId), ["emberwheat"]);
    assert.ok(farm.crops.some((crop) => crop.id === "emberwheat" && crop.mutation));
    const researched = await me(token);
    assert.equal(researched.player.coins, coinsBefore + CONTENT.mutations.emberwheat!.research.coins);
    assert.ok(!researched.inventory.some((entry) => entry.itemId === "emberwheat"));
    assert.equal((await call("POST", GEO_API_PATHS.farm.lab, token, { mutationId: "emberwheat" })).status, 400);
    step("the Research Lab takes the first Emberwheat, logs its recipe and pays once");

    const harvestStanding = farm.contests.standings.find((standing) => standing.contest === "harvest")!;
    assert.ok(harvestStanding.score > 0 && harvestStanding.rank !== null, "the harvest counted for this week's contest");
    // Settle a made-up week long past, so no real week is touched; cleared first, so runs repeat.
    await sql(`DELETE FROM farm_weeks WHERE week IN (1, 2)`);
    await sql(`DELETE FROM farm_contest_scores WHERE week = 1`);
    await sql(`INSERT INTO farm_contest_scores (week, contest, player_id, score, updated_at) VALUES (1, 'harvest', ?, 50, ?)`, [playerId, Date.now()]);
    const beforePrize = (await me(token)).player.coins;
    await farmWeeks(weekEndsAt(1).getTime());
    assert.equal((await me(token)).player.coins, beforePrize + FARMING.contests.prizes[0]!);
    const inbox = (await call<GeoInboxResponse>("GET", GEO_API_PATHS.inbox.root, token)).body;
    assert.ok(inbox.messages.some((message) => message.kind === "contest"));
    await farmWeeks(weekEndsAt(1).getTime());
    assert.equal((await me(token)).player.coins, beforePrize + FARMING.contests.prizes[0]!, "a week pays out once");
    step("a harvest scores for the week's contest; a finished week pays its winner once, with an inbox message");

    assert.equal(farm.orders.orders.length, 3);
    const order = farm.orders.orders[0]!;
    const beforeOrder = (await me(token)).player.coins;
    await act({ type: "accept-order", orderId: order.id });
    await grant(playerId, [{ itemId: order.itemId, quantity: order.quantity }]);
    await act({ type: "deliver-order", orderId: order.id });
    assert.equal(farm.orders.orders[0]!.status, "done");
    assert.equal((await me(token)).player.coins, beforeOrder + order.reward);
    step("an Order Board order takes a deposit, and pays reward plus deposit on delivery");

    // Structures are built from their materials, from the Build list.
    const bin = CONTENT.structures["compost-bin"]!;
    const holding = async (itemId: string) => held((await me(token)).inventory, itemId);
    await grant(playerId, bin.cost);
    farm = (await call<GeoFarmView>("GET", GEO_API_PATHS.farm.root, token)).body;
    assert.ok(farm.buildList.includes("compost-bin"));
    const before = await Promise.all(bin.cost.map((entry) => holding(entry.itemId)));
    await act({ type: "place", tile: MID, structureId: "compost-bin" });
    assert.equal(farm.tiles[MID]!.structure?.structureId, "compost-bin");
    const built = await Promise.all(bin.cost.map((entry) => holding(entry.itemId)));
    assert.deepEqual(built, before.map((have, i) => have - bin.cost[i]!.quantity));
    await act({ type: "place", tile: MID, structureId: "compost-bin" }, 400);
    await act({ type: "demolish", tile: MID });
    assert.equal(farm.tiles[MID]!.structure, null);
    assert.deepEqual(await Promise.all(bin.cost.map((entry) => holding(entry.itemId))), built, "nothing back");
    step("a Compost Bin is built from its materials, and demolished for nothing back");

    const shrine = CONTENT.structures["mysterious-shrine"]!;
    await grant(playerId, [...shrine.cost, { itemId: "mouse-tail", quantity: 4 }]);
    farm = (await call<GeoFarmView>("GET", GEO_API_PATHS.farm.root, token)).body;
    await act({ type: "place", tile: MID, structureId: "mysterious-shrine" });
    const tailsBefore = await holding("mouse-tail");
    await act({ type: "offer", tile: MID, itemId: "mouse-tail", quantity: 4 });
    assert.ok(farm.log.some((line) => line.startsWith("The Shrine")), "the Shrine answered");
    assert.equal(await holding("mouse-tail"), tailsBefore - 4);
    await act({ type: "demolish", tile: MID });
    step("the Mysterious Shrine takes an offering from the inventory and answers");

    await act({ type: "blueprint", tile: 0, cropId: "melon" });
    assert.equal(farm.tiles[0]!.blueprint, "melon");
    step("blueprints plan any tile");

    await grant(playerId, [{ itemId: "wheat-seeds", quantity: 20 }, { itemId: "carrot-seeds", quantity: 1 }]);
    const isEmpty = (tile: GeoFarmView["tiles"][number]) => tile.owned && !tile.crop && !tile.structure && tile.partOf === null && !tile.waste;
    const planned = farm.tiles.find(isEmpty)!;
    await act({ type: "blueprint", tile: planned.index, cropId: "carrot" });
    const empty = farm.tiles.filter(isEmpty).map((tile) => tile.index);
    const seedsBefore = held((await me(token)).inventory, "wheat-seeds");
    const carrotsBefore = held((await me(token)).inventory, "carrot-seeds");
    await act({ type: "plant-all", itemId: "wheat-seeds" });
    assert.equal(farm.tiles[planned.index]!.crop?.cropId, "carrot", "the planned tile takes its own seed");
    for (const index of empty.filter((index) => index !== planned.index)) assert.equal(farm.tiles[index]!.crop?.cropId, "wheat");
    const inventory = (await me(token)).inventory;
    assert.equal(held(inventory, "wheat-seeds"), seedsBefore - (empty.length - 1));
    assert.equal(held(inventory, "carrot-seeds"), carrotsBefore - 1);
    await act({ type: "plant-all", itemId: "wheat-seeds" }, 400);
    step(`plant-all fills ${empty.length} empty tiles in one go, a planned tile with its own seed, then refuses a full farm`);

} finally {
    await stop();
}

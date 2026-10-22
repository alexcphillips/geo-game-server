import assert from "node:assert/strict";
import {
    GEO_API_PATHS,
    type GeoChestsResponse,
    type GeoDeathResponse,
    type GeoMeResponse,
    type GeoOpenChestResponse,
    type GeoRunResponse,
} from "@geo/shared";
import { CONTENT } from "../content";
import { startSmokeServer, step } from "./smoke-kit";

/**
 * End-to-end check of chests against the local database: a win that gives a
 * chest selection instead of loot, the selection waiting as pending (through
 * a death too), refusals, opening one, and the history. `npm run smoke:geo-chests`.
 */
const { call, registerPlayer, coins, stop } = await startSmokeServer();

const openPath = (selectionId: string) => GEO_API_PATHS.chests.open.replace(":selectionId", selectionId);
const me = async (token: string) => (await call<GeoMeResponse>("GET", GEO_API_PATHS.me.root, token)).body;
const quantityOf = (inventory: GeoMeResponse["inventory"], itemId: string) =>
    inventory.filter((entry) => entry.itemId === itemId).reduce((sum, entry) => sum + entry.quantity, 0);

/** Fights the test boss to a win with the starter hand. */
async function beatTestBoss(token: string): Promise<GeoRunResponse> {
    let response = await call<GeoRunResponse>("POST", GEO_API_PATHS.runs.start, token, {
        kind: "combat",
        enemyId: "test-chest-boss",
    });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    for (let turn = 0; response.body.run.status === "active"; turn++) {
        assert.ok(turn < 50, "the fight should be over by now");
        const { run } = response.body;
        const card = run.hand.find((entry) => entry.chargesLeft > 0);
        assert.ok(card, "ran out of cards");
        const enemy = run.combatants.find((c) => c.side === "enemy");
        response = await call<GeoRunResponse>("POST", GEO_API_PATHS.runs.turns.replace(":runId", run.id), token, {
            inventoryId: card.inventoryId,
            targetId: enemy?.id,
        });
        assert.equal(response.status, 200, JSON.stringify(response.body));
    }
    assert.equal(response.body.run.status, "victory");
    return response.body;
}

try {
    const session = await registerPlayer("chests");
    const token = session.accessToken;

    const { run } = await beatTestBoss(token);
    const reward = run.rewards?.chests;
    assert.ok(reward, "the test boss always gives chests");
    assert.deepEqual(run.rewards?.items, [], "chests replace the loot list");
    assert.ok((run.rewards?.coins ?? 0) > 0, "coins still drop");
    assert.ok((run.rewards?.xp[0]?.amount ?? 0) > 0, "XP still counts");
    assert.deepEqual(
        reward.chests.slice(0, 2).map((chest) => [chest.tier, chest.cost]),
        [
            ["plain", CONTENT.chestTiers.plain.cost],
            ["gold", CONTENT.chestTiers.gold.cost],
        ],
    );
    assert.ok(reward.chests.every((chest) => !("items" in chest)), "closed chests keep their contents secret");
    step("a win gives chests instead of loot, with coins and XP");

    let list = (await call<GeoChestsResponse>("GET", GEO_API_PATHS.chests.root, token)).body;
    assert.deepEqual(list.pending.map((selection) => selection.id), [reward.selectionId]);
    assert.equal(list.pending[0]?.opened, null);
    assert.equal(list.pending[0]?.source.name, CONTENT.enemies["test-chest-boss"]!.name);
    assert.equal(list.history.length, 0);
    step("unopened chests wait as pending");

    const death = await call<GeoDeathResponse>("POST", GEO_API_PATHS.dev.kill, token);
    assert.equal(death.status, 200);
    list = (await call<GeoChestsResponse>("GET", GEO_API_PATHS.chests.root, token)).body;
    assert.equal(list.pending.length, 1);
    step("pending chests survive a death");

    // The death took every coin, so gold can't be paid for.
    const gold = reward.chests.findIndex((chest) => chest.tier === "gold");
    let refused = await call<{ error: string }>("POST", openPath(reward.selectionId), token, { index: gold });
    assert.equal(refused.status, 400);
    assert.match(refused.body.error, /Not enough coins/);
    refused = await call<{ error: string }>("POST", openPath(reward.selectionId), token, { index: 99 });
    assert.equal(refused.status, 400);
    step("refuses a chest you can't pay for, or that isn't there");

    await coins(session.player.id, 600);
    const before = await me(token);
    const opened = await call<GeoOpenChestResponse>("POST", openPath(reward.selectionId), token, { index: gold });
    assert.equal(opened.status, 200, JSON.stringify(opened.body));
    const result = opened.body.selection.opened;
    assert.ok(result && result.index === gold && result.items.length > 0);
    const after = await me(token);
    assert.equal(after.player.coins, before.player.coins - CONTENT.chestTiers.gold.cost);
    for (const item of result.items) {
        assert.equal(
            quantityOf(after.inventory, item.itemId) - quantityOf(before.inventory, item.itemId),
            item.quantity,
            `${item.itemId} handed over`,
        );
    }
    step("opening a chest takes its cost and hands over what's inside");

    refused = await call<{ error: string }>("POST", openPath(reward.selectionId), token, { index: 0 });
    assert.equal(refused.status, 400);
    assert.match(refused.body.error, /already opened/);
    list = (await call<GeoChestsResponse>("GET", GEO_API_PATHS.chests.root, token)).body;
    assert.equal(list.pending.length, 0);
    assert.equal(list.history.length, 1);
    assert.deepEqual(list.history[0]?.opened?.items, result.items);
    step("only one chest per selection; it moves to the history");
} finally {
    await stop();
}

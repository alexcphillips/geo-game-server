import assert from "node:assert/strict";
import { GEO_API_PATHS, geoXpToNextLevel, type GeoQuestsResponse } from "@geo/shared";
import { withTransaction } from "../db/transaction";
import { addCoins, addSkillXp } from "../modules/player/geo-player.repository";
import { recordQuestEvents } from "../modules/quests/geo-quests.repository";
import { startSmokeServer, step } from "./smoke-kit";

/**
 * End-to-end check of the quest chain against the local database: quests are
 * given in order, the bank and cooking count through their own routes, and
 * tier 2 opens only with both its combat level and Trial I turned in. Fights
 * are stood in for by recording their wins directly. `npm run smoke:geo-quests`.
 */
const { call, registerPlayer, grant, stop } = await startSmokeServer();

const CAMP = { latitude: 51.5007, longitude: -0.1246 };

try {
    const { accessToken, player } = await registerPlayer("quests");
    const quests = async () => {
        const response = await call<GeoQuestsResponse>("GET", GEO_API_PATHS.quests.root, accessToken);
        assert.equal(response.status, 200);
        return response.body;
    };
    const claim = (questId: string) =>
        call<GeoQuestsResponse & { error: string }>("POST", GEO_API_PATHS.quests.claim.replace(":questId", questId), accessToken);
    const only = async (id: string) => {
        const { quests: held } = await quests();
        assert.deepEqual(held.map((q) => q.id), [id]);
        return held[0]!;
    };
    const win = (events: Parameters<typeof recordQuestEvents>[2]) => withTransaction((tx) => recordQuestEvents(tx, player.id, events));

    let first = await only("slime-cull");
    assert.equal(first.tracked, true);
    assert.equal(first.status, "active");
    const start = await quests();
    assert.deepEqual(start.combatTier, {
        tier: 1,
        next: { tier: 2, level: 5, levelMet: false, trial: { questId: "trial-1", title: "Trial I", done: false } },
    });
    step("a new player gets Slime Cull, tracked, and sees tier 2 needs level 5 and Trial I");

    assert.equal((await claim("slime-cull")).status, 400);
    await win([{ type: "kill", enemyId: "green-slime" }]);
    first = await only("slime-cull");
    assert.equal(first.status, "ready");
    assert.equal(first.objectives[0]!.label, "Kill Green Slime");
    assert.equal((await claim("trial-1")).status, 404);

    // Camp placed and coins banked before Rainy Day Fund is given still count.
    await withTransaction((tx) => addCoins(tx, player.id, 50, "admin-grant", "quests-smoke"));
    assert.equal((await call("PUT", GEO_API_PATHS.me.camp, accessToken, { position: CAMP })).status, 200);
    const deposit = (amount: number) => call("POST", GEO_API_PATHS.me.bankDeposit, accessToken, { amount, position: CAMP });
    assert.equal((await deposit(4)).status, 200);

    const afterSlime = await claim("slime-cull");
    assert.equal(afterSlime.status, 200);
    assert.deepEqual(afterSlime.body.quests.map((q) => q.id), ["rainy-day-fund"]);
    assert.equal(afterSlime.body.quests[0]!.tracked, true);
    assert.equal((await claim("slime-cull")).status, 404);
    step("unfinished quests can't be turned in; turning one in gives the next, tracked, once");

    const early = await only("rainy-day-fund");
    assert.deepEqual(
        early.objectives.map((o) => [o.label, o.current, o.target]),
        [
            ["Place your camp", 1, 1],
            ["Deposit coins in the bank", 4, 10],
        ],
    );
    assert.equal(early.status, "active");
    assert.equal((await claim("rainy-day-fund")).status, 400);
    step("camp placed and coins banked before Rainy Day Fund count toward it");

    assert.equal((await deposit(20)).status, 200);
    const bank = await only("rainy-day-fund");
    assert.deepEqual([bank.status, bank.objectives[1]!.current, bank.objectives[1]!.target], ["ready", 10, 10]);
    assert.equal((await claim("rainy-day-fund")).status, 200);
    step("bank deposits add up toward Rainy Day Fund, capped at 10");

    await grant(player.id, [{ itemId: "fish.salmon", quantity: 1 }]);
    const cooked = await call("POST", GEO_API_PATHS.crafting.craft.replace(":recipeId", "cook-salmon"), accessToken, { quantity: 1 });
    assert.equal(cooked.status, 200, JSON.stringify(cooked.body));
    const cook = await only("fresh-off-the-fire");
    assert.equal(cook.objectives[0]!.label, "Cook Grilled Salmon");
    assert.equal(cook.status, "ready");
    assert.equal((await claim("fresh-off-the-fire")).status, 200);
    step("cooking a salmon finishes Fresh off the Fire");

    const trial = await only("trial-1");
    assert.equal(trial.unlocksTier, 2);
    await win([{ type: "kill", enemyId: "green-slime" }, { type: "dungeon", dungeonId: "slime-pits" }]);
    assert.equal((await only("trial-1")).status, "active");
    await win([{ type: "kill", enemyId: "giant-river-crab" }]);
    assert.equal((await only("trial-1")).status, "ready");
    const trialDone = await claim("trial-1");
    assert.equal(trialDone.status, 200);
    assert.equal(trialDone.body.combatTier.tier, 1, "level 1 still");
    assert.equal(trialDone.body.combatTier.next?.trial?.done, true);
    step("Trial I needs both the crab and Slime Pits; turned in, tier 2 still waits on level 5");

    let xp = 0;
    for (let level = 1; level < 5; level++) xp += geoXpToNextLevel(level);
    await withTransaction((tx) => addSkillXp(tx, player.id, "combat", xp));
    const tier2 = (await quests()).combatTier;
    assert.equal(tier2.tier, 2);
    assert.equal(tier2.next?.tier, 3);
    step("at combat level 5 with Trial I turned in, tier 2 is open");
} finally {
    await stop();
}

import assert from "node:assert/strict";
import {
    distanceMetres,
    GEO_API_PATHS,
    GEO_BAIT_STACK_SIZE,
    GEO_LUNCHBOX_STACK_SIZE,
    GEO_TALISMAN_BAG_FULL,
    GEO_TALISMAN_BAG_PAGE_SIZE,
    type GeoDeathResponse,
    type GeoMeResponse,
    type GeoRunResponse,
    type GeoSession,
    type GeoWorldResponse,
} from "@geo/shared";
import { pool } from "../db";
import { withTransaction } from "../db/transaction";
import { grantItems } from "../modules/player/geo-player.repository";
import { STARTER_KIT } from "../modules/accounts/geo-starter-kit";
import { SPAWN_RULES } from "../world";
import { startSmokeServer, step } from "./smoke-kit";

/**
 * End-to-end check of the geo API against the local database: sign up, read
 * the player, fight a Run to the end, refresh tokens, and hit the rule
 * rejections. Mounts the geo router on a spare port.
 *
 * Dev only — it creates throwaway accounts and deletes them after.
 * `npm run smoke:geo`.
 */
const { call, registerPlayer, stop } = await startSmokeServer();

try {
    // Accounts
    assert.equal((await call("POST", "/geo/auth/device")).status, 404);
    step("anonymous sign-up is gone");

    const signUp = { body: await registerPlayer() };
    const { accessToken, refreshToken } = signUp.body;
    assert.equal(signUp.body.player.role, "player");
    step("register makes a geo-game account and its player");

    const wrong = await call("POST", GEO_API_PATHS.auth.login, undefined, { email: signUp.body.email, password: "nope-nope-nope" });
    assert.equal(wrong.status, 401);
    const login = await call<GeoSession>("POST", GEO_API_PATHS.auth.login, undefined, {
        email: signUp.body.email,
        password: signUp.body.password,
    });
    assert.equal(login.status, 200);
    assert.equal(login.body.player.id, signUp.body.player.id, "signing in again finds the same player");
    step("login refuses a wrong password and finds the same player");

    assert.equal((await call("GET", "/geo/admin/players", accessToken)).status, 403);
    step("admin routes refuse a plain player");

    assert.equal((await call("GET", GEO_API_PATHS.me.root)).status, 401);
    assert.equal((await call("GET", GEO_API_PATHS.me.root, "not-a-token")).status, 401);

    // A malformed id is the caller's mistake (400), not a server error.
    const badRunId = await call("POST", GEO_API_PATHS.runs.flee.replace(":runId", "not-a-uuid"), accessToken);
    assert.equal(badRunId.status, 400, JSON.stringify(badRunId.body));
    step("me rejects missing and bad tokens");

    const me = await call<GeoMeResponse>("GET", GEO_API_PATHS.me.root, accessToken);
    assert.equal(me.status, 200);
    assert.deepEqual(me.body.inventory.map((entry) => entry.itemId).sort(), STARTER_KIT.items.map((entry) => entry.itemId).sort());
    assert.equal(me.body.hands.combat?.length, 2);
    const dagger = me.body.inventory.find((entry) => entry.itemId === "bronze-dagger")!;
    assert.equal(me.body.equipment.mainHand, dagger.id);
    assert.deepEqual(me.body.talismanBag, { pages: 1, inventoryIds: [] });
    assert.deepEqual(me.body.lunchbox, { slots: 1, contents: [{ slot: 0, itemId: "bread", quantity: 5 }] });
    step("starter kit: bronze dagger equipped, Slash and Double Slash in the combat hand, 5 bread packed");

    // Hand rules
    const handPath = GEO_API_PATHS.me.hand.replace(":skill", "combat");
    const badHand = await call<{ error: string }>("PUT", handPath, accessToken, { inventoryIds: [dagger.id] });
    assert.equal(badHand.status, 400);
    step(`hand rejects a non-card: "${badHand.body.error}"`);

    const slotPath = (slot: string) => GEO_API_PATHS.me.equipmentSlot.replace(":slot", slot);
    const wrongSlot = await call<{ error: string }>("PUT", slotPath("head"), accessToken, { inventoryId: dagger.id });
    assert.equal(wrongSlot.status, 400);
    step(`equipment rejects the wrong slot: "${wrongSlot.body.error}"`);

    // Weapon requirements: Double Slash is daggers only, so a rod (fists) can't fight with it alone.
    const starterHand = me.body.hands.combat!;
    const doubleSlash = me.body.inventory.find((entry) => entry.itemId === "card.double-slash")!;
    const [rodId] = await withTransaction((tx) => grantItems(tx, signUp.body.player.id, [{ itemId: "twig-rod", quantity: 1 }]));
    assert.equal((await call("PUT", slotPath("mainHand"), accessToken, { inventoryId: rodId })).status, 200);
    assert.equal((await call("PUT", handPath, accessToken, { inventoryIds: [doubleSlash.id] })).status, 200);
    const noWeapon = await call<{ error: string }>("POST", GEO_API_PATHS.runs.start, accessToken, { kind: "combat", enemyId: "spider" });
    assert.equal(noWeapon.status, 400);
    assert.match(noWeapon.body.error, /can be used with your gear/);
    assert.equal((await call("PUT", slotPath("mainHand"), accessToken, { inventoryId: dagger.id })).status, 200);
    assert.equal((await call("PUT", handPath, accessToken, { inventoryIds: starterHand })).status, 200);
    step(`a rod with only Double Slash in hand can't start a fight: "${noWeapon.body.error}"`);

    // Talisman Bag
    const [charmId] = await withTransaction((tx) => grantItems(tx, signUp.body.player.id, [{ itemId: "storm-charm", quantity: 1 }]));
    const charm = { id: charmId! };
    const bagEntry = (id: string) => GEO_API_PATHS.me.talismanBagEntry.replace(":inventoryId", id);
    const bagged = await call<GeoMeResponse>("PUT", bagEntry(charm.id), accessToken);
    assert.deepEqual(bagged.body.talismanBag, { pages: 1, inventoryIds: [charm.id] });
    step("a storm-charm goes in the Talisman Bag; 1 page");

    const [secondCharm] = await withTransaction((tx) =>
        grantItems(tx, signUp.body.player.id, [{ itemId: "storm-charm", quantity: 1 }]),
    );
    const duplicate = await call<{ error: string }>("PUT", bagEntry(secondCharm!), accessToken);
    assert.equal(duplicate.status, 400);
    step(`bag rejects a second copy: "${duplicate.body.error}"`);

    const notTalisman = await call<{ error: string }>("PUT", bagEntry(dagger.id), accessToken);
    assert.equal(notTalisman.status, 400);
    step(`bag rejects a non-talisman: "${notTalisman.body.error}"`);

    const removed = await call<GeoMeResponse>("DELETE", bagEntry(charm.id), accessToken);
    assert.deepEqual(removed.body.talismanBag.inventoryIds, []);
    assert.ok(removed.body.inventory.some((entry) => entry.id === charm.id));
    const swapped = await call<GeoMeResponse>("PUT", bagEntry(secondCharm!), accessToken);
    assert.deepEqual(swapped.body.talismanBag.inventoryIds, [secondCharm]);
    step("a talisman taken out stays in the inventory; the other copy goes in");

    // Fill one page with stand-in rows (only one real talisman exists yet),
    // check a full bag refuses, then put things back for the fight below.
    const playerId = signUp.body.player.id;
    await call("DELETE", bagEntry(secondCharm!), accessToken);
    await pool.query(
        `WITH filler AS (
           INSERT INTO geo.inventory (player_id, item_id)
           SELECT $1, 'smoke-filler-' || n FROM generate_series(1, $2::int) n
           RETURNING id, item_id
         )
         INSERT INTO geo.talisman_bag (player_id, item_id, inventory_id)
         SELECT $1, item_id, id FROM filler;`,
        [playerId, GEO_TALISMAN_BAG_PAGE_SIZE],
    );
    const full = await call<{ error: string }>("PUT", bagEntry(secondCharm!), accessToken);
    assert.equal(full.status, 400);
    assert.equal(full.body.error, GEO_TALISMAN_BAG_FULL);
    step(`a full bag refuses another: "${full.body.error}"`);

    await pool.query(`DELETE FROM geo.inventory WHERE player_id = $1 AND item_id LIKE 'smoke-filler-%'`, [playerId]);
    assert.equal((await call("PUT", bagEntry(secondCharm!), accessToken)).status, 200);

    // Lunchbox
    const lunchboxPath = (slot: number) => GEO_API_PATHS.me.lunchboxSlot.replace(":slot", String(slot));
    const amountOf = (body: GeoMeResponse, itemId: string) =>
        body.inventory.filter((entry) => entry.itemId === itemId).reduce((sum, entry) => sum + entry.quantity, 0);
    await withTransaction((tx) => grantItems(tx, playerId, [{ itemId: "grilled-trout", quantity: 4 }]));

    // Camp: packing (restocking) only happens there.
    const CAMP = { latitude: 51.50713, longitude: -0.12794 };
    const AWAY = { latitude: 51.52, longitude: -0.1279 };
    const campless = await call<{ error: string }>("PUT", lunchboxPath(0), accessToken, { itemId: "grilled-trout", quantity: 1, position: CAMP });
    assert.equal(campless.status, 400);
    step(`packing with no camp set is refused: "${campless.body.error}"`);
    const camped = await call<GeoMeResponse>("PUT", GEO_API_PATHS.me.camp, accessToken, { position: CAMP });
    assert.equal(camped.status, 200, JSON.stringify(camped.body));
    assert.deepEqual(camped.body.camp?.position, { latitude: 51.5071, longitude: -0.1279 }, "stored rounded");
    step("camp set, stored rounded to 4 decimals");
    const campMoved = await call<{ error: string }>("PUT", GEO_API_PATHS.me.camp, accessToken, { position: AWAY });
    assert.equal(campMoved.status, 400);
    step(`moving camp again within GEO_CAMP_MOVE_DAYS is refused: "${campMoved.body.error}"`);
    const away = await call<{ error: string }>("PUT", lunchboxPath(0), accessToken, { itemId: "grilled-trout", quantity: 1, position: AWAY });
    assert.equal(away.status, 400);
    step(`packing away from camp is refused: "${away.body.error}"`);

    for (const [why, slot, body] of [
        ["a non-food", 0, { itemId: "bronze-dagger", quantity: 1, position: CAMP }],
        ["a locked slot", 1, { itemId: "grilled-trout", quantity: 1, position: CAMP }],
        ["more than a slot holds", 0, { itemId: "grilled-trout", quantity: GEO_LUNCHBOX_STACK_SIZE + 1, position: CAMP }],
        ["more than you have", 0, { itemId: "grilled-trout", quantity: 5, position: CAMP }],
    ] as const) {
        const refused = await call<{ error: string }>("PUT", lunchboxPath(slot), accessToken, body);
        assert.equal(refused.status, 400, why);
        step(`packing ${why} is refused: "${refused.body.error}"`);
    }

    const packed = await call<GeoMeResponse>("PUT", lunchboxPath(0), accessToken, { itemId: "grilled-trout", quantity: 3, position: CAMP });
    assert.equal(packed.status, 200, JSON.stringify(packed.body));
    assert.deepEqual(packed.body.lunchbox.contents, [{ slot: 0, itemId: "grilled-trout", quantity: 3 }]);
    assert.equal(amountOf(packed.body, "grilled-trout"), 1);
    assert.equal(amountOf(packed.body, "bread"), 5);
    step("packing 3 trout leaves 1 in the inventory, and the bread it replaced comes back");

    await pool.query(`UPDATE geo.players SET lunchbox_slots = 2 WHERE id = $1`, [playerId]);
    const twice = await call<{ error: string }>("PUT", lunchboxPath(1), accessToken, { itemId: "grilled-trout", quantity: 1, position: CAMP });
    assert.equal(twice.status, 400);
    step(`with a second slot, the same food can't go in both: "${twice.body.error}"`);
    const second = await call<GeoMeResponse>("PUT", lunchboxPath(1), accessToken, { itemId: "bread", quantity: 2, position: CAMP });
    assert.equal(second.status, 200, JSON.stringify(second.body));
    assert.equal(amountOf(second.body, "bread"), 3);
    step("2 bread go in the second slot");

    // A whole Run
    const started = await call<GeoRunResponse>("POST", GEO_API_PATHS.runs.start, accessToken, { kind: "combat", enemyId: "spider" });
    assert.equal(started.status, 201);
    const runId = started.body.run.id;
    step(`run started; round 1 order: ${started.body.run.order.join(" → ")}`);

    assert.equal((await call("POST", GEO_API_PATHS.runs.start, accessToken, { kind: "combat", enemyId: "spider" })).status, 400);
    step("a second run at once is refused");

    const midRunHand = await call<{ error: string }>("PUT", GEO_API_PATHS.me.hand.replace(":skill", "combat"), accessToken, { inventoryIds: [] });
    assert.equal(midRunHand.status, 400);
    step(`changing the combat hand mid-Run is refused: "${midRunHand.body.error}"`);

    // Even an item free to list (not worn, bagged or in a hand) waits until the fight is over.
    const midRunMe = (await call<GeoMeResponse>("GET", GEO_API_PATHS.me.root, accessToken)).body;
    const inUse = new Set([
        ...Object.values(midRunMe.hands).flat(),
        ...Object.values(midRunMe.equipment),
        ...midRunMe.talismanBag.inventoryIds,
    ]);
    const spare = midRunMe.inventory.find((entry) => !inUse.has(entry.id));
    assert.ok(spare, "a free item to try listing");
    const midRunListing = await call<{ error: string }>("POST", GEO_API_PATHS.market.listings, accessToken, {
        inventoryId: spare.id,
        type: "bin",
        quantity: 1,
        price: 1_000_000,
    });
    assert.equal(midRunListing.status, 400);
    assert.match(midRunListing.body.error, /mid-Run/);
    step(`listing on the Market mid-Run is refused: "${midRunListing.body.error}"`);

    const midRunPack = await call<{ error: string }>("DELETE", lunchboxPath(1), accessToken);
    assert.equal(midRunPack.status, 400);
    step(`repacking the lunchbox mid-Run is refused: "${midRunPack.body.error}"`);

    assert.deepEqual(started.body.run.lunchbox, [
        { slot: 0, itemId: "grilled-trout", quantity: 3 },
        { slot: 1, itemId: "bread", quantity: 2 },
    ]);
    const ate = await call<GeoRunResponse>("POST", GEO_API_PATHS.runs.turns.replace(":runId", runId), accessToken, { lunchboxSlot: 0 });
    assert.equal(ate.status, 200, JSON.stringify(ate.body));
    assert.ok(ate.body.log.some((e) => e.type === "foodEaten" && e.foodId === "grilled-trout"));
    assert.equal(ate.body.run.lunchbox[0]?.quantity, 2);
    const ateMe = (await call<GeoMeResponse>("GET", GEO_API_PATHS.me.root, accessToken)).body;
    assert.equal(ateMe.lunchbox.contents[0]?.quantity, 2);
    step("ate a trout mid-fight: the turn passed, and 2 are left, in the Run and saved");

    // Food gone from the stored lunchbox (as if tampered with) can't be eaten
    // from the fight's copy: refused, and the Run's health and food unchanged.
    const ghostSlot = (await pool.query(`DELETE FROM geo.lunchbox WHERE player_id = $1 AND slot = 1 RETURNING *`, [playerId])).rows[0];
    const beforeGhost = (await call<GeoRunResponse>("GET", GEO_API_PATHS.runs.active, accessToken)).body.run;
    const ghostMeal = await call<{ error: string }>("POST", GEO_API_PATHS.runs.turns.replace(":runId", runId), accessToken, { lunchboxSlot: 1 });
    assert.equal(ghostMeal.status, 400);
    const afterGhost = (await call<GeoRunResponse>("GET", GEO_API_PATHS.runs.active, accessToken)).body.run;
    assert.deepEqual(afterGhost.combatants, beforeGhost.combatants, "no heal, no turn");
    assert.deepEqual(afterGhost.lunchbox, beforeGhost.lunchbox, "the fight's lunchbox is untouched");
    await pool.query(`INSERT INTO geo.lunchbox (player_id, slot, item_id, quantity) VALUES ($1, $2, $3, $4)`, [
        playerId,
        ghostSlot.slot,
        ghostSlot.item_id,
        ghostSlot.quantity,
    ]);
    step(`food gone from the lunchbox can't be eaten from the fight's copy: "${ghostMeal.body.error}"`);

    const badSlot = await call("POST", GEO_API_PATHS.runs.turns.replace(":runId", runId), accessToken, { lunchboxSlot: 3 });
    assert.equal(badSlot.status, 400);
    step("eating from an empty slot is refused");

    // A card that has left the inventory (as if sold) can't be played on from
    // the fight's copy of the hand: the turn is refused and nothing is saved.
    const goneCard = started.body.run.hand[0]!;
    const [goneRow] = (await pool.query(`DELETE FROM geo.inventory WHERE id = $1 RETURNING *`, [goneCard.inventoryId])).rows;
    const ghostTurn = await call<{ error: string }>("POST", GEO_API_PATHS.runs.turns.replace(":runId", runId), accessToken, { inventoryId: goneCard.inventoryId });
    assert.equal(ghostTurn.status, 400);
    const unchanged = (await call<GeoRunResponse>("GET", GEO_API_PATHS.runs.active, accessToken)).body.run;
    assert.deepEqual(unchanged.hand, started.body.run.hand, "the refused turn saved nothing");
    await pool.query(
        `INSERT INTO geo.inventory (id, player_id, item_id, quantity, charges_left, obtained_at) VALUES ($1, $2, $3, $4, $5, $6)`,
        [goneRow.id, goneRow.player_id, goneRow.item_id, goneRow.quantity, goneRow.charges_left, goneRow.obtained_at],
    );
    step(`a card gone from the inventory can't be played from the fight: "${ghostTurn.body.error}"`);

    let run = ate.body.run;
    let turns = 0;
    const procs = new Set<string>();
    while (run.status === "active" && turns < 30) {
        const card = run.hand.find((c) => c.cardId === "double-slash" && c.chargesLeft > 0) ?? run.hand.find((c) => c.chargesLeft > 0);
        assert.ok(card, "a playable card");
        const turn = await call<GeoRunResponse>("POST", GEO_API_PATHS.runs.turns.replace(":runId", runId), accessToken, { inventoryId: card.inventoryId });
        assert.equal(turn.status, 200, JSON.stringify(turn.body));
        for (const entry of turn.body.log) if (entry.type === "proc") procs.add(entry.effectId);
        run = turn.body.run;
        turns += 1;
    }
    step(`run ended "${run.status}" after ${turns} turns; effects that fired: ${[...procs].join(", ") || "none"}`);

    if (run.status === "victory") {
        assert.ok(run.rewards && run.rewards.xp[0]?.amount === 40);
        const after = await call<GeoMeResponse>("GET", GEO_API_PATHS.me.root, accessToken);
        assert.equal(after.body.skillXp.combat, 40);
        assert.ok(after.body.inventory.some((i) => i.itemId === "spider-fang"));
        const doubleSlashAfter = after.body.inventory.find((i) => i.itemId === "card.double-slash");
        assert.ok(run.rewards.coins >= 1 && run.rewards.coins <= 3, `${run.rewards.coins} coins`);
        assert.equal(after.body.player.coins, run.rewards.coins);
        step(`rewards saved: ${run.rewards.items.map((i) => i.itemId).join(", ")}, ${run.rewards.coins} coins, 40 combat XP; Double Slash charges ${doubleSlashAfter?.chargesLeft}/60`);
    }

    // Health carries out of a fight and into the next.
    {
        const you = run.combatants.find((c) => c.side === "player")!;
        const carried = (await call<GeoMeResponse>("GET", GEO_API_PATHS.me.root, accessToken)).body.health;
        assert.equal(carried.current, Math.min(you.health, carried.max));
        // The enemy may strike before the first decision, so: no more than that.
        await pool.query(`UPDATE geo.players SET health = 37 WHERE id = $1`, [playerId]);
        const next = await call<GeoRunResponse>("POST", GEO_API_PATHS.runs.start, accessToken, { kind: "combat", enemyId: "spider" });
        assert.equal(next.status, 201, JSON.stringify(next.body));
        const startedAt = next.body.run.combatants.find((c) => c.side === "player")!.health;
        assert.ok(startedAt <= 37, `started at ${startedAt}`);
        await call("POST", GEO_API_PATHS.runs.flee.replace(":runId", next.body.run.id), accessToken);
        assert.equal((await call<GeoMeResponse>("GET", GEO_API_PATHS.me.root, accessToken)).body.health.current, startedAt);
        step(`the fight left ${carried.current}/${carried.max} health; one started at 37 began at ${startedAt} and fleeing kept it`);
    }

    // Defeat costs every coin. Rig a fight to lose: 1 health against a
    // spider that can't die, with coins in the purse first.
    {
        await pool.query(`UPDATE geo.players SET coins = coins + 50 WHERE id = $1`, [signUp.body.player.id]);
        const before = (await call<GeoMeResponse>("GET", GEO_API_PATHS.me.root, accessToken)).body.player.coins;
        const doomed = await call<GeoRunResponse>("POST", GEO_API_PATHS.runs.start, accessToken, { kind: "combat", enemyId: "spider" });
        assert.equal(doomed.status, 201, JSON.stringify(doomed.body));
        await pool.query(
            `UPDATE geo.runs SET state = jsonb_set(state, '{combatants}', (
               SELECT jsonb_agg(CASE WHEN c->>'side' = 'player' THEN jsonb_set(c, '{health}', '1')
                                     ELSE jsonb_set(c, '{health}', '9999') END)
               FROM jsonb_array_elements(state->'combatants') c))
             WHERE id = $1`,
            [doomed.body.run.id],
        );
        let lost = doomed.body.run;
        for (let i = 0; i < 10 && lost.status === "active"; i++) {
            const card = lost.hand.find((c) => c.chargesLeft > 0)!;
            lost = (await call<GeoRunResponse>("POST", GEO_API_PATHS.runs.turns.replace(":runId", lost.id), accessToken, { inventoryId: card.inventoryId })).body.run;
        }
        assert.equal(lost.status, "defeat");
        assert.equal(lost.coinsLost, before);
        assert.equal((await call<GeoMeResponse>("GET", GEO_API_PATHS.me.root, accessToken)).body.player.coins, 0);
        const { rows: ledger } = await pool.query<{ delta: string; reason: string }>(
            `SELECT delta, reason FROM geo.coin_ledger WHERE player_id = $1 ORDER BY id`,
            [signUp.body.player.id],
        );
        assert.ok(ledger.some((row) => row.reason === "run-defeat" && Number(row.delta) === -before));
        step(`defeat took all ${before} coins, and the ledger says so`);

        // Health carries out of the fight: a defeat leaves a tenth of max.
        // Packed food heals between fights, anywhere. There is no resting.
        const beatenMe = (await call<GeoMeResponse>("GET", GEO_API_PATHS.me.root, accessToken)).body;
        const beaten = beatenMe.health;
        assert.equal(beaten.current, Math.ceil(beaten.max / 10));
        step(`defeat left ${beaten.current}/${beaten.max} health`);
        const trout = beatenMe.lunchbox.contents.find((entry) => entry.slot === 0)!;
        const eatPath = GEO_API_PATHS.me.eatLunchbox.replace(":slot", "0");
        const snack = await call<GeoMeResponse>("POST", eatPath, accessToken);
        assert.equal(snack.status, 200, JSON.stringify(snack.body));
        assert.ok(snack.body.health.current > beaten.current, "the food healed");
        assert.equal(snack.body.lunchbox.contents.find((entry) => entry.slot === 0)?.quantity ?? 0, trout.quantity - 1);
        const emptySlot = await call<{ error: string }>("POST", GEO_API_PATHS.me.eatLunchbox.replace(":slot", "3"), accessToken);
        assert.equal(emptySlot.status, 400);
        step(`eating packed trout between fights healed to ${snack.body.health.current}; an empty slot is refused`);
    }

    // The admin kill: all coins go, and a Run in progress ends as a defeat.
    {
        await pool.query(`UPDATE geo.players SET coins = coins + 30 WHERE id = $1`, [signUp.body.player.id]);
        const fight = await call<GeoRunResponse>("POST", GEO_API_PATHS.runs.start, accessToken, { kind: "combat", enemyId: "spider" });
        assert.equal(fight.status, 201, JSON.stringify(fight.body));
        const killed = await call<GeoDeathResponse>("POST", GEO_API_PATHS.dev.kill, accessToken);
        assert.equal(killed.status, 200, JSON.stringify(killed.body));
        assert.deepEqual(killed.body, { cause: "admin-kill", coinsLost: 30 });
        assert.equal((await call<GeoMeResponse>("GET", GEO_API_PATHS.me.root, accessToken)).body.player.coins, 0);
        assert.equal((await call("GET", GEO_API_PATHS.runs.active, accessToken)).body, null);
        const { rows: ledger } = await pool.query<{ delta: string; reason: string }>(
            `SELECT delta, reason FROM geo.coin_ledger WHERE player_id = $1 ORDER BY id DESC LIMIT 1`,
            [signUp.body.player.id],
        );
        assert.deepEqual(ledger[0], { delta: "-30", reason: "admin-kill" });
        step("admin kill took all 30 coins and ended the fight as a defeat");
    }

    const unpacked = await call<GeoMeResponse>("DELETE", lunchboxPath(1), accessToken);
    assert.equal(unpacked.status, 200);
    assert.deepEqual(unpacked.body.lunchbox.contents.map((entry) => entry.slot), [0]);
    assert.equal(amountOf(unpacked.body, "bread"), 5);
    step("after the fight, unpacking the bread puts it back in the inventory");

    const late = await call("POST", GEO_API_PATHS.runs.turns.replace(":runId", runId), accessToken, { inventoryId: run.hand[0]!.inventoryId });
    assert.equal(late.status, 400);
    step("playing into a finished run is refused");

    // Bait: packed like the lunchbox, but only bait goes in.
    const baitPath = (slot: number) => GEO_API_PATHS.me.baitSlot.replace(":slot", String(slot));
    await withTransaction((tx) => grantItems(tx, playerId, [{ itemId: "worm-bait", quantity: 30 }]));
    for (const [why, slot, body] of [
        ["food", 0, { itemId: "bread", quantity: 1, position: CAMP }],
        ["a locked slot", 1, { itemId: "worm-bait", quantity: 1, position: CAMP }],
        ["more than a slot holds", 0, { itemId: "worm-bait", quantity: GEO_BAIT_STACK_SIZE + 1, position: CAMP }],
    ] as const) {
        const refused = await call<{ error: string }>("PUT", baitPath(slot), accessToken, body);
        assert.equal(refused.status, 400, why);
        step(`packing ${why} as bait is refused: "${refused.body.error}"`);
    }
    const baited = await call<GeoMeResponse>("PUT", baitPath(0), accessToken, { itemId: "worm-bait", quantity: GEO_BAIT_STACK_SIZE, position: CAMP });
    assert.equal(baited.status, 200, JSON.stringify(baited.body));
    assert.deepEqual(baited.body.bait, { slots: 1, contents: [{ slot: 0, itemId: "worm-bait", quantity: GEO_BAIT_STACK_SIZE }] });
    // The starter worms were packed already: packing over them puts them back first.
    const starterWorms = STARTER_KIT.bait.reduce((sum, entry) => sum + (entry.itemId === "worm-bait" ? entry.quantity : 0), 0);
    assert.equal(amountOf(baited.body, "worm-bait"), 30 + starterWorms - GEO_BAIT_STACK_SIZE);
    const unbaited = await call<GeoMeResponse>("DELETE", baitPath(0), accessToken);
    assert.deepEqual(unbaited.body.bait.contents, []);
    assert.equal(amountOf(unbaited.body, "worm-bait"), 30 + starterWorms);
    step("worm bait packs into the bait slot and unpacks back to the inventory");

    // Saved hands
    const saved = await call<GeoMeResponse>("POST", GEO_API_PATHS.me.savedHands, accessToken, { skill: "combat", name: "Starter" });
    assert.equal(saved.status, 201);
    const savedHand = saved.body.savedHands[0]!;
    await call("PUT", GEO_API_PATHS.me.hand.replace(":skill", "combat"), accessToken, { inventoryIds: [] });
    const loaded = await call<GeoMeResponse>("POST", GEO_API_PATHS.me.loadSavedHand.replace(":savedHandId", savedHand.id), accessToken);
    assert.equal(loaded.body.hands.combat?.length, 2);
    step("saved a hand, emptied it, loaded it back");

    // World spawns and reach
    const here = { latitude: 32.7894, longitude: -96.8016 };
    const worldAt = (point: { latitude: number; longitude: number }) =>
        call<GeoWorldResponse>("GET", `${GEO_API_PATHS.world}?latitude=${point.latitude}&longitude=${point.longitude}`, accessToken);

    const world = await worldAt(here);
    assert.equal(world.status, 200);
    const spawns = world.body.spawns;
    assert.equal(spawns.length, 1, "they arrive one at a time, not the whole count at once");
    for (const spawn of spawns) assert.ok(distanceMetres(here, spawn) <= SPAWN_RULES.maxSpawnMetres + 1, "placed around the player");
    step(`world placed ${spawns.length} spawns within ${SPAWN_RULES.maxSpawnMetres} m (reach ${world.body.reachMetres} m)`);

    const ids = (list: { id: string }[]) => list.map((spawn) => spawn.id).sort();
    assert.deepEqual(ids((await worldAt(here)).body.spawns), ids(spawns));
    step("asking again gives the same spawns");

    const target = spawns[0]!;
    const far = { latitude: target.latitude + 0.01, longitude: target.longitude };
    const tooFar = await call<{ error: string }>("POST", GEO_API_PATHS.runs.start, accessToken, { kind: "combat", spawnId: target.id, position: far });
    assert.equal(tooFar.status, 400);
    step(`a spawn 1 km away is refused: "${tooFar.body.error}"`);

    for (const fakeId of ["1:2:3:0", "00000000-0000-4000-8000-000000000000"]) {
        const fake = await call("POST", GEO_API_PATHS.runs.start, accessToken, { kind: "combat", spawnId: fakeId, position: here });
        assert.equal(fake.status, 400);
    }
    step("made-up spawn ids are refused");

    const near = { latitude: target.latitude, longitude: target.longitude };
    let fight = await call<GeoRunResponse>("POST", GEO_API_PATHS.runs.start, accessToken, { kind: "combat", spawnId: target.id, position: near });
    assert.equal(fight.status, 201, JSON.stringify(fight.body));
    while (fight.body.run.status === "active") {
        const card = fight.body.run.hand.find((c) => c.chargesLeft > 0)!;
        fight = await call<GeoRunResponse>("POST", GEO_API_PATHS.runs.turns.replace(":runId", fight.body.run.id), accessToken, { inventoryId: card.inventoryId });
    }
    if (fight.body.run.status === "victory") {
        const again = (await worldAt(here)).body.spawns;
        assert.ok(!again.some((spawn) => spawn.id === target.id));
        assert.equal(again.length, spawns.length - 1, "a beaten spawn keeps its slot, so none replaces it yet");
        step("beat a spawn; it's gone, and nothing replaces it straight away");
    } else {
        step(`spawn fight ended "${fight.body.run.status}"`);
    }

    const elsewhere = { latitude: here.latitude + 0.01, longitude: here.longitude };
    const stillThere = (await worldAt(elsewhere)).body.spawns;
    const left = stillThere.filter((spawn) => spawns.some((old) => old.id === spawn.id));
    // Every unbeaten one lingers; with a single spawn rolled, there may be none.
    const unbeaten = spawns.filter((spawn) => spawn.id !== target.id || fight.body.run.status !== "victory");
    assert.equal(left.length, unbeaten.length, "walked-away spawns linger");
    for (const spawn of left) {
        const secondsLeft = (new Date(spawn.despawnsAt).getTime() - Date.now()) / 1000;
        assert.ok(secondsLeft > 30 && secondsLeft <= SPAWN_RULES.outOfReachSeconds, `${secondsLeft}s left`);
    }
    step(`walked 1 km: ${left.length} old spawn(s) linger, each despawning within ${SPAWN_RULES.outOfReachSeconds}s`);

    // Run the clock forward rather than wait.
    await pool.query(
        `UPDATE geo.spawns SET out_of_reach_since = now() - interval '46 seconds' WHERE player_id = $1 AND out_of_reach_since IS NOT NULL`,
        [playerId],
    );
    const moved = (await worldAt(elsewhere)).body.spawns;
    assert.ok(!moved.some((spawn) => spawns.some((old) => old.id === spawn.id)), "gone after the countdown");
    for (const spawn of moved) assert.ok(distanceMetres(elsewhere, spawn) <= SPAWN_RULES.maxSpawnMetres + 1);
    step(`${SPAWN_RULES.outOfReachSeconds}s later they're gone, and ${moved.length} new appear in reach`);

    // Refresh rotation and reuse detection
    const refreshed = await call<GeoSession>("POST", GEO_API_PATHS.auth.refresh, undefined, { refreshToken });
    assert.equal(refreshed.status, 200);
    assert.notEqual(refreshed.body.refreshToken, refreshToken);
    step("refresh issues a new pair");

    assert.equal((await call("POST", GEO_API_PATHS.auth.refresh, undefined, { refreshToken })).status, 401);
    assert.equal((await call("POST", GEO_API_PATHS.auth.refresh, undefined, { refreshToken: refreshed.body.refreshToken })).status, 401);
    step("reusing an old refresh token ends every session");

    const content = await call<{ items: unknown[] }>("GET", GEO_API_PATHS.content);
    assert.equal(content.status, 200);
    step(`content lists ${content.body.items.length} items`);

    console.log("\nAll geo smoke checks passed.");
} finally {
    await stop();
}

import assert from "node:assert/strict";
import { GEO_API_PATHS, type GeoDeathResponse, type GeoMeResponse } from "@geo/shared";
import { startSmokeServer, step } from "./smoke-kit";

/**
 * End-to-end check of the bank at camp against the local database: it needs
 * a camp and the player standing at it, moves only coins that are there,
 * keeps them through a death, and leaves the purse matching the ledger.
 * `npm run smoke:geo-bank`.
 */
const { call, registerPlayer, sql, coins, stop } = await startSmokeServer();

// Already on camp's 4-decimal grid, so camp is stored exactly here.
const AT_CAMP = { latitude: 51.5007, longitude: -0.1246 };
const FAR_AWAY = { latitude: 51.51, longitude: -0.1246 };

try {
    const { accessToken, player } = await registerPlayer("bank");
    const me = async () => (await call<GeoMeResponse>("GET", GEO_API_PATHS.me.root, accessToken)).body.player;
    const deposit = (amount: unknown, position = AT_CAMP) =>
        call<{ error: string }>("POST", GEO_API_PATHS.me.bankDeposit, accessToken, { amount, position });
    const withdraw = (amount: unknown, position = AT_CAMP) =>
        call<{ error: string }>("POST", GEO_API_PATHS.me.bankWithdraw, accessToken, { amount, position });

    const startCoins = (await me()).coins;
    await coins(player.id, 100);
    assert.equal((await me()).bankCoins, 0);
    step("a new player's bank is empty");

    const noCamp = await deposit(10);
    assert.equal(noCamp.status, 400);
    assert.match(noCamp.body.error, /Set a camp first/);
    step("no camp: refused");

    assert.equal((await call("PUT", GEO_API_PATHS.me.camp, accessToken, { position: AT_CAMP })).status, 200);
    const far = await deposit(10, FAR_AWAY);
    assert.equal(far.status, 400);
    assert.match(far.body.error, /only use the bank at camp/);
    step("away from camp: refused");

    for (const bad of [0, -5, 1.5, "10"]) assert.equal((await deposit(bad)).status, 400, `amount ${bad}`);
    step("amounts that aren't whole positive coins: refused");

    const tooMuch = await deposit(startCoins + 101);
    assert.equal(tooMuch.status, 400);
    assert.match(tooMuch.body.error, /Not enough coins/);
    step("depositing more than the purse holds: refused, nothing moved");

    assert.equal((await deposit(60)).status, 200);
    let now = await me();
    assert.deepEqual([now.coins, now.bankCoins], [startCoins + 40, 60]);
    step("deposit 60: purse down 60, bank 60");

    const overdraw = await withdraw(61);
    assert.equal(overdraw.status, 400);
    assert.match(overdraw.body.error, /Not enough coins in the bank/);
    assert.equal((await withdraw(10)).status, 200);
    now = await me();
    assert.deepEqual([now.coins, now.bankCoins], [startCoins + 50, 50]);
    step("withdraw: more than banked refused; 10 comes back to the purse");

    const killed = await call<GeoDeathResponse>("POST", GEO_API_PATHS.dev.kill, accessToken);
    assert.equal(killed.status, 200, JSON.stringify(killed.body));
    assert.equal(killed.body.coinsLost, startCoins + 50);
    now = await me();
    assert.deepEqual([now.coins, now.bankCoins], [0, 50]);
    step("death takes the purse, not the bank");

    const rows = await sql<{ coins: number; ledger: number; banked: number }>(
        `SELECT p.coins,
            COALESCE((SELECT SUM(delta) FROM coin_ledger WHERE player_id = p.id), 0) AS ledger,
            COALESCE((SELECT -SUM(delta) FROM coin_ledger WHERE player_id = p.id AND reason LIKE 'bank-%'), 0) AS banked
         FROM players p WHERE p.id = ?`,
        [player.id],
    );
    const [balances] = rows;
    assert.ok(balances);
    assert.equal(Number(balances.coins), Number(balances.ledger));
    assert.equal(Number(balances.banked), 50);
    step("the purse matches the ledger, and the bank's ledger rows add up to its balance");
} finally {
    await stop();
}

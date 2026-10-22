import assert from "node:assert/strict";
import { GEO_API_PATHS, type GeoMeResponse } from "@geo/shared";
import { pool } from "../db";
import { GAME_CONFIG } from "../content";
import { withTransaction } from "../db/transaction";
import { addCoins, addSkillXp } from "../modules/player/geo-player.repository";
import { ownModifiers } from "../world/global-effects";
import { startSmokeServer, step } from "./smoke-kit";

/**
 * End-to-end check of pets against the local database: summoning, XP from
 * skills, held items, refusals while active, Kat raising the rarity, and a
 * pet keeping its XP through the Market. `npm run smoke:geo-pets`.
 */
const { call, registerPlayer, grant, stop } = await startSmokeServer();

const PET = "pet.tarantula.common";
const KAT = "kat";
const me = async (token: string) => (await call<GeoMeResponse>("GET", GEO_API_PATHS.me.root, token)).body;
const petEntry = (body: GeoMeResponse, id: string) => body.inventory.find((entry) => entry.id === id);
const count = (body: GeoMeResponse, itemId: string) =>
    body.inventory.filter((entry) => entry.itemId === itemId).reduce((sum, entry) => sum + entry.quantity, 0);
const petItemPath = (inventoryId: string) => GEO_API_PATHS.me.petItem.replace(":inventoryId", inventoryId);
const katPath = (path: string) => path.replace(":vendorId", KAT);

try {
    const session = await registerPlayer("pets");
    const token = session.accessToken;
    const playerId = (await me(token)).player.id;
    await grant(playerId, [
        { itemId: PET, quantity: 1 },
        { itemId: "silk-collar", quantity: 2 },
        { itemId: "silk-spool", quantity: 20 },
    ]);
    await withTransaction((tx) => addCoins(tx, playerId, 50_000, "admin-grant", "pets-smoke"));

    let body = await me(token);
    const petId = body.inventory.find((entry) => entry.itemId === PET)!.id;
    assert.equal(petEntry(body, petId)?.pet?.level, 1);
    assert.equal(body.activePet, null);
    step("a granted pet arrives at level 1, not active");

    let response = await call<GeoMeResponse>("PUT", GEO_API_PATHS.me.activePet, token, { inventoryId: petId });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.activePet, petId);
    const silk = body.inventory.find((entry) => entry.itemId === "silk-collar")!.id;
    response = await call("PUT", GEO_API_PATHS.me.activePet, token, { inventoryId: silk });
    assert.equal(response.status, 400, "only pets can be active");
    step("summoning a pet; nothing else can be");

    await withTransaction((tx) => addSkillXp(tx, playerId, "combat", 300));
    await withTransaction((tx) => addSkillXp(tx, playerId, "foraging", 300));
    body = await me(token);
    const share = GAME_CONFIG.pets.otherSkillShare * (GAME_CONFIG.pets.skillMultiplier.foraging ?? 1);
    assert.equal(petEntry(body, petId)?.pet?.xp, Math.floor(300 + 300 * share));
    assert.ok((petEntry(body, petId)?.pet?.level ?? 0) > 1);
    const defense = (await ownModifiers(playerId)).filter((m) => m.stat === "defense").reduce((sum, m) => sum + m.value, 0);
    assert.ok(defense > 0, "the active pet adds its defense");
    step("the active pet levels from its own skill and a share of others, and gives stats");

    response = await call<GeoMeResponse>("PUT", petItemPath(petId), token, { inventoryId: silk });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(petEntry(response.body, petId)?.pet?.heldItem, "silk-collar");
    assert.equal(count(response.body, "silk-collar"), 1);
    const xpBefore = petEntry(response.body, petId)!.pet!.xp;
    await withTransaction((tx) => addSkillXp(tx, playerId, "combat", 100));
    body = await me(token);
    assert.equal(petEntry(body, petId)!.pet!.xp, Math.floor(xpBefore + 120));
    step("a held item is used up and boosts its skill's pet XP");

    const coinsBefore = body.player.coins;
    response = await call<GeoMeResponse>("DELETE", petItemPath(petId), token);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(petEntry(response.body, petId)?.pet?.heldItem, null);
    assert.equal(count(response.body, "silk-collar"), 2);
    assert.equal(response.body.player.coins, coinsBefore - GAME_CONFIG.pets.heldItemRemovalCost.uncommon);
    step("taking a held item off costs coins and hands it back");

    response = await call("POST", katPath(GEO_API_PATHS.vendors.petUpgrade), token, { inventoryId: petId });
    assert.equal(response.status, 400, "an active pet can't be left with Kat");
    response = await call("POST", katPath(GEO_API_PATHS.vendors.sell), token, { inventoryId: petId, quantity: 1 });
    assert.equal(response.status, 400, "an active pet can't be sold");
    step("an active pet can't be sold or upgraded");

    await call("PUT", GEO_API_PATHS.me.activePet, token, { inventoryId: null });
    body = await me(token);
    const quote = petEntry(body, petId)!.pet!.upgrade!;
    const xpAtKat = petEntry(body, petId)!.pet!.xp;
    response = await call<GeoMeResponse>("POST", katPath(GEO_API_PATHS.vendors.petUpgrade), token, { inventoryId: petId });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.petUpgrade?.inventoryId, petId);
    assert.equal(petEntry(response.body, petId), undefined, "the pet is with Kat");
    assert.equal(response.body.player.coins, body.player.coins - quote.coins);
    for (const cost of quote.items) assert.equal(count(response.body, cost.itemId), count(body, cost.itemId) - cost.quantity);
    response = await call("POST", katPath(GEO_API_PATHS.vendors.collectPetUpgrade), token);
    assert.equal(response.status, 400, "not ready yet");
    step("Kat takes the pet and her price, and holds it until it's ready");

    await pool.query(`UPDATE geo.pet_upgrades SET ready_at = now() - interval '1 minute' WHERE player_id = $1`, [playerId]);
    response = await call<GeoMeResponse>("POST", katPath(GEO_API_PATHS.vendors.collectPetUpgrade), token);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    const back = petEntry(response.body, petId);
    assert.equal(back?.itemId, quote.toItemId);
    assert.equal(back?.pet?.xp, xpAtKat, "XP carries over");
    assert.equal(response.body.petUpgrade, null);
    step("collected: the same copy, one rarity higher, XP kept");

    const buyer = await registerPlayer("pets-buyer");
    const buyerId = (await me(buyer.accessToken)).player.id;
    await withTransaction((tx) => addCoins(tx, buyerId, 1_000_000, "admin-grant", "pets-smoke"));
    const listed = await call("POST", GEO_API_PATHS.market.listings, token, {
        inventoryId: petId,
        type: "bin",
        quantity: 1,
        price: 100_000,
    });
    assert.equal(listed.status, 201, JSON.stringify(listed.body));
    const { rows } = await pool.query<{ id: string }>(`SELECT id FROM geo.market_listings WHERE source_inventory_id = $1`, [petId]);
    const listingId = rows[0]!.id;
    const bought = await call<GeoMeResponse>("POST", GEO_API_PATHS.market.buy.replace(":listingId", listingId), buyer.accessToken, {
        expectedPrice: 100_000,
    });
    assert.equal(bought.status, 200, JSON.stringify(bought.body));
    const theirs = (await me(buyer.accessToken)).inventory.find((entry) => entry.itemId === quote.toItemId);
    assert.equal(theirs?.pet?.xp, xpAtKat, "the buyer gets its XP too");
    step("a pet sold on the Market keeps its XP");

    console.log("\nPets smoke test passed.");
} finally {
    await stop();
}

import assert from "node:assert/strict";
import {
    GEO_ALREADY_VOTED,
    GEO_API_PATHS,
    geoAuctionFee,
    geoBinTax,
    type GeoAdminEconomy,
    type GeoMarketResponse,
    type GeoMayorResponse,
    type GeoMeResponse,
    type GeoOwnListing,
    type GeoSocketServerMessage,
    type GeoSocketTopic,
    type GeoVendorsResponse,
} from "@geo/shared";
import { CONTENT, sellValueOf } from "../../game/src/content";
import { startSmokeServer, step } from "./smoke-kit";

/**
 * End-to-end check of the economy against the Worker: vendors, the
 * Market's escrow (listing, buying, bidding, cancelling, settling,
 * collecting), mayor elections, and the admin tools. Every coin is checked
 * against the ledger at the end. `npm run smoke:geo-economy`.
 *
 * Dev only. It ends the running election twice and puts Marlon back in office
 * at the end, so the dev server's mayor is as most tests expect.
 */
const { call, registerPlayer, grant, openSocket, sql, makeAdmin, stop } = await startSmokeServer();

/** The hint that `topic` changed, for anyone watching it. */
const changed = (topic: GeoSocketTopic) => (m: GeoSocketServerMessage): m is GeoSocketServerMessage => m.type === "changed" && m.topic === topic;

const fill = (path: string, params: Record<string, string>) =>
    Object.entries(params).reduce((result, [key, value]) => result.replace(`:${key}`, value), path);

async function me(token: string) {
    return (await call<GeoMeResponse>("GET", GEO_API_PATHS.me.root, token)).body;
}
const coinsOf = async (token: string) => (await me(token)).player.coins;
const quantityOf = async (token: string, itemId: string) =>
    (await me(token)).inventory.filter((entry) => entry.itemId === itemId).reduce((sum, entry) => sum + entry.quantity, 0);

function expectRefusal(response: { status: number; body: unknown }, status: number, text?: string) {
    assert.equal(response.status, status, JSON.stringify(response.body));
    if (text) assert.match((response.body as { error: string }).error, new RegExp(text));
    return (response.body as { error: string }).error;
}

try {
    const seller = await registerPlayer("seller");
    const buyer = await registerPlayer("buyer");
    const adminSession = await registerPlayer("admin");
    await makeAdmin(adminSession.player.id);
    const [A, B, C] = [seller.accessToken, buyer.accessToken, adminSession.accessToken];
    await grant(seller.player.id, [
        { itemId: "bones", quantity: 31 },
        { itemId: "claymore", quantity: 1 },
        { itemId: "cloth-tunic", quantity: 1 },
        { itemId: "plank-shield", quantity: 1 },
        { itemId: "card.heavy-swing", quantity: 1, chargesLeft: 37 },
    ]);
    await grant(buyer.player.id, [{ itemId: "bones", quantity: 5 }]);

    // Admin
    expectRefusal(await call("POST", fill(GEO_API_PATHS.admin.playerCoins, { playerId: B }), A, { amount: 5 }), 403);
    for (const player of [seller, buyer, adminSession]) {
        const granted = await call("POST", fill(GEO_API_PATHS.admin.playerCoins, { playerId: player.player.id }), C, {
            amount: 1_000,
            note: "smoke test",
        });
        assert.equal(granted.status, 200, JSON.stringify(granted.body));
    }
    expectRefusal(
        await call("POST", fill(GEO_API_PATHS.admin.playerCoins, { playerId: buyer.player.id }), C, { amount: -5_000 }),
        400,
    );
    assert.equal(await coinsOf(B), 1_000);
    step("admin granted 1,000 coins each; plain players can't; a take can't go below 0");

    // Vendors
    const vendors = (await call<GeoVendorsResponse>("GET", GEO_API_PATHS.vendors.list, B)).body.vendors;
    const farmer = vendors.find((vendor) => vendor.id === "farmer");
    assert.ok(farmer);
    const wheatPrice = farmer.sells.find((offer) => offer.itemId === "wheat")?.price;
    step(`the Farmer sells wheat for ${wheatPrice}`);

    const buyWheat = (quantity: number) =>
        call("POST", fill(GEO_API_PATHS.vendors.buy, { vendorId: "farmer" }), B, { itemId: "wheat", quantity });
    assert.equal((await buyWheat(10)).status, 200);
    assert.equal(await quantityOf(B, "wheat"), 10);
    assert.equal(await coinsOf(B), 1_000 - 10 * (wheatPrice ?? 0));
    expectRefusal(await buyWheat(999), 400, "Not enough coins");
    assert.equal(await quantityOf(B, "wheat"), 10, "a refused buy hands nothing over");
    step(`bought 10 wheat for ${10 * (wheatPrice ?? 0)}; a buy they can't afford takes nothing and gives nothing`);

    const wheatRow = (await me(B)).inventory.find((entry) => entry.itemId === "wheat");
    const sellTo = (inventoryId: string | undefined, quantity: number) =>
        call("POST", fill(GEO_API_PATHS.vendors.sell, { vendorId: "farmer" }), B, { inventoryId, quantity });
    const coinsBeforeSale = await coinsOf(B);
    assert.equal((await sellTo(wheatRow?.id, 4)).status, 200);
    assert.equal(await quantityOf(B, "wheat"), 6);
    assert.equal(await coinsOf(B), coinsBeforeSale + 4);
    expectRefusal(await sellTo(wheatRow?.id, 7), 400, "only have 6");
    const bones = (await me(B)).inventory.find((entry) => entry.itemId === "bones");
    const coinsBeforeBones = await coinsOf(B);
    assert.equal((await sellTo(bones?.id, 1)).status, 200, "any vendor buys anything with a sell value");
    assert.equal(await coinsOf(B), coinsBeforeBones + sellValueOf(CONTENT.items.bones as never));
    expectRefusal(await sellTo("00000000-0000-0000-0000-000000000000", 1), 404);
    step("sold 4 wheat for 4 and a bone to the Farmer; refused selling more than owned and someone else's row");

    // Market: a stack
    const sellerMe = await me(A);
    const sellerBones = sellerMe.inventory.find((entry) => entry.itemId === "bones");
    assert.ok(sellerBones);
    const bonesFloor = sellValueOf(CONTENT.items.bones as never);
    const list = (body: object, token = A) => call("POST", GEO_API_PATHS.market.listings, token, body);
    expectRefusal(
        await list({ inventoryId: sellerBones.id, type: "bin", quantity: 10, price: bonesFloor - 1 }),
        400,
        "lowest price",
    );
    expectRefusal(
        await list({ inventoryId: sellerBones.id, type: "auction", quantity: 10, startingBid: 50, hours: 6 }),
        400,
        "buy-it-now only",
    );
    // B watches over the geo socket: everyone hears when the Market changes.
    const watcher = openSocket(B);
    await watcher.next((m): m is GeoSocketServerMessage => m.type === "ready");
    watcher.drain();
    const coinsBeforeList = await coinsOf(A);
    const bonesBefore = sellerBones.quantity;
    assert.equal((await list({ inventoryId: sellerBones.id, type: "bin", quantity: 10, price: bonesFloor + 1 })).status, 201);
    assert.equal(await quantityOf(A, "bones"), bonesBefore - 10, "listed bones leave the inventory");
    assert.equal(await coinsOf(A), coinsBeforeList - geoBinTax(bonesFloor, 10), "tax paid at listing");
    await watcher.next(changed("market"));
    step(`listed 10 bones at ${bonesFloor + 1} each; they left the inventory, the ${geoBinTax(bonesFloor, 10)}-coin tax was paid, and a watcher heard`);

    const market = (await call<GeoMarketResponse>("GET", GEO_API_PATHS.market.root, B)).body;
    const offer = market.stacks.find((stack) => stack.itemId === "bones");
    assert.ok(offer?.offers.some((entry) => entry.price === bonesFloor + 1 && entry.quantity >= 10));
    const ownView = (await call<GeoMarketResponse>("GET", GEO_API_PATHS.market.root, A)).body;
    assert.ok(!ownView.stacks.find((stack) => stack.itemId === "bones")?.offers.some((entry) => entry.price === bonesFloor + 1 && entry.quantity >= 10), "you can't buy your own stack");

    const buyBones = (quantity: number, expectedTotal: number) =>
        call("POST", fill(GEO_API_PATHS.market.buyStack, { itemId: "bones" }), B, { quantity, expectedTotal });
    // Only this smoke test's offer is guaranteed: buy from it at its price.
    const cheapest = offer?.offers[0];
    assert.ok(cheapest);
    expectRefusal(await buyBones(4, cheapest.price * 4 - 1), 400, "Prices have changed");
    const buyerBonesBefore = await quantityOf(B, "bones");
    const buyerCoinsBefore = await coinsOf(B);
    assert.equal((await buyBones(4, cheapest.price * 4)).status, 200);
    assert.equal(await quantityOf(B, "bones"), buyerBonesBefore + 4);
    assert.equal(await coinsOf(B), buyerCoinsBefore - cheapest.price * 4);
    expectRefusal(await buyBones(999, 999 * 1_000_000), 400, "aren't 999");
    step("bought 4 bones, cheapest first; a stale price and more than is for sale are refused");

    // Market: an auction
    const sword = (await me(A)).inventory.find((entry) => entry.itemId === "claymore");
    assert.ok(sword);
    const swordFloor = sellValueOf(CONTENT.items["claymore"] as never);
    const coinsBeforeAuction = await coinsOf(A);
    assert.equal((await list({ inventoryId: sword.id, type: "auction", quantity: 1, startingBid: swordFloor, hours: 6 })).status, 201);
    assert.equal(await coinsOf(A), coinsBeforeAuction - geoAuctionFee(swordFloor, 6));
    assert.ok(!(await me(A)).inventory.some((entry) => entry.id === sword.id), "the sword is in escrow");
    const auction = (await call<GeoMarketResponse>("GET", GEO_API_PATHS.market.root, B)).body.listings.find(
        (listing) => listing.type === "auction" && listing.item.itemId === "claymore" && listing.seller === seller.player.displayName,
    );
    assert.ok(auction && auction.type === "auction");
    step(`auctioned the sword from ${swordFloor}; it's in escrow and the ${geoAuctionFee(swordFloor, 6)}-coin fee is paid`);

    const bid = (token: string, amount: number) =>
        call("POST", fill(GEO_API_PATHS.market.bids, { listingId: auction.id }), token, { amount });
    expectRefusal(await bid(B, swordFloor - 1), 400, "lowest bid");
    expectRefusal(await bid(A, swordFloor), 400, "own auction");
    const bBefore = await coinsOf(B);
    assert.equal((await bid(B, swordFloor)).status, 200);
    assert.equal(await coinsOf(B), bBefore - swordFloor, "a bid's coins are held");
    expectRefusal(await bid(B, swordFloor + 100), 400, "already have the highest");
    const after = (await call<GeoMarketResponse>("GET", GEO_API_PATHS.market.root, C)).body.listings.find((l) => l.id === auction.id);
    assert.ok(after && after.type === "auction");
    const cBefore = await coinsOf(C);
    assert.equal((await bid(C, after.minBid)).status, 200);
    assert.equal(await coinsOf(B), bBefore, "outbid: B's coins came back");
    assert.equal(await coinsOf(C), cBefore - after.minBid);
    const held = (await call<GeoMarketResponse>("GET", GEO_API_PATHS.market.root, C)).body.heldCoins;
    assert.ok(held >= after.minBid);
    expectRefusal(await call("POST", fill(GEO_API_PATHS.market.cancel, { listingId: auction.id }), A), 400, "can't be cancelled");
    step(`B bid ${swordFloor}, C outbid at ${after.minBid} and B got their coins back; a bid auction can't be cancelled`);

    // The anti-snipe rule: a bid in the last 10 minutes pushes the end out.
    await sql(`UPDATE market_listings SET ends_at = ? WHERE id = ?`, [Date.now() + 2 * 60_000, auction.id]);
    const third = (await call<GeoMarketResponse>("GET", GEO_API_PATHS.market.root, B)).body.listings.find((l) => l.id === auction.id);
    assert.ok(third && third.type === "auction");
    assert.equal((await bid(B, third.minBid)).status, 200);
    const extended = (await call<GeoMarketResponse>("GET", GEO_API_PATHS.market.root, B)).body.listings.find((l) => l.id === auction.id);
    assert.ok(extended && extended.type === "auction");
    assert.ok(new Date(extended.endsAt).getTime() > Date.now() + 9 * 60_000, "end pushed to 10 minutes after the bid");
    assert.equal(extended.youLead, true);
    step("a bid with 2 minutes left pushed the end to 10 minutes after it");

    // Settle: time's up, B wins.
    await sql(`UPDATE market_listings SET ends_at = ? WHERE id = ?`, [Date.now() - 1000, auction.id]);
    const own = (await call<GeoOwnListing[]>("GET", GEO_API_PATHS.market.mine, A)).body;
    const sold = own.find((listing) => listing.id === auction.id);
    assert.equal(sold?.status, "sold");
    assert.equal(sold?.uncollected, third.minBid);
    assert.equal(sold?.bidHistory.length, 3);
    assert.ok((await me(B)).inventory.some((entry) => entry.itemId === "claymore"), "the winner has the sword");
    const aBeforeCollect = await coinsOf(A);
    assert.equal((await call("POST", GEO_API_PATHS.market.collectAll, A)).status, 200);
    const stackProceeds = own.filter((l) => l.id !== auction.id).reduce((sum, l) => sum + l.uncollected, 0);
    assert.equal(await coinsOf(A), aBeforeCollect + third.minBid + stackProceeds);
    const collected = (await call<GeoOwnListing[]>("GET", GEO_API_PATHS.market.mine, A)).body;
    assert.ok(!collected.some((listing) => listing.id === auction.id), "a collected listing leaves the list");
    step(`the auction settled: B has the sword, A collected ${third.minBid} (+${stackProceeds} from bones)`);

    // Cancel: the copy comes back as it was.
    const tunic = (await me(A)).inventory.find((entry) => entry.itemId === "cloth-tunic");
    assert.ok(tunic);
    const coinsBeforeTunic = await coinsOf(A);
    assert.equal((await list({ inventoryId: tunic.id, type: "bin", quantity: 1, price: 999 })).status, 201);
    assert.equal(
        await coinsOf(A),
        coinsBeforeTunic - geoBinTax(sellValueOf(CONTENT.items["cloth-tunic"] as never), 1),
        "tax from the NPC value, not the price",
    );
    const tunicListing = (await call<GeoOwnListing[]>("GET", GEO_API_PATHS.market.mine, A)).body.find(
        (listing) => listing.item.itemId === "cloth-tunic" && listing.status === "active",
    );
    assert.ok(tunicListing);
    expectRefusal(
        await call("POST", fill(GEO_API_PATHS.market.buy, { listingId: tunicListing.id }), B, { expectedPrice: 998 }),
        400,
        "price has changed",
    );
    assert.equal((await call("POST", fill(GEO_API_PATHS.market.cancel, { listingId: tunicListing.id }), A)).status, 200);
    const back = (await me(A)).inventory.find((entry) => entry.id === tunic.id);
    assert.equal(back?.obtainedAt, tunic.obtainedAt, "same copy, same obtained date");
    step("a cancelled listing hands back the same copy (same id, same obtained date)");

    // In use: worn gear can't be listed.
    const worn = (await me(A)).equipment.mainHand;
    expectRefusal(await list({ inventoryId: worn, type: "bin", quantity: 1, price: 999 }), 400, "Unequip");
    const spent = (await me(A)).inventory.find((entry) => entry.itemId === "card.heavy-swing");
    expectRefusal(await list({ inventoryId: spent?.id, type: "bin", quantity: 1, price: 999 }), 400, "full charge");
    step("worn gear and played cards can't be listed");

    // Admin removes a listing with a bid: bidder refunded, item back to seller.
    const shield = (await me(A)).inventory.find((entry) => entry.itemId === "plank-shield");
    assert.ok(shield);
    assert.equal((await list({ inventoryId: shield.id, type: "auction", quantity: 1, startingBid: 50, hours: 6 })).status, 201);
    const shieldListing = (await call<GeoOwnListing[]>("GET", GEO_API_PATHS.market.mine, A)).body.find(
        (listing) => listing.item.itemId === "plank-shield" && listing.status === "active",
    );
    assert.ok(shieldListing);
    const cBeforeShield = await coinsOf(C);
    assert.equal((await call("POST", fill(GEO_API_PATHS.market.bids, { listingId: shieldListing.id }), C, { amount: 50 })).status, 200);
    expectRefusal(await call("POST", fill(GEO_API_PATHS.admin.removeListing, { listingId: shieldListing.id }), B), 403);
    assert.equal((await call("POST", fill(GEO_API_PATHS.admin.removeListing, { listingId: shieldListing.id }), C)).status, 204);
    assert.equal(await coinsOf(C), cBeforeShield);
    assert.ok((await me(A)).inventory.some((entry) => entry.id === shield.id));
    step("an admin took down a bid-on auction: the bid came back, and the shield went home");

    // A seller's account deleted mid-auction: the bidder's held coins come back.
    const leaver = await registerPlayer("leaver");
    await grant(leaver.player.id, [{ itemId: "cloth-tunic", quantity: 1 }]);
    await call("POST", fill(GEO_API_PATHS.admin.playerCoins, { playerId: leaver.player.id }), C, { amount: 100 });
    const leaverTunic = (await me(leaver.accessToken)).inventory.find((entry) => entry.itemId === "cloth-tunic");
    assert.ok(leaverTunic);
    assert.equal(
        (await list({ inventoryId: leaverTunic.id, type: "auction", quantity: 1, startingBid: 40, hours: 6 }, leaver.accessToken)).status,
        201,
    );
    const leaverListing = (await call<GeoOwnListing[]>("GET", GEO_API_PATHS.market.mine, leaver.accessToken)).body[0];
    assert.ok(leaverListing);
    const cBeforeLeave = await coinsOf(C);
    assert.equal((await call("POST", fill(GEO_API_PATHS.market.bids, { listingId: leaverListing.id }), C, { amount: 40 })).status, 200);
    await sql(`DELETE FROM players WHERE id = ?`, [leaver.player.id]);
    assert.equal(await coinsOf(C), cBeforeLeave, "the bid came back when the seller's account went");
    step("a seller's account deleted mid-auction: the bidder got their held coins back");

    // Ledger: every player's coins are the sum of their ledger.
    for (const player of [seller, buyer, adminSession]) {
        const rows = await sql<{ coins: number; ledger: number }>(
            `SELECT p.coins, COALESCE((SELECT SUM(delta) FROM coin_ledger WHERE player_id = p.id), 0) AS ledger
             FROM players p WHERE p.id = ?`,
            [player.player.id],
        );
        assert.equal(Number(rows[0]?.coins), Number(rows[0]?.ledger), `${player.player.displayName}'s ledger explains their coins`);
    }
    const economy = await call<GeoAdminEconomy>("GET", GEO_API_PATHS.admin.economy, C);
    assert.equal(economy.status, 200);
    assert.ok(
        !economy.body.ledgerMismatches.some((row) =>
            [seller, buyer, adminSession].some((player) => player.player.id === row.playerId),
        ),
        "the economy check finds no mismatch for these players",
    );
    step("every coin is in the ledger; the admin economy summary answers");

    // Elections
    const mayor = (await call<GeoMayorResponse>("GET", GEO_API_PATHS.mayor.root, B)).body;
    const { election } = mayor;
    assert.equal(election.candidates.length, 3);
    assert.ok(!election.candidates.some((candidate) => candidate.id === mayor.mayor.id), "the mayor in office isn't standing");
    assert.equal(election.yourVote, null);
    assert.equal(election.yourVoteWeight, 1);
    const [first, second] = election.candidates;
    assert.ok(first && second);
    const vote = (token: string, candidateId: string, electionId = election.id) =>
        call<GeoMayorResponse>("POST", fill(GEO_API_PATHS.mayor.vote, { electionId }), token, { candidateId });

    expectRefusal(await vote(B, mayor.mayor.id), 400, "isn't standing");
    watcher.drain();
    const cast = await vote(B, first.id);
    assert.equal(cast.status, 201);
    assert.deepEqual(cast.body.election.yourVote, { candidateId: first.id, weight: 1 });
    assert.equal(cast.body.election.candidates.find((c) => c.id === first.id)?.votes, first.votes + 1);
    expectRefusal(await vote(B, first.id), 409, GEO_ALREADY_VOTED);
    expectRefusal(await vote(B, second.id), 409, GEO_ALREADY_VOTED);
    await watcher.next(changed("mayor"));
    step(`B voted ${first.name} (heard over the socket); a second vote, for anyone, is refused`);

    // A vote worth 2: what a vote-weight talisman would do.
    await sql(`UPDATE election_votes SET weight = 2 WHERE election_id = ? AND player_id = ?`, [
        election.id,
        buyer.player.id,
    ]);
    assert.equal((await vote(A, second.id)).status, 201);
    assert.equal((await vote(C, second.id)).status, 201);
    const tallied = (await call<GeoMayorResponse>("GET", GEO_API_PATHS.mayor.root, B)).body.election;
    const firstVotes = tallied.candidates.find((c) => c.id === first.id)?.votes ?? 0;
    const secondVotes = tallied.candidates.find((c) => c.id === second.id)?.votes ?? 0;
    const winnerId = firstVotes > secondVotes ? first.id : second.id;

    expectRefusal(await call("POST", GEO_API_PATHS.admin.endElection, B), 403);
    // The World's clock may be a little off this machine's.
    const since = Date.now() - 60_000;
    const ended = await call<GeoMayorResponse>("POST", GEO_API_PATHS.admin.endElection, C);
    assert.equal(ended.status, 200);
    const sameTotals = firstVotes === secondVotes;
    if (!sameTotals) assert.equal(ended.body.mayor.id, winnerId, "most votes won");
    assert.notEqual(ended.body.election.id, election.id, "a new election opened");
    assert.ok(!ended.body.election.candidates.some((c) => c.id === ended.body.mayor.id));
    expectRefusal(await vote(A, first.id), 400, "closed");
    step(`the election closed: ${ended.body.mayor.name} took office (${firstVotes} v ${secondVotes}); a new one opened`);

    const announced = await sql<{ title: string }>(`SELECT title FROM announcements WHERE kind = 'mayor' AND created_at >= ?`, [since]);
    assert.ok(announced.some((row) => row.title.startsWith(ended.body.mayor.name)), JSON.stringify(announced));
    step("every inbox is told who won");

    // Put Marlon back in office for the dev server.
    if (ended.body.mayor.id !== "marlon") {
        // Candidates are a random few, so close elections until Marlon stands
        // (or a vote-less one happens to put him in office).
        let state = ended.body;
        for (let tries = 0; state.mayor.id !== "marlon" && !state.election.candidates.some((c) => c.id === "marlon"); tries++) {
            assert.ok(tries < 20, "Marlon never stood");
            state = (await call<GeoMayorResponse>("POST", GEO_API_PATHS.admin.endElection, C)).body;
        }
        if (state.mayor.id !== "marlon") {
            const restorer = await registerPlayer("restore");
            assert.equal((await vote(restorer.accessToken, "marlon", state.election.id)).status, 201);
            const restored = await call<GeoMayorResponse>("POST", GEO_API_PATHS.admin.endElection, C);
            assert.equal(restored.body.mayor.id, "marlon");
        }
    }
    // The test's elections aren't news: their announcements go too.
    await sql(`DELETE FROM announcements WHERE kind = 'mayor' AND created_at >= ?`, [since]);
    step("Marlon is back in office for the dev server");

    console.log("\nAll geo economy smoke checks passed.");
} finally {
    await stop();
}

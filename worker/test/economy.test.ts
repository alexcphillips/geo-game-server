import { describe, expect, it } from "vitest";
import {
    GEO_ANTI_SNIPE_MS,
    GEO_API_PATHS,
    geoBinTax,
    type GeoMarketResponse,
    type GeoMeResponse,
    type GeoOwnListing,
    type GeoVendorsResponse,
} from "@geo/shared";
import { CONTENT, sellValueOf } from "../../server/src/content";
import { runDueJobs } from "../src/jobs";
import { dueAt } from "../src/modules/jobs/jobs.repository";
import { amountOf, call, giveCoins, grant, inWorld, newPlayer, path, rowsWrittenBy } from "./helpers";

/** Vendors, crafting and the Market end to end in workerd: ported from server/src/dev/geo-economy-smoke.ts and friends. */

const vendors = GEO_API_PATHS.vendors;
const market = GEO_API_PATHS.market;

/** The coins on the ledger match the purse. */
const ledgerMatches = (playerId: string) =>
    inWorld((db) => {
        const purse = db.one<{ coins: number }>(`SELECT coins FROM players WHERE id = ?;`, playerId)!.coins;
        const ledger = db.one<{ total: number }>(`SELECT coalesce(sum(delta), 0) AS total FROM coin_ledger WHERE player_id = ?;`, playerId)!.total;
        return purse === ledger;
    });

describe("vendors", () => {
    it("lists prices, sells for coins, buys back at the sell value, and refuses what it doesn't sell", async () => {
        const { token, id, me } = await newPlayer("shopper");
        const list = await call<GeoVendorsResponse>("GET", vendors.list, token);
        const angler = list.body.vendors.find((vendor) => vendor.id === "angler")!;
        const worm = angler.sells.find((offer) => offer.itemId === "worm-bait")!;

        const before = (await me()).player.coins;
        await giveCoins(id, 100 - before);
        const bought = await call<GeoMeResponse>("POST", path(vendors.buy, { vendorId: "angler" }), token, { itemId: "worm-bait", quantity: 5 });
        expect(bought.status, JSON.stringify(bought.body)).toBe(200);
        expect(bought.body.player.coins).toBe(100 - worm.price * 5);
        expect(amountOf(bought.body, "worm-bait")).toBeGreaterThanOrEqual(5);

        expect((await call("POST", path(vendors.buy, { vendorId: "angler" }), token, { itemId: "bread", quantity: 1 })).status).toBe(400);
        expect((await call("POST", path(vendors.buy, { vendorId: "nobody" }), token, { itemId: "bread", quantity: 1 })).status).toBe(404);

        const [bones] = await grant(id, "bones", 3);
        const sold = await call<GeoMeResponse>("POST", path(vendors.sell, { vendorId: "angler" }), token, { inventoryId: bones, quantity: 3 });
        expect(sold.status, JSON.stringify(sold.body)).toBe(200);
        expect(sold.body.player.coins).toBe(100 - worm.price * 5 + sellValueOf(CONTENT.items.bones!) * 3);
        expect(await ledgerMatches(id)).toBe(true);
    });

    it("rerolls a reforge for its price, never to the one it had", async () => {
        const { token, id } = await newPlayer("smith");
        const [dagger] = await grant(id, "bronze-dagger");
        await giveCoins(id, 10_000);
        const first = await call<GeoMeResponse>("POST", path(vendors.reforge, { vendorId: "blacksmith" }), token, { inventoryId: dagger });
        expect(first.status, JSON.stringify(first.body)).toBe(200);
        const reforgeOf = (body: GeoMeResponse) => body.inventory.find((entry) => entry.id === dagger)!.reforge;
        const was = reforgeOf(first.body);
        expect(was).toBeTruthy();
        const second = await call<GeoMeResponse>("POST", path(vendors.reforge, { vendorId: "blacksmith" }), token, { inventoryId: dagger });
        expect(reforgeOf(second.body)).not.toBe(was);
        expect((await call("POST", path(vendors.reforge, { vendorId: "angler" }), token, { inventoryId: dagger })).status).toBe(400);
    });
});

describe("crafting", () => {
    it("takes every input and gives the output, or takes nothing when one falls short", async () => {
        const { token, id, me } = await newPlayer("crafter");
        const recipe = CONTENT.recipes["slime-grip-wraps"]!;
        const craft = path(GEO_API_PATHS.crafting.craft, { recipeId: recipe.id });
        await grant(id, "slime", 10);
        const short = await call("POST", craft, token, { quantity: 1 });
        expect(short.status).toBe(400);
        expect(amountOf(await me(), "slime")).toBe(10);

        await grant(id, "silk-spool", 4);
        const made = await call<GeoMeResponse>("POST", craft, token, { quantity: 1 });
        expect(made.status, JSON.stringify(made.body)).toBe(200);
        expect(amountOf(made.body, "slime")).toBe(0);
        expect(amountOf(made.body, "slime-grip-wraps")).toBe(1);
        expect((await call("POST", path(GEO_API_PATHS.crafting.craft, { recipeId: "nope" }), token, { quantity: 1 })).status).toBe(404);
    });
});

describe("market", () => {
    it("lists a single item, sells it buy-it-now, and pays the seller on collect", async () => {
        const seller = await newPlayer("seller");
        const buyer = await newPlayer("buyer");
        const [dagger] = await grant(seller.id, "venomfang-dagger");
        await giveCoins(seller.id, 1000);
        await giveCoins(buyer.id, 1000);

        const floor = sellValueOf(CONTENT.items["venomfang-dagger"]!);
        expect((await call("POST", market.listings, seller.token, { inventoryId: dagger, type: "bin", quantity: 1, price: floor - 1 })).status).toBe(400);
        const listed = await call<GeoMeResponse>("POST", market.listings, seller.token, { inventoryId: dagger, type: "bin", quantity: 1, price: 300 });
        expect(listed.status, JSON.stringify(listed.body)).toBe(201);
        expect(amountOf(listed.body, "venomfang-dagger")).toBe(0);

        const browse = await call<GeoMarketResponse>("GET", market.root, buyer.token);
        const listing = browse.body.listings.find((entry) => entry.item.itemId === "venomfang-dagger" && entry.seller.startsWith("seller"))!;
        expect(listing.type).toBe("bin");

        expect((await call("POST", path(market.buy, { listingId: listing.id }), buyer.token, { expectedPrice: 299 })).status).toBe(400);
        expect((await call("POST", path(market.buy, { listingId: listing.id }), seller.token, { expectedPrice: 300 })).status).toBe(400);
        const bought = await call<GeoMeResponse>("POST", path(market.buy, { listingId: listing.id }), buyer.token, { expectedPrice: 300 });
        expect(bought.status, JSON.stringify(bought.body)).toBe(200);
        expect(bought.body.player.coins).toBe(700);
        const copy = bought.body.inventory.find((entry) => entry.itemId === "venomfang-dagger")!;
        expect(copy).toBeTruthy();

        const own = await call<GeoOwnListing[]>("GET", market.mine, seller.token);
        expect(own.body.find((entry) => entry.id === listing.id)?.uncollected).toBe(300);
        const coinsBefore = (await seller.me()).player.coins;
        const collected = await call<GeoMeResponse>("POST", path(market.collect, { listingId: listing.id }), seller.token);
        expect(collected.body.player.coins).toBe(coinsBefore + 300);
        expect(await ledgerMatches(seller.id)).toBe(true);
        expect(await ledgerMatches(buyer.id)).toBe(true);
    });

    it("pools stacks and buys the cheapest first, all or nothing", async () => {
        const a = await newPlayer("stacker");
        const b = await newPlayer("stacker");
        const buyer = await newPlayer("stackbuyer");
        for (const seller of [a, b]) await giveCoins(seller.id, 1000);
        await giveCoins(buyer.id, 10_000);
        const floor = sellValueOf(CONTENT.items["shiny-shell"]!);
        const [shellsA] = await grant(a.id, "shiny-shell", 5);
        const [shellsB] = await grant(b.id, "shiny-shell", 5);
        const listA = await call<GeoMeResponse>("POST", market.listings, a.token, { inventoryId: shellsA, type: "bin", quantity: 5, price: floor + 10 });
        expect(listA.status, JSON.stringify(listA.body)).toBe(201);
        expect(listA.body.player.coins).toBe(1000 - geoBinTax(floor, 5));
        await call("POST", market.listings, b.token, { inventoryId: shellsB, type: "bin", quantity: 5, price: floor + 20 });

        const stack = (await call<GeoMarketResponse>("GET", market.root, buyer.token)).body.stacks.find((entry) => entry.itemId === "shiny-shell")!;
        expect(stack.offers.slice(0, 2)).toEqual([
            { price: floor + 10, quantity: 5 },
            { price: floor + 20, quantity: 5 },
        ]);

        const buyStack = path(market.buyStack, { itemId: "shiny-shell" });
        const cost = 5 * (floor + 10) + 2 * (floor + 20);
        expect((await call("POST", buyStack, buyer.token, { quantity: 7, expectedTotal: cost - 1 })).status).toBe(400);
        const bought = await call<GeoMeResponse>("POST", buyStack, buyer.token, { quantity: 7, expectedTotal: cost });
        expect(bought.status, JSON.stringify(bought.body)).toBe(200);
        expect(amountOf(bought.body, "shiny-shell")).toBe(7);
        expect(bought.body.player.coins).toBe(10_000 - cost);
    });

    it("holds bids, returns the outbid, stops snipes, and settles the auction when its alarm goes off", async () => {
        const seller = await newPlayer("auctioneer");
        const first = await newPlayer("bidder");
        const second = await newPlayer("bidder");
        const [dagger] = await grant(seller.id, "venomfang-dagger");
        for (const player of [seller, first, second]) await giveCoins(player.id, 5000);

        const listed = await call("POST", market.listings, seller.token, { inventoryId: dagger, type: "auction", quantity: 1, startingBid: 200, hours: 12 });
        expect(listed.status, JSON.stringify(listed.body)).toBe(201);
        const own = (await call<GeoOwnListing[]>("GET", market.mine, seller.token)).body;
        const listing = own.find((entry) => entry.item.itemId === "venomfang-dagger")!;
        const bids = path(market.bids, { listingId: listing.id });
        const key = `auction:${listing.id}`;
        expect(await inWorld((db) => dueAt(db, key))).toBe(Date.parse(listing.type === "auction" ? listing.endsAt : ""));

        expect((await call("POST", bids, first.token, { amount: 150 })).status).toBe(400);
        expect((await call("POST", bids, first.token, { amount: 200 })).status).toBe(200);
        expect((await first.me()).player.coins).toBe(4800);
        expect((await call("POST", path(market.cancel, { listingId: listing.id }), seller.token)).status).toBe(400);
        const outbid = await call<GeoMeResponse>("POST", bids, second.token, { amount: 300 });
        expect(outbid.status, JSON.stringify(outbid.body)).toBe(200);
        expect((await first.me()).player.coins).toBe(5000);

        // Ten minutes from the end, a bid pushes the end (and its alarm) out.
        const soon = Date.now() + 5 * 60_000;
        await inWorld((db) => db.run(`UPDATE market_listings SET ends_at = ? WHERE id = ?;`, soon, listing.id));
        expect((await call("POST", bids, first.token, { amount: 400 })).status).toBe(200);
        const pushed = await inWorld((db) => dueAt(db, key));
        expect(pushed).toBeGreaterThanOrEqual(Date.now() + GEO_ANTI_SNIPE_MS - 5_000);

        // The alarm settles it: the winner gets the dagger, the seller's coins wait on the listing.
        const settled = await rowsWrittenBy(() => inWorld((_db, instance) => runDueJobs(instance.state, pushed! + 1)));
        expect(settled).toBeLessThan(20);
        expect(await inWorld((db) => dueAt(db, key))).toBeNull();
        expect(amountOf(await first.me(), "venomfang-dagger")).toBe(1);
        expect((await second.me()).player.coins).toBe(5000);
        const after = (await call<GeoOwnListing[]>("GET", market.mine, seller.token)).body.find((entry) => entry.id === listing.id)!;
        expect(after.status).toBe("sold");
        expect(after.uncollected).toBe(400);
        expect(after.bidHistory.map((bid) => bid.amount)).toEqual([200, 300, 400]);
    });

    it("gives held bids back when the seller's account is deleted", async () => {
        const seller = await newPlayer("leaver");
        const bidder = await newPlayer("bidder");
        const [dagger] = await grant(seller.id, "venomfang-dagger");
        await giveCoins(seller.id, 1000);
        await giveCoins(bidder.id, 1000);
        await call("POST", market.listings, seller.token, { inventoryId: dagger, type: "auction", quantity: 1, startingBid: 200, hours: 12 });
        const listing = (await call<GeoOwnListing[]>("GET", market.mine, seller.token)).body[0]!;
        await call("POST", path(market.bids, { listingId: listing.id }), bidder.token, { amount: 250 });
        expect((await bidder.me()).player.coins).toBe(750);

        await inWorld((db) => db.run(`DELETE FROM players WHERE id = ?;`, seller.id));
        expect((await bidder.me()).player.coins).toBe(1000);
        expect(await ledgerMatches(bidder.id)).toBe(true);
    });

    it("settles an ended auction nobody bid on back to its seller on the next look", async () => {
        const seller = await newPlayer("quiet");
        const [dagger] = await grant(seller.id, "venomfang-dagger");
        await giveCoins(seller.id, 1000);
        await call("POST", market.listings, seller.token, { inventoryId: dagger, type: "auction", quantity: 1, startingBid: 200, hours: 12 });
        const listing = (await call<GeoOwnListing[]>("GET", market.mine, seller.token)).body[0]!;
        await inWorld((db) => db.run(`UPDATE market_listings SET ends_at = ? WHERE id = ?;`, Date.now() - 1000, listing.id));

        const own = (await call<GeoOwnListing[]>("GET", market.mine, seller.token)).body;
        expect(own.find((entry) => entry.id === listing.id)).toBeUndefined();
        const me = await seller.me();
        expect(me.inventory.find((entry) => entry.id === dagger)?.itemId).toBe("venomfang-dagger");
    });

    it("stays inside its write budget", async () => {
        const seller = await newPlayer("budget");
        const buyer = await newPlayer("budget");
        const [dagger] = await grant(seller.id, "venomfang-dagger");
        await giveCoins(seller.id, 1000);
        await giveCoins(buyer.id, 1000);
        const list = await rowsWrittenBy(() => call("POST", market.listings, seller.token, { inventoryId: dagger, type: "bin", quantity: 1, price: 300 }));
        const listing = (await call<GeoOwnListing[]>("GET", market.mine, seller.token)).body[0]!;
        const browse = await rowsWrittenBy(() => call("GET", market.root, buyer.token));
        const buy = await rowsWrittenBy(() => call("POST", path(market.buy, { listingId: listing.id }), buyer.token, { expectedPrice: 300 }));
        expect({ list, browse, buy }).toEqual({ list: 8, browse: 0, buy: 7 });
    });
});

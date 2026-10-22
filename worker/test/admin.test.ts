import { describe, expect, it } from "vitest";
import {
    GEO_API_PATHS,
    type GeoAdminAnnouncementsResponse,
    type GeoAdminAuditEntry,
    type GeoAdminEconomy,
    type GeoAdminPlayer,
    type GeoAdminPlayerDetail,
    type GeoFarmView,
    type GeoInboxResponse,
    type GeoOwnListing,
} from "@geo/shared";
import { call, giveCoins, grant, makeAdmin, newPlayer, path } from "./helpers";

/** The game-admin tools in workerd: every route admin-only, every change audited. */

const admin = GEO_API_PATHS.admin;

async function newAdmin() {
    const player = await newPlayer("admin");
    await makeAdmin(player.id);
    return player;
}

describe("admin", () => {
    it("refuses players", async () => {
        const { token } = await newPlayer("nosy");
        expect((await call("GET", admin.players, token)).status).toBe(403);
        expect((await call("GET", admin.economy, token)).status).toBe(403);
    });

    it("finds players, grants coins and items, bans, and audits it all", async () => {
        const boss = await newAdmin();
        const target = await newPlayer("target");
        const name = (await target.me()).player.displayName;

        const found = await call<GeoAdminPlayer[]>("GET", `${admin.players}?search=${encodeURIComponent(name.toUpperCase())}`, boss.token);
        expect(found.body.map((player) => player.id)).toEqual([target.id]);
        expect((await call<GeoAdminPlayer[]>("GET", `${admin.players}?search=%25`, boss.token)).body).toEqual([]);

        const coins = (await target.me()).player.coins;
        const granted = await call<GeoAdminPlayer>("POST", path(admin.playerCoins, { playerId: target.id }), boss.token, { amount: 500, note: "sorry" });
        expect(granted.body.coins).toBe(coins + 500);
        expect((await call("POST", path(admin.playerCoins, { playerId: target.id }), boss.token, { amount: -(coins + 501) })).status).toBe(400);
        expect((await call("POST", path(admin.playerItems, { playerId: target.id }), boss.token, { itemId: "bones", quantity: 3 })).status).toBe(200);
        const detail = await call<GeoAdminPlayerDetail>("GET", path(admin.player, { playerId: target.id }), boss.token);
        expect(detail.body.inventory.some((entry) => entry.itemId === "bones")).toBe(true);
        expect(detail.body.ledger[0]).toMatchObject({ delta: 500, reason: "admin-grant" });

        expect((await call("POST", path(admin.playerBan, { playerId: boss.id }), boss.token, { banned: true })).status).toBe(400);
        const banned = await call<GeoAdminPlayer>("POST", path(admin.playerBan, { playerId: target.id }), boss.token, { banned: true });
        expect(banned.body.bannedAt).not.toBeNull();
        expect((await call("GET", GEO_API_PATHS.me.root, target.token)).status).toBe(403);
        await call("POST", path(admin.playerBan, { playerId: target.id }), boss.token, { banned: false });
        expect((await call("GET", GEO_API_PATHS.me.root, target.token)).status).toBe(200);

        expect((await call("PUT", path(admin.playerRole, { playerId: boss.id }), boss.token, { role: "player" })).status).toBe(400);
        const audit = await call<GeoAdminAuditEntry[]>("GET", admin.audit, boss.token);
        const mine = audit.body.filter((entry) => entry.target === target.id).map((entry) => entry.action);
        expect(mine).toEqual(["unban", "ban", "grant-item", "grant-coins"]);
        expect(audit.body.find((entry) => entry.action === "grant-coins" && entry.target === target.id)?.details).toEqual({ amount: 500, note: "sorry" });
    });

    it("shows the economy with every purse matching its ledger", async () => {
        const boss = await newAdmin();
        const economy = await call<GeoAdminEconomy>("GET", admin.economy, boss.token);
        expect(economy.status).toBe(200);
        expect(economy.body.coinsInPurses).toBeGreaterThanOrEqual(0);
        expect(economy.body.lastDay.length).toBeGreaterThan(0);
    });

    it("switches sea creatures and skips the farm a cycle, for the calling admin only", async () => {
        const boss = await newAdmin();
        expect((await call<{ always: boolean }>("GET", admin.seaCreatures, boss.token)).body.always).toBe(false);
        expect((await call<{ always: boolean }>("PUT", admin.seaCreatures, boss.token, { always: true })).body.always).toBe(true);
        expect((await call<{ always: boolean }>("GET", admin.seaCreatures, boss.token)).body.always).toBe(true);

        const farm = (await call<GeoFarmView>("GET", GEO_API_PATHS.farm.root, boss.token)).body;
        const next = await call<GeoFarmView>("POST", admin.farmNextCycle, boss.token);
        expect(next.status, JSON.stringify(next.body)).toBe(200);
        expect(next.body.turn).toBe(farm.turn + 1);
        expect((await call<GeoFarmView>("GET", GEO_API_PATHS.farm.root, boss.token)).body.turn).toBe(farm.turn + 1);
    });

    it("takes a bid-on listing down, handing the bid and the item back", async () => {
        const boss = await newAdmin();
        const seller = await newPlayer("seller");
        const bidder = await newPlayer("bidder");
        const [dagger] = await grant(seller.id, "venomfang-dagger");
        await giveCoins(seller.id, 1000);
        await giveCoins(bidder.id, 1000);
        await call("POST", GEO_API_PATHS.market.listings, seller.token, { inventoryId: dagger, type: "auction", quantity: 1, startingBid: 200, hours: 12 });
        const listing = (await call<GeoOwnListing[]>("GET", GEO_API_PATHS.market.mine, seller.token)).body[0]!;
        await call("POST", path(GEO_API_PATHS.market.bids, { listingId: listing.id }), bidder.token, { amount: 250 });

        expect((await call("POST", path(admin.removeListing, { listingId: listing.id }), boss.token)).status).toBe(204);
        expect((await bidder.me()).player.coins).toBe(1000);
        expect((await seller.me()).inventory.some((entry) => entry.id === dagger)).toBe(true);
        expect((await call("POST", path(admin.removeListing, { listingId: listing.id }), boss.token)).status).toBe(400);
    });

    it("posts and deletes announcements in every inbox", async () => {
        const boss = await newAdmin();
        const reader = await newPlayer("reader");
        expect((await call("POST", admin.announcements, boss.token, { kind: "changelog", title: "1.1" })).status).toBe(400);
        const posted = await call<GeoAdminAnnouncementsResponse>("POST", admin.announcements, boss.token, {
            kind: "news",
            title: "Hello",
            body: "World",
            expiresInHours: 1.5,
        });
        expect(posted.status).toBe(201);
        const news = posted.body.announcements.find((entry) => entry.title === "Hello")!;
        expect(news.expiresAt).not.toBeNull();
        const inbox = await call<GeoInboxResponse>("GET", GEO_API_PATHS.inbox.root, reader.token);
        expect(inbox.body.announcements.find((entry) => entry.id === news.id)?.read).toBe(false);

        const gone = await call<GeoAdminAnnouncementsResponse>("DELETE", path(admin.announcement, { announcementId: news.id }), boss.token);
        expect(gone.body.announcements.some((entry) => entry.id === news.id)).toBe(false);
        expect((await call("DELETE", path(admin.announcement, { announcementId: news.id }), boss.token)).status).toBe(404);
    });
});

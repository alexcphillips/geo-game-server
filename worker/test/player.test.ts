import { describe, expect, it } from "vitest";
import {
    GEO_API_PATHS,
    GEO_LUNCHBOX_STACK_SIZE,
    GEO_TALISMAN_BAG_FULL,
    GEO_TALISMAN_BAG_PAGE_SIZE,
    type GeoMeResponse,
} from "@geo/shared";
import { GAME_CONFIG } from "../../game/src/content";
import { addCoins } from "../src/modules/player/player.repository";
import { amountOf, call, grant, inWorld, newPlayer, path, rowsWrittenBy } from "./helpers";

/** The player module end to end in workerd: ported from server/src/dev/geo-smoke.ts and geo-bank-smoke.ts. */

const me = GEO_API_PATHS.me;
const CAMP = { latitude: 51.50713, longitude: -0.12794 };
const AWAY = { latitude: 51.52, longitude: -0.1279 };

describe("player", () => {
    it("refuses a missing or bad token", async () => {
        expect((await call("GET", me.root)).status).toBe(401);
        expect((await call("GET", me.root, "not-a-token")).status).toBe(401);
    });

    it("gives a new player the starter kit", async () => {
        const state = await (await newPlayer("kit")).me();
        const kit = GAME_CONFIG["starter-kit"];
        expect(state.inventory.map((entry) => entry.itemId).sort()).toEqual(kit.items.map((entry) => entry.itemId).sort());
        const dagger = state.inventory.find((entry) => entry.itemId === "bronze-dagger");
        expect(state.equipment).toEqual({ mainHand: dagger?.id });
        expect(state.hands.combat).toHaveLength(2);
        expect(state.hands.fishing).toHaveLength(4);
        expect(state.hands.farming).toHaveLength(5);
        expect(state.talismanBag).toEqual({ pages: 1, inventoryIds: [] });
        expect(state.lunchbox).toEqual({ slots: 1, contents: [{ slot: 0, itemId: "bread", quantity: 5 }] });
        expect(state.bait).toEqual({ slots: 1, contents: [{ slot: 0, itemId: "worm-bait", quantity: 20 }] });
        expect(state.health.current).toBe(state.health.max);
        expect(state.health.max).toBeGreaterThan(0);
        expect(state.camp).toBeNull();
        expect(state.stats.length).toBeGreaterThan(0);
        expect(state.wardrobe.activeSlot).toBe(0);
    });

    it("checks gear slots and hands", async () => {
        const { token, me: read } = await newPlayer("gear");
        const state = await read();
        const dagger = state.inventory.find((entry) => entry.itemId === "bronze-dagger")!;
        const rod = state.inventory.find((entry) => entry.itemId === "twig-rod")!;
        const slot = (name: string) => path(me.equipmentSlot, { slot: name });
        const hand = path(me.hand, { skill: "combat" });

        expect((await call("PUT", slot("head"), token, { inventoryId: dagger.id })).status).toBe(400);
        expect((await call("PUT", slot("nowhere"), token, { inventoryId: dagger.id })).status).toBe(400);
        const rodIn = await call<GeoMeResponse>("PUT", slot("mainHand"), token, { inventoryId: rod.id });
        expect(rodIn.body.equipment.mainHand).toBe(rod.id);
        // The active loadout (Combat) follows what's worn.
        expect(rodIn.body.wardrobe.loadouts[0]?.equipment.mainHand).toBe(rod.id);
        const emptied = await call<GeoMeResponse>("PUT", slot("mainHand"), token, { inventoryId: null });
        expect(emptied.body.equipment).toEqual({});
        expect(emptied.body.wardrobe.loadouts[0]?.equipment).toEqual({});

        expect((await call("PUT", hand, token, { inventoryIds: [dagger.id] })).status).toBe(400);
        const fishingCard = state.hands.fishing![0]!;
        expect((await call("PUT", hand, token, { inventoryIds: [fishingCard] })).status).toBe(400);
        const [slash] = state.hands.combat!;
        expect((await call("PUT", hand, token, { inventoryIds: [slash, slash] })).status).toBe(400);
        const set = await call<GeoMeResponse>("PUT", hand, token, { inventoryIds: [slash] });
        expect(set.body.hands.combat).toEqual([slash]);
    });

    it("saves and loads hands", async () => {
        const { token, me: read } = await newPlayer("hands");
        const starter = (await read()).hands.combat!;
        const saved = await call<GeoMeResponse>("POST", me.savedHands, token, { skill: "combat", name: "  Both  " });
        expect(saved.status).toBe(201);
        const [entry] = saved.body.savedHands;
        expect(entry).toMatchObject({ skill: "combat", name: "Both", inventoryIds: starter });
        await call("PUT", path(me.hand, { skill: "combat" }), token, { inventoryIds: [] });
        expect((await call("POST", me.savedHands, token, { skill: "combat", name: "Empty" })).status).toBe(400);

        const loaded = await call<GeoMeResponse>("POST", path(me.loadSavedHand, { savedHandId: entry!.id }), token);
        expect(loaded.body.hands.combat).toEqual(starter);
        const deleted = await call<GeoMeResponse>("DELETE", path(me.savedHand, { savedHandId: entry!.id }), token);
        expect(deleted.body.savedHands).toEqual([]);
        expect((await call("POST", path(me.loadSavedHand, { savedHandId: entry!.id }), token)).status).toBe(404);
    });

    it("keeps one of each talisman in the bag, up to a page", async () => {
        const { token, id, me: read } = await newPlayer("bag");
        const [charm] = await grant(id, "storm-charm");
        const [second] = await grant(id, "storm-charm");
        const entry = (inventoryId: string) => path(me.talismanBagEntry, { inventoryId });

        const bagged = await call<GeoMeResponse>("PUT", entry(charm!), token);
        expect(bagged.body.talismanBag).toEqual({ pages: 1, inventoryIds: [charm] });
        expect((await call("PUT", entry(second!), token)).status).toBe(400);
        const dagger = (await read()).inventory.find((row) => row.itemId === "bronze-dagger")!;
        expect((await call("PUT", entry(dagger.id), token)).status).toBe(400);

        const removed = await call<GeoMeResponse>("DELETE", entry(charm!), token);
        expect(removed.body.talismanBag.inventoryIds).toEqual([]);
        expect(removed.body.inventory.some((row) => row.id === charm)).toBe(true);

        // Fill the page with stand-in rows (not real talismans), then try one more.
        await inWorld((db) => {
            for (let n = 0; n < GEO_TALISMAN_BAG_PAGE_SIZE; n++) {
                const fillerId = `filler-${n}`;
                db.run(`INSERT INTO inventory (player_id, id, item_id, obtained_at) VALUES (?, ?, ?, ?);`, id, fillerId, fillerId, 0);
                db.run(`INSERT INTO talisman_bag (player_id, item_id, inventory_id) VALUES (?, ?, ?);`, id, fillerId, fillerId);
            }
        });
        expect(await call("PUT", entry(charm!), token)).toEqual({ status: 400, body: { error: GEO_TALISMAN_BAG_FULL } });
        // A copy leaving the inventory leaves the bag with it.
        await inWorld((db) => db.run(`DELETE FROM inventory WHERE player_id = ? AND id LIKE 'filler-%';`, id));
        expect((await call<GeoMeResponse>("PUT", entry(charm!), token)).body.talismanBag.inventoryIds).toEqual([charm]);
    });

    it("sets camp, and packs the lunchbox and bait only there", async () => {
        const { token, id } = await newPlayer("camp");
        await grant(id, "grilled-trout", 4);
        const lunchbox = (slot: number) => path(me.lunchboxSlot, { slot });

        expect((await call("PUT", lunchbox(0), token, { itemId: "grilled-trout", quantity: 1, position: CAMP })).status).toBe(400);
        const camped = await call<GeoMeResponse>("PUT", me.camp, token, { position: CAMP });
        expect(camped.body.camp?.position).toEqual({ latitude: 51.5071, longitude: -0.1279 });
        expect((await call("PUT", me.camp, token, { position: AWAY })).status).toBe(400);
        expect((await call("PUT", lunchbox(0), token, { itemId: "grilled-trout", quantity: 1, position: AWAY })).status).toBe(400);

        for (const [why, slot, body] of [
            ["a non-food", 0, { itemId: "bronze-dagger", quantity: 1, position: CAMP }],
            ["a locked slot", 1, { itemId: "grilled-trout", quantity: 1, position: CAMP }],
            ["more than a slot holds", 0, { itemId: "grilled-trout", quantity: GEO_LUNCHBOX_STACK_SIZE + 1, position: CAMP }],
            ["more than you have", 0, { itemId: "grilled-trout", quantity: 5, position: CAMP }],
        ] as const) {
            expect((await call("PUT", lunchbox(slot), token, body)).status, why).toBe(400);
        }

        const packed = await call<GeoMeResponse>("PUT", lunchbox(0), token, { itemId: "grilled-trout", quantity: 3, position: CAMP });
        expect(packed.body.lunchbox.contents).toEqual([{ slot: 0, itemId: "grilled-trout", quantity: 3 }]);
        expect(amountOf(packed.body, "grilled-trout")).toBe(1);
        expect(amountOf(packed.body, "bread")).toBe(5);

        await inWorld((db) => db.run(`UPDATE players SET lunchbox_slots = 2 WHERE id = ?;`, id));
        expect((await call("PUT", lunchbox(1), token, { itemId: "grilled-trout", quantity: 1, position: CAMP })).status).toBe(400);
        const second = await call<GeoMeResponse>("PUT", lunchbox(1), token, { itemId: "bread", quantity: 2, position: CAMP });
        expect(amountOf(second.body, "bread")).toBe(3);
        const unpacked = await call<GeoMeResponse>("DELETE", lunchbox(0), token);
        expect(unpacked.body.lunchbox.contents).toEqual([{ slot: 1, itemId: "bread", quantity: 2 }]);
        expect(amountOf(unpacked.body, "grilled-trout")).toBe(4);

        const bait = path(me.baitSlot, { slot: 0 });
        expect((await call("PUT", bait, token, { itemId: "grilled-trout", quantity: 1, position: CAMP })).status).toBe(400);
        const unbaited = await call<GeoMeResponse>("DELETE", bait, token);
        expect(unbaited.body.bait.contents).toEqual([]);
        expect(amountOf(unbaited.body, "worm-bait")).toBe(20);
        const rebaited = await call<GeoMeResponse>("PUT", bait, token, { itemId: "worm-bait", quantity: 15, position: CAMP });
        expect(rebaited.body.bait.contents).toEqual([{ slot: 0, itemId: "worm-bait", quantity: 15 }]);
        expect(amountOf(rebaited.body, "worm-bait")).toBe(5);

        const forgot = await call<GeoMeResponse>("DELETE", me.camp, token);
        expect(forgot.body.camp).toBeNull();
        expect((await call("PUT", me.camp, token, { position: AWAY })).status).toBe(400);
    });

    it("moves coins to and from the bank at camp, through the ledger", async () => {
        const { token, id } = await newPlayer("bank");
        await inWorld((db) => addCoins(db, id, 300, "admin-grant", "test"));
        expect((await call("POST", me.bankDeposit, token, { amount: 100, position: CAMP })).status).toBe(400);
        await call("PUT", me.camp, token, { position: CAMP });
        expect((await call("POST", me.bankDeposit, token, { amount: 100, position: AWAY })).status).toBe(400);
        expect((await call("POST", me.bankDeposit, token, { amount: 0, position: CAMP })).status).toBe(400);
        expect((await call("POST", me.bankDeposit, token, { amount: 301, position: CAMP })).status).toBe(400);

        const deposited = await call<GeoMeResponse>("POST", me.bankDeposit, token, { amount: 250, position: CAMP });
        expect(deposited.body.player).toMatchObject({ coins: 50, bankCoins: 250 });
        expect((await call("POST", me.bankWithdraw, token, { amount: 251, position: CAMP })).status).toBe(400);
        const withdrawn = await call<GeoMeResponse>("POST", me.bankWithdraw, token, { amount: 100, position: CAMP });
        expect(withdrawn.body.player).toMatchObject({ coins: 150, bankCoins: 150 });

        const ledger = await inWorld((db) => db.one<{ total: number }>(`SELECT sum(delta) AS total FROM coin_ledger WHERE player_id = ?;`, id));
        expect(ledger?.total).toBe(150);
    });

    it("refuses mid-Run changes while a Run is going", async () => {
        const { token, id, me: read } = await newPlayer("midrun");
        // Touched just now: one left too long would have ended (see the stale-Run test in runs.test.ts).
        await inWorld((db) =>
            db.run(
                `INSERT INTO runs (id, player_id, kind, state, created_at, updated_at) VALUES (?1, ?2, 'combat', '{}', ?3, ?3);`,
                crypto.randomUUID(),
                id,
                Date.now(),
            ),
        );
        const hand = (await read()).hands.combat!;
        expect((await call("PUT", path(me.hand, { skill: "combat" }), token, { inventoryIds: hand })).status).toBe(400);
        expect((await call("PUT", path(me.hand, { skill: "fishing" }), token, { inventoryIds: [] })).status).toBe(200);
        expect((await call("DELETE", path(me.lunchboxSlot, { slot: 0 }), token)).status).toBe(400);
        expect((await call("POST", path(me.wearLoadout, { slot: 1 }), token)).status).toBe(400);
    });

    it("makes a pet active, and gives and takes its held item", async () => {
        const { token, id } = await newPlayer("pets");
        const [pet] = await grant(id, "pet.tarantula.common");
        const [collar] = await grant(id, "silk-collar", 2);

        const active = await call<GeoMeResponse>("PUT", me.activePet, token, { inventoryId: pet });
        expect(active.body.activePet).toBe(pet);
        expect(active.body.wardrobe.loadouts[0]?.petId).toBe(pet);

        const item = path(me.petItem, { inventoryId: pet! });
        const held = await call<GeoMeResponse>("PUT", item, token, { inventoryId: collar });
        expect(held.body.inventory.find((row) => row.id === pet)?.pet?.heldItem).toBeTruthy();
        expect(amountOf(held.body, "silk-collar")).toBe(1);
        // Taking it off costs coins by its rarity; this player has none.
        expect((await call("DELETE", item, token)).status).toBe(400);
        await inWorld((db) => addCoins(db, id, GAME_CONFIG.pets.heldItemRemovalCost.uncommon, "admin-grant", "test"));
        const taken = await call<GeoMeResponse>("DELETE", item, token);
        expect(amountOf(taken.body, "silk-collar")).toBe(2);
        expect(taken.body.player.coins).toBe(0);

        const away = await call<GeoMeResponse>("PUT", me.activePet, token, { inventoryId: null });
        expect(away.body.activePet).toBeNull();
        expect(away.body.wardrobe.loadouts[0]?.petId).toBeNull();
    });

    it("stays inside its write budget", async () => {
        const { token, me: read } = await newPlayer("budget");
        const state = await read();
        const rod = state.inventory.find((entry) => entry.itemId === "twig-rod")!;
        const getMe = await rowsWrittenBy(() => call("GET", me.root, token));
        const equip = await rowsWrittenBy(() => call("PUT", path(me.equipmentSlot, { slot: "mainHand" }), token, { inventoryId: rod.id }));
        const hand = await rowsWrittenBy(() => call("PUT", path(me.hand, { skill: "combat" }), token, { inventoryIds: state.hands.combat }));
        await call("PUT", me.camp, token, { position: CAMP });
        await inWorld((db) => addCoins(db, state.player.id, 10, "admin-grant", "test"));
        const deposit = await rowsWrittenBy(() => call("POST", me.bankDeposit, token, { amount: 10, position: CAMP }));
        console.log(`rows written: GET /geo/me ${getMe}, equip ${equip}, hand ${hand}, bank deposit ${deposit}`);
        expect(getMe).toBe(0);
        // A coin change: the player row, and a ledger row with its one index entry.
        expect(deposit).toBe(3);
        // The worn slot changes in place, and the active loadout follows.
        expect(equip).toBeLessThanOrEqual(3);
        expect(hand).toBeLessThanOrEqual(1);
    });
});

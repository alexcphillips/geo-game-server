import { describe, expect, it } from "vitest";
import { GEO_API_PATHS, type GeoMeResponse } from "@geo/shared";
import { GAME_CONFIG } from "../../game/src/content";
import { addCoins } from "../src/modules/player/player.repository";
import { autoSwap } from "../src/modules/wardrobe/wardrobe.repository";
import { call, inWorld, newPlayer, path } from "./helpers";

/**
 * The wardrobe end to end in workerd, ported from server/src/dev/geo-wardrobe-smoke.ts.
 * Auto-swap is called directly: the Runs that trigger it move in session 3.
 */

const me = GEO_API_PATHS.me;
const itemOf = (state: GeoMeResponse, inventoryId: string | undefined) => state.inventory.find((entry) => entry.id === inventoryId)?.itemId;

describe("wardrobe", () => {
    it("starts with Combat (worn) and Fishing, tagged for auto-swap", async () => {
        const state = await (await newPlayer("wardrobe")).me();
        expect(state.wardrobe.slots).toBe(GAME_CONFIG.wardrobe.startingSlots);
        expect(state.wardrobe.loadouts.map((loadout) => [loadout.name, loadout.autoFor])).toEqual([
            ["Combat", "combat"],
            ["Fishing", "fishing"],
        ]);
        expect(state.wardrobe.activeSlot).toBe(0);
        expect(itemOf(state, state.equipment.mainHand)).toBe("bronze-dagger");
        expect(itemOf(state, state.wardrobe.loadouts[1]?.equipment.mainHand)).toBe("twig-rod");
    });

    it("wears, renames, saves and clears loadouts", async () => {
        const { token, me: read } = await newPlayer("wear");
        const wear = (slot: number) => call<GeoMeResponse>("POST", path(me.wearLoadout, { slot }), token);

        const fishing = await wear(1);
        expect(fishing.body.wardrobe.activeSlot).toBe(1);
        expect(itemOf(fishing.body, fishing.body.equipment.mainHand)).toBe("twig-rod");
        const rodId = fishing.body.equipment.mainHand!;

        // Gear changes follow into the active loadout only; one rod can be in two loadouts.
        await wear(0);
        await call("PUT", path(me.equipmentSlot, { slot: "mainHand" }), token, { inventoryId: rodId });
        let state = await read();
        expect(state.wardrobe.loadouts[0]?.equipment.mainHand).toBe(rodId);
        expect(state.wardrobe.loadouts[1]?.equipment.mainHand).toBe(rodId);

        const renamed = await call<GeoMeResponse>("PUT", path(me.loadout, { slot: 0 }), token, { name: "  Fight  ", save: false });
        expect(renamed.body.wardrobe.loadouts[0]?.name).toBe("Fight");
        expect((await call("PUT", path(me.loadout, { slot: 0 }), token, { name: "", save: false })).status).toBe(400);
        expect((await call("PUT", path(me.loadout, { slot: 2 }), token, { name: "Nope", save: false })).status).toBe(404);
        expect((await wear(2)).status).toBe(404);
        expect((await wear(GAME_CONFIG.wardrobe.startingSlots)).status).toBe(400);

        const saved = await call<GeoMeResponse>("PUT", path(me.loadout, { slot: 2 }), token, { name: "Spare", save: true });
        expect(saved.body.wardrobe.activeSlot).toBe(2);
        expect(saved.body.wardrobe.loadouts[2]?.equipment.mainHand).toBe(rodId);
        const cleared = await call<GeoMeResponse>("DELETE", path(me.loadout, { slot: 2 }), token);
        expect(cleared.body.wardrobe.activeSlot).toBeNull();
        expect(cleared.body.wardrobe.loadouts).toHaveLength(2);
        expect(cleared.body.equipment.mainHand).toBe(rodId);

        // Nothing worn and no pet saves as an empty loadout.
        await call("PUT", path(me.equipmentSlot, { slot: "mainHand" }), token, { inventoryId: null });
        state = (await call<GeoMeResponse>("PUT", path(me.loadout, { slot: 2 }), token, { name: "Bare", save: true })).body;
        expect(state.wardrobe.loadouts[2]).toMatchObject({ equipment: {}, petId: null });
    });

    it("keeps one loadout per auto-swap activity, and swaps to it", async () => {
        const { token, id, me: read } = await newPlayer("auto");
        const auto = (slot: number, autoFor: string | null) => call<GeoMeResponse>("PUT", path(me.loadoutAuto, { slot }), token, { autoFor });

        expect((await auto(0, "sleeping")).status).toBe(400);
        const moved = await auto(0, "fishing");
        expect(moved.body.wardrobe.loadouts.map((loadout) => loadout.autoFor)).toEqual(["fishing", null]);
        await auto(0, "combat");
        await auto(1, "fishing");

        expect(await inWorld((db) => autoSwap(db, id, { activity: "fishing" }))).toBe(true);
        let state = await read();
        expect(state.wardrobe.activeSlot).toBe(1);
        expect(itemOf(state, state.equipment.mainHand)).toBe("twig-rod");
        expect(await inWorld((db) => autoSwap(db, id, { activity: "fishing" }))).toBe(false);

        expect(await inWorld((db) => autoSwap(db, id, { activity: "combat", enemyId: "spider", dungeonId: null }))).toBe(true);
        expect(itemOf(await read(), (await read()).equipment.mainHand)).toBe("bronze-dagger");

        // None tagged for fishing: the first loadout with a rod.
        await auto(1, null);
        expect(await inWorld((db) => autoSwap(db, id, { activity: "fishing" }))).toBe(true);
        state = await read();
        expect(state.wardrobe.activeSlot).toBe(1);
    });

    it("sells more slots, each dearer", async () => {
        const { token, id } = await newPlayer("slots");
        const { slotCost, startingSlots } = GAME_CONFIG.wardrobe;
        expect((await call("POST", me.buyLoadoutSlot, token)).status).toBe(400);
        await inWorld((db) => addCoins(db, id, slotCost.first, "admin-grant", "test"));
        const bought = await call<GeoMeResponse>("POST", me.buyLoadoutSlot, token);
        expect(bought.body.player.coins).toBe(0);
        expect(bought.body.wardrobe.slots).toBe(startingSlots + 1);
        expect(bought.body.wardrobe.nextSlotCost).toBe(slotCost.first + slotCost.step);

        const balances = await inWorld((db) =>
            db.one<{ coins: number; ledger: number }>(
                `SELECT coins, (SELECT coalesce(sum(delta), 0) FROM coin_ledger WHERE player_id = players.id) AS ledger FROM players WHERE id = ?;`,
                id,
            ),
        );
        expect(balances?.coins).toBe(balances?.ledger);
    });
});

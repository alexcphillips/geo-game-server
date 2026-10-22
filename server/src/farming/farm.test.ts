import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GEO_FARM_SIZE, GEO_HAND_SIZE, type GeoFarmWeather } from "@geo/shared";
import { CONTENT, FARMING } from "../content";
import { createRng } from "../engine/rng";
import {
    catchUp,
    FarmRuleError,
    footprint,
    forecast,
    groundAt,
    isUnlockable,
    newFarm,
    nextTurnAt,
    refreshOrders,
    weekOf,
    withFortune,
    weekEndsAt,
    globalEventFor,
    activeGlobalEvent,
    contestCropFor,
    planIntent,
    playsLeft,
    stepFarm,
    tickFarm,
    readFarm,
    type FarmContext,
    type FarmPest,
    type FarmState,
} from "./farm";

const NOW = new Date("2026-10-13T12:00:00Z");
const HOUR = 3_600_000;
// No pests arrive on their own here; the pest tests place them.
// No frosts on their own either: they'd pause the growth other tests are watching.
const config = {
    ...FARMING,
    rotChances: [0, 0, 0, 1],
    pests: { ...FARMING.pests, max: 0 },
    events: { ...FARMING.events, chance: 0 },
    weatherWeights: { ...FARMING.weatherWeights, frost: 0 },
};
const hand = [
    "farm.swat",
    "farm.careful-pick",
    "farm.scythe-sweep",
    "farm.hold",
    "farm.read-sky",
    "farm.ripen",
    "farm.smoke",
    "farm.bait-ring",
    "farm.snap-trap",
    "farm.hand-pollinate",
    "farm.hazmat-scrub",
    "farm.controlled-leak",
    "farm.tear-the-veil",
    "farm.coax",
    "farm.moon-rite",
    "farm.exterminators-oath",
    "farm.chain-reaction",
].map(
    (cardId, i) => ({ inventoryId: `inv-${i}`, itemId: `card.${cardId}`, cardId, chargesLeft: 10 }),
);
const ctx: FarmContext = {
    crops: CONTENT.crops,
    mutations: CONTENT.mutations,
    pests: CONTENT.pests,
    structures: CONTENT.structures,
    events: CONTENT.farmEvents,
    sellValue: (itemId) => CONTENT.items[itemId]?.sellValue ?? 1,
    itemName: (itemId) => CONTENT.items[itemId]?.name ?? itemId,
    config,
    now: NOW,
    hand,
    held: {
        // Plenty of every structure's materials.
        ...Object.fromEntries(Object.values(CONTENT.structures).flatMap((structure) => structure.cost.map((entry) => [entry.itemId, 100]))),
        "wheat-seeds": 5,
        "melon-seeds": 5,
    },
    farmingLevel: 1,
};
const card = (cardId: string) => hand.find((entry) => entry.cardId === cardId)!.inventoryId;

/** The middle tile: owned on every new farm. */
const MID = Math.floor((GEO_FARM_SIZE * GEO_FARM_SIZE) / 2);

const farm = (overrides: Partial<FarmState> = {}): FarmState => ({ ...newFarm(config, 1, 2, NOW), ...overrides });

/** The farm with a pest of `pestId` on `tile`, its move planned. */
function withPest(state: FarmState, pestId: string, tile: number): FarmState {
    const next = structuredClone(state);
    const pest: FarmPest = { id: next.nextPestId++, pestId, tile, age: 0, intent: { kind: "move", tile }, hp: CONTENT.pests[pestId]!.hp };
    next.pests.push(pest);
    pest.intent = planIntent(next, pest, CONTENT.pests[pestId]!, createRng(7));
    return next;
}

const plant = (state: FarmState, tile: number, itemId = "wheat-seeds") => stepFarm(state, { type: "plant", tile, itemId }, ctx).state;

/** `context` with every turn under this sky. */
const under = (weather: GeoFarmWeather, context: FarmContext = ctx): FarmContext => ({ ...context, weather: () => weather });
/** `cropId` ripe on each of `tiles`. */
const ripe = (state: FarmState, cropId: string, tiles: number[]): FarmState => ({
    ...state,
    tiles: state.tiles.map((tile, i) =>
        tiles.includes(i)
            ? { ...tile, crop: { cropId, stage: CONTENT.crops[cropId]!.stages, ripeTurns: 0, held: false, rotten: false } }
            : tile,
    ),
});
/** Every mutation certain to sprout once its recipe holds. */
const sure = (chance = 1): FarmContext => ({
    ...ctx,
    mutations: Object.fromEntries(Object.entries(CONTENT.mutations).map(([id, mutation]) => [id, { ...mutation, chance }])),
});

/** A structure from the (test) inventory onto a tile. */
const place = (state: FarmState, structureId: string, tile: number) =>
    stepFarm(state, { type: "place", tile, structureId }, ctx).state;

/** Turns of the seeded weather with heatwaves played as clear days, so dry ground can't stall growth. */
function advanceMild(state: FarmState, times: number): FarmState {
    let next = state;
    for (let i = 0; i < times; i++) {
        const sky = forecast(next, config)[0]!;
        next = tickFarm(next, ctx, sky === "heatwave" ? "clear" : sky).state;
    }
    return next;
}

describe("farm", () => {
    it("starts as a startSize square in the middle", () => {
        const state = newFarm(config, 1, 2, NOW);
        assert.equal(state.tiles.filter((tile) => tile.owned).length, config.startSize ** 2);
        assert.ok(state.tiles[MID]!.owned);
        assert.deepEqual(state.played, []);
    });

    it("takes a turn every turnHours on its own, keeping the clock's phase", () => {
        const period = config.turnHours * HOUR;
        const early = catchUp(farm(), { ...ctx, now: new Date(NOW.getTime() + period * 0.9) });
        assert.equal(early.turns, 0);
        assert.equal(early.state.turn, 0);
        const later = catchUp(farm(), { ...ctx, now: new Date(NOW.getTime() + period * 1.5) });
        assert.equal(later.turns, 1);
        assert.equal(later.state.turn, 1);
        assert.equal(nextTurnAt(later.state, config).getTime(), NOW.getTime() + period * 2);
        assert.match(later.log[0]!, /ran 1 cycle\./);
    });

    it("waits for the player after maxTurnsAway turns, then restarts the clock", () => {
        const period = config.turnHours * HOUR;
        const back = new Date(NOW.getTime() + period * 100.5);
        const away = catchUp(farm(), { ...ctx, now: back });
        assert.equal(away.turns, config.maxTurnsAway);
        assert.equal(away.state.turn, config.maxTurnsAway);
        assert.equal(nextTurnAt(away.state, config).getTime(), back.getTime() + period);
        assert.match(away.log[0]!, /then waited for you/);
    });

    it("plants from the inventory for free and grows to ripe, then harvests", () => {
        const planted = stepFarm(farm(), { type: "plant", tile: MID, itemId: "wheat-seeds" }, ctx);
        assert.deepEqual(planted.itemsUsed, [{ itemId: "wheat-seeds", quantity: 1 }]);
        assert.throws(() => stepFarm(farm(), { type: "plant", tile: MID, itemId: "carrot-seeds" }, ctx), /none of those seeds/);
        assert.throws(() => stepFarm(farm(), { type: "plant", tile: MID, itemId: "wheat" }, ctx), /aren't seeds/);

        const ripe = advanceMild(planted.state, CONTENT.crops.wheat!.stages);
        assert.throws(() => stepFarm(planted.state, { type: "harvest", tile: MID }, ctx), FarmRuleError);
        const harvested = stepFarm(ripe, { type: "harvest", tile: MID }, ctx);
        const wheat = harvested.gains.find((entry) => entry.itemId === "wheat")!;
        assert.ok(wheat.quantity >= CONTENT.crops.wheat!.yield.min);
        assert.equal(harvested.xp, CONTENT.crops.wheat!.xp);
        assert.equal(harvested.state.tiles[MID]!.crop, null);
    });

    it("Farming Fortune multiplies a harvest: each 100 adds it again, the fraction a chance of 1 more", () => {
        const rng = createRng(1);
        assert.equal(withFortune(3, 0, rng), 3);
        assert.equal(withFortune(3, 100, rng), 6);
        assert.equal(withFortune(3, 1000, rng), 33);
        assert.equal(withFortune(3, -50, rng), 3);
        const rolls = Array.from({ length: 200 }, () => withFortune(3, 50, rng));
        assert.ok(rolls.every((amount) => amount === 4 || amount === 5));
        assert.ok(rolls.includes(4) && rolls.includes(5));
    });

    it("harvests with Farming Fortune give more crops, but not more seeds", () => {
        const ripeWheat = ripe(farm(), "wheat", [MID]);
        const plain = stepFarm(ripeWheat, { type: "harvest", tile: MID }, ctx);
        const lucky = stepFarm(ripeWheat, { type: "harvest", tile: MID }, { ...ctx, fortune: 200 });
        const amount = (result: typeof plain, itemId: string) => result.gains.find((gain) => gain.itemId === itemId)?.quantity ?? 0;
        assert.equal(amount(lucky, "wheat"), amount(plain, "wheat") * 3);
        assert.equal(amount(lucky, "wheat-seeds"), amount(plain, "wheat-seeds"));
        assert.equal(lucky.harvested[0]!.quantity, amount(lucky, "wheat"), "contests count the fortune crops");
    });

    it("grows without watering, but not on dry ground", () => {
        const planted = plant(farm(), MID);
        assert.equal(tickFarm(planted, under("clear")).state.tiles[MID]!.crop!.stage, 1);
        assert.equal(tickFarm(planted, under("clear")).state.tiles[MID]!.crop!.stage, 1);
        assert.equal(groundAt(planted, MID, "heatwave", CONTENT.structures), "dry");
        const scorched = tickFarm(planted, under("heatwave"));
        assert.equal(scorched.state.tiles[MID]!.crop!.stage, 0);
        assert.ok(scorched.log.some((line) => line.includes("too dry to grow")));
    });

    it("gives each tile its ground from the sky and the structures around it", () => {
        const state = farm();
        assert.equal(groundAt(state, MID, "clear", CONTENT.structures), "normal");
        assert.equal(groundAt(state, MID, "rain", CONTENT.structures), "wet");
        const sheltered = place(state, "greenhouse", MID);
        assert.equal(groundAt(sheltered, MID, "rain", CONTENT.structures), "normal", "no rain under glass");
        assert.equal(groundAt(sheltered, MID, "heatwave", CONTENT.structures), "normal", "no heatwave either");
    });

    it("pays more for waiting on a ripe crop, until it rots", () => {
        const ripe = advanceMild(stepFarm(farm(), { type: "plant", tile: MID, itemId: "wheat-seeds" }, ctx).state, CONTENT.crops.wheat!.stages);
        const pushed = advanceMild(ripe, 2);
        assert.equal(pushed.tiles[MID]!.crop!.ripeTurns, 2);
        // rotChances[3] is 1 in this config: the fourth wait always rots.
        const rotted = advanceMild(pushed, 2);
        assert.equal(rotted.tiles[MID]!.crop!.rotten, true);
        assert.throws(() => stepFarm(rotted, { type: "harvest", tile: MID }, ctx), FarmRuleError);
    });

    it("Hold stops a ripe crop rotting or improving for one turn", () => {
        let state = advanceMild(stepFarm(farm(), { type: "plant", tile: MID, itemId: "wheat-seeds" }, ctx).state, CONTENT.crops.wheat!.stages);
        state = stepFarm(state, { type: "play", inventoryId: card("farm.hold"), tile: MID }, ctx).state;
        state = advanceMild(state, 1);
        assert.equal(state.tiles[MID]!.crop!.ripeTurns, 0);
        assert.equal(state.tiles[MID]!.crop!.held, false);
    });

    it("plays a card once a cycle, spending a charge; harvests and clears are free", () => {
        const state = plant(farm(), MID);
        const result = stepFarm(state, { type: "play", inventoryId: card("farm.read-sky"), tile: MID }, ctx);
        assert.deepEqual(result.cardPlayed, { inventoryId: card("farm.read-sky"), chargesLeft: 9 });
        assert.equal(result.state.skyRead, true);
        assert.deepEqual(result.state.played, [card("farm.read-sky")]);
        assert.equal(playsLeft(result.state), GEO_HAND_SIZE - 1);
        // Out of the hand and back is the same card: still played.
        assert.throws(() => stepFarm(result.state, { type: "play", inventoryId: card("farm.read-sky"), tile: MID }, ctx), /played this cycle/);
        assert.equal(stepFarm(result.state, { type: "clear", tile: MID }, ctx).state.tiles[MID]!.crop, null);
        const next = tickFarm(result.state, ctx).state;
        assert.deepEqual(next.played, [], "the hand is ready again next cycle");
    });

    it("allows GEO_HAND_SIZE plays a cycle, however the hand is swapped", () => {
        // Every card in this test hand is a different one, as if swapped in after each play.
        const fresh = hand.filter((entry) => entry.cardId === "farm.read-sky" || entry.cardId === "farm.exterminators-oath" || entry.cardId === "farm.moon-rite");
        let state = { ...farm(), played: ["a", "b", "c", "d"] };
        state = stepFarm(state, { type: "play", inventoryId: fresh[0]!.inventoryId, tile: 0 }, ctx).state;
        assert.equal(playsLeft(state), 0);
        assert.throws(() => stepFarm(state, { type: "play", inventoryId: fresh[1]!.inventoryId, tile: 0 }, ctx), /played 5 cards this cycle/);
    });

    it("harvests every ripe crop in one go, leaving the growing ones", () => {
        let state = plant(ripe(farm(), "wheat", [MID - 1, MID + 1]), MID);
        const result = stepFarm(state, { type: "harvest-all" }, ctx);
        assert.equal(result.state.tiles[MID - 1]!.crop, null);
        assert.equal(result.state.tiles[MID + 1]!.crop, null);
        assert.ok(result.state.tiles[MID]!.crop, "still growing");
        assert.equal(result.xp, CONTENT.crops.wheat!.xp * 2);
        state = result.state;
        assert.throws(() => stepFarm(state, { type: "harvest-all" }, ctx), /Nothing is ripe/);
    });

    it("plants every empty tile at once, planned tiles with their own seed first, while seeds last", () => {
        let state = plant(farm(), MID);
        state = stepFarm(state, { type: "blueprint", tile: MID + 1, cropId: "melon" }, ctx).state;
        const empty = state.tiles.filter((tile) => tile.owned && !tile.crop).length;
        const result = stepFarm(state, { type: "plant-all", itemId: "wheat-seeds" }, ctx);
        assert.equal(result.state.tiles[MID + 1]!.crop!.cropId, "melon", "the plan wins");
        assert.equal(result.state.tiles[MID]!.crop!.stage, 0, "the growing crop is left alone");
        const wheat = result.itemsUsed.find((entry) => entry.itemId === "wheat-seeds")!.quantity;
        assert.equal(wheat, Math.min(5, empty - 1), "the rest take wheat, up to the 5 held");
        assert.deepEqual(result.itemsUsed.find((entry) => entry.itemId === "melon-seeds"), { itemId: "melon-seeds", quantity: 1 });
        assert.throws(() => stepFarm(state, { type: "plant-all", itemId: "carrot-seeds" }, { ...ctx, held: {} }), /none of those seeds/);
        assert.throws(() => stepFarm(state, { type: "plant-all", itemId: "wheat" }, ctx), /aren't seeds/);
    });

    it("Scythe Sweep harvests every ripe crop in reach, with seeds back twice", () => {
        let state = farm();
        const row = Math.floor(MID / GEO_FARM_SIZE);
        for (const tile of [MID - 1, MID, MID + 1]) state = stepFarm(state, { type: "plant", tile, itemId: "wheat-seeds" }, ctx).state;
        state = advanceMild(state, CONTENT.crops.wheat!.stages);
        const result = stepFarm(state, { type: "play", inventoryId: card("farm.scythe-sweep"), tile: MID }, ctx);
        const seeds = result.gains.find((gain) => gain.itemId === "wheat-seeds")!.quantity;
        assert.ok(seeds >= 3 * 2 * CONTENT.crops.wheat!.seedsBack.min, "two seed rolls per crop");
        assert.equal(result.state.tiles.filter((tile, i) => Math.floor(i / GEO_FARM_SIZE) === row && tile.crop).length, 0);
        assert.equal(result.xp, CONTENT.crops.wheat!.xp * 3);
    });

    it("Read the Sky shows three turns of weather until the next turn", () => {
        assert.equal(forecast(farm(), config).length, 1);
        const read = stepFarm(farm(), { type: "play", inventoryId: card("farm.read-sky"), tile: 0 }, ctx).state;
        assert.equal(forecast(read, config).length, 3);
        assert.equal(forecast(tickFarm(read, ctx).state, config).length, 1);
    });

    it("forecast is the weather that comes", () => {
        const state = farm();
        const said = forecast(state, config)[0]!;
        const log = tickFarm(state, ctx).log[0]!;
        assert.match(log.toLowerCase(), new RegExp(said));
    });

    it("reads only a farm saved at this version: older ones are wiped, not upgraded", () => {
        assert.deepEqual(readFarm(farm()), farm());
        assert.throws(() => readFarm({ ...farm(), version: 15 }), /wipe:geo/);
    });

    it("unlocks only tiles touching the farm, each dearer than the last", () => {
        const state = farm();
        assert.ok(!isUnlockable(state, 0));
        const edge = MID - 2;
        const first = stepFarm(state, { type: "unlock", tile: edge }, ctx);
        assert.equal(first.coins, config.unlockCost.first);
        assert.deepEqual(first.itemsUsed, [], "the first tiles are coins only");
        const second = stepFarm(first.state, { type: "unlock", tile: edge - 1 }, ctx);
        assert.equal(second.coins, config.unlockCost.first + config.unlockCost.step);
        assert.throws(() => stepFarm(state, { type: "unlock", tile: 0 }, ctx), FarmRuleError);
    });

    it("asks Compost for a tile once a few are bought", () => {
        const { compost, compostFrom, itemId } = config.unlockCost;
        const bought = { ...farm(), unlocked: compostFrom };
        const edge = MID - 2;
        assert.throws(() => stepFarm(bought, { type: "unlock", tile: edge }, { ...ctx, held: {} }), /needs 1 Compost; you have 0/);
        const paid = stepFarm(bought, { type: "unlock", tile: edge }, { ...ctx, held: { [itemId]: compost } });
        assert.deepEqual(paid.itemsUsed, [{ itemId, quantity: compost }]);
        assert.equal(paid.state.tiles[edge]!.owned, true);
    });

    it("blueprints any tile, costing nothing", () => {
        const result = stepFarm(farm(), { type: "blueprint", tile: 0, cropId: "melon" }, ctx);
        assert.equal(result.state.tiles[0]!.blueprint, "melon");
        assert.throws(() => stepFarm(farm(), { type: "blueprint", tile: 0, cropId: "nope" }, ctx), FarmRuleError);
    });

    describe("pests", () => {
        it("a mouse eats the crop it telegraphed, and the crop is gone", () => {
            const state = withPest(plant(farm(), MID + 1), "field-mouse", MID);
            assert.deepEqual(state.pests[0]!.intent, { kind: "eat", tile: MID + 1 });
            const after = advanceMild(state, 1);
            assert.equal(after.tiles[MID + 1]!.crop, null);
            assert.equal(after.pests[0]!.tile, MID + 1);
        });

        it("misses if the crop is cleared first", () => {
            let state = { ...withPest(plant(farm(), MID + 1), "field-mouse", MID) };
            state = stepFarm(state, { type: "clear", tile: MID + 1 }, ctx).state;
            const result = tickFarm(state, ctx);
            assert.ok(result.log.some((line) => line.includes("found nothing to eat")));
        });

        it("the Swat card clears the pests on a tile, with drops and XP", () => {
            const state = withPest(farm(), "field-mouse", MID);
            const result = stepFarm(state, { type: "play", inventoryId: card("farm.swat"), tile: MID }, ctx);
            assert.equal(result.state.pests.length, 0);
            assert.ok(result.gains.some((gain) => gain.itemId === "mouse-tail"));
            assert.equal(result.xp, CONTENT.pests["field-mouse"]!.xp);
            assert.throws(() => stepFarm(farm(), { type: "play", inventoryId: card("farm.swat"), tile: MID }, ctx), /No pests there/);
        });

        it("Snap Trap catches a pest moving onto it, and lasts one turn", () => {
            let state = { ...withPest(plant(farm(), MID + 1), "field-mouse", MID) };
            state = stepFarm(state, { type: "play", inventoryId: card("farm.snap-trap"), tile: MID + 1 }, ctx).state;
            const result = tickFarm(state, ctx);
            assert.equal(result.state.pests.length, 0);
            assert.ok(result.state.tiles[MID + 1]!.crop, "caught before it ate");
            assert.ok(result.log.includes("Your Snap Trap saved the Wheat there."));
            assert.ok(result.gains.some((gain) => gain.itemId === "mouse-tail"));

            const wasted = stepFarm({ ...farm() }, { type: "play", inventoryId: card("farm.snap-trap"), tile: MID }, ctx).state;
            assert.equal(tickFarm(wasted, ctx).state.tiles[MID]!.trap, false);
        });

        it("Smoke clears every pest in a 3×3, and ripe crops in it lose their wait", () => {
            let state = advanceMild(plant(farm(), MID), CONTENT.crops.wheat!.stages + 1);
            assert.equal(state.tiles[MID]!.crop!.ripeTurns, 1);
            state = { ...withPest(withPest(state, "mite", MID - 1), "earthworm", MID + GEO_FARM_SIZE + 1) };
            const result = stepFarm(state, { type: "play", inventoryId: card("farm.smoke"), tile: MID }, ctx);
            assert.equal(result.state.pests.length, 0);
            assert.equal(result.state.tiles[MID]!.crop!.ripeTurns, 0);
            assert.throws(() => stepFarm(result.state, { type: "play", inventoryId: card("farm.smoke"), tile: MID }, ctx), FarmRuleError);
        });

        it("Bait Ring pulls the pests around onto the middle tile", () => {
            let state = { ...withPest(withPest(farm(), "earthworm", MID - 1), "mite", MID + GEO_FARM_SIZE) };
            state = stepFarm(state, { type: "play", inventoryId: card("farm.bait-ring"), tile: MID }, ctx).state;
            assert.deepEqual(state.pests.map((pest) => pest.tile), [MID, MID]);
        });

        it("an earthworm saps the crop it's on", () => {
            const state = withPest(plant(farm(), MID), "earthworm", MID);
            assert.equal(state.pests[0]!.intent.kind, "sap");
            const after = tickFarm(state, under("clear")).state;
            assert.equal(after.tiles[MID]!.crop!.stage, 0);
            assert.ok(after.tiles[MID]!.crop, "it doesn't eat it");
        });

        it("a mite stops its crop growing, then breeds next door", () => {
            let state = plant(plant(farm(), MID), MID + 1);
            state = withPest(state, "mite", MID);
            state = advanceMild(state, 1);
            assert.equal(state.tiles[MID]!.crop!.stage, 0, "sapped");
            assert.equal(state.tiles[MID + 1]!.crop!.stage, 1);
            assert.deepEqual(state.pests[0]!.intent, { kind: "breed", tile: MID + 1 });
            state = advanceMild(state, 1);
            assert.equal(state.pests.length, 2);
            assert.ok(state.pests.some((pest) => pest.tile === MID + 1));
        });

        it("arrive next to the crops they like, but not before fromTurn", () => {
            const eager = { ...ctx, config: { ...config, pests: { fromTurn: 2, chancePerCrop: 1, maxChance: 1, max: 4 } } };
            let state = plant(farm(), MID, "melon-seeds");
            state = tickFarm(state, eager).state;
            assert.equal(state.pests.length, 0);
            state = tickFarm(state, eager).state;
            assert.equal(state.pests.length, 1);
            const pest = state.pests[0]!;
            assert.ok(CONTENT.pests[pest.pestId]!.likes.includes("melon"));
            const dx = Math.abs((pest.tile % GEO_FARM_SIZE) - (MID % GEO_FARM_SIZE));
            const dy = Math.abs(Math.floor(pest.tile / GEO_FARM_SIZE) - Math.floor(MID / GEO_FARM_SIZE));
            assert.ok(dx <= 1 && dy <= 1);
        });

    });

    describe("mutations", () => {
        it("sprouts on an empty tile when the recipe holds", () => {
            const state = ripe(farm(), "wheat", [MID - 1, MID + 1]);
            const result = tickFarm(state, under("heatwave", sure()));
            assert.equal(result.state.tiles[MID]!.crop?.cropId, "emberwheat");
            assert.ok(result.log.some((line) => line.includes("Emberwheat")));
        });

        it("a setup kept together gets likelier each cycle, and says so, until it sprouts", () => {
            const ramp = { ...sure(0), config: { ...config, mutationRamp: 1 } };
            const state = ripe(farm(), "wheat", [MID - 1, MID + 1]);
            const first = tickFarm(state, under("heatwave", ramp));
            assert.equal(first.state.tiles[MID]!.crop, null, "a 0% recipe can't sprout on its first cycle");
            // The tiles above and below MID touch both parents too.
            assert.deepEqual(first.state.setups.find((setup) => setup.tile === MID), { tile: MID, mutationId: "emberwheat", cycles: 1 });
            assert.ok(first.log.some((line) => line.startsWith("Emberwheat is close at")));
            const second = tickFarm(first.state, under("heatwave", ramp));
            assert.equal(second.state.tiles[MID]!.crop?.cropId, "emberwheat");
            assert.ok(second.log.some((line) => /From 2 ripe Wheat \+ the heatwave \+ dry ground, helped by 1 cycle of keeping it set up\./.test(line)));
            assert.deepEqual(second.state.setups, []);
            // A cycle it doesn't hold starts it over.
            assert.deepEqual(tickFarm(first.state, under("clear", ramp)).state.setups, []);
        });

        it("doesn't sprout without the weather or the ground, or with too few parents", () => {
            const wrongSky = ripe(farm(), "wheat", [MID - 1, MID + 1]);
            assert.equal(tickFarm(wrongSky, under("clear", sure())).state.tiles[MID]!.crop, null);
            // Emberwheat wants dry ground: a Well within reach spoils it.
            const watered = place(ripe(farm(), "wheat", [MID - 1, MID + 1]), "well", MID - GEO_FARM_SIZE);
            assert.equal(tickFarm(watered, under("heatwave", sure())).state.tiles[MID]!.crop, null);
            const oneParent = ripe(farm(), "wheat", [MID - 1]);
            assert.ok(tickFarm(oneParent, under("heatwave", sure())).state.tiles.every((tile) => tile.crop?.cropId !== "emberwheat"));
        });

        it("can need a pest nearby", () => {
            let state = ripe(farm(), "pumpkin", [MID - 1]);
            assert.ok(tickFarm(state, sure()).state.tiles.every((tile) => tile.crop?.cropId !== "grinning-gourd"));
            state = withPest(state, "field-mouse", MID + 1);
            state.pests[0]!.intent = { kind: "move", tile: MID + 1 };
            assert.equal(tickFarm(state, sure()).state.tiles[MID]!.crop?.cropId, "grinning-gourd");
        });

        it("Hand Pollinate boosts the odds on its tile for one turn", () => {
            let state = { ...ripe(farm(), "wheat", [MID - 1, MID + 1]) };
            // 0.5 × pollinateBoost 2 = certain.
            state = stepFarm(state, { type: "play", inventoryId: card("farm.hand-pollinate"), tile: MID }, sure(0.5)).state;
            assert.equal(state.tiles[MID]!.pollinated, true);
            const after = tickFarm(state, under("heatwave", sure(0.5))).state;
            assert.equal(after.tiles[MID]!.crop?.cropId, "emberwheat");
            assert.equal(after.tiles[MID]!.pollinated, false);
            assert.throws(() => stepFarm({ ...after }, { type: "play", inventoryId: card("farm.hand-pollinate"), tile: MID }, ctx), FarmRuleError);
        });

        it("grows and harvests like a crop, with no seeds back", () => {
            const mutation = CONTENT.mutations.emberwheat!;
            const state = {
                ...farm(),
                tiles: farm().tiles.map((tile, i) =>
                    i === MID ? { ...tile, crop: { cropId: mutation.id, stage: mutation.stages, ripeTurns: 0, held: false, rotten: false } } : tile,
                ),
            };
            const result = stepFarm(state, { type: "harvest", tile: MID }, ctx);
            assert.deepEqual(result.gains.map((gain) => gain.itemId), [mutation.produce]);
            assert.equal(result.xp, mutation.xp);
        });
    });

    describe("structures", () => {

        it("builds onto an empty tile from its materials, and demolishes for nothing back", () => {
            const placed = stepFarm(farm(), { type: "place", tile: MID, structureId: "pond" }, ctx);
            assert.equal(placed.state.tiles[MID]!.structure?.structureId, "pond");
            assert.deepEqual(placed.itemsUsed, CONTENT.structures.pond!.cost, "its materials are spent");
            assert.throws(() => stepFarm(placed.state, { type: "plant", tile: MID, itemId: "wheat-seeds" }, ctx), FarmRuleError);
            assert.throws(() => stepFarm(plant(farm(), MID), { type: "place", tile: MID, structureId: "pond" }, ctx), FarmRuleError);
            assert.throws(() => stepFarm(farm(), { type: "place", tile: MID, structureId: "pond" }, { ...ctx, held: {} }), /needs 4 Melon; you have 0/);
            assert.throws(() => stepFarm(farm(), { type: "place", tile: MID, structureId: "no-such" }, ctx), /isn't a farm structure/);
            assert.throws(() => stepFarm(farm(), { type: "place", tile: 0, structureId: "pond" }, ctx), /isn't yours/, "not on a locked tile");
            const picked = stepFarm(placed.state, { type: "demolish", tile: MID }, ctx);
            assert.equal(picked.state.tiles[MID]!.structure, null);
            assert.deepEqual(picked.gains, [], "nothing back");
        });

        it("a Pond keeps the tiles beside it wet, and its frog eats a pest", () => {
            let state = place(farm(), "pond", MID);
            state = withPest(state, "earthworm", MID + 1);
            const after = tickFarm(state, ctx);
            assert.equal(after.state.pests.length, 0);
            assert.ok(after.log.some((line) => line.includes("frog")));
            assert.equal(groundAt(after.state, MID - 1, "heatwave", CONTENT.structures), "wet");
            assert.equal(groundAt(after.state, MID - 1 - GEO_FARM_SIZE, "heatwave", CONTENT.structures), "dry", "only the 4 beside it");
            assert.equal(after.gains.length, 0, "the frog had it: no drops");
        });

        it("a Compost Bin turns every few harvests and clears into Compost", () => {
            const bin = CONTENT.structures["compost-bin"]!;
            if (bin.effect.kind !== "compost") throw new Error("not a Compost Bin");
            const { capacity, itemId } = bin.effect;
            let state = place(farm(), "compost-bin", MID);
            for (let i = 1; i < capacity; i++) {
                const cleared = stepFarm(plant(state, MID + 1), { type: "clear", tile: MID + 1 }, ctx);
                assert.deepEqual(cleared.gains, []);
                state = cleared.state;
            }
            assert.equal(state.tiles[MID]!.structure!.compost, capacity - 1);
            const full = stepFarm(plant(state, MID + 1), { type: "clear", tile: MID + 1 }, ctx);
            assert.deepEqual(full.gains, [{ itemId, quantity: 1 }]);
            assert.equal(full.state.tiles[MID]!.structure!.compost, 0);
        });

        it("a Pest Cage keeps a pest alive, which counts for mutation recipes", () => {
            let state = { ...place(ripe(farm(), "pumpkin", [MID - 1]), "pest-cage", MID + 1) };
            state = withPest(state, "field-mouse", MID + GEO_FARM_SIZE + 1);
            state = stepFarm(state, { type: "cage", tile: MID + GEO_FARM_SIZE + 1 }, ctx).state;
            assert.equal(state.pests.length, 0);
            assert.equal(state.tiles[MID + 1]!.structure!.caged, "field-mouse");
            assert.throws(() => stepFarm(state, { type: "demolish", tile: MID + 1 }, ctx), FarmRuleError);
            assert.equal(tickFarm(state, sure()).state.tiles[MID]!.crop?.cropId, "grinning-gourd");
            const released = stepFarm(state, { type: "release", tile: MID + 1 }, ctx);
            assert.equal(released.state.tiles[MID + 1]!.structure!.caged, null);
            assert.ok(released.gains.some((gain) => gain.itemId === "mouse-tail"));
        });

        it("the Pesthunter takes a caged pest for points, spent in its shop", () => {
            let state = { ...place(farm(), "pest-cage", MID + 1) };
            state = withPest(state, "field-mouse", MID);
            state = stepFarm(state, { type: "cage", tile: MID }, ctx).state;
            const turnedIn = stepFarm(state, { type: "turn-in", tile: MID + 1 }, ctx);
            assert.equal(turnedIn.state.tiles[MID + 1]!.structure!.caged, null);
            assert.equal(turnedIn.state.pesthunterPoints, CONTENT.pests["field-mouse"]!.bounty);
            assert.equal(turnedIn.gains.length, 0);
            assert.throws(() => stepFarm(turnedIn.state, { type: "turn-in", tile: MID + 1 }, ctx), FarmRuleError);

            const [offer] = config.pesthunter.shop;
            const bought = stepFarm(farm({ pesthunterPoints: offer!.price + 1 }), { type: "pesthunter-buy", offer: 0 }, ctx);
            assert.equal(bought.state.pesthunterPoints, 1);
            assert.deepEqual(bought.gains, [{ itemId: offer!.itemId, quantity: 1 }]);
            assert.throws(() => stepFarm(farm(), { type: "pesthunter-buy", offer: 0 }, ctx), FarmRuleError);
            assert.throws(() => stepFarm(farm({ pesthunterPoints: 999 }), { type: "pesthunter-buy", offer: 999 }, ctx), FarmRuleError);
        });

        it("a Beehive boosts mutation odds around it", () => {
            // 0.5 × hive 1.5 isn't certain, but 0.7 × 1.5 is.
            const state = place(ripe(farm(), "wheat", [MID - 1, MID + 1]), "beehive", MID + GEO_FARM_SIZE);
            const noSwarm = { ...sure(0.7), structures: { ...CONTENT.structures, beehive: { ...CONTENT.structures.beehive!, effect: { kind: "beehive" as const, boost: 1.5, swarmChance: 0 } } } };
            assert.equal(tickFarm(state, under("heatwave", noSwarm)).state.tiles[MID]!.crop?.cropId, "emberwheat");
        });

        it("a Jukebox's tune decides which pest comes", () => {
            const eager = { ...ctx, config: { ...config, pests: { fromTurn: 0, chancePerCrop: 1, maxChance: 1, max: 4 } } };
            let state = { ...place(plant(plant(farm(), MID - 1), MID + 1, "melon-seeds"), "jukebox", MID) };
            state = stepFarm(state, { type: "tune", tile: MID, pestId: "earthworm" }, eager).state;
            const boosted = { ...eager, structures: { ...CONTENT.structures, jukebox: { ...CONTENT.structures.jukebox!, effect: { kind: "jukebox" as const, boost: 1e9 } } } };
            for (let seed = 1; seed <= 5; seed++) {
                const after = tickFarm({ ...state, seed }, boosted).state;
                assert.equal(after.pests[0]?.pestId, "earthworm");
            }
        });
    });

    describe("weather", () => {
        const growing = (cropId = "wheat", stage = 1) => ({
            ...farm(),
            tiles: farm().tiles.map((tile, i) =>
                i === MID ? { ...tile, crop: { cropId, stage, ripeTurns: 0, held: false, rotten: false } } : tile,
            ),
        });

        it("each turn plays the weather of the period it came over, and the forecast is the periods ahead", () => {
            const period = config.turnHours * HOUR;
            const lookup = (start: number): GeoFarmWeather => (start === NOW.getTime() ? "rain" : start === NOW.getTime() + period ? "heatwave" : "clear");
            assert.deepEqual(forecast({ ...farm(), skyRead: true }, config, lookup), ["rain", "heatwave", "clear"]);
            const played = catchUp(farm(), { ...ctx, weather: lookup, now: new Date(NOW.getTime() + period * 2.5) });
            assert.match(played.log[1]!, /Cycle 1: Rain/);
            assert.ok(played.log.some((line) => /Cycle 2: Heatwave/.test(line)));
        });

        it("a frost pauses growth in the open, and kills nothing", () => {
            const young = tickFarm(growing("wheat", 1), under("frost")).state;
            assert.equal(young.tiles[MID]!.crop!.stage, 1, "the seedling survives, ungrown");
        });

        it("a Greenhouse roofs its 3×3, over crops, and they grow under it as on a clear day", () => {
            const state = stepFarm(growing("wheat", 1), { type: "place", tile: MID, structureId: "greenhouse" }, ctx).state;
            const roofed = state.tiles.flatMap((tile, index) => (tile.roof ? [index] : []));
            assert.deepEqual(roofed, footprint(MID, { width: 3, height: 3 }));
            assert.equal(state.tiles[MID]!.structure, null, "a roof stands on nothing");
            const after = tickFarm(state, under("frost"));
            assert.equal(after.state.tiles[MID]!.crop!.stage, 2, "grew as on a clear day");
            assert.ok(after.log.includes("Your Greenhouse kept 1 crop growing through the frost."));
        });
    });

    describe("multi-tile structures", () => {
        const owned = (state: FarmState) => ({ ...state, tiles: state.tiles.map((tile) => ({ ...tile, owned: true })) });
        /** A Pond made 2×1, to try a solid footprint. */
        const widePond: FarmContext = {
            ...ctx,
            structures: { ...CONTENT.structures, pond: { ...CONTENT.structures.pond!, size: { width: 2, height: 1 } } },
        };

        it("are centred on the tile they're placed from, and need every tile under them owned", () => {
            assert.deepEqual(footprint(MID, { width: 3, height: 3 }), [MID - GEO_FARM_SIZE - 1, MID - GEO_FARM_SIZE, MID - GEO_FARM_SIZE + 1, MID - 1, MID, MID + 1, MID + GEO_FARM_SIZE - 1, MID + GEO_FARM_SIZE, MID + GEO_FARM_SIZE + 1]);
            assert.deepEqual(footprint(MID, { width: 2, height: 1 }), [MID, MID + 1], "an even side reaches right");
            assert.throws(() => stepFarm(farm(), { type: "place", tile: MID + 1, structureId: "greenhouse" }, ctx), /every tile under it must be yours/);
            assert.throws(() => stepFarm(owned(farm()), { type: "place", tile: 0, structureId: "greenhouse" }, ctx), /runs off the farm/);
        });

        it("can't be built below its requiredLevel, but can be demolished", () => {
            const gated: FarmContext = {
                ...ctx,
                structures: { ...CONTENT.structures, pond: { ...CONTENT.structures.pond!, requiredLevel: 10 } },
            };
            assert.throws(() => stepFarm(farm(), { type: "place", tile: MID, structureId: "pond" }, gated), /needs farming level 10 \(you're 1\)/);
            const placed = stepFarm(farm(), { type: "place", tile: MID, structureId: "pond" }, { ...gated, farmingLevel: 10 }).state;
            assert.equal(placed.tiles[MID]!.structure?.structureId, "pond");
            assert.deepEqual(stepFarm(placed, { type: "demolish", tile: MID }, gated).gains, []);
        });

        it("a solid one covers its tiles, and is demolished whole from any of them", () => {
            const placed = stepFarm(farm(), { type: "place", tile: MID, structureId: "pond" }, widePond).state;
            assert.equal(placed.tiles[MID]!.structure?.structureId, "pond");
            assert.equal(placed.tiles[MID + 1]!.partOf, MID);
            assert.throws(() => stepFarm(placed, { type: "plant", tile: MID + 1, itemId: "wheat-seeds" }, widePond), /structure stands there/);
            assert.throws(() => stepFarm(plant(farm(), MID + 1), { type: "place", tile: MID, structureId: "pond" }, widePond), /Clear the crop/);
            const picked = stepFarm(placed, { type: "demolish", tile: MID + 1 }, widePond);
            assert.equal(picked.state.tiles[MID]!.structure, null);
            assert.equal(picked.state.tiles[MID + 1]!.partOf, null);
            assert.deepEqual(picked.gains, []);
        });

        it("a Greenhouse can't go over a structure, and is demolished whole from any tile under it", () => {
            assert.throws(() => stepFarm(place(farm(), "pond", MID + 1), { type: "place", tile: MID, structureId: "greenhouse" }, ctx), /structure stands/);
            const roofed = plant(place(farm(), "greenhouse", MID), MID);
            const picked = stepFarm(roofed, { type: "demolish", tile: MID + GEO_FARM_SIZE + 1 }, ctx);
            assert.ok(picked.state.tiles.every((tile) => tile.roof === null));
            assert.equal(picked.state.tiles[MID]!.crop?.cropId, "wheat", "the crops stay, in the open");
            assert.deepEqual(picked.gains, []);
        });

    });

    describe("events", () => {
        /** Only `eventId` exists, and one is telegraphed every turn. */
        const only = (eventId: string): FarmContext => ({
            ...ctx,
            events: { [eventId]: CONTENT.farmEvents[eventId]! },
            config: { ...config, events: { fromTurn: 0, chance: 1 } },
        });

        it("telegraphs an event for the next turn, then runs it", () => {
            const first = tickFarm(farm(), only("bumper-harvest"));
            assert.equal(first.state.nextEvent, "bumper-harvest");
            assert.ok(first.log.some((line) => line.includes("Coming next cycle")));
            const second = tickFarm(first.state, only("bumper-harvest")).state;
            assert.equal(second.activeEvent?.eventId, "bumper-harvest");
        });

        it("Bumper Harvest adds yield for the turn", () => {
            const ripeWheat = ripe(farm(), "wheat", [MID]);
            const plainYield = stepFarm(ripeWheat, { type: "harvest", tile: MID }, ctx).gains.find((gain) => gain.itemId === "wheat")!.quantity;
            const bumper = { ...ripeWheat, activeEvent: { eventId: "bumper-harvest", offers: [] } };
            const bumperYield = stepFarm(bumper, { type: "harvest", tile: MID }, ctx).gains.find((gain) => gain.itemId === "wheat")!.quantity;
            assert.equal(bumperYield, plainYield + 1);
        });

        it("a Pest Swarm brings extra pests, past the cap", () => {
            const state = { ...plant(farm(), MID), nextEvent: "pest-swarm" };
            const after = tickFarm(state, ctx).state;
            assert.equal(after.pests.length, 2);
        });

        it("a Blood Moon lets Bloodmelon sprout beside a Pond", () => {
            const melons = ripe(farm(), "melon", [MID - 1, MID + 1]);
            const sure = { ...ctx, mutations: { bloodmelon: { ...CONTENT.mutations.bloodmelon!, chance: 1 } } };
            assert.equal(tickFarm({ ...melons, nextEvent: "blood-moon" }, sure).state.tiles[MID]!.crop, null, "no Pond");
            const ponded = place(melons, "pond", MID - GEO_FARM_SIZE);
            assert.equal(tickFarm(ponded, sure).state.tiles[MID]!.crop, null, "no Blood Moon");
            assert.equal(tickFarm({ ...ponded, nextEvent: "blood-moon" }, sure).state.tiles[MID]!.crop?.cropId, "bloodmelon");
        });

        it("the Travelling Merchant sells each offer once", () => {
            const state = tickFarm({ ...farm(), nextEvent: "travelling-merchant" }, ctx).state;
            const offers = state.activeEvent!.offers;
            assert.equal(offers.length, 2);
            const bought = stepFarm(state, { type: "buy", offer: 0 }, ctx);
            assert.equal(bought.coins, offers[0]!.price);
            assert.deepEqual(bought.gains, [{ itemId: offers[0]!.itemId, quantity: 1 }]);
            assert.throws(() => stepFarm(bought.state, { type: "buy", offer: 0 }, ctx), FarmRuleError);
        });
    });

    describe("orders", () => {
        const price = (itemId: string) => CONTENT.items[itemId]?.sellValue ?? 1;
        const board = () => refreshOrders(farm(), config, CONTENT.crops, price, NOW);

        it("posts the week's orders, and keeps them until the week ends", () => {
            const state = board();
            assert.equal(state.orders!.list.length, config.orders.perWeek);
            assert.equal(state.orders!.week, weekOf(NOW));
            assert.equal(refreshOrders(state, config, CONTENT.crops, price, new Date(NOW.getTime() + HOUR)), state);
            const nextWeek = refreshOrders(state, config, CONTENT.crops, price, new Date(NOW.getTime() + 7 * 24 * HOUR));
            assert.notEqual(nextWeek.orders!.week, state.orders!.week);
        });

        it("takes a deposit to accept, and pays reward and deposit on delivery", () => {
            const state = board();
            const order = state.orders!.list[0]!;
            const accepted = stepFarm(state, { type: "accept-order", orderId: order.id }, ctx);
            assert.equal(accepted.coins, order.deposit);
            const partial = stepFarm(accepted.state, { type: "deliver-order", orderId: order.id }, { ...ctx, held: { [order.itemId]: order.quantity - 1 } });
            assert.equal(partial.coinsGained, 0);
            const done = stepFarm(partial.state, { type: "deliver-order", orderId: order.id }, { ...ctx, held: { [order.itemId]: 5 } });
            assert.deepEqual(done.itemsUsed, [{ itemId: order.itemId, quantity: 1 }]);
            assert.equal(done.coinsGained, order.reward + order.deposit);
            assert.equal(done.state.orders!.list[0]!.status, "done");
            assert.throws(() => stepFarm(state, { type: "deliver-order", orderId: order.id }, ctx), FarmRuleError);
        });
    });

    describe("global events and contests", () => {
        it("picks the same global event for a week every time, in its last days", () => {
            const week = weekOf(NOW);
            const global = globalEventFor(week, config)!;
            assert.deepEqual(globalEventFor(week, config), global);
            assert.equal(global.endsAt.getTime(), weekEndsAt(week).getTime());
            const days = config.globalEvents.find((entry) => entry.eventId === global.eventId)!.days;
            assert.equal(global.endsAt.getTime() - global.startsAt.getTime(), days * 24 * HOUR);
            assert.equal(activeGlobalEvent(new Date(global.startsAt.getTime() - HOUR), config, CONTENT.farmEvents), undefined);
            assert.equal(activeGlobalEvent(global.startsAt, config, CONTENT.farmEvents)?.id, global.eventId);
        });

        it("a global Blood Moon lets Bloodmelon sprout on any farm", () => {
            const rich = place(ripe(farm(), "melon", [MID - 1, MID + 1]), "pond", MID - GEO_FARM_SIZE);
            const sure = { ...ctx, mutations: { bloodmelon: { ...CONTENT.mutations.bloodmelon!, chance: 1 } }, globalEvent: CONTENT.farmEvents["blood-moon"] };
            assert.equal(tickFarm(rich, sure).state.tiles[MID]!.crop?.cropId, "bloodmelon");
        });

        it("a Meteor Shower drops Stardust on empty tiles", () => {
            const meteor = { ...CONTENT.farmEvents["meteor-shower"]!, effect: { kind: "meteor-shower" as const, mutationBoost: 2, dropChance: 1, itemId: "stardust" } };
            const after = tickFarm(farm(), { ...ctx, globalEvent: meteor });
            assert.deepEqual(after.gains, [{ itemId: "stardust", quantity: config.startSize ** 2 }]);
        });

        it("records each harvest for the contests, mutations marked", () => {
            const result = stepFarm(ripe(farm(), "wheat", [MID]), { type: "harvest", tile: MID }, ctx);
            assert.deepEqual(result.harvested.map(({ cropId, mutation }) => ({ cropId, mutation })), [{ cropId: "wheat", mutation: false }]);
        });

        it("rotates the crop contest through every plain crop", () => {
            const ids = Object.keys(CONTENT.crops);
            const seen = new Set(Array.from({ length: ids.length }, (_, i) => contestCropFor(100 + i, CONTENT.crops)));
            assert.equal(seen.size, ids.length);
        });
    });

    describe("gambles", () => {
        const withConfig = (patch: Partial<typeof config>): FarmContext => ({ ...ctx, config: { ...config, ...patch } });
        const wasteAt = (state: FarmState, tiles: number[]): FarmState => ({
            ...state,
            tiles: state.tiles.map((tile, i) => (tiles.includes(i) ? { ...tile, waste: true, crop: null } : tile)),
        });
        const calmWaste = { ...config.waste, spreadChance: 0, pestChance: 0 };

        it("an elite pest takes several hits; frogs and cages won't take it", () => {
            let state = { ...withPest(farm(), "shade-rat", MID) };
            assert.equal(state.pests[0]!.hp, 3);
            state = stepFarm(state, { type: "play", inventoryId: card("farm.swat"), tile: MID }, ctx).state;
            assert.equal(state.pests[0]!.hp, 2);
            assert.throws(() => stepFarm({ ...place(state, "pest-cage", MID + 1) }, { type: "cage", tile: MID }, ctx), FarmRuleError);
            const withPond = place(state, "pond", MID + 1);
            withPond.pests[0]!.intent = { kind: "move", tile: MID };
            assert.equal(tickFarm(withPond, ctx).state.pests.length, 1);
        });

        it("a Reactor speeds crops near it, and leaks waste that kills", () => {
            const reactor = (wasteChance: number): FarmContext => ({
                ...withConfig({ waste: calmWaste }),
                structures: {
                    ...CONTENT.structures,
                    "nuclear-reactor": { ...CONTENT.structures["nuclear-reactor"]!, effect: { kind: "reactor", radius: 2, growth: 1, wasteChance } },
                },
            });
            const state = plant(place(farm(), "nuclear-reactor", MID), MID + 1);
            assert.equal(tickFarm(state, under("clear", reactor(0))).state.tiles[MID + 1]!.crop!.stage, 2, "1 stage + 1 extra");
            const leaked = tickFarm(state, under("clear", reactor(1))).state;
            assert.equal(leaked.tiles.filter((tile) => tile.waste).length, 1);
        });

        it("waste blocks planting, is scrubbed by Hazmat Scrub, and boosts mutations beside it", () => {
            let state = { ...wasteAt(farm(), [MID]) };
            assert.throws(() => stepFarm(state, { type: "plant", tile: MID, itemId: "wheat-seeds" }, ctx), FarmRuleError);
            assert.equal(stepFarm(state, { type: "play", inventoryId: card("farm.hazmat-scrub"), tile: MID }, ctx).state.tiles[MID]!.waste, false);
            // Emberwheat at 0.4 × waste 3 is certain beside waste, not without it.
            state = ripe(farm(), "wheat", [MID - 1, MID + 1]);
            const mutations = { ...under("heatwave"), config: { ...config, waste: calmWaste }, mutations: { emberwheat: { ...CONTENT.mutations.emberwheat!, chance: 0.4 } } };
            const beside = wasteAt(state, [MID + GEO_FARM_SIZE]);
            assert.equal(tickFarm(beside, mutations).state.tiles[MID]!.crop?.cropId, "emberwheat");
        });

        it("waste spreads, and glowing pests crawl out", () => {
            const wild = withConfig({ waste: { ...config.waste, spreadChance: 1, pestChance: 1 }, pests: { ...config.pests, max: 4 } });
            const after = tickFarm(wasteAt(farm(), [MID]), wild).state;
            assert.equal(after.tiles.filter((tile) => tile.waste).length, 2);
            assert.ok(after.pests.some((pest) => pest.pestId === config.waste.pest));
        });

        it("Controlled Leak puts waste on the 4 tiles beside, killing crops", () => {
            const state = { ...plant(farm(), MID + 1) };
            const after = stepFarm(state, { type: "play", inventoryId: card("farm.controlled-leak"), tile: MID }, ctx).state;
            assert.deepEqual(
                [MID - 1, MID + 1, MID - GEO_FARM_SIZE, MID + GEO_FARM_SIZE].map((i) => after.tiles[i]!.waste),
                [true, true, true, true],
            );
            assert.equal(after.tiles[MID]!.waste, false);
            assert.equal(after.tiles[MID + 1]!.crop, null);
        });

        it("Tear the Veil opens a Portal: elite pests come through on its turn, then it shuts", () => {
            let state = { ...place(farm(), "portal", MID) };
            assert.throws(() => stepFarm(state, { type: "play", inventoryId: card("farm.tear-the-veil"), tile: MID + 1 }, ctx), FarmRuleError);
            state = stepFarm(state, { type: "play", inventoryId: card("farm.tear-the-veil"), tile: MID }, ctx).state;
            assert.equal(state.tiles[MID]!.structure!.open, true);
            const after = tickFarm(state, ctx).state;
            assert.equal(after.pests.length, 2);
            assert.ok(after.pests.every((pest) => (pest.hp ?? 1) > 1));
            assert.equal(after.tiles[MID]!.structure!.open, false);
        });

        it("the Shrine turns offerings into blessings, or curses", () => {
            const state = place(farm(), "mysterious-shrine", MID);
            const kind = withConfig({ shrine: { ...config.shrine, halfValue: 1e-9, blessings: config.shrine.blessings.map((b) => ({ ...b, weight: b.id === "plenty" || b.curse ? 1 : 0 })) } });
            const held = { ...kind, held: { wheat: 10 } };
            const blessed = stepFarm(state, { type: "offer", tile: MID, itemId: "wheat", quantity: 10 }, held);
            assert.deepEqual(blessed.itemsUsed, [{ itemId: "wheat", quantity: 10 }]);
            assert.deepEqual(blessed.state.blessings, [{ id: "plenty", turnsLeft: 3 }]);
            const ripeWheat = ripe(blessed.state, "wheat", [MID + 1]);
            const plainYield = stepFarm(ripe(state, "wheat", [MID + 1]), { type: "harvest", tile: MID + 1 }, ctx).gains[0]!.quantity;
            assert.equal(stepFarm(ripeWheat, { type: "harvest", tile: MID + 1 }, ctx).gains[0]!.quantity, plainYield + 1);

            const cruel = { ...withConfig({ shrine: { ...config.shrine, halfValue: 1e12, curseShare: 1 } }), held: { wheat: 1 } };
            const cursed = stepFarm(state, { type: "offer", tile: MID, itemId: "wheat", quantity: 1 }, cruel).state;
            assert.deepEqual(cursed.blessings.map((b) => b.id), ["pests"]);
            assert.throws(() => stepFarm(state, { type: "offer", tile: MID, itemId: "wheat", quantity: 5 }, cruel), FarmRuleError);
        });
    });

    describe("Well", () => {
        it("a Well keeps the crops near it growing through a heatwave, and gets the credit", () => {
            const state = plant(place(farm(), "well", MID), MID + 1);
            assert.equal(groundAt(state, MID + 1, "heatwave", CONTENT.structures), "normal");
            const hot = tickFarm(state, under("heatwave"));
            assert.equal(hot.state.tiles[MID + 1]!.crop!.stage, 1);
            assert.ok(hot.log.includes("Your Wells and Ponds kept 1 crop growing through the heatwave."));
            assert.equal(tickFarm(plant(farm(), MID + 1), under("heatwave")).state.tiles[MID + 1]!.crop!.stage, 0, "no Well: too dry");
        });

    });

    describe("Shrine curses", () => {
        it("Hexroot sprouts by ripe potatoes under the Curse of Hunger", () => {
            const sure = { ...ctx, mutations: { hexroot: { ...CONTENT.mutations.hexroot!, chance: 1 } } };
            const potatoes = ripe(farm(), "potato", [MID - 1, MID + 1]);
            assert.equal(tickFarm(potatoes, under("clear", sure)).state.tiles[MID]!.crop, null);
            const cursed = { ...potatoes, blessings: [{ id: "pests" as const, turnsLeft: 2 }] };
            assert.equal(tickFarm(cursed, under("clear", sure)).state.tiles[MID]!.crop?.cropId, "hexroot");
        });

        it("the Shrine keeps an offering it doesn't answer, and gives nothing back", () => {
            const state = place(farm(), "mysterious-shrine", MID);
            const stingy = { ...ctx, config: { ...config, shrine: { ...config.shrine, halfValue: 1e12, curseShare: 0 } }, held: { wheat: 1 } };
            const kept = stepFarm(state, { type: "offer", tile: MID, itemId: "wheat", quantity: 1 }, stingy);
            assert.deepEqual(kept.gains, []);
            assert.deepEqual(kept.itemsUsed, [{ itemId: "wheat", quantity: 1 }]);
        });
    });

    describe("more cards", () => {
        const play = (state: FarmState, cardId: string, tile = MID, context = ctx) =>
            stepFarm({ ...state }, { type: "play", inventoryId: card(cardId), tile }, context);

        it("Coax rolls the recipes that hold now, at half chance", () => {
            const wheat = ripe(farm(), "wheat", [MID - 1, MID + 1]);
            const sure = { ...under("heatwave"), mutations: { emberwheat: { ...CONTENT.mutations.emberwheat!, chance: 1 } } };
            // Chance 1 at half share is 50%: find a seed each way.
            const outcome = (seed: number) => play({ ...wheat, seed }, "farm.coax", MID, sure).state.tiles[MID]!;
            const seeds = Array.from({ length: 20 }, (_, i) => i + 1);
            assert.ok(seeds.some((seed) => outcome(seed).crop?.cropId === "emberwheat"));
            assert.ok(seeds.some((seed) => !outcome(seed).crop));
        });

        it("Moon Rite brings a Blood Moon next", () => {
            assert.equal(play(farm(), "farm.moon-rite").state.nextEvent, "blood-moon");
        });

        it("Exterminator's Oath doubles the next 3 pests' drops", () => {
            const sworn = play(withPest(farm(), "field-mouse", MID), "farm.exterminators-oath").state;
            assert.equal(sworn.oath, 3);
            const swatted = stepFarm(sworn, { type: "play", inventoryId: card("farm.swat"), tile: MID }, ctx);
            assert.equal(swatted.state.oath, 2);
            const tails = swatted.gains.find((gain) => gain.itemId === "mouse-tail")!.quantity;
            assert.ok(tails >= 2, "two rolls of 1–2 tails");
        });

        it("Chain Reaction turns waste into mutations, or Glow Beetles", () => {
            const state = { ...farm(), tiles: farm().tiles.map((tile, i) => (i === MID || i === MID + 1 ? { ...tile, waste: true } : tile)) };
            const after = play(state, "farm.chain-reaction").state;
            for (const i of [MID, MID + 1]) {
                const tile = after.tiles[i]!;
                assert.ok((!tile.waste && tile.crop) || after.pests.some((pest) => pest.tile === i));
            }
        });
    });
});

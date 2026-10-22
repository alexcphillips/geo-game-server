import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GeoFishingAction } from "@geo/shared";
import { CONTENT } from "../content";
import { WATER_RARITIES } from "../content";
import type { RodDef } from "../content/fishing";
import {
    biteRarities,
    FishingRuleError,
    newFishingState,
    rollTier,
    stepFishing,
    type CastBait,
    type FishingSetup,
    type FishingState,
} from "./fishing-run";

function rod(itemId: string): RodDef {
    const item = CONTENT.items[itemId];
    assert.ok(item?.kind === "equipment" && item.rod, `${itemId} is a rod`);
    return { name: item.name, ...item.rod };
}
const setupWith = (r: RodDef): FishingSetup => ({ rod: r, power: r.power + 1, seaCreatureChance: 0, fish: CONTENT.fish });
const setup = setupWith(rod("leviathan-rod"));
const twig = setupWith(rod("twig-rod"));
const hand = ["fish.reel", "fish.slack", "fish.steady", "fish.gaff"].map((cardId, i) => ({
    inventoryId: `inv-${i}`,
    itemId: `card.${cardId}`,
    cardId,
    chargesLeft: 40,
}));
const worm = { itemId: "worm-bait", chum: false };

/** Plays a cast to its end: strike the bite, then a simple card policy. */
function playCast(start: FishingState, using: FishingSetup = setup, bait: CastBait = worm): FishingState {
    let state = stepFishing(start, { type: "cast" }, using, bait);
    for (let guard = 0; state.phase !== "over"; guard++) {
        assert.ok(guard < 200, `stuck in ${state.phase}`);
        let action: GeoFishingAction;
        if (state.phase === "waiting") action = { type: "strike" };
        else if (state.phase === "creature") action = { type: "cutLine" };
        else {
            const f = state.fight!;
            const pick = f.distance <= 2 ? "fish.gaff" : f.tension > f.zoneHigh ? "fish.slack" : "fish.reel";
            action = { type: "play", inventoryId: state.hand.find((c) => c.cardId === pick)!.inventoryId };
        }
        state = stepFishing(state, action, using);
    }
    return state;
}

/** Casts and strikes the bite: the phase it hooks into. */
function hook(start: FishingState, using: FishingSetup): FishingState {
    let state = stepFishing(start, { type: "cast" }, using, worm);
    if (state.phase === "waiting") state = stepFishing(state, { type: "strike" }, using);
    return state;
}

describe("fishing Run", () => {
    it("casts a bare hook without bait: commons only, no sea creatures, no quality", () => {
        const always = { ...setup, seaCreatureChance: 1 };
        for (let seed = 1; seed <= 10; seed++) {
            const state = playCast(newFishingState("open", hand, seed), always, null);
            assert.equal(state.baitItemId, null);
            const result = state.result!;
            assert.equal(result.kind === "landed" || result.kind === "lost", true, `no sea creature on a bare hook (${result.kind})`);
            if (result.kind === "landed") {
                assert.equal(CONTENT.fish[result.fishId]?.rarity, "common");
                assert.equal(result.tier, null);
            }
        }
    });

    it("always ends a cast, and only hooks fish the water allows", () => {
        let state = newFishingState("puddle", hand, 7);
        for (let i = 0; i < 10; i++) {
            state = playCast(state);
            const result = state.result!;
            if (result.kind === "landed") assert.equal(CONTENT.fish[result.fishId]?.rarity, "common", "a puddle holds only commons");
        }
    });

    it("is replayable from its seed", () => {
        const a = playCast(newFishingState("open", hand, 42));
        const b = playCast(newFishingState("open", hand, 42));
        assert.deepEqual(a, b);
    });

    it("spends a charge per card played", () => {
        let state = newFishingState("open", hand, 3);
        state = stepFishing(state, { type: "cast" }, setup, worm);
        state = stepFishing(state, { type: "strike" }, setup);
        assert.equal(state.phase, "fight");
        const after = stepFishing(state, { type: "play", inventoryId: "inv-1" }, setup);
        assert.equal(after.hand[1]!.chargesLeft, 39);
        assert.equal(state.hand[1]!.chargesLeft, 40, "the stored state is never changed in place");
    });

    it("rolls no tier without Finesse, and never past the rod's best", () => {
        assert.equal(rollTier(0, "common", "ruby", 0.99), null);
        assert.equal(rollTier(100, "common", "silver", 0.99), "silver");
        assert.equal(rollTier(100, "common", null, 0.99), null, "a rod with no quality never grades a catch");
    });

    it("hooks only what the rod can handle, whatever the water", () => {
        assert.deepEqual(biteRarities("open", "common"), ["common"]);
        assert.deepEqual(biteRarities("lake", "uncommon"), ["common", "uncommon"]);
        assert.deepEqual(biteRarities("pond", "legendary"), ["common", "uncommon"]);

        for (let seed = 0; seed < 10; seed++) {
            const result = playCast(newFishingState("open", hand, seed), twig).result!;
            if (result.kind !== "landed") continue;
            assert.equal(CONTENT.fish[result.fishId]?.rarity, "common", "the Twig Rod hooks only commons");
            assert.equal(result.tier, null, "the Twig Rod never lands a quality catch");
        }
    });

    it("hooks a sea creature at the creature chance, and fighting it names the enemy", () => {
        const always = { ...setup, seaCreatureChance: 1 };
        const state = hook(newFishingState("open", hand, 5), always);
        assert.equal(state.phase, "creature");
        assert.equal(state.creatureId, "kraken");
        assert.throws(() => stepFishing(state, { type: "play", inventoryId: "inv-0" }, always), FishingRuleError);

        const fought = stepFishing(state, { type: "fightCreature" }, always);
        assert.equal(fought.phase, "over");
        assert.deepEqual(fought.result, { kind: "creature", enemyId: "kraken" });
        assert.equal(stepFishing(state, { type: "cutLine" }, always).result?.kind, "lost");
    });

    it("hooks no sea creature where none live, or at no chance", () => {
        const always = { ...setup, seaCreatureChance: 1 };
        for (let seed = 0; seed < 100; seed++) {
            assert.notEqual(hook(newFishingState("puddle", hand, seed), always).phase, "creature", "nothing lurks in a puddle");
            assert.notEqual(hook(newFishingState("open", hand, seed), setup).phase, "creature", "0% chance");
        }
    });

    it("lets rarer fish bite in better water", () => {
        assert.deepEqual(WATER_RARITIES.puddle, ["common"]);
        assert.ok(WATER_RARITIES.open.includes("legendary"));
    });
});

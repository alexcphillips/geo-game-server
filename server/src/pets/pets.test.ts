import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CONTENT, GAME_CONFIG } from "../content";
import type { PetDef } from "../content/content.types";
import { nextRarity, petModifiers, petProgress, petState, petXpFrom, upgradeQuote, xpToNextLevel } from "./pets";

const PETS = GAME_CONFIG.pets;

/** A made-up pet, so these tests don't move when real pets are tuned. */
const PET: PetDef = {
    id: "test-pet",
    name: "Test Pet",
    icon: "paw-print",
    image: "test-pet",
    description: "",
    skill: "combat",
    rarities: ["common", "rare", "legendary"],
    stats: [{ stat: "defense", kind: "flat", perLevel: 0.5 }],
    abilities: [
        { id: "a", name: "A", from: "common", description: "", modifiers: [{ stat: "speed", kind: "flat", perLevel: { common: 1, rare: 2, legendary: 3 } }] },
        { id: "b", name: "B", from: "rare", description: "", modifiers: [{ stat: "attack", kind: "percent", perLevel: 0.01 }] },
    ],
    upgrades: { common: { coins: 1000, items: [], hours: 10 }, rare: { coins: 5000, items: [], hours: 20 } },
};

/** Total XP to reach `level` at a rarity. */
function xpFor(level: number, rarity: "common" | "rare" | "legendary") {
    let total = 0;
    for (let l = 1; l < level; l++) total += xpToNextLevel(l, rarity);
    return total;
}

describe("pet levels", () => {
    it("starts at level 1 and caps at the max level", () => {
        assert.equal(petProgress(0, "common").level, 1);
        assert.equal(petProgress(xpFor(10, "common"), "common").level, 10);
        assert.equal(petProgress(xpFor(10, "common") - 1, "common").level, 9);
        const capped = petProgress(Number.MAX_SAFE_INTEGER, "common");
        assert.equal(capped.level, PETS.maxLevel);
        assert.equal(capped.xpForLevel, 0);
    });

    it("needs more XP at a higher rarity, so the same XP is a lower level", () => {
        const xp = xpFor(30, "common");
        assert.ok(petProgress(xp, "legendary").level < 30);
    });
});

describe("pet stats", () => {
    it("grow with level, per rarity where a stat says so", () => {
        const level10 = { xp: xpFor(10, "common"), heldItem: null };
        assert.deepEqual(petModifiers(PET, "common", level10), [
            { stat: "defense", kind: "flat", value: 5 },
            { stat: "speed", kind: "flat", value: 10 },
        ]);
    });

    it("unlock abilities by rarity", () => {
        const stats = petModifiers(PET, "rare", { xp: xpFor(10, "rare"), heldItem: null }).map((modifier) => modifier.stat);
        assert.deepEqual(stats, ["defense", "speed", "attack"]);
        const state = petState("pet.tarantula.common", { xp: 0, heldItem: null });
        assert.ok(state?.abilities.some((ability) => !ability.unlocked && ability.stats.length === 0));
    });

    it("add the held item's stats", () => {
        const held = CONTENT.items["silk-collar"];
        assert.equal(held?.kind, "petItem");
        const stats = petModifiers(PET, "common", { xp: 0, heldItem: "silk-collar" });
        for (const modifier of held?.kind === "petItem" ? (held.modifiers ?? []) : []) assert.ok(stats.some((m) => m.stat === modifier.stat && m.value === modifier.value));
    });
});

describe("pet XP", () => {
    it("is all of its own skill's XP and a share of the rest", () => {
        assert.equal(petXpFrom(PET, "combat", 90, null), 90);
        assert.equal(petXpFrom(PET, "foraging", 90, null), 90 * PETS.otherSkillShare * (PETS.skillMultiplier.foraging ?? 1));
    });

    it("is boosted by a held item, only for its skill", () => {
        const held = CONTENT.items["silk-collar"];
        const boost = held?.kind === "petItem" ? held.xpBoost : undefined;
        assert.ok(boost?.skill === "combat");
        assert.equal(petXpFrom(PET, "combat", 100, "silk-collar"), 100 * boost.multiplier);
        assert.equal(petXpFrom(PET, "foraging", 90, "silk-collar"), petXpFrom(PET, "foraging", 90, null));
    });
});

describe("Kat", () => {
    it("raises a pet through its own rarities, and not past the last", () => {
        assert.equal(nextRarity(PET, "common"), "rare");
        assert.equal(nextRarity(PET, "legendary"), null);
        assert.equal(upgradeQuote(PET, "legendary", 1), null);
    });

    it("charges less the higher the level", () => {
        const low = upgradeQuote(PET, "common", 1)!;
        const high = upgradeQuote(PET, "common", 100)!;
        assert.equal(low.toItemId, "pet.test-pet.rare");
        assert.ok(high.coins < low.coins && high.hours < low.hours);
        assert.equal(high.coins, Math.ceil(1000 * (1 - 100 * PETS.upgradeDiscountPerLevel)));
    });
});

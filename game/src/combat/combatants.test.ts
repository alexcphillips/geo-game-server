import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GEO_MAX_SKILL_LEVEL, geoSkillLevel, geoSkillProgress } from "@geo/shared";
import { CONTENT } from "../content";
import type { GameContent } from "../content";
import { canWield } from "../engine/battle";
import { DAMAGE_DEALT_STAT } from "../engine/engine.types";
import { createRng } from "../engine/rng";
import { playerCombatant, rollChests, withMagicFind } from "./combatants";

describe("player combatant", () => {
    it("counts a talisman once even if listed twice", () => {
        const once = playerCombatant({ name: "You", equipment: [], talismans: ["storm-charm"], hand: [] }, CONTENT);
        const twice = playerCombatant({ name: "You", equipment: [], talismans: ["storm-charm", "storm-charm"], hand: [] }, CONTENT);
        assert.equal(once.effects.length, 1);
        assert.deepEqual(twice.effects, once.effects);
    });

    it("gets nothing from talismans left out of the bag", () => {
        const empty = playerCombatant({ name: "You", equipment: [], talismans: [], hand: [] }, CONTENT);
        assert.equal(empty.effects.length, 0);
    });

    it("punches with fists when no weapon is equipped: melee, one attack less than the Bronze Dagger", () => {
        const attack = (setup: { modifiers: { stat: string; value: number }[] }) =>
            setup.modifiers.filter((mod) => mod.stat === "attack").reduce((sum, mod) => sum + mod.value, 0);
        const fists = playerCombatant({ name: "You", equipment: [], talismans: [], hand: [] }, CONTENT);
        const dagger = playerCombatant({ name: "You", equipment: ["bronze-dagger"], talismans: [], hand: [] }, CONTENT);
        assert.deepEqual(fists.weaponTags, ["fists", "melee"]);
        assert.ok(canWield(CONTENT.cards.slash!, fists.weaponTags));
        assert.equal(attack(fists), 1);
        assert.equal(attack(dagger), 2);
    });

    it("carries the off-hand's type, so shield cards need a shield", () => {
        const bare = playerCombatant({ name: "You", equipment: [], talismans: [], hand: [] }, CONTENT);
        const shielded = playerCombatant({ name: "You", equipment: ["plank-shield"], talismans: [], hand: [] }, CONTENT);
        assert.deepEqual(bare.offHandTags, []);
        assert.deepEqual(shielded.offHandTags, ["shield"]);
        assert.ok(!canWield(CONTENT.cards.guard!, bare.weaponTags, bare.offHandTags));
        assert.ok(canWield(CONTENT.cards.guard!, shielded.weaponTags, shielded.offHandTags));
    });
});

describe("reforges", () => {
    it("adds a worn copy's reforge, for the item's rarity", () => {
        const plain = playerCombatant({ name: "You", equipment: ["claymore"], talismans: [], hand: [] }, CONTENT);
        const violent = playerCombatant(
            { name: "You", equipment: ["claymore"], reforges: [{ itemId: "claymore", reforgeId: "violent" }], talismans: [], hand: [] },
            CONTENT,
        );
        const extra = violent.modifiers.slice(plain.modifiers.length);
        assert.deepEqual(extra, CONTENT.reforges.violent!.modifiers.common);
    });

    it("ignores a reforge that doesn't fit the item", () => {
        const odd = playerCombatant(
            { name: "You", equipment: ["claymore"], reforges: [{ itemId: "claymore", reforgeId: "heavy" }], talismans: [], hand: [] },
            CONTENT,
        );
        const plain = playerCombatant({ name: "You", equipment: ["claymore"], talismans: [], hand: [] }, CONTENT);
        assert.deepEqual(odd.modifiers, plain.modifiers);
    });
});

describe("magic find", () => {
    it("makes a rare drop 1% likelier per point, never past the rare line", () => {
        assert.equal(withMagicFind(0.01, 0), 0.01);
        assert.equal(withMagicFind(0.02, 50), 0.03);
        assert.equal(withMagicFind(0.04, 100), 0.05);
        assert.equal(withMagicFind(0.01, -10), 0.01);
    });

    it("leaves commoner drops alone", () => {
        assert.equal(withMagicFind(0.05, 100), 0.05);
        assert.equal(withMagicFind(0.5, 100), 0.5);
    });
});

describe("combat level", () => {
    it("adds 1% damage dealt per level", () => {
        const bonus = (combatLevel: number) =>
            playerCombatant({ name: "You", equipment: [], talismans: [], hand: [], combatLevel }, CONTENT).modifiers.find(
                (modifier) => modifier.stat === DAMAGE_DEALT_STAT,
            )?.value;
        assert.equal(bonus(1), 0.01);
        assert.equal(bonus(50), 0.5);
    });

    it("stops every skill at level 50, however much XP", () => {
        assert.equal(geoSkillLevel(0), 1);
        assert.equal(geoSkillLevel(100), 2);
        assert.equal(geoSkillLevel(Number.MAX_SAFE_INTEGER), GEO_MAX_SKILL_LEVEL);
        // 100 × (1 + 2 + … + 49) XP reaches exactly 50.
        const toMax = 100 * ((49 * 50) / 2);
        assert.equal(geoSkillLevel(toMax - 1), 49);
        assert.deepEqual(geoSkillProgress(toMax), { level: 50, progress: 1, xpIntoLevel: 0, xpForLevel: 0, isMax: true });
    });
});

describe("chests", () => {
    it("rolls every chest's contents at the win, each with something in it", () => {
        for (let seed = 1; seed <= 200; seed++) {
            const chests = rollChests("test-chest-boss", createRng(seed), CONTENT);
            assert.ok(chests, "the test boss always gives chests");
            const tiers = chests.map((chest) => chest.tier);
            // Plain and gold are certain; ruby and void only sometimes.
            assert.deepEqual(tiers.slice(0, 2), ["plain", "gold"]);
            for (const chest of chests) {
                assert.ok(chest.items.length > 0, `${chest.tier} came out empty`);
                assert.equal(chest.cost, CONTENT.chestTiers[chest.tier].cost);
                assert.ok(chest.items.every((item) => item.quantity >= 1));
            }
        }
    });

    it("gives the same chests for the same seed", () => {
        assert.deepEqual(rollChests("test-chest-boss", createRng(7), CONTENT), rollChests("test-chest-boss", createRng(7), CONTENT));
    });

    it("gives none for an enemy without them, or when its chance misses", () => {
        assert.equal(rollChests("spider", createRng(1), CONTENT), null);
        const boss = CONTENT.enemies["test-chest-boss"]!;
        const never: GameContent = {
            ...CONTENT,
            enemies: { ...CONTENT.enemies, [boss.id]: { ...boss, chests: { ...boss.chests!, chance: 0 } } },
        };
        assert.equal(rollChests(boss.id, createRng(1), never), null);
    });

    it("joins repeat picks of one item into one stack", () => {
        const boss = CONTENT.enemies["test-chest-boss"]!;
        const one: GameContent = {
            ...CONTENT,
            enemies: {
                ...CONTENT.enemies,
                [boss.id]: {
                    ...boss,
                    chests: {
                        chance: 1,
                        offers: [
                            {
                                tier: "plain",
                                chance: 1,
                                pools: [{ rolls: { min: 3, max: 3 }, entries: [{ itemId: "bones", weight: 1, quantity: { min: 2, max: 2 } }] }],
                            },
                        ],
                    },
                },
            },
        };
        assert.deepEqual(rollChests(boss.id, createRng(1), one)?.[0]?.items, [{ itemId: "bones", quantity: 6 }]);
    });
});

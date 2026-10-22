import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CONTENT, reforgeModifiers, reforgesFor, reforgeTarget } from "./index";

describe("reforges", () => {
    it("weapons take weapon reforges, armor and shields armor ones, rings none", () => {
        assert.equal(reforgeTarget(CONTENT.items.claymore), "weapon");
        assert.equal(reforgeTarget(CONTENT.items["cloth-tunic"]), "armor");
        assert.equal(reforgeTarget(CONTENT.items["plank-shield"]), "armor");
        assert.equal(reforgeTarget(CONTENT.items["ember-ring"]), null);
        assert.deepEqual(reforgesFor(CONTENT, CONTENT.items.claymore).map((reforge) => reforge.id).sort(), ["keen", "violent"]);
    });

    it("scales with the item's rarity", () => {
        assert.deepEqual(reforgeModifiers(CONTENT, "cloth-tunic", "heavy"), CONTENT.reforges.heavy!.modifiers.common);
        assert.deepEqual(reforgeModifiers(CONTENT, "slime-grip-wraps", "heavy"), CONTENT.reforges.heavy!.modifiers.uncommon);
    });

    it("gives nothing for no reforge, an unknown one, or one that doesn't fit", () => {
        assert.deepEqual(reforgeModifiers(CONTENT, "cloth-tunic", null), []);
        assert.deepEqual(reforgeModifiers(CONTENT, "cloth-tunic", "gone"), []);
        assert.deepEqual(reforgeModifiers(CONTENT, "cloth-tunic", "keen"), []);
    });

    it("the Blacksmith reforges, with every rarity priced", () => {
        const cost = CONTENT.vendors.blacksmith?.reforge?.cost;
        assert.ok(cost);
        assert.deepEqual(Object.keys(cost).sort(), ["common", "epic", "legendary", "rare", "uncommon"]);
    });
});

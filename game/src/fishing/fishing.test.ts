import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CONTENT } from "../content";
import { FISHING_BASE, fishingOdds } from "./fishing";

const marlon = CONTENT.mayors.marlon?.perks.flatMap((perk) => perk.modifiers) ?? [];

describe("fishing odds", () => {
    it("are the base chances with no modifiers", () => {
        assert.deepEqual(fishingOdds([]), { ...FISHING_BASE });
    });

    it("feel Marlon's perks while he's mayor", () => {
        const odds = fishingOdds(marlon);
        assert.ok(Math.abs(odds.eelChance - (FISHING_BASE.eelChance + 0.1)) < 1e-12, "Eel Affinity: a flat +10%");
        assert.ok(Math.abs(odds.baitSaveChance - 0.1) < 1e-12, "Bait Lover: 10% chance");
        assert.ok(Math.abs(odds.seaCreatureChance - FISHING_BASE.seaCreatureChance * 1.1) < 1e-12);
    });

    it("stack a mayor's perk with a player's own gear", () => {
        const odds = fishingOdds([...marlon, { stat: "eelChance", kind: "flat", value: 0.05 }]);
        assert.ok(Math.abs(odds.eelChance - (FISHING_BASE.eelChance + 0.05 + 0.1)) < 1e-12, "base + gear + Marlon");
    });

    it("never go past 0–1", () => {
        assert.equal(fishingOdds([{ stat: "eelChance", kind: "flat", value: 5 }]).eelChance, 1);
        assert.equal(fishingOdds([{ stat: "baitSaveChance", kind: "flat", value: -1 }]).baitSaveChance, 0);
    });
});

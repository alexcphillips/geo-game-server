import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CONTENT, type GameContent, type QuestDef } from "../../content";
import { combatTierView, killTargets, objectiveLabel, openTier, progressAfter, questsToGive, withHistory } from "./geo-quests.rules";

const quest = (id: string, extra: Partial<QuestDef> = {}): QuestDef => ({
    id,
    title: id,
    giver: null,
    after: [],
    unlocksTier: null,
    objectives: [{ id: "kill", type: "kill", enemy: "green-slime", count: 1 }],
    rewards: { coins: 1, items: [] },
    ...extra,
});

/** Tier 2 at level 5 with a Trial, tier 3 at 12 with one, tier 4 at 22 with none. */
const LEVELS = [1, 5, 12, 22];
const content = {
    ...CONTENT,
    quests: {
        intro: quest("intro"),
        "trial-1": quest("trial-1", { unlocksTier: 2, after: ["intro"] }),
        "trial-2": quest("trial-2", { unlocksTier: 3 }),
    },
} as GameContent;

describe("quests: enemy tiers", () => {
    it("open a tier only with both its level and its Trial", () => {
        assert.equal(openTier(1, new Set(), content, LEVELS), 1);
        assert.equal(openTier(30, new Set(), content, LEVELS), 1, "level alone isn't enough");
        assert.equal(openTier(4, new Set(["trial-1"]), content, LEVELS), 1, "nor the Trial alone");
        assert.equal(openTier(5, new Set(["trial-1"]), content, LEVELS), 2);
    });

    it("hold back every tier above a missing Trial", () => {
        assert.equal(openTier(30, new Set(["trial-2"]), content, LEVELS), 1);
        assert.equal(openTier(30, new Set(["trial-1"]), content, LEVELS), 2);
        // Tier 4 has no Trial: its level is enough.
        assert.equal(openTier(30, new Set(["trial-1", "trial-2"]), content, LEVELS), 4);
    });

    it("say what the next tier still needs", () => {
        assert.deepEqual(combatTierView(6, new Set(), content, LEVELS), {
            tier: 1,
            next: { tier: 2, level: 5, levelMet: true, trial: { questId: "trial-1", title: "trial-1", done: false } },
        });
        assert.equal(combatTierView(30, new Set(["trial-1", "trial-2"]), content, LEVELS).next, null);
    });
});

describe("quests: giving", () => {
    const ids = (quests: QuestDef[]) => quests.map((q) => q.id).sort();

    it("give a quest once everything before it is turned in", () => {
        assert.deepEqual(ids(questsToGive(new Set(), new Set(), 1, content)), ["intro"]);
        assert.deepEqual(ids(questsToGive(new Set(["intro"]), new Set(), 1, content)), [], "held, not turned in");
        assert.deepEqual(ids(questsToGive(new Set(["intro"]), new Set(["intro"]), 1, content)), ["trial-1"]);
    });

    it("give a Trial only once the tier below it is open", () => {
        const held = new Set(["intro", "trial-1"]);
        assert.ok(!questsToGive(held, held, 1, content).some((q) => q.id === "trial-2"));
        assert.ok(questsToGive(held, held, 2, content).some((q) => q.id === "trial-2"));
    });
});

describe("quests: progress", () => {
    const trial = quest("t", {
        objectives: [
            { id: "crab", type: "kill", enemy: "giant-river-crab", count: 1 },
            { id: "pits", type: "dungeon", dungeon: "slime-pits", count: 1 },
            { id: "cook", type: "craft", recipe: "cook-salmon", count: 3 },
            { id: "bank", type: "deposit", count: 10 },
            { id: "camp", type: "camp", count: 1 },
        ],
    });

    it("count only what matches, capped at each count", () => {
        assert.equal(progressAfter(trial, {}, [{ type: "kill", enemyId: "green-slime" }]), null);
        assert.deepEqual(
            progressAfter(trial, {}, [
                { type: "kill", enemyId: "giant-river-crab" },
                { type: "kill", enemyId: "giant-river-crab" },
                { type: "dungeon", dungeonId: "slime-pits" },
            ]),
            { crab: 1, pits: 1 },
        );
        assert.deepEqual(progressAfter(trial, { cook: 1 }, [{ type: "craft", recipeId: "cook-salmon", times: 5 }]), { cook: 3 });
        assert.equal(progressAfter(trial, { crab: 1 }, [{ type: "kill", enemyId: "giant-river-crab" }]), null, "already met");
    });

    it("count camp and deposits from history, whenever they happened", () => {
        assert.deepEqual(withHistory(trial, { crab: 1 }, { campPlaced: true, deposited: 4 }), { crab: 1, camp: 1, bank: 4 });
        assert.deepEqual(withHistory(trial, {}, { campPlaced: false, deposited: 25 }), { bank: 10 }, "capped");
        assert.deepEqual(withHistory(trial, { bank: 6 }, { campPlaced: false, deposited: 2 }), { bank: 6 }, "never lowered");
    });

    it("pull spawns toward unmet kills only", () => {
        assert.deepEqual(killTargets(trial, {}), ["giant-river-crab"]);
        assert.deepEqual(killTargets(trial, { crab: 1 }), []);
    });

    it("label each kind for the app", () => {
        const [crab, pits, cook, bank, camp] = trial.objectives;
        assert.equal(objectiveLabel(crab!), "Kill Giant River Crab");
        assert.equal(objectiveLabel(pits!), "Complete Slime Pits");
        assert.equal(objectiveLabel(cook!), "Cook Grilled Salmon");
        assert.equal(objectiveLabel(bank!), "Deposit coins in the bank");
        assert.equal(objectiveLabel(camp!), "Place your camp");
    });
});

describe("quests: the content", () => {
    it("gates tier 2 behind Trial I, after the bank and cooking quests", () => {
        const trial = CONTENT.quests["trial-1"]!;
        assert.equal(trial.unlocksTier, 2);
        assert.deepEqual(trial.after, ["fresh-off-the-fire"]);
        assert.deepEqual(CONTENT.quests["fresh-off-the-fire"]!.after, ["rainy-day-fund"]);
        assert.deepEqual(CONTENT.quests["rainy-day-fund"]!.after, ["slime-cull"]);
    });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { enemyCombatant, playerCombatant } from "../combat/combatants";
import { canWield, createBattle, playCard, type CombatantSetup } from "../engine/battle";
import { CONTENT } from "./index";

/** The real content loads, and every card can be played in a real fight. */
describe("game content", () => {
    it("loads without broken references", () => {
        assert.ok(Object.keys(CONTENT.items).length > 0);
    });

    for (const card of Object.values(CONTENT.cards)) {
        it(`plays ${card.id} against every enemy`, () => {
            const weapon = Object.values(CONTENT.items).find(
                (item) => item.kind === "equipment" && item.weapon && canWield(card, [item.weapon.type, item.weapon.style], card.requiresOffHand),
            );
            assert.ok(weapon, `some weapon can play ${card.id}`);
            const offHand = Object.values(CONTENT.items).find(
                (item) => item.kind === "equipment" && item.offHand && card.requiresOffHand?.includes(item.offHand.type),
            );
            if (card.requiresOffHand) assert.ok(offHand, `some off-hand can play ${card.id}`);
            const equipment = [weapon.id, ...(card.requiresOffHand && offHand ? [offHand.id] : [])];
            for (const enemyId of Object.keys(CONTENT.enemies)) {
                const hand = [{ instanceId: "i0", cardId: card.id, chargesLeft: 5 }];
                const setup = [
                    playerCombatant({ name: "You", equipment, talismans: ["storm-charm"], hand }, CONTENT),
                    enemyCombatant(enemyId, 0, CONTENT),
                ];
                const start = createBattle(setup, 7, CONTENT);
                if (start.state.outcome !== "ongoing") continue;
                const { state } = playCard(start.state, CONTENT, { cardInstanceId: "i0" });
                assert.ok(state.round >= 1);
            }
        });
    }

    it("Envenom's coat poisons on every hit, and the poison goes through defense", () => {
        const hand = [
            { instanceId: "i0", cardId: "envenom", chargesLeft: 10 },
            { instanceId: "i1", cardId: "double-slash", chargesLeft: 40 },
        ];
        // Armored past any blow (only the minimum share lands), and harmless.
        const wall: CombatantSetup = {
            id: "enemy:0",
            side: "enemy",
            name: "Wall",
            baseStats: { maxHealth: 100, attack: 0, defense: 50, speed: 1 },
            modifiers: [],
            effects: [],
            moves: [{ id: "wait", name: "Wait", weight: 1, actions: [] }],
        };
        const you = playerCombatant({ name: "You", equipment: ["bronze-dagger"], talismans: [], hand }, CONTENT);
        const start = createBattle([you, wall], 7, CONTENT);
        const coated = playCard(start.state, CONTENT, { cardInstanceId: "i0" });
        const slashed = playCard(coated.state, CONTENT, { cardInstanceId: "i1" });
        const wallNow = slashed.state.combatants.find((c) => c.id === "enemy:0")!;
        assert.equal(wallNow.statuses.find((s) => s.statusId === "poisoned")?.stacks, 2);
        // Its turn after the slash: 2 stacks tick for 2, through 50 defense.
        const blows = slashed.log.reduce((sum, entry) => sum + (entry.type === "damage" && entry.isAttack ? entry.amount : 0), 0);
        assert.equal(wallNow.health, 100 - blows - 2);
        assert.equal(slashed.state.combatants[0]!.hand!.find((c) => c.instanceId === "i0")!.chargesLeft, 9);
    });
});

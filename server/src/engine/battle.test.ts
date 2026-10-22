import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    BattleRuleError,
    canPlayCard,
    createBattle,
    currentActor,
    eatBetweenFights,
    eatFood,
    leaveBattle,
    playCard,
    previewCard,
    previewIntent,
    skipTurn,
    type CombatantSetup,
} from "./battle";
import type { EngineContent } from "./content.types";
import type { CardDef, EffectDef, FoodDef, LogEntry, StatusDef } from "./engine.types";

/*
 * Engine tests against small hand-made content, so each rule is checked on
 * its own and with chances pinned to 0 or 1. Run with `npm test`.
 */

const BURNING: StatusDef = {
    id: "burning",
    name: "Burning",
    duration: 3,
    maxStacks: 5,
    effects: [
        {
            id: "burning.tick",
            trigger: { event: "attackFinished", as: "actor" },
            actions: [{ type: "damage", to: "self", amount: { flat: 3, perStack: true }, element: "fire", ignoreDefense: true }],
        },
    ],
};

const frozen = (thawChance: number): StatusDef => ({
    id: "frozen",
    name: "Frozen",
    duration: 3,
    maxStacks: 1,
    effects: [
        {
            id: "frozen.thaw",
            trigger: { event: "turnStart", as: "actor" },
            chance: thawChance,
            actions: [{ type: "removeStatus", from: "self", status: "frozen" }],
        },
        { id: "frozen.skip", trigger: { event: "beforeAction", as: "actor" }, actions: [{ type: "cancelAction" }] },
    ],
});

const CARDS: Record<string, CardDef> = {
    slash: {
        id: "slash",
        name: "Slash",
        skill: "combat",
        targets: "enemy",
        actions: [{ type: "attack", to: "other", amount: { stat: "attack" } }],
    },
    flurry: {
        id: "flurry",
        name: "Flurry",
        skill: "combat",
        targets: "enemy",
        actions: [{ type: "attack", to: "other", amount: { stat: "attack", multiplier: 0.6 }, hits: 2 }],
    },
    fireball: {
        id: "fireball",
        name: "Fireball",
        skill: "combat",
        tags: ["fire"],
        targets: "enemy",
        actions: [
            { type: "attack", to: "other", amount: 5, element: "fire" },
            { type: "applyStatus", to: "other", status: "burning" },
        ],
        effects: [
            {
                id: "fireball.free",
                trigger: { event: "cardPlayed", as: "actor" },
                conditions: [{ type: "hasStatus", who: "target", status: "burning" }],
                actions: [{ type: "freeCharge" }],
            },
        ],
    },
    freeze: {
        id: "freeze",
        name: "Freeze",
        skill: "combat",
        targets: "enemy",
        actions: [{ type: "applyStatus", to: "other", status: "frozen" }],
    },
    stab: {
        id: "stab",
        name: "Stab",
        skill: "combat",
        targets: "enemy",
        requiresWeapon: ["dagger"],
        actions: [{ type: "attack", to: "other", amount: { stat: "attack" } }],
    },
    "shield-bash": {
        id: "shield-bash",
        name: "Shield Bash",
        skill: "combat",
        targets: "enemy",
        requiresWeapon: ["melee"],
        requiresOffHand: ["shield"],
        actions: [{ type: "attack", to: "other", amount: { stat: "attack" } }],
    },
    brace: {
        id: "brace",
        name: "Brace",
        skill: "combat",
        targets: "self",
        actions: [{ type: "guard", to: "self", amount: 8 }],
    },
    barrier: {
        id: "barrier",
        name: "Barrier",
        skill: "combat",
        targets: "self",
        actions: [{ type: "barrier", to: "self", amount: 10 }],
    },
};

const WELL_FED: StatusDef = {
    id: "well-fed",
    name: "Well Fed",
    duration: 4,
    maxStacks: 1,
    effects: [{ id: "well-fed.regen", trigger: { event: "turnStart", as: "actor" }, actions: [{ type: "heal", to: "self", amount: 8 }] }],
};

const FOODS: Record<string, FoodDef> = {
    bread: { id: "bread", name: "Bread", actions: [{ type: "heal", to: "self", amount: 15 }] },
    stew: {
        id: "stew",
        name: "Stew",
        tags: ["hearty"],
        actions: [
            { type: "heal", to: "self", amount: 10 },
            { type: "applyStatus", to: "self", status: "well-fed" },
        ],
    },
    ramen: { id: "ramen", name: "Ramen", tags: ["spicy"], actions: [{ type: "heal", to: "self", amount: 20 }] },
};

const content = (thawChance = 0.5): EngineContent => ({
    statuses: { burning: BURNING, frozen: frozen(thawChance), "well-fed": WELL_FED },
    cards: CARDS,
    foods: FOODS,
});

const hand = (...cardIds: string[]) =>
    cardIds.map((cardId, i) => ({ instanceId: `c${i}`, cardId, chargesLeft: 3 }));

function player(overrides: Partial<CombatantSetup> = {}): CombatantSetup {
    return {
        id: "player",
        side: "player",
        name: "You",
        baseStats: { maxHealth: 100, attack: 10, defense: 0, speed: 10 },
        modifiers: [],
        effects: [],
        hand: hand("slash", "fireball", "freeze", "brace"),
        ...overrides,
    };
}

function spider(overrides: Partial<CombatantSetup> = {}): CombatantSetup {
    return {
        id: "enemy:0",
        side: "enemy",
        name: "Spider",
        baseStats: { maxHealth: 40, attack: 12, defense: 0, speed: 12 },
        modifiers: [],
        effects: [],
        moves: [{ id: "bite", name: "Bite", weight: 1, actions: [{ type: "attack", to: "other", amount: { stat: "attack" } }] }],
        ...overrides,
    };
}

const healthOf = (state: { combatants: { id: string; health: number }[] }, id: string) =>
    state.combatants.find((c) => c.id === id)!.health;

const damageTo = (log: LogEntry[], target: string) =>
    log.filter((e): e is Extract<LogEntry, { type: "damage" }> => e.type === "damage" && e.target === target);

describe("turn order", () => {
    it("lets the faster enemy act before the player's first decision", () => {
        const { state, log } = createBattle([player(), spider()], 1, content());
        assert.deepEqual(state.order, ["enemy:0", "player"]);
        assert.equal(healthOf(state, "player"), 88);
        assert.equal(log.find((e) => e.type === "enemyMove")?.type, "enemyMove");
    });

    it("gives ties to the player", () => {
        const { state } = createBattle([player(), spider({ baseStats: { maxHealth: 40, attack: 12, speed: 10 } })], 1, content());
        assert.deepEqual(state.order, ["player", "enemy:0"]);
    });

    it("gives ties to the player even when the enemy is set up first", () => {
        const { state } = createBattle([spider({ baseStats: { maxHealth: 40, attack: 12, speed: 10 } }), player()], 1, content());
        assert.deepEqual(state.order, ["player", "enemy:0"]);
    });
});

describe("cards and charges", () => {
    it("deals attack damage and spends a charge", () => {
        const start = createBattle([player(), spider()], 1, content());
        const { state } = playCard(start.state, content(), { cardInstanceId: "c0" });
        assert.equal(healthOf(state, "enemy:0"), 30);
        assert.equal(state.combatants[0]!.hand![0]!.chargesLeft, 2);
    });

    it("rejects an illegal play and leaves the state unchanged", () => {
        const start = createBattle([player({ hand: [{ instanceId: "c0", cardId: "slash", chargesLeft: 0 }] }), spider()], 1, content());
        const before = JSON.stringify(start.state);
        assert.throws(() => playCard(start.state, content(), { cardInstanceId: "c0" }), BattleRuleError);
        assert.throws(() => playCard(start.state, content(), { cardInstanceId: "nope" }), BattleRuleError);
        assert.equal(JSON.stringify(start.state), before);
    });

    it("plays a fire card free into a burning target", () => {
        const start = createBattle([player(), spider({ baseStats: { maxHealth: 200, attack: 1, speed: 1 } })], 1, content());
        const first = playCard(start.state, content(), { cardInstanceId: "c1" });
        const second = playCard(first.state, content(), { cardInstanceId: "c1" });
        const plays = [...first.log, ...second.log].filter((e) => e.type === "cardPlayed");
        assert.deepEqual(plays.map((p) => p.type === "cardPlayed" && p.chargeSpent), [true, false]);
        assert.equal(second.state.combatants[0]!.hand![1]!.chargesLeft, 2);
    });

    it("plays a weapon card only with a weapon that carries one of its tags", () => {
        const withWeapon = (weaponTags?: string[]) =>
            createBattle([player({ hand: hand("stab"), weaponTags }), spider()], 1, content()).state;
        for (const tags of [undefined, ["sword", "melee"]]) {
            const state = withWeapon(tags);
            const before = JSON.stringify(state);
            assert.throws(() => playCard(state, content(), { cardInstanceId: "c0" }), /needs a dagger weapon/);
            assert.equal(JSON.stringify(state), before);
        }
        const { state } = playCard(withWeapon(["dagger", "melee"]), content(), { cardInstanceId: "c0" });
        assert.equal(healthOf(state, "enemy:0"), 30);
    });

    it("plays an off-hand card only with a fitting weapon and off-hand", () => {
        const withGear = (weaponTags: string[], offHandTags?: string[]) =>
            createBattle([player({ hand: hand("shield-bash"), weaponTags, offHandTags }), spider()], 1, content()).state;
        for (const tags of [undefined, []]) {
            assert.throws(() => playCard(withGear(["sword", "melee"], tags), content(), { cardInstanceId: "c0" }), /needs a shield in your off-hand/);
        }
        assert.throws(() => playCard(withGear([], ["shield"]), content(), { cardInstanceId: "c0" }), /needs a melee weapon/);
        const { state } = playCard(withGear(["sword", "melee"], ["shield"]), content(), { cardInstanceId: "c0" });
        assert.equal(healthOf(state, "enemy:0"), 30);
    });
});

describe("statuses", () => {
    it("burns a burning enemy after it attacks", () => {
        const start = createBattle([player({ baseStats: { maxHealth: 100, attack: 10, speed: 20 } }), spider()], 1, content());
        const { state, log } = playCard(start.state, content(), { cardInstanceId: "c1" });
        const burns = damageTo(log, "enemy:0").filter((d) => d.effectId === "burning.tick");
        assert.equal(burns.length, 1);
        assert.equal(burns[0]!.amount, 3);
        // 40 − fireball 5 − burn 3
        assert.equal(healthOf(state, "enemy:0"), 32);
    });

    it("skips a frozen enemy's turn when it fails to thaw", () => {
        const c = content(0);
        const start = createBattle([player({ baseStats: { maxHealth: 100, attack: 10, speed: 20 } }), spider()], 1, c);
        const { state, log } = playCard(start.state, c, { cardInstanceId: "c2" });
        assert.ok(log.some((e) => e.type === "turnSkipped" && e.actor === "enemy:0"));
        assert.equal(healthOf(state, "player"), 100);
    });

    it("lets a frozen enemy act once it thaws", () => {
        const c = content(1);
        const start = createBattle([player({ baseStats: { maxHealth: 100, attack: 10, speed: 20 } }), spider()], 1, c);
        const { state, log } = playCard(start.state, c, { cardInstanceId: "c2" });
        assert.ok(log.some((e) => e.type === "statusRemoved" && e.statusId === "frozen"));
        assert.equal(healthOf(state, "player"), 88);
    });
});

describe("gear and talisman effects", () => {
    const lightning = (chance: number): EffectDef => ({
        id: "storm.lightning",
        trigger: { event: "attacked", as: "target" },
        chance,
        actions: [{ type: "damage", to: "other", amount: 10, element: "lightning", ignoreDefense: true }],
    });

    it("strikes an attacker with lightning when the proc lands", () => {
        const { state, log } = createBattle([player({ effects: [lightning(1)] }), spider()], 1, content());
        assert.equal(damageTo(log, "enemy:0")[0]?.element, "lightning");
        assert.equal(healthOf(state, "enemy:0"), 30);
    });

    it("does nothing when the proc misses", () => {
        const { state } = createBattle([player({ effects: [lightning(0)] }), spider()], 1, content());
        assert.equal(healthOf(state, "enemy:0"), 40);
    });

    it("applies stat modifiers from gear", () => {
        const geared = player({ modifiers: [{ stat: "attack", kind: "flat", value: 5 }, { stat: "attack", kind: "percent", value: 0.2 }] });
        const start = createBattle([geared, spider()], 1, content());
        const { state } = playCard(start.state, content(), { cardInstanceId: "c0" });
        // (10 + 5) × 1.2 = 18
        assert.equal(healthOf(state, "enemy:0"), 22);
    });

    it("stops effects that trigger each other", () => {
        const thorns: EffectDef = {
            id: "thorns",
            trigger: { event: "damageTaken", as: "target" },
            actions: [{ type: "damage", to: "other", amount: 1, ignoreDefense: true }],
        };
        const big = { maxHealth: 10_000, attack: 1, speed: 1 };
        const start = createBattle(
            [player({ effects: [thorns], baseStats: { ...big, speed: 20 } }), spider({ effects: [thorns], baseStats: big })],
            1,
            content(),
        );
        const { log } = playCard(start.state, content(), { cardInstanceId: "c0" });
        assert.ok(log.length < 200, `log grew to ${log.length}`);
    });
});

describe("mending", () => {
    it("never heals by itself", () => {
        const { state, log } = createBattle([player({ modifiers: [{ stat: "mending", kind: "flat", value: 0.5 }] }), spider()], 1, content());
        assert.equal(healthOf(state, "player"), 88);
        assert.ok(!log.some((e) => e.type === "heal"));
    });
});

describe("guard", () => {
    it("absorbs the next hit", () => {
        const start = createBattle([player({ baseStats: { maxHealth: 100, attack: 10, speed: 20 } }), spider()], 1, content());
        const { state, log } = playCard(start.state, content(), { cardInstanceId: "c3" });
        assert.equal(damageTo(log, "player")[0]?.blocked, 8);
        assert.equal(healthOf(state, "player"), 96);
    });
});

describe("barrier", () => {
    const barrierOf = (state: { combatants: { id: string; barrier: number }[] }, id: string) =>
        state.combatants.find((c) => c.id === id)!.barrier;
    // Faster than a weak spider, so each card lands before its bite.
    const caster = (overrides: Partial<CombatantSetup> = {}) =>
        player({ baseStats: { maxHealth: 100, attack: 10, speed: 20 }, hand: hand("slash", "barrier", "brace"), ...overrides });
    const weak = () => spider({ baseStats: { maxHealth: 200, attack: 5, speed: 12 } });

    it("starts on a combatant set up with one, logged, and soaks before health with the overflow carried", () => {
        const start = createBattle([caster(), spider({ barrier: 8 })], 1, content());
        assert.deepEqual(start.log[0], { type: "barrier", target: "enemy:0", amount: 8 });
        const { state, log } = playCard(start.state, content(), { cardInstanceId: "c0" });
        assert.equal(damageTo(log, "enemy:0")[0]?.absorbed, 8);
        assert.equal(damageTo(log, "enemy:0")[0]?.amount, 2);
        assert.equal(barrierOf(state, "enemy:0"), 0);
        assert.equal(healthOf(state, "enemy:0"), 38);
    });

    it("lasts across turns, unlike guard", () => {
        const start = createBattle([caster(), weak()], 1, content());
        const cast = playCard(start.state, content(), { cardInstanceId: "c1" });
        assert.equal(barrierOf(cast.state, "player"), 5);
        const next = playCard(cast.state, content(), { cardInstanceId: "c0" });
        assert.equal(barrierOf(next.state, "player"), 0);
        assert.equal(healthOf(next.state, "player"), 100);
    });

    it("resets on a recast instead of stacking", () => {
        const start = createBattle([caster(), weak()], 1, content());
        const cast = playCard(start.state, content(), { cardInstanceId: "c1" });
        const recast = playCard(cast.state, content(), { cardInstanceId: "c1" });
        assert.ok(recast.log.some((e) => e.type === "barrier" && e.amount === 10));
        // 10 again, then the bite takes 5: not 5 + 10 − 5.
        assert.equal(barrierOf(recast.state, "player"), 5);
    });

    it("is spent after guard", () => {
        const start = createBattle([caster({ barrier: 10 }), spider({ baseStats: { maxHealth: 200, attack: 12, speed: 12 } })], 1, content());
        const { state, log } = playCard(start.state, content(), { cardInstanceId: "c2" });
        assert.equal(damageTo(log, "player")[0]?.blocked, 8);
        assert.equal(damageTo(log, "player")[0]?.absorbed, 4);
        assert.equal(barrierOf(state, "player"), 6);
        assert.equal(healthOf(state, "player"), 100);
    });
});

describe("defense", () => {
    const fast = player({ baseStats: { maxHealth: 100, attack: 10, defense: 0, speed: 20 } });
    const armored = (defense: number) => spider({ baseStats: { maxHealth: 40, attack: 12, defense, speed: 12 } });

    it("takes its amount off each hit", () => {
        const { state } = playCard(createBattle([fast, armored(6)], 1, content()).state, content(), { cardInstanceId: "c0" });
        assert.equal(healthOf(state, "enemy:0"), 36);
    });

    it("never stops more than three quarters of a hit", () => {
        const { state } = playCard(createBattle([fast, armored(50)], 1, content()).state, content(), { cardInstanceId: "c0" });
        // 25% of 10, rounded.
        assert.equal(healthOf(state, "enemy:0"), 37);
    });
});

describe("enemy intents", () => {
    const fast = (overrides: Partial<CombatantSetup> = {}) =>
        player({ baseStats: { maxHealth: 100, attack: 10, defense: 0, speed: 20 }, ...overrides });
    const twoMoves = spider({
        moves: [
            { id: "bite", name: "Bite", weight: 1, actions: [{ type: "attack", to: "other", amount: { stat: "attack" } }] },
            { id: "shell", name: "Shell", weight: 1, actions: [{ type: "guard", to: "self", amount: 5 }] },
        ],
    });
    const intentOf = (state: { combatants: { id: string; intent?: string }[] }) =>
        state.combatants.find((c) => c.id === "enemy:0")!.intent;

    it("makes the move it showed, then shows the next", () => {
        const seen = new Set<string>();
        for (let seed = 1; seed <= 20; seed++) {
            const start = createBattle([fast(), twoMoves], seed, content());
            const shown = intentOf(start.state)!;
            seen.add(shown);
            const { state, log } = playCard(start.state, content(), { cardInstanceId: "c0" });
            const made = log.find((e) => e.type === "enemyMove");
            assert.equal(made?.type === "enemyMove" && made.moveId, shown);
            assert.ok(intentOf(state));
        }
        assert.equal(seen.size, 2, "both moves come up across seeds");
    });

    it("keeps the move through a skipped turn", () => {
        const c = content(0);
        const start = createBattle([fast(), twoMoves], 3, c);
        const { state, log } = playCard(start.state, c, { cardInstanceId: "c2" });
        assert.ok(log.some((e) => e.type === "turnSkipped" && e.actor === "enemy:0"));
        assert.equal(intentOf(state), intentOf(start.state));
    });

    it("previews each hit after the player's defense, and what lands on the enemy itself", () => {
        const flurry = spider({
            moves: [
                {
                    id: "flurry",
                    name: "Flurry",
                    weight: 1,
                    actions: [
                        { type: "attack", to: "other", amount: { stat: "attack", multiplier: 0.75 }, hits: 3 },
                        { type: "guard", to: "self", amount: 4 },
                    ],
                },
            ],
        });
        const armored = fast({ baseStats: { maxHealth: 100, attack: 10, defense: 5, speed: 20 } });
        const { state } = createBattle([armored, flurry], 1, content());
        // 12 × 0.75 = 9, less 5 defense.
        assert.deepEqual(previewIntent(state, content(), "enemy:0"), {
            moveId: "flurry",
            targetId: "player",
            name: "Flurry",
            parts: [
                { kind: "attack", damage: 4, hits: 3 },
                { kind: "guard", amount: 4, self: true },
            ],
        });
        const walled = fast({ baseStats: { maxHealth: 100, attack: 10, defense: 50, speed: 20 } });
        // A quarter of 9 always lands.
        const preview = previewIntent(createBattle([walled, flurry], 1, content()).state, content(), "enemy:0");
        assert.deepEqual(preview?.parts[0], { kind: "attack", damage: 2, hits: 3 });
    });
});

describe("card previews", () => {
    const fast = player({ baseStats: { maxHealth: 100, attack: 10, defense: 0, speed: 20 } });
    const armored = spider({ baseStats: { maxHealth: 40, attack: 12, defense: 4, speed: 12 } });

    it("shows a card's hit on its target after defense, matching what lands", () => {
        const start = createBattle([fast, armored], 1, content());
        assert.deepEqual(previewCard(start.state, content(), "c0"), [{ kind: "attack", damage: 6, hits: 1 }]);
        const { log } = playCard(start.state, content(), { cardInstanceId: "c0" });
        const hit = damageTo(log, "enemy:0")[0]!;
        if (!hit.crit) assert.equal(hit.amount, 6);
    });

    it("logs what defense stopped", () => {
        const start = createBattle([fast, armored], 1, content());
        const hit = damageTo(playCard(start.state, content(), { cardInstanceId: "c0" }).log, "enemy:0")[0]!;
        assert.equal(hit.defended, 4);
    });
});

describe("multi-hit attacks", () => {
    const fast = (overrides: Partial<CombatantSetup> = {}) =>
        player({ baseStats: { maxHealth: 100, attack: 10, defense: 0, speed: 20 }, hand: hand("flurry"), ...overrides });

    it("lands each hit separately, each meeting defense alone", () => {
        const start = createBattle([fast(), spider({ baseStats: { maxHealth: 40, attack: 12, defense: 2, speed: 12 } })], 1, content());
        const { state, log } = playCard(start.state, content(), { cardInstanceId: "c0" });
        assert.deepEqual(damageTo(log, "enemy:0").map((d) => d.amount), [4, 4]);
        // 40 − 2 × (6 − 2)
        assert.equal(healthOf(state, "enemy:0"), 32);
    });

    it("fires on-attacked procs once per hit", () => {
        const zap: EffectDef = {
            id: "zap",
            trigger: { event: "attacked", as: "target" },
            actions: [{ type: "damage", to: "other", amount: 1, ignoreDefense: true }],
        };
        const start = createBattle([fast(), spider({ effects: [zap] })], 1, content());
        const { log } = playCard(start.state, content(), { cardInstanceId: "c0" });
        assert.equal(damageTo(log, "player").filter((d) => d.effectId === "zap").length, 2);
    });

    it("fires attackFinished once, after the last hit", () => {
        const after: EffectDef = {
            id: "after",
            trigger: { event: "attackFinished", as: "actor" },
            actions: [{ type: "damage", to: "other", amount: 1, ignoreDefense: true }],
        };
        const start = createBattle([fast({ effects: [after] }), spider()], 1, content());
        const { log } = playCard(start.state, content(), { cardInstanceId: "c0" });
        const enemyHits = damageTo(log, "enemy:0");
        assert.deepEqual(enemyHits.map((d) => d.effectId ?? "hit"), ["hit", "hit", "after"]);
    });

    it("stops early once the target is dead", () => {
        const start = createBattle([fast(), spider({ baseStats: { maxHealth: 5, attack: 12, speed: 12 } })], 1, content());
        const { state, log } = playCard(start.state, content(), { cardInstanceId: "c0" });
        assert.equal(damageTo(log, "enemy:0").length, 1);
        assert.equal(state.outcome, "victory");
    });
});

describe("counters", () => {
    const counters = (log: LogEntry[], target: string) => damageTo(log, target).filter((d) => d.counter);
    const crab = (overrides: Partial<CombatantSetup> = {}) =>
        spider({ baseStats: { maxHealth: 40, attack: 12, defense: 0, speed: 1, counterChance: 1 }, ...overrides });

    it("strikes back once per attack, not per hit, for half its attack against defense", () => {
        const you = player({ baseStats: { maxHealth: 100, attack: 10, defense: 2, speed: 20 }, hand: hand("flurry") });
        const start = createBattle([you, crab()], 1, content());
        const { log } = playCard(start.state, content(), { cardInstanceId: "c0" });
        // 12 × 0.5 − 2
        assert.deepEqual(counters(log, "player").map((d) => d.amount), [4]);
        // After both hits land.
        const order = log.filter((e) => e.type === "damage").map((e) => (e.counter ? "counter" : e.target));
        assert.deepEqual(order.slice(0, 3), ["enemy:0", "enemy:0", "counter"]);
    });

    it("hits for counterDamage × attack when set", () => {
        const start = createBattle([player({ hand: hand("slash") }), crab({ baseStats: { maxHealth: 40, attack: 12, speed: 1, counterChance: 1, counterDamage: 0.25 } })], 1, content());
        const { log } = playCard(start.state, content(), { cardInstanceId: "c0" });
        assert.deepEqual(counters(log, "player").map((d) => d.amount), [3]);
    });

    it("never counters a counter", () => {
        const you = player({ baseStats: { maxHealth: 100, attack: 10, defense: 0, speed: 20, counterChance: 1 } });
        const start = createBattle([you, crab()], 1, content());
        const { log } = playCard(start.state, content(), { cardInstanceId: "c0" });
        // Your slash is countered, then the crab's bite is: one each way.
        assert.equal(counters(log, "player").length, 1);
        assert.equal(counters(log, "enemy:0").length, 1);
    });

    it("doesn't counter from the grave", () => {
        const start = createBattle([player(), crab({ baseStats: { maxHealth: 5, attack: 12, speed: 1, counterChance: 1 } })], 1, content());
        const { log } = playCard(start.state, content(), { cardInstanceId: "c0" });
        assert.equal(counters(log, "player").length, 0);
    });

    it("never rolls without counter chance", () => {
        const start = createBattle([player(), spider()], 1, content());
        const { log } = playCard(start.state, content(), { cardInstanceId: "c0" });
        assert.equal(counters(log, "player").length + counters(log, "enemy:0").length, 0);
    });
});

describe("armor pen", () => {
    const pen = (value: number) => [{ stat: "armorPen", kind: "flat" as const, value }];
    const shell = (defense: number) => spider({ baseStats: { maxHealth: 100, attack: 1, defense, speed: 1 } });

    it("ignores that much defense on an attack", () => {
        const start = createBattle([player({ hand: hand("slash"), modifiers: pen(2) }), shell(4)], 1, content());
        const { log } = playCard(start.state, content(), { cardInstanceId: "c0" });
        // 10 − (4 − 2)
        assert.deepEqual(damageTo(log, "enemy:0").map((d) => d.amount), [8]);
    });

    it("never takes defense below 0", () => {
        const start = createBattle([player({ hand: hand("slash"), modifiers: pen(10) }), shell(4)], 1, content());
        const { log } = playCard(start.state, content(), { cardInstanceId: "c0" });
        assert.deepEqual(damageTo(log, "enemy:0").map((d) => d.amount), [10]);
    });

    it("applies to each hit of a multi-hit attack", () => {
        const start = createBattle([player({ hand: hand("flurry"), modifiers: pen(2) }), shell(4)], 1, content());
        const { log } = playCard(start.state, content(), { cardInstanceId: "c0" });
        // 6 − (4 − 2), twice
        assert.deepEqual(damageTo(log, "enemy:0").map((d) => d.amount), [4, 4]);
    });

    it("doesn't apply to proc damage", () => {
        const after: EffectDef = {
            id: "after",
            trigger: { event: "attackFinished", as: "actor" },
            actions: [{ type: "damage", to: "other", amount: 6 }],
        };
        const you = player({ hand: hand("slash"), modifiers: pen(4), effects: [after] });
        const start = createBattle([you, shell(4)], 1, content());
        const { log } = playCard(start.state, content(), { cardInstanceId: "c0" });
        assert.equal(damageTo(log, "enemy:0").find((d) => d.effectId === "after")!.amount, 2);
    });

    it("stacks with a status that grants it, as a Pierce card would", () => {
        const PIERCING: StatusDef = { id: "piercing", name: "Piercing", duration: 1, maxStacks: 1, modifiers: pen(2) };
        const c: EngineContent = {
            ...content(),
            statuses: { ...content().statuses, piercing: PIERCING },
            cards: {
                ...CARDS,
                pierce: {
                    id: "pierce",
                    name: "Pierce",
                    skill: "combat",
                    targets: "enemy",
                    actions: [
                        { type: "applyStatus", to: "self", status: "piercing" },
                        { type: "attack", to: "other", amount: { stat: "attack" } },
                    ],
                },
            },
        };
        const start = createBattle([player({ hand: hand("pierce", "slash"), modifiers: pen(1) }), shell(4)], 1, c);
        const first = playCard(start.state, c, { cardInstanceId: "c0" });
        // Gear 1 + status 2: 10 − (4 − 3)
        assert.deepEqual(damageTo(first.log, "enemy:0").map((d) => d.amount), [9]);
        const second = playCard(first.state, c, { cardInstanceId: "c1" });
        // The status is gone after one turn: gear only, 10 − (4 − 1)
        assert.deepEqual(damageTo(second.log, "enemy:0").map((d) => d.amount), [7]);
    });
});

describe("battle end and determinism", () => {
    it("ends in victory when the last enemy falls", () => {
        const start = createBattle([player({ baseStats: { maxHealth: 100, attack: 50, speed: 20 } }), spider()], 1, content());
        const { state, log } = playCard(start.state, content(), { cardInstanceId: "c0" });
        assert.equal(state.outcome, "victory");
        assert.deepEqual(log.at(-1), { type: "battleEnd", outcome: "victory" });
        assert.throws(() => playCard(state, content(), { cardInstanceId: "c0" }), BattleRuleError);
    });

    it("replays identically from the same seed", () => {
        const run = (seed: number) => {
            let result = createBattle([player({ effects: [] }), spider()], seed, content());
            const logs = [...result.log];
            for (let i = 0; i < 3 && result.state.outcome === "ongoing"; i++) {
                result = playCard(result.state, content(), { cardInstanceId: "c2" });
                logs.push(...result.log);
            }
            return JSON.stringify(logs);
        };
        assert.equal(run(42), run(42));
    });
});

describe("condition combinators and on-kill", () => {
    it("supports not and any", () => {
        const notFrozen: EffectDef = {
            id: "rage",
            trigger: { event: "attacked", as: "target" },
            conditions: [
                { type: "not", condition: { type: "hasStatus", who: "self", status: "frozen" } },
                { type: "any", conditions: [{ type: "healthBelow", who: "self", fraction: 0.1 }, { type: "lacksStatus", who: "other", status: "burning" }] },
            ],
            actions: [{ type: "damage", to: "other", amount: 2, ignoreDefense: true }],
        };
        const { state } = createBattle([player({ effects: [notFrozen] }), spider()], 1, content());
        assert.equal(healthOf(state, "enemy:0"), 38);
    });

    it("tells on-kill effects who landed the blow", () => {
        const onKill: EffectDef = {
            id: "victory-heal",
            trigger: { event: "defeated", as: "actor" },
            actions: [{ type: "heal", to: "self", amount: 5 }],
        };
        const start = createBattle([player({ effects: [onKill], baseStats: { maxHealth: 100, attack: 50, speed: 1 } }), spider()], 1, content());
        const { log } = playCard(start.state, content(), { cardInstanceId: "c0" });
        assert.ok(log.some((e) => e.type === "proc" && e.effectId === "victory-heal"));
    });
});

describe("eating from the lunchbox", () => {
    /** A spider too slow and weak to matter, so only the food moves health. */
    const harmless = () => spider({ baseStats: { maxHealth: 40, attack: 0, speed: 1 } });
    const lunchbox = () => [
        { slot: 0, foodId: "bread", quantity: 2 },
        { slot: 1, foodId: "stew", quantity: 1 },
        { slot: 2, foodId: "ramen", quantity: 1 },
    ];
    const heals = (log: LogEntry[]) =>
        log.filter((e): e is Extract<LogEntry, { type: "heal" }> => e.type === "heal").map((e) => e.amount);

    it("heals, uses one from the slot and takes the turn", () => {
        const start = createBattle([player({ health: 50, lunchbox: lunchbox() }), harmless()], 1, content());
        const { state, log } = eatFood(start.state, content(), { slot: 0 });
        assert.equal(healthOf(state, "player"), 65);
        assert.equal(state.combatants[0]!.lunchbox![0]!.quantity, 1);
        assert.deepEqual(log.find((e) => e.type === "foodEaten"), { type: "foodEaten", actor: "player", foodId: "bread", slot: 0 });
        // The turn passed: the enemy moved before the player's next decision.
        assert.ok(log.some((e) => e.type === "enemyMove"));
    });

    it("never heals past max health", () => {
        const start = createBattle([player({ health: 95, lunchbox: lunchbox() }), harmless()], 1, content());
        const { state, log } = eatFood(start.state, content(), { slot: 0 });
        assert.equal(healthOf(state, "player"), 100);
        assert.deepEqual(heals(log), [5]);
    });

    it("rejects an empty or missing slot and leaves the state unchanged", () => {
        const start = createBattle(
            [player({ lunchbox: [{ slot: 0, foodId: "bread", quantity: 0 }] }), harmless()],
            1,
            content(),
        );
        const before = JSON.stringify(start.state);
        assert.throws(() => eatFood(start.state, content(), { slot: 0 }), BattleRuleError);
        assert.throws(() => eatFood(start.state, content(), { slot: 3 }), BattleRuleError);
        assert.equal(JSON.stringify(start.state), before);
    });

    it("can apply statuses: a stew heals now, then on each of the next 3 turns", () => {
        const start = createBattle([player({ health: 40, lunchbox: lunchbox() }), harmless()], 1, content());
        let { state, log } = eatFood(start.state, content(), { slot: 1 });
        const all = [...log];
        // The next turn's first tick lands before the player decides, so it's
        // in the eating turn's log; two more turns hold the other two, and a
        // third holds none.
        for (let turn = 0; turn < 3; turn++) {
            ({ state, log } = playCard(state, content(), { cardInstanceId: "c3" }));
            all.push(...log);
        }
        assert.deepEqual(heals(all), [10, 8, 8, 8]);
        assert.ok(!state.combatants[0]!.statuses.some((s) => s.statusId === "well-fed"));
    });

    it("lets gear react to food by tag", () => {
        const spiceLover: EffectDef = {
            id: "spice-lover",
            trigger: { event: "foodEaten", as: "actor" },
            conditions: [{ type: "foodHasTag", tag: "spicy" }],
            actions: [{ type: "guard", to: "self", amount: 5 }],
        };
        const start = createBattle([player({ health: 50, lunchbox: lunchbox(), effects: [spiceLover] }), harmless()], 1, content());
        const bread = eatFood(start.state, content(), { slot: 0 });
        assert.ok(!bread.log.some((e) => e.type === "guard"));
        const ramen = eatFood(start.state, content(), { slot: 2 });
        assert.ok(ramen.log.some((e) => e.type === "guard" && e.amount === 5));
    });

    it("Mending boosts heals its bearer receives, but not the food's own", () => {
        const mending = [{ stat: "mending", kind: "flat" as const, value: 0.5 }];
        const start = createBattle([player({ health: 40, lunchbox: lunchbox(), modifiers: mending }), harmless()], 1, content());
        const { log } = eatFood(start.state, content(), { slot: 1 });
        // Stew's own 10 stays 10; Well Fed's regen is a status, so 8 → 12.
        assert.deepEqual(heals(log), [10, 12]);
    });

    describe("between fights", () => {
        /** A food that hurts and buffs, as later content may. */
        const bitter: FoodDef = {
            id: "bitter",
            name: "Bitter Root",
            actions: [
                { type: "damage", to: "self", amount: 30, ignoreDefense: true },
                { type: "applyStatus", to: "self", status: "well-fed" },
            ],
        };
        const withBitter: EngineContent = { ...content(), foods: { ...FOODS, bitter } };
        const box = [...lunchbox(), { slot: 3, foodId: "bitter", quantity: 1 }];

        it("heals as in a fight, food's own heal unboosted by Mending", () => {
            const you = player({ health: 40, lunchbox: box, modifiers: [{ stat: "mending", kind: "flat", value: 0.5 }] });
            assert.equal(eatBetweenFights(you, withBitter, { slot: 0 }, 1).health, 40 + 15);
        });

        it("takes a food's harm, keeps none of its buffs, and stops at 1", () => {
            const hurt = eatBetweenFights(player({ health: 50, lunchbox: box }), withBitter, { slot: 3 }, 1);
            assert.equal(hurt.health, 20);
            assert.ok(hurt.log.some((e) => e.type === "statusApplied"), "the status resolves, then is dropped with the fight state");
            assert.equal(eatBetweenFights(player({ health: 10, lunchbox: box }), withBitter, { slot: 3 }, 1).health, 1);
        });

        it("refuses an empty slot and leaves the setup untouched", () => {
            const you = player({ health: 50, lunchbox: box });
            assert.throws(() => eatBetweenFights(you, withBitter, { slot: 7 }, 1), BattleRuleError);
            eatBetweenFights(you, withBitter, { slot: 0 }, 1);
            assert.equal(you.lunchbox![0]!.quantity, 2);
        });
    });
});

describe("damage dealt bonus", () => {
    const boosted = (value: number) => [{ stat: "damageDealt", kind: "flat" as const, value }];
    /** Slow and harmless, so only the player's damage happens. */
    const target = () => spider({ baseStats: { maxHealth: 500, attack: 0, speed: 1 } });

    it("scales attacks, of any element", () => {
        const plain = playCard(createBattle([player(), target()], 1, content()).state, content(), { cardInstanceId: "c0" });
        const strong = playCard(createBattle([player({ modifiers: boosted(0.5) }), target()], 1, content()).state, content(), {
            cardInstanceId: "c0",
        });
        assert.equal(damageTo(plain.log, "enemy:0")[0]!.amount, 10);
        assert.equal(damageTo(strong.log, "enemy:0")[0]!.amount, 15);
        // Fireball: a fire attack for 5.
        const fire = playCard(createBattle([player({ modifiers: boosted(0.5) }), target()], 1, content()).state, content(), {
            cardInstanceId: "c1",
        });
        assert.equal(damageTo(fire.log, "enemy:0")[0]!.amount, 8);
    });

    it("scales damage that isn't an attack, like a proc", () => {
        const zap: EffectDef = {
            id: "zap",
            trigger: { event: "cardPlayed", as: "actor" },
            actions: [{ type: "damage", to: "other", amount: 10, element: "lightning" }],
        };
        const { log } = playCard(
            createBattle([player({ modifiers: boosted(0.5), effects: [zap] }), target()], 1, content()).state,
            content(),
            // Slash, so the zap's "other" is the enemy.
            { cardInstanceId: "c0" },
        );
        assert.equal(damageTo(log, "enemy:0").find((d) => d.element === "lightning")!.amount, 15);
    });

    it("never scales damage to oneself", () => {
        const recoil: EffectDef = {
            id: "recoil",
            trigger: { event: "cardPlayed", as: "actor" },
            actions: [{ type: "damage", to: "self", amount: 10, ignoreDefense: true }],
        };
        const { log } = playCard(
            createBattle([player({ modifiers: boosted(0.5), effects: [recoil] }), target()], 1, content()).state,
            content(),
            { cardInstanceId: "c3" },
        );
        assert.equal(damageTo(log, "player")[0]!.amount, 10);
    });
});

describe("status damage", () => {
    const boosted = [{ stat: "damageDealt", kind: "flat" as const, value: 0.5 }];

    it("isn't raised by damage-dealt bonuses, even from a status the player carries", () => {
        // A status on the player that hurts whoever attacks them.
        const spikes: StatusDef = {
            id: "spikes",
            name: "Spikes",
            maxStacks: 1,
            effects: [{ id: "spikes.prick", trigger: { event: "attacked", as: "target" }, actions: [{ type: "damage", to: "other", amount: 10 }] }],
        };
        const withSpikes: EngineContent = { ...content(), statuses: { ...content().statuses, spikes } };
        const biter = spider({ baseStats: { maxHealth: 500, attack: 1, speed: 1 } });
        const start = createBattle([player({ modifiers: boosted }), biter], 1, withSpikes);
        start.state.combatants[0]!.statuses.push({ statusId: "spikes", stacks: 1, turnsLeft: null });
        const { log } = playCard(start.state, withSpikes, { cardInstanceId: "c3" });
        assert.equal(damageTo(log, "enemy:0").find((d) => d.effectId === "spikes.prick")!.amount, 10);
    });

    it("can be raised by a rule that asks for it: oil makes burns hurt more", () => {
        // A future "Oil" card's status: burns on an oiled target hit 1.5×.
        const oiled: StatusDef = {
            id: "oiled",
            name: "Oiled",
            maxStacks: 1,
            effects: [
                {
                    id: "oiled.flare",
                    trigger: { event: "beforeDamage", as: "target" },
                    conditions: [{ type: "damageFromStatus", status: "burning" }],
                    actions: [{ type: "modifyDamage", multiply: 1.5 }],
                },
            ],
        };
        const withOil: EngineContent = { ...content(), statuses: { ...content().statuses, oiled } };
        // A fast player and an enemy that attacks, so its Burning ticks.
        const enemy = spider({ baseStats: { maxHealth: 500, attack: 1, speed: 1 } });
        const start = createBattle([player({ modifiers: boosted }), enemy], 1, withOil);
        start.state.combatants[1]!.statuses.push({ statusId: "oiled", stacks: 1, turnsLeft: null });
        const { log } = playCard(start.state, withOil, { cardInstanceId: "c1" });
        const hits = damageTo(log, "enemy:0");
        // Fireball itself: 5 × 1.5 from the player's bonus; oil leaves it alone.
        assert.equal(hits[0]!.amount, 8);
        // The burn: 3, × 1.5 from oil only (the player's bonus never applies).
        assert.equal(hits.find((d) => d.effectId === "burning.tick")!.amount, 5);
    });
});

describe("playableIf", () => {
    const COATED: StatusDef = { id: "coated", name: "Coated", maxStacks: 1 };
    const coatContent = (): EngineContent => ({
        ...content(),
        statuses: { ...content().statuses, coated: COATED },
        cards: {
            ...CARDS,
            coat: {
                id: "coat",
                name: "Coat",
                skill: "combat",
                targets: "self",
                playableIf: [{ type: "lacksStatus", who: "self", status: "coated" }],
                actions: [{ type: "applyStatus", to: "self", status: "coated" }],
            },
        },
    });
    const slow = (actions: CombatantSetup["moves"]) =>
        spider({ baseStats: { maxHealth: 200, attack: 1, speed: 1 }, moves: actions });

    it("greys out and refuses a self-buff while it lasts", () => {
        const c = coatContent();
        const bite = [{ id: "bite", name: "Bite", weight: 1, actions: [{ type: "attack" as const, to: "other" as const, amount: 1 }] }];
        const start = createBattle([player({ hand: hand("coat") }), slow(bite)], 1, c);
        assert.equal(canPlayCard(start.state, c, "c0"), true);
        const { state } = playCard(start.state, c, { cardInstanceId: "c0" });
        assert.equal(canPlayCard(state, c, "c0"), false);
        assert.throws(() => playCard(state, c, { cardInstanceId: "c0" }), /can't be played right now/);
    });

    it("allows it again once an enemy strips the buff", () => {
        const c = coatContent();
        const strip = [{ id: "strip", name: "Strip", weight: 1, actions: [{ type: "removeStatus" as const, from: "other" as const, status: "coated" }] }];
        const start = createBattle([player({ hand: hand("coat") }), slow(strip)], 1, c);
        const { state } = playCard(start.state, c, { cardInstanceId: "c0" });
        assert.equal(state.combatants[0]!.statuses.length, 0);
        assert.equal(canPlayCard(state, c, "c0"), true);
    });
});

describe("shared fights", () => {
    // Two players at speed 10, the second tougher; a slow spider.
    const ann = () => player({ id: "player:0", name: "Ann" });
    const bob = () => player({ id: "player:1", name: "Bob", baseStats: { maxHealth: 120, attack: 10, defense: 0, speed: 10 } });
    const slow = () => spider({ baseStats: { maxHealth: 400, attack: 5, defense: 0, speed: 5 } });
    const start = () => createBattle([ann(), bob(), slow()], 3, content());

    it("orders a speed tie by max health, players before enemies", () => {
        assert.deepEqual(start().state.order, ["player:1", "player:0", "enemy:0"]);
    });

    it("lets only the player whose turn it is act", () => {
        const { state } = start();
        assert.equal(currentActor(state)?.id, "player:1");
        assert.throws(() => playCard(state, content(), { cardInstanceId: "c0", actorId: "player:0" }), /isn't your turn/);
        const after = playCard(state, content(), { cardInstanceId: "c0", actorId: "player:1" }).state;
        assert.equal(currentActor(after)?.id, "player:0");
    });

    it("aims each enemy move at a rolled player, shown in its intent beforehand", () => {
        let { state } = start();
        const targets = new Set<string>();
        for (let turn = 0; turn < 30 && state.outcome === "ongoing"; turn++) {
            const shown = previewIntent(state, content(), "enemy:0")!.targetId;
            const actor = currentActor(state)!.id;
            const { state: next, log } = skipTurn(state, content(), actor, "timeout");
            const move = log.find((e): e is Extract<LogEntry, { type: "enemyMove" }> => e.type === "enemyMove");
            if (move) {
                assert.equal(move.target, shown, "it hits who the intent showed");
                targets.add(move.target);
            }
            state = next;
        }
        assert.deepEqual([...targets].sort(), ["player:0", "player:1"], "both get picked over a few rounds");
    });

    it("skips a turn the clock ran out on", () => {
        const { state, log } = skipTurn(start().state, content(), "player:1", "timeout");
        assert.deepEqual(log[0], { type: "turnSkipped", actor: "player:1", reason: "timeout" });
        assert.equal(currentActor(state)?.id, "player:0");
    });

    it("lets a player leave: their turn passes, nobody aims at them, and the last one out loses it", () => {
        const left = leaveBattle(start().state, content(), "player:1");
        assert.equal(currentActor(left.state)?.id, "player:0");
        assert.equal(previewIntent(left.state, content(), "enemy:0")!.targetId, "player:0");
        assert.throws(() => leaveBattle(left.state, content(), "player:1"), BattleRuleError);
        // Off-turn leaving doesn't move the turn on.
        const offTurn = leaveBattle(start().state, content(), "player:0");
        assert.equal(currentActor(offTurn.state)?.id, "player:1");
        const lost = leaveBattle(left.state, content(), "player:0");
        assert.equal(lost.state.outcome, "defeat");
    });
});

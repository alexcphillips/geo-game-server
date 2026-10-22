import type {
    GeoFishIntent,
    GeoFishingAction,
    GeoFishingPhase,
    GeoFishingStatuses,
    GeoFishingTier,
    GeoQualityTier,
} from "@geo/shared";
import { GEO_QUALITY_TIERS } from "@geo/shared";
import type { Rarity } from "../content/content.types";
import {
    FISHING_TUNING,
    PAR_TURNS,
    RARITY_DIFFICULTY,
    RARITY_POWER,
    RARITY_WEIGHT,
    SEA_CREATURES,
    WATER_RARITIES,
} from "../content";
import { RARITIES } from "../content/data.schema";
import { isFishingCardId, type FishDef, type FishingCardId, type RodDef } from "../content/fishing";
import { createRng, type Rng } from "../engine/rng";

/**
 * The rod fishing rules: pure and seeded, like the combat engine. Each step
 * takes the stored state and returns the next, and the repository saves it
 * with whatever it costs or gives (bait, charges, the catch) in one
 * transaction.
 *
 * PLACEHOLDER: a port of the Rod Fishing Playground. Card rules are a switch
 * on card id; the fishing engine additions (meters, intent events, new
 * conditions) turn them into data later.
 */

export class FishingRuleError extends Error {}

export type FishingHandCard = { inventoryId: string; itemId: string; cardId: string; chargesLeft: number };

export type FishingFight = {
    distance: number;
    maxDistance: number;
    tension: number;
    cap: number;
    zoneLow: number;
    zoneHigh: number;
    stamina: number;
    maxStamina: number;
    finesse: number;
    turn: number;
    par: number;
    intents: GeoFishIntent[];
    statuses: GeoFishingStatuses;
    exhausted: boolean;
    frenzy: boolean;
};

export type FishingResult =
    | { kind: "landed"; fishId: string; tier: GeoQualityTier | null; how: string; turns: number }
    | { kind: "lost"; reason: string; turns: number }
    /** The cast ends here; the repository starts the creature's combat Run. */
    | { kind: "creature"; enemyId: string };

/** Everything a fishing Run keeps between steps, in `geo.runs.state`. */
export type FishingState = {
    kind: "fishing";
    seed: number;
    draws: number;
    tier: GeoFishingTier;
    phase: GeoFishingPhase;
    fishId: string | null;
    /** The enemy on the line in the `creature` phase. */
    creatureId?: string | null;
    fight: FishingFight | null;
    result: FishingResult | null;
    message: string;
    lastTurn: string[];
    hand: FishingHandCard[];
    /** The bait on the hook this cast. */
    baitItemId: string | null;
    chum: boolean;
};

/** What a step needs to know about the player, worked out by the repository. */
export type FishingSetup = {
    rod: RodDef;
    /** Rod power plus the fishing level. */
    power: number;
    /** 0–1, with every modifier applied (`fishingOdds`). */
    seaCreatureChance: number;
    fish: Record<string, FishDef>;
};

/**
 * What casting needs from the bait slots: the bait used, or null for a bare
 * hook. Bait is optional: a bare hook only hooks commons, never a sea
 * creature, and never lands a quality catch.
 */
export type CastBait = { itemId: string; chum: boolean } | null;

export function newFishingState(tier: GeoFishingTier, hand: FishingHandCard[], seed: number): FishingState {
    return {
        kind: "fishing",
        seed,
        draws: 0,
        tier,
        phase: "ready",
        fishId: null,
        creatureId: null,
        fight: null,
        result: null,
        message: "Cast when you're ready.",
        lastTurn: [],
        hand,
        baitItemId: null,
        chum: false,
    };
}

const INTENT_VERBS: Record<GeoFishIntent, string> = { run: "runs", thrash: "thrashes", dive: "dives", rest: "rests", jump: "jumps" };

/** How far Feather the Drag pulls Tension toward the zone's middle. */
const FEATHER_PULL = 3;

const fmt = (n: number) => String(Math.round(n * 10) / 10);

function pickWeighted<K extends string>(weights: Record<K, number>, roll: number): K {
    const entries = (Object.entries(weights) as [K, number][]).filter(([, w]) => w > 0);
    const total = entries.reduce((sum, [, w]) => sum + w, 0);
    let x = roll * total;
    for (const [key, weight] of entries) {
        x -= weight;
        if (x < 0) return key;
    }
    return entries[entries.length - 1]![0];
}

/**
 * One step of a cast. `bait` is only read by a cast: the bait the repository
 * is about to take, or null when none is packed (refused).
 */
export function stepFishing(
    prev: FishingState,
    action: GeoFishingAction,
    setup: FishingSetup,
    bait: CastBait = null,
): FishingState {
    const rng = createRng(prev.seed, prev.draws);
    const state: FishingState = structuredClone(prev);
    state.lastTurn = [];
    const next = applyAction(state, action, setup, rng, bait);
    next.draws = rng.draws();
    return next;
}

function applyAction(state: FishingState, action: GeoFishingAction, setup: FishingSetup, rng: Rng, bait: CastBait): FishingState {
    switch (action.type) {
        case "cast":
            return cast(state, bait);
        case "strike":
            return strike(state, setup, rng);
        case "cutLine":
            if (state.phase !== "creature") throw new FishingRuleError("Nothing to cut loose");
            return over(state, { kind: "lost", reason: "You cut the line. The bait's gone, but you're safe.", turns: 0 });
        case "fightCreature":
            if (state.phase !== "creature" || !state.creatureId) throw new FishingRuleError("Nothing to fight");
            return over(state, { kind: "creature", enemyId: state.creatureId });
        case "play":
            return playCard(state, action.inventoryId, setup, rng);
    }
}

function over(state: FishingState, result: FishingResult): FishingState {
    return { ...state, phase: "over", result, message: "" };
}

function cast(state: FishingState, bait: CastBait): FishingState {
    if (state.phase !== "ready" && state.phase !== "over") throw new FishingRuleError("Your line's already in the water");
    return {
        ...state,
        phase: "waiting",
        fishId: null,
        creatureId: null,
        fight: null,
        result: null,
        baitItemId: bait?.itemId ?? null,
        chum: bait?.chum ?? false,
        message: "The bobber plunges under!",
    };
}

function strike(state: FishingState, setup: FishingSetup, rng: Rng): FishingState {
    if (state.phase !== "waiting") throw new FishingRuleError("Nothing to strike at");
    const creatures = SEA_CREATURES[state.tier];
    const creatureChance = Math.min(1, setup.seaCreatureChance * (state.chum ? 3 : 1));
    if (state.baitItemId && creatures.length > 0 && rng.next() < creatureChance) {
        const weights = Object.fromEntries(creatures.map((c) => [c.enemyId, c.weight])) as Record<string, number>;
        const creatureId = pickWeighted(weights, rng.next());
        return { ...state, phase: "creature", creatureId, message: "The water goes still. The line pulls sideways…" };
    }

    const fish = randomFish(state.tier, state.baitItemId ? setup.rod.maxRarity : "common", setup, rng);
    return startFight({ ...state, fishId: fish.id }, setup, rng);
}

/** The rarities that can bite: the water's, up to the rod's rarest. Every rod hooks commons. */
/** Rarities that can bite: the water's, capped by the rod (or "common" for a bare hook). */
export function biteRarities(tier: GeoFishingTier, maxRarity: Rarity): Rarity[] {
    const cap = RARITIES.indexOf(maxRarity);
    const allowed = WATER_RARITIES[tier].filter((rarity) => RARITIES.indexOf(rarity) <= cap);
    return allowed.length > 0 ? allowed : ["common"];
}

function randomFish(tier: GeoFishingTier, maxRarity: Rarity, setup: FishingSetup, rng: Rng): FishDef {
    const allowed = biteRarities(tier, maxRarity);
    const weights = Object.fromEntries(allowed.map((rarity) => [rarity, RARITY_WEIGHT[rarity]])) as Record<Rarity, number>;
    const rarity = pickWeighted(weights, rng.next());
    const pool = Object.values(setup.fish).filter((fish) => fish.rarity === rarity);
    const fallback = Object.values(setup.fish)[0];
    if (!fallback) throw new Error("No fish in the content");
    return pool[Math.floor(rng.next() * pool.length)] ?? fallback;
}

function intentWeights(fight: FishingFight, fish: FishDef): Record<GeoFishIntent, number> {
    if (fight.exhausted) return { run: 2, thrash: 0, dive: 0, rest: 5, jump: 1 };
    if (fight.frenzy) return { ...fish.moves, thrash: fish.moves.thrash + 3 };
    return fish.moves;
}

function startFight(state: FishingState, setup: FishingSetup, rng: Rng): FishingState {
    const fish = setup.fish[state.fishId ?? ""];
    if (!fish) throw new Error(`Unknown fish "${state.fishId}"`);
    const cap = setup.rod.line;
    const fight: FishingFight = {
        distance: fish.distance,
        maxDistance: fish.distance + 5,
        tension: cap * 0.5,
        cap,
        zoneLow: cap * FISHING_TUNING.zoneLow,
        zoneHigh: cap * FISHING_TUNING.zoneHigh,
        stamina: fish.stamina,
        maxStamina: fish.stamina,
        finesse: 0,
        turn: 0,
        par: PAR_TURNS[fish.rarity],
        intents: [],
        statuses: { hooked: 0, tired: 0, momentum: 0, focus: 0, reading: 0 },
        exhausted: false,
        frenzy: false,
    };
    for (let i = 0; i < 4; i++) fight.intents.push(pickWeighted(intentWeights(fight, fish), rng.next()));
    return { ...state, phase: "fight", fight, message: "Fish on! Watch its next move." };
}

/**
 * One turn: your card, then the fish makes the move it showed, then the
 * checks: snapped line, thrown hook, escape, the sweet zone, par.
 */
function playCard(state: FishingState, inventoryId: string, setup: FishingSetup, rng: Rng): FishingState {
    if (state.phase !== "fight" || !state.fight) throw new FishingRuleError("You're not fighting a fish");
    const fish = setup.fish[state.fishId ?? ""];
    if (!fish) throw new Error(`Unknown fish "${state.fishId}"`);
    const card = state.hand.find((entry) => entry.inventoryId === inventoryId);
    if (!card) throw new FishingRuleError("That card isn't in your hand");
    if (card.chargesLeft <= 0) throw new FishingRuleError("That card has faded");
    if (!isFishingCardId(card.cardId)) throw new FishingRuleError("That isn't a fishing card");
    card.chargesLeft -= 1;

    const f = state.fight;
    const finesseBefore = f.finesse;
    const say = (line: string) => state.lastTurn.push(line);
    // Rarer fish shrug off part of your Fishing Power.
    const power = Math.max(0, setup.power - RARITY_POWER[fish.rarity]);
    const reelBonus = Math.floor(power / 6);
    let intent = f.intents[0]!;

    let progress = 1;
    if (intent === "dive") progress *= 0.5;
    if (fish.traits.includes("deepdiver") && !f.exhausted) progress *= 0.5;
    const tired = f.statuses.tired > 0;
    if (tired) progress *= 2;
    let steadyBonus = 0;
    let feather = false;
    let usedProgress = false;

    const cardId: FishingCardId = card.cardId;
    switch (cardId) {
        case "fish.reel": {
            const d = (2 + reelBonus + 2 * f.statuses.momentum) * progress;
            f.distance -= d;
            f.statuses.momentum = 0;
            f.tension += intent === "rest" ? 1 : 2;
            usedProgress = true;
            say(`Reel: −${fmt(d)} distance`);
            break;
        }
        case "fish.horse": {
            const d = (4 + reelBonus) * progress;
            f.distance -= d;
            f.tension += 4;
            f.finesse -= 1;
            usedProgress = true;
            say(`Horse It In: −${fmt(d)} distance`);
            break;
        }
        case "fish.gaff": {
            const reach = f.exhausted ? 4 : 2;
            if (f.distance <= reach) {
                f.finesse -= 2;
                f.turn++;
                return land(state, fish, setup, rng, "Gaffed");
            }
            f.tension += 1;
            say(`Gaff misses: out of reach (needs ≤ ${reach})`);
            break;
        }
        case "fish.slack":
            f.tension -= 3;
            f.distance += 1;
            f.statuses.momentum = Math.min(3, f.statuses.momentum + 1);
            say("Give Slack: −3 tension, +1 momentum");
            break;
        case "fish.steady":
            f.distance -= progress;
            steadyBonus = 1;
            usedProgress = true;
            say(`Steady: −${fmt(progress)} distance`);
            break;
        case "fish.feather":
            feather = true;
            f.finesse += 1;
            say("Feather the Drag");
            break;
        case "fish.read":
            f.statuses.reading = 4;
            f.finesse += 1;
            say("Read the Water");
            break;
        case "fish.tire":
            if (intent === "run" || intent === "dive") {
                const s = 2 + power / 4;
                f.stamina -= s;
                f.statuses.tired = 2;
                f.finesse += 2;
                say(`Tire It Out: −${fmt(s)} stamina, it's Tired`);
            } else {
                f.tension += 1;
                say("Tire It Out: nothing to tire");
            }
            break;
        case "fish.hook":
            f.statuses.hooked = 3;
            say("Set the Hook");
            break;
        case "fish.twitch":
            f.intents[0] = "rest";
            intent = "rest";
            f.finesse += 1;
            say("Twitch: it pauses to Rest");
            break;
        case "fish.patient":
            f.statuses.focus = 3;
            say("Patient Hands: Focus");
            break;
    }
    if (usedProgress && tired) f.statuses.tired = 0;
    f.turn++;
    if (f.distance <= 0) {
        f.distance = 0;
        return land(state, fish, setup, rng, "Reeled in");
    }

    // The fish makes the move it showed.
    const strength = fish.strength * (f.exhausted ? 0.5 : 1) * (f.frenzy ? 1.2 : 1);
    switch (intent) {
        case "run":
            f.distance += strength;
            f.tension += 3 * strength;
            break;
        case "thrash":
            f.tension += 4 * strength + (fish.traits.includes("linebreaker") ? 2 : 0);
            break;
        case "dive":
            f.distance += 0.5 * strength;
            f.tension += 2 * strength;
            break;
        case "rest":
            f.tension -= 2;
            break;
        case "jump":
            f.tension -= 3 * strength;
            break;
    }
    if (fish.traits.includes("slippery")) f.tension -= 1;
    if (feather) {
        const mid = (f.zoneLow + f.zoneHigh) / 2;
        f.tension += Math.max(-FEATHER_PULL, Math.min(FEATHER_PULL, mid - f.tension));
    }
    say(`It ${INTENT_VERBS[intent]}`);

    if (f.tension > f.cap) return over(state, { kind: "lost", reason: "The line snapped.", turns: f.turn });
    if (f.tension <= 0) {
        if (f.statuses.hooked > 0) {
            f.tension = 0.5;
            say("Slack, but the hook holds");
        } else {
            return over(state, { kind: "lost", reason: "Too much slack. It threw the hook.", turns: f.turn });
        }
    }
    if (f.distance >= f.maxDistance) {
        if (f.statuses.hooked > 0) {
            f.distance = f.maxDistance - 0.5;
            say("It hits the end of the line; the hook holds");
        } else {
            return over(state, { kind: "lost", reason: "It ran off with the line.", turns: f.turn });
        }
    }

    const inZone = f.tension >= f.zoneLow && f.tension <= f.zoneHigh;
    if (inZone) {
        // An Exhausted fish has nothing left to tire: zone turns stop paying.
        if (!f.exhausted) f.finesse += 1 + (f.statuses.focus > 0 ? 1 : 0) + steadyBonus;
        f.stamina = Math.max(0, f.stamina - (1 + power / 6));
    }
    // Past par you're stalling: nothing earns Finesse, and each turn costs 1.
    if (f.turn > f.par) {
        f.finesse = Math.min(f.finesse, finesseBefore) - 1;
        say("Past par: −1 finesse");
    }

    let message = inZone ? "In the zone." : f.tension < f.zoneLow ? "The line's slack." : "The line's straining!";
    if (f.stamina <= 0 && !f.exhausted) {
        f.exhausted = true;
        f.frenzy = false;
        rerollIntents(f, fish, rng);
        message = "It's Exhausted. Finish it.";
    } else if (fish.rarity === "legendary" && !f.frenzy && !f.exhausted && f.stamina <= f.maxStamina / 2) {
        f.frenzy = true;
        rerollIntents(f, fish, rng);
        message = "Frenzy! It fights harder.";
    }

    for (const key of ["hooked", "reading", "focus", "tired"] as const) {
        if (f.statuses[key] > 0) f.statuses[key]--;
    }
    f.intents.shift();
    f.intents.push(pickWeighted(intentWeights(f, fish), rng.next()));
    if (f.turn >= FISHING_TUNING.maxTurns) return over(state, { kind: "lost", reason: "It wore you out.", turns: f.turn });

    return { ...state, message };
}

function rerollIntents(f: FishingFight, fish: FishDef, rng: Rng) {
    for (let i = 1; i < f.intents.length; i++) f.intents[i] = pickWeighted(intentWeights(f, fish), rng.next());
}

function land(state: FishingState, fish: FishDef, setup: FishingSetup, rng: Rng, how: string): FishingState {
    const f = state.fight!;
    // A bare hook never lands a quality catch.
    const tier = state.baitItemId ? rollTier(f.finesse, fish.rarity, setup.rod.maxTier, rng.next()) : null;
    return over(state, { kind: "landed", fishId: fish.id, tier, how, turns: f.turn });
}

/**
 * Quality is a surprise: Finesse weights a luck roll, rarer fish need more
 * of it, and the rod caps the best tier. No Finesse, or a rod with no
 * quality at all, no tier.
 */
export function rollTier(finesse: number, rarity: Rarity, maxTier: GeoQualityTier | null, roll: number): GeoQualityTier | null {
    if (finesse <= 0 || !maxTier) return null;
    const value = finesse * (0.4 + roll * roll * 1.6);
    let tier: GeoQualityTier | null = null;
    for (const candidate of GEO_QUALITY_TIERS) {
        if (value >= FISHING_TUNING.tierThresholds[candidate] * RARITY_DIFFICULTY[rarity]) tier = candidate;
    }
    if (tier && GEO_QUALITY_TIERS.indexOf(tier) > GEO_QUALITY_TIERS.indexOf(maxTier)) tier = maxTier;
    return tier;
}

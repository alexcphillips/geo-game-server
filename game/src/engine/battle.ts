import type { EngineContent } from "./content.types";
import type {
    Action,
    Amount,
    BattleState,
    CardDef,
    CardInstance,
    Combatant,
    Condition,
    EffectDef,
    EnemyMove,
    EventType,
    FoodDef,
    LogEntry,
    StatusInstance,
    Who,
} from "./engine.types";
import {
    ARMOR_PEN_STAT,
    CORE_STATS,
    COUNTER_CHANCE_STAT,
    COUNTER_DAMAGE_STAT,
    DAMAGE_DEALT_STAT,
    DEFAULT_COUNTER_DAMAGE,
    MENDING_STAT,
    MIN_DAMAGE_SHARE,
} from "./engine.types";
import { createRng, type Rng } from "./rng";
import { statOf } from "./stats";

/**
 * The battle engine: pure functions over a JSON `BattleState`.
 *
 * Flow: `createBattle` sets up and runs everything up to the first player's
 * decision; `playCard` or `eatFood` resolves that player's turn, then every
 * turn after it until a player must decide again (or a side wins). A shared
 * fight has several players: each acts on their own turn (`actorId`), a turn
 * can be skipped (`skipTurn`, the turn clock), and a player can leave
 * (`leaveBattle`). Each returns the new
 * state and the log of what happened, which the app plays back as animation.
 *
 * Every rule runs through `emit`: an event goes to every effect listening for
 * it — from gear and talismans, statuses, and the card being played — and
 * those effects run actions, which can emit further events. Chains stop at
 * MAX_EFFECT_DEPTH so two procs can never trigger each other forever.
 */

/** How deep effects may trigger effects. Lightning → burn → … stops here. */
const MAX_EFFECT_DEPTH = 6;
/** Turns one advance may run, as a backstop against a battle nobody can act in. */
const MAX_TURNS_PER_ADVANCE = 100;

export type CombatantSetup = Omit<Combatant, "health" | "guard" | "barrier" | "statuses"> & {
    /** Starts at max health when omitted. */
    health?: number;
    /** A barrier it starts the fight with, e.g. an enemy that spawns shielded. */
    barrier?: number;
};

export type BattleResult = { state: BattleState; log: LogEntry[] };

export class BattleRuleError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "BattleRuleError";
    }
}

// ---------------------------------------------------------------------------
// Public API

/** Sets up a battle and runs it to the player's first decision. */
export function createBattle(
    combatants: CombatantSetup[],
    seed: number,
    content: EngineContent,
): BattleResult {
    const state: BattleState = {
        seed,
        rngDraws: 0,
        round: 0,
        order: [],
        turnIndex: 0,
        combatants: combatants.map((setup) => {
            const draft: Combatant = {
                ...setup,
                health: 0,
                guard: 0,
                barrier: setup.barrier ?? 0,
                statuses: [],
            };
            draft.health = setup.health ?? statOf(draft, CORE_STATS.maxHealth, content);
            return draft;
        }),
        outcome: "ongoing",
    };

    const ctx = makeContext(state, content);
    for (const combatant of state.combatants) {
        if (combatant.side !== "enemy") continue;
        combatant.intent = pickMove(ctx, combatant.moves ?? [])?.id;
        combatant.intentTarget = pickTarget(ctx)?.id;
    }
    // Logged so the app shows a starting barrier arriving, like any other.
    for (const combatant of state.combatants) {
        if (combatant.barrier > 0) ctx.log.push({ type: "barrier", target: combatant.id, amount: combatant.barrier });
    }
    emit(ctx, { type: "battleStart" });
    advance(ctx);
    return finish(ctx);
}

/**
 * The player plays a card at a target, then the battle runs until the player
 * must decide again. Throws `BattleRuleError` for an illegal play, leaving
 * the state untouched.
 */
export function playCard(
    previous: BattleState,
    content: EngineContent,
    play: { cardInstanceId: string; targetId?: string; actorId?: string },
): BattleResult {
    return playerTurn(previous, content, play.actorId, (ctx, actor) => {
        const instance = actor.hand?.find((card) => card.instanceId === play.cardInstanceId);
        if (!instance) throw new BattleRuleError("That card isn't in your hand.");
        const card = content.cards[instance.cardId];
        if (!card) throw new BattleRuleError(`Unknown card ${instance.cardId}.`);

        const target = resolveCardTarget(ctx.state, actor, card, play.targetId);
        const refusal = cardRefusal(ctx, actor, target, card, instance);
        if (refusal) throw new BattleRuleError(refusal);
        resolveCard(ctx, actor, target, card, instance);
    });
}

/**
 * Whether the player could play this hand card now, whoever's turn it is:
 * charges, weapon and the card's `playableIf`. The app greys out the rest.
 */
export function canPlayCard(state: BattleState, content: EngineContent, cardInstanceId: string, actorId?: string): boolean {
    const actor = playerById(state, actorId);
    const instance = actor?.hand?.find((card) => card.instanceId === cardInstanceId);
    const card = instance && content.cards[instance.cardId];
    if (!actor || !instance || !card || state.outcome !== "ongoing") return false;
    const ctx = makeContext(state, content);
    try {
        return !cardRefusal(ctx, actor, resolveCardTarget(state, actor, card, undefined), card, instance);
    } catch {
        return false;
    }
}

/** Why this card can't be played now, or null if it can. */
function cardRefusal(ctx: Context, actor: Combatant, target: Combatant, card: CardDef, instance: CardInstance): string | null {
    if (instance.chargesLeft <= 0) return "That card has no charges left.";
    if (!fitsWeapon(card, actor.weaponTags)) return `${card.name} needs a ${card.requiresWeapon!.join(" or ")} weapon.`;
    if (!fitsOffHand(card, actor.offHandTags)) return `${card.name} needs a ${card.requiresOffHand!.join(" or ")} in your off-hand.`;
    const event: BattleEvent = { type: "cardPlayed", actor: actor.id, target: target.id, card };
    if (!(card.playableIf ?? []).every((condition) => conditionHolds(ctx, condition, actor, event))) {
        return `${card.name} can't be played right now.`;
    }
    return null;
}

/**
 * The player eats one food from a lunchbox slot, which takes their turn, then
 * the battle runs until the player must decide again. Throws
 * `BattleRuleError` for an empty or missing slot, leaving the state untouched.
 */
export function eatFood(previous: BattleState, content: EngineContent, eat: { slot: number; actorId?: string }): BattleResult {
    return playerTurn(previous, content, eat.actorId, (ctx, actor) => {
        const packed = actor.lunchbox?.find((entry) => entry.slot === eat.slot);
        if (!packed || packed.quantity <= 0) throw new BattleRuleError("That lunchbox slot is empty.");
        const food = content.foods[packed.foodId];
        if (!food) throw new BattleRuleError(`Unknown food ${packed.foodId}.`);
        resolveFood(ctx, actor, food, packed);
    });
}

/**
 * The player eats one food from a lunchbox slot between fights. The food
 * resolves exactly as in a fight (its heals, its damage, gear that reacts to `foodEaten`), but only the eater's health is
 * kept: statuses, guard and the rest exist only in a fight. Eating can't
 * kill: health stops at 1. Throws `BattleRuleError` for an empty slot.
 */
export function eatBetweenFights(
    setup: CombatantSetup,
    content: EngineContent,
    eat: { slot: number },
    seed: number,
): { health: number; log: LogEntry[] } {
    const eater: Combatant = { ...structuredClone(setup), health: 0, guard: 0, barrier: 0, statuses: [] };
    eater.health = setup.health ?? statOf(eater, CORE_STATS.maxHealth, content);
    const state: BattleState = { seed, rngDraws: 0, round: 0, order: [eater.id], turnIndex: 0, combatants: [eater], outcome: "ongoing" };
    const ctx = makeContext(state, content);

    const packed = eater.lunchbox?.find((entry) => entry.slot === eat.slot);
    if (!packed || packed.quantity <= 0) throw new BattleRuleError("That lunchbox slot is empty.");
    const food = content.foods[packed.foodId];
    if (!food) throw new BattleRuleError(`Unknown food ${packed.foodId}.`);
    resolveFood(ctx, eater, food, packed);

    return { health: Math.max(1, eater.health), log: ctx.log };
}

/**
 * The player's turn passes without them acting: the turn clock ran out in a
 * shared fight. Their turn ends as any other does (statuses tick down).
 */
export function skipTurn(previous: BattleState, content: EngineContent, actorId: string, reason: string): BattleResult {
    return playerTurn(previous, content, actorId, (ctx, actor) => {
        ctx.log.push({ type: "turnSkipped", actor: actor.id, reason });
    });
}

/**
 * A player flees a shared fight: they're out of it for good, and nobody's
 * target. On their own turn, play moves on to the next; with no player left
 * standing, the fight is lost.
 */
export function leaveBattle(previous: BattleState, content: EngineContent, actorId: string): BattleResult {
    const state = structuredClone(previous);
    if (state.outcome !== "ongoing") throw new BattleRuleError("The battle is over.");
    const actor = state.combatants.find((c) => c.id === actorId);
    if (!actor || actor.side !== "player" || !isAlive(actor)) throw new BattleRuleError("You're not in this fight.");

    const ctx = makeContext(state, content);
    const wasTheirTurn = currentActor(state)?.id === actorId;
    actor.left = true;
    ctx.log.push({ type: "left", actor: actor.id });
    checkOutcome(ctx);
    if (wasTheirTurn && state.outcome === "ongoing") {
        state.turnIndex += 1;
        advance(ctx);
    }
    return finish(ctx);
}

/** A player by id, or the first when none is asked for (a solo fight's only one). */
function playerById(state: BattleState, actorId?: string): Combatant | undefined {
    return state.combatants.find((c) => c.side === "player" && (actorId === undefined || c.id === actorId));
}

/**
 * The checks and running every player turn shares. `act` may throw a
 * `BattleRuleError`; it works on a copy, so a rejected turn changes nothing.
 * `actorId`: who's acting; it must be their turn (any player's, when absent).
 */
function playerTurn(
    previous: BattleState,
    content: EngineContent,
    actorId: string | undefined,
    act: (ctx: Context, actor: Combatant) => void,
): BattleResult {
    const state = structuredClone(previous);
    if (state.outcome !== "ongoing") throw new BattleRuleError("The battle is over.");

    const actor = currentActor(state);
    if (!actor || actor.side !== "player" || (actorId !== undefined && actor.id !== actorId)) {
        throw new BattleRuleError("It isn't your turn.");
    }

    const ctx = makeContext(state, content);
    act(ctx, actor);
    if (state.outcome === "ongoing") endTurn(ctx, actor);
    advance(ctx);
    return finish(ctx);
}

const fitsWeapon = (card: CardDef, weaponTags: string[] = []) =>
    !card.requiresWeapon || card.requiresWeapon.some((tag) => weaponTags.includes(tag));

const fitsOffHand = (card: CardDef, offHandTags: string[] = []) =>
    !card.requiresOffHand || card.requiresOffHand.some((tag) => offHandTags.includes(tag));

/** Whether a weapon and off-hand with these tags can play `card`. */
export function canWield(card: CardDef, weaponTags: string[] = [], offHandTags: string[] = []): boolean {
    return fitsWeapon(card, weaponTags) && fitsOffHand(card, offHandTags);
}

/** Whose turn it is, or null when the battle is over. */
export function currentActor(state: BattleState): Combatant | null {
    if (state.outcome !== "ongoing") return null;
    const id = state.order[state.turnIndex];
    return state.combatants.find((combatant) => combatant.id === id) ?? null;
}

// ---------------------------------------------------------------------------
// Context

type Context = {
    state: BattleState;
    content: EngineContent;
    rng: Rng;
    log: LogEntry[];
    depth: number;
};

function makeContext(state: BattleState, content: EngineContent): Context {
    return { state, content, rng: createRng(state.seed, state.rngDraws), log: [], depth: 0 };
}

function finish(ctx: Context): BattleResult {
    ctx.state.rngDraws = ctx.rng.draws();
    return { state: ctx.state, log: ctx.log };
}

function byId(ctx: Context, id: string | undefined): Combatant | undefined {
    return id === undefined ? undefined : ctx.state.combatants.find((c) => c.id === id);
}

/** Standing and still in the fight: a player who left counts as gone. */
const isAlive = (combatant: Combatant) => combatant.health > 0 && !combatant.left;

// ---------------------------------------------------------------------------
// Turn flow

/** Runs turns until the player must choose a card, or the battle ends. */
function advance(ctx: Context): void {
    const { state } = ctx;

    for (let turns = 0; turns < MAX_TURNS_PER_ADVANCE && state.outcome === "ongoing"; turns++) {
        if (state.turnIndex >= state.order.length) startRound(ctx);

        const actor = byId(ctx, state.order[state.turnIndex]);
        if (!actor || !isAlive(actor)) {
            state.turnIndex += 1;
            continue;
        }

        ctx.log.push({ type: "turnStart", actor: actor.id });
        // Guard lasts until the bearer's next turn: it protects through the
        // other side's turn, then lapses.
        actor.guard = 0;
        emit(ctx, { type: "turnStart", actor: actor.id });
        if (state.outcome !== "ongoing") return;
        if (!isAlive(actor)) {
            state.turnIndex += 1;
            continue;
        }

        const before = emit(ctx, { type: "beforeAction", actor: actor.id });
        if (state.outcome !== "ongoing") return;
        if (before.cancelled) {
            ctx.log.push({ type: "turnSkipped", actor: actor.id, reason: before.cancelledBy ?? "" });
            endTurn(ctx, actor);
            continue;
        }

        // The player's turn has started; wait for their card.
        if (actor.side === "player") return;

        enemyTurn(ctx, actor);
        if (state.outcome === "ongoing") endTurn(ctx, actor);
    }
}

/**
 * A new round: everyone alive, fastest first. Ties go to players before
 * enemies, then to the higher max health, then to setup order. Speed is read
 * now, so a speed change mid-round takes effect from the next round.
 */
function startRound(ctx: Context): void {
    const { state, content } = ctx;
    state.round += 1;
    state.turnIndex = 0;
    state.order = state.combatants
        .map((combatant, index) => ({ combatant, index }))
        .filter(({ combatant }) => isAlive(combatant))
        .sort(
            (a, b) =>
                statOf(b.combatant, CORE_STATS.speed, content) -
                    statOf(a.combatant, CORE_STATS.speed, content) ||
                Number(b.combatant.side === "player") - Number(a.combatant.side === "player") ||
                statOf(b.combatant, CORE_STATS.maxHealth, content) - statOf(a.combatant, CORE_STATS.maxHealth, content) ||
                a.index - b.index,
        )
        .map(({ combatant }) => combatant.id);
    ctx.log.push({ type: "roundStart", round: state.round, order: [...state.order] });
}

function endTurn(ctx: Context, actor: Combatant): void {
    emit(ctx, { type: "turnEnd", actor: actor.id });

    // Durations count the bearer's own turns.
    for (const status of [...actor.statuses]) {
        if (status.turnsLeft === null) continue;
        status.turnsLeft -= 1;
        if (status.turnsLeft <= 0) removeStatus(ctx, actor, status.statusId);
    }
    ctx.state.turnIndex += 1;
}

function enemyTurn(ctx: Context, actor: Combatant): void {
    const moves = actor.moves ?? [];
    const move = moves.find((m) => m.id === actor.intent) ?? pickMove(ctx, moves);
    const aimed = byId(ctx, actor.intentTarget);
    const target = aimed && aimed.side === "player" && isAlive(aimed) ? aimed : pickTarget(ctx);
    if (!move || !target) return;

    ctx.log.push({ type: "enemyMove", actor: actor.id, moveId: move.id, target: target.id });
    runActions(ctx, move.actions, {
        owner: actor,
        event: { type: "cardPlayed", actor: actor.id, target: target.id },
    });
    // The next move and its target, chosen now so the app can show them coming.
    actor.intent = pickMove(ctx, moves)?.id;
    actor.intentTarget = pickTarget(ctx)?.id;
}

/**
 * A player for an enemy's move to aim at: any one standing, rolled. Alone,
 * it's them, with no roll, so a solo fight's dice are as they always were.
 */
function pickTarget(ctx: Context): Combatant | undefined {
    const players = ctx.state.combatants.filter((c) => c.side === "player" && isAlive(c));
    if (players.length <= 1) return players[0];
    return players[Math.floor(ctx.rng.next() * players.length)];
}

/** One part of what a move or card will do, as the app shows it. */
export type MovePreviewPart =
    | { kind: "attack"; damage: number; hits: number }
    | { kind: "guard" | "barrier" | "heal"; amount: number; self: boolean }
    | { kind: "status"; statusId: string; self: boolean };

export type MovePreview = { moveId: string; name: string; targetId: string; parts: MovePreviewPart[] };

/**
 * What an enemy will do on its next turn, against the player as they stand
 * now (see `previewActions`). Null for an enemy with no move chosen.
 */
export function previewIntent(state: BattleState, content: EngineContent, enemyId: string): MovePreview | null {
    const enemy = state.combatants.find((c) => c.id === enemyId);
    const move = enemy?.moves?.find((m) => m.id === enemy.intent);
    const aimed = state.combatants.find((c) => c.id === enemy?.intentTarget);
    const target = aimed && isAlive(aimed) ? aimed : state.combatants.find((c) => c.side === "player" && isAlive(c));
    if (!enemy || !move || !target) return null;
    return { moveId: move.id, name: move.name, targetId: target.id, parts: previewActions(state, content, enemy, target, move.actions) };
}

/**
 * What playing a hand card now would do, at its default target (the first
 * enemy standing, or the player for a self card). Null for a card not in hand.
 */
export function previewCard(state: BattleState, content: EngineContent, cardInstanceId: string, actorId?: string): MovePreviewPart[] | null {
    const player = playerById(state, actorId);
    const instance = player?.hand?.find((card) => card.instanceId === cardInstanceId);
    const card = instance && content.cards[instance.cardId];
    if (!player || !card || state.outcome !== "ongoing") return null;
    const target = card.targets === "self" ? player : state.combatants.find((c) => c.side === "enemy" && isAlive(c));
    if (!target) return null;
    return previewActions(state, content, player, target, card.actions ?? []);
}

/**
 * Actions as the app previews them: each hit after attack, damage bonuses and
 * the target's defense, before crits, guard, barrier and any rule that reacts
 * to the hit. `other` is `target`.
 */
function previewActions(
    state: BattleState,
    content: EngineContent,
    owner: Combatant,
    target: Combatant,
    actions: Action[],
): MovePreviewPart[] {
    const ctx = makeContext(state, content);
    const scope: ActionScope = { owner, event: { type: "cardPlayed", actor: owner.id, target: target.id } };
    const parts: MovePreviewPart[] = [];
    for (const action of actions) {
        switch (action.type) {
            case "attack":
            case "damage": {
                const victim = action.to === "self" ? owner : target;
                let amount = amountOf(ctx, action.amount, scope);
                if (victim !== owner) amount *= 1 + statOf(owner, DAMAGE_DEALT_STAT, content);
                const isAttack = action.type === "attack";
                if (isAttack || !action.ignoreDefense) amount = defended(content, owner, victim, amount, isAttack);
                const hits = action.type === "attack" ? Math.max(1, Math.floor(action.hits ?? 1)) : 1;
                parts.push({ kind: "attack", damage: Math.max(0, Math.round(amount)), hits });
                break;
            }
            case "guard":
            case "barrier":
            case "heal":
                parts.push({ kind: action.type, amount: Math.round(amountOf(ctx, action.amount, scope)), self: action.to === "self" });
                break;
            case "applyStatus":
                parts.push({ kind: "status", statusId: action.status, self: action.to === "self" });
                break;
        }
    }
    return parts;
}

function pickMove(ctx: Context, moves: EnemyMove[]): EnemyMove | undefined {
    if (moves.length <= 1) return moves[0];
    const total = moves.reduce((sum, move) => sum + move.weight, 0);
    let roll = ctx.rng.next() * total;
    for (const move of moves) {
        roll -= move.weight;
        if (roll < 0) return move;
    }
    return moves.at(-1);
}

function resolveCardTarget(
    state: BattleState,
    actor: Combatant,
    card: CardDef,
    targetId: string | undefined,
): Combatant {
    if (card.targets === "self") return actor;

    const enemies = state.combatants.filter((c) => c.side !== actor.side && isAlive(c));
    const target = targetId ? enemies.find((c) => c.id === targetId) : enemies[0];
    if (!target) throw new BattleRuleError("No enemy to target.");
    return target;
}

function resolveCard(
    ctx: Context,
    actor: Combatant,
    target: Combatant,
    card: CardDef,
    instance: CardInstance,
): void {
    // Card rules are judged before the card does anything, so a fire card
    // that applies Burning doesn't make itself free.
    const played = emit(
        ctx,
        { type: "cardPlayed", actor: actor.id, target: target.id, card },
        card.effects?.map((effect) => ({ owner: actor, effect })) ?? [],
    );

    const chargeSpent = !played.freeCharge;
    if (chargeSpent) instance.chargesLeft -= 1;
    ctx.log.push({
        type: "cardPlayed",
        actor: actor.id,
        cardId: card.id,
        target: target.id,
        chargeSpent,
    });

    runActions(ctx, card.actions, {
        owner: actor,
        event: { type: "cardPlayed", actor: actor.id, target: target.id, card },
    });
}

function resolveFood(ctx: Context, actor: Combatant, food: FoodDef, packed: { slot: number; quantity: number }): void {
    const event: BattleEvent = { type: "foodEaten", actor: actor.id, target: actor.id, food };
    packed.quantity -= 1;
    ctx.log.push({ type: "foodEaten", actor: actor.id, foodId: food.id, slot: packed.slot });

    emit(ctx, event, food.effects?.map((effect) => ({ owner: actor, effect })) ?? []);
    runActions(ctx, food.actions, { owner: actor, event, fromFood: true });
}

// ---------------------------------------------------------------------------
// Events

type BattleEvent = {
    type: EventType;
    actor?: string;
    target?: string;
    card?: CardDef;
    food?: FoodDef;
    /** beforeDamage / damageTaken. Mutable in beforeDamage. */
    damage?: { amount: number; element: string; fromStatus?: string };
};

/** What listeners decided, read by whoever emitted the event. */
type EventOutcome = {
    cancelled: boolean;
    cancelledBy?: string;
    freeCharge: boolean;
};

type Listener = {
    owner: Combatant;
    effect: EffectDef;
    /** Set when the effect comes from a status, for per-stack amounts. */
    status?: StatusInstance;
};

/**
 * Sends an event to every listening effect, in a fixed order — combatants in
 * setup order; each one's gear, then statuses — so a seeded battle always
 * resolves the same way. `extra` adds listeners only this event hears (the
 * played card's own rules).
 */
function emit(ctx: Context, event: BattleEvent, extra: Listener[] = []): EventOutcome {
    const outcome: EventOutcome = { cancelled: false, freeCharge: false };
    if (ctx.depth >= MAX_EFFECT_DEPTH) return outcome;

    const listeners: Listener[] = [...extra];
    for (const owner of ctx.state.combatants) {
        // The defeated don't react, except to their own defeat.
        if (!isAlive(owner) && !(event.type === "defeated" && event.target === owner.id)) continue;
        for (const effect of owner.effects) listeners.push({ owner, effect });
        for (const status of owner.statuses) {
            const def = ctx.content.statuses[status.statusId];
            for (const effect of def?.effects ?? []) listeners.push({ owner, effect, status });
        }
    }

    ctx.depth += 1;
    try {
        for (const listener of listeners) {
            if (ctx.state.outcome !== "ongoing" && event.type !== "defeated") break;
            if (!hears(listener, event)) continue;
            // A status removed earlier in this same event (unfrozen) no longer acts.
            if (listener.status && !listener.owner.statuses.includes(listener.status)) continue;
            if (!conditionsHold(ctx, listener, event)) continue;
            if (!ctx.rng.chance(listener.effect.chance ?? 1)) continue;

            ctx.log.push({ type: "proc", owner: listener.owner.id, effectId: listener.effect.id });
            runActions(ctx, listener.effect.actions, {
                owner: listener.owner,
                event,
                status: listener.status,
                effectId: listener.effect.id,
                outcome,
            });
        }
    } finally {
        ctx.depth -= 1;
    }
    return outcome;
}

function hears({ owner, effect }: Listener, event: BattleEvent): boolean {
    if (effect.trigger.event !== event.type) return false;
    const as = effect.trigger.as ?? "any";
    if (as === "actor") return event.actor === owner.id;
    if (as === "target") return event.target === owner.id;
    return true;
}

function resolveWho(ctx: Context, who: Who, owner: Combatant, event: BattleEvent): Combatant | undefined {
    switch (who) {
        case "self":
            return owner;
        case "actor":
            return byId(ctx, event.actor);
        case "target":
            return byId(ctx, event.target);
        case "other":
            return event.actor === owner.id ? byId(ctx, event.target) : byId(ctx, event.actor);
    }
}

function conditionsHold(ctx: Context, listener: Listener, event: BattleEvent): boolean {
    return (listener.effect.conditions ?? []).every((condition) =>
        conditionHolds(ctx, condition, listener.owner, event),
    );
}

function conditionHolds(ctx: Context, condition: Condition, owner: Combatant, event: BattleEvent): boolean {
    switch (condition.type) {
        case "hasStatus":
        case "lacksStatus": {
            const who = resolveWho(ctx, condition.who, owner, event);
            const has = who?.statuses.some((s) => s.statusId === condition.status) ?? false;
            return condition.type === "hasStatus" ? has : !has;
        }
        case "healthBelow": {
            const who = resolveWho(ctx, condition.who, owner, event);
            if (!who) return false;
            return who.health <= condition.fraction * statOf(who, CORE_STATS.maxHealth, ctx.content);
        }
        case "cardHasTag":
            return event.card?.tags?.includes(condition.tag) ?? false;
        case "foodHasTag":
            return event.food?.tags?.includes(condition.tag) ?? false;
        case "damageElement":
            return event.damage?.element === condition.element;
        case "damageFromStatus":
            return event.damage?.fromStatus !== undefined && (condition.status ?? event.damage.fromStatus) === event.damage.fromStatus;
        case "not":
            return !conditionHolds(ctx, condition.condition, owner, event);
        case "any":
            return condition.conditions.some((c) => conditionHolds(ctx, c, owner, event));
    }
}

// ---------------------------------------------------------------------------
// Actions

type ActionScope = {
    owner: Combatant;
    event: BattleEvent;
    status?: StatusInstance;
    effectId?: string;
    /** Where cancelAction / freeCharge report back to the emitter. */
    outcome?: EventOutcome;
    /** The eaten food's own actions, whose heals Mending doesn't boost. */
    fromFood?: boolean;
};

function runActions(ctx: Context, actions: Action[], scope: ActionScope): void {
    for (const action of actions) {
        if (ctx.state.outcome !== "ongoing") return;
        runAction(ctx, action, scope);
    }
}

function amountOf(ctx: Context, amount: Amount, scope: ActionScope): number {
    if (typeof amount === "number") return amount;
    const scaled = amount.stat
        ? statOf(scope.owner, amount.stat, ctx.content) * (amount.multiplier ?? 1)
        : 0;
    const stacks = amount.perStack ? (scope.status?.stacks ?? 1) : 1;
    return (scaled + (amount.flat ?? 0)) * stacks;
}

function runAction(ctx: Context, action: Action, scope: ActionScope): void {
    const { owner, event } = scope;
    switch (action.type) {
        case "attack": {
            const target = resolveWho(ctx, action.to, owner, event);
            if (target && isAlive(target)) attack(ctx, owner, target, action, scope);
            return;
        }
        case "damage": {
            const target = resolveWho(ctx, action.to, owner, event);
            if (!target || !isAlive(target)) return;
            dealDamage(ctx, owner, target, amountOf(ctx, action.amount, scope), {
                element: action.element ?? "physical",
                isAttack: false,
                crit: false,
                ignoreDefense: action.ignoreDefense ?? false,
                effectId: scope.effectId,
                fromStatus: scope.status?.statusId,
            });
            return;
        }
        case "heal": {
            const target = resolveWho(ctx, action.to, owner, event);
            if (!target || !isAlive(target)) return;
            const max = statOf(target, CORE_STATS.maxHealth, ctx.content);
            // Mending is the healed one's: it boosts heals they receive, but never food's.
            const boost = scope.fromFood ? 1 : 1 + statOf(target, MENDING_STAT, ctx.content);
            const healed = Math.min(max - target.health, Math.round(amountOf(ctx, action.amount, scope) * boost));
            if (healed <= 0) return;
            target.health += healed;
            ctx.log.push({ type: "heal", target: target.id, amount: healed });
            return;
        }
        case "guard": {
            const target = resolveWho(ctx, action.to, owner, event);
            if (!target || !isAlive(target)) return;
            const amount = Math.round(amountOf(ctx, action.amount, scope));
            target.guard += amount;
            ctx.log.push({ type: "guard", target: target.id, amount });
            return;
        }
        case "barrier": {
            const target = resolveWho(ctx, action.to, owner, event);
            if (!target || !isAlive(target)) return;
            target.barrier = Math.max(0, Math.round(amountOf(ctx, action.amount, scope)));
            ctx.log.push({ type: "barrier", target: target.id, amount: target.barrier });
            return;
        }
        case "applyStatus": {
            const target = resolveWho(ctx, action.to, owner, event);
            if (target && isAlive(target)) {
                applyStatus(ctx, target, action.status, action.stacks ?? 1, action.duration);
            }
            return;
        }
        case "removeStatus": {
            const target = resolveWho(ctx, action.from, owner, event);
            if (target) removeStatus(ctx, target, action.status);
            return;
        }
        case "cancelAction":
            if (scope.outcome) {
                scope.outcome.cancelled = true;
                scope.outcome.cancelledBy ??= scope.effectId;
            }
            return;
        case "freeCharge":
            if (scope.outcome) scope.outcome.freeCharge = true;
            return;
        case "modifyDamage":
            if (event.damage) {
                event.damage.amount = (event.damage.amount + (action.add ?? 0)) * (action.multiply ?? 1);
            }
            return;
    }
}

function attack(
    ctx: Context,
    attacker: Combatant,
    target: Combatant,
    action: Extract<Action, { type: "attack" }>,
    scope: ActionScope,
    isCounter = false,
): void {
    const hits = Math.max(1, Math.floor(action.hits ?? 1));
    for (let hit = 0; hit < hits; hit++) {
        // Defenders react first: a thorns talisman can kill the attacker
        // before the blow lands. A dead target ends the flurry early.
        emit(ctx, { type: "attacked", actor: attacker.id, target: target.id });
        if (ctx.state.outcome !== "ongoing" || !isAlive(attacker) || !isAlive(target)) return;

        let amount = amountOf(ctx, action.amount, scope);
        const crit = ctx.rng.chance(statOf(attacker, CORE_STATS.critChance, ctx.content));
        if (crit) amount *= statOf(attacker, CORE_STATS.critMultiplier, ctx.content) || 1.5;

        dealDamage(ctx, attacker, target, amount, {
            element: action.element ?? "physical",
            isAttack: true,
            crit,
            ignoreDefense: false,
            delivery: action.delivery ?? "melee",
            counter: isCounter || undefined,
        });

        if (ctx.state.outcome !== "ongoing") return;
        if (!isAlive(target)) break;
    }
    emit(ctx, { type: "attackFinished", actor: attacker.id, target: target.id });
    if (!isCounter) counter(ctx, target, attacker);
}

/** One roll per attack, not per hit, so multi-hit attacks don't invite more counters. */
function counter(ctx: Context, defender: Combatant, attacker: Combatant): void {
    if (ctx.state.outcome !== "ongoing" || !isAlive(defender) || !isAlive(attacker)) return;
    if (!ctx.rng.chance(statOf(defender, COUNTER_CHANCE_STAT, ctx.content))) return;
    const share = statOf(defender, COUNTER_DAMAGE_STAT, ctx.content) || DEFAULT_COUNTER_DAMAGE;
    const blow = {
        type: "attack",
        to: "other",
        amount: { stat: CORE_STATS.attack, multiplier: share },
        delivery: "melee",
    } as const;
    const event: BattleEvent = { type: "attackFinished", actor: attacker.id, target: defender.id };
    attack(ctx, defender, attacker, blow, { owner: defender, event }, true);
}

function dealDamage(
    ctx: Context,
    source: Combatant,
    target: Combatant,
    base: number,
    options: {
        element: string;
        isAttack: boolean;
        crit: boolean;
        ignoreDefense: boolean;
        delivery?: "melee" | "projectile";
        /** A counterattack (`COUNTER_CHANCE_STAT`). */
        counter?: boolean;
        effectId?: string;
        /** The status whose effect this is (a Burning tick), if any. */
        fromStatus?: string;
    },
): void {
    // The source's own damage bonus first, so beforeDamage rules see the
    // boosted hit. Never on status damage: that changes only through rules
    // that ask for it (`damageFromStatus`).
    if (source !== target && !options.fromStatus) base *= 1 + statOf(source, DAMAGE_DEALT_STAT, ctx.content);
    const before = {
        type: "beforeDamage" as const,
        actor: source.id,
        target: target.id,
        damage: { amount: base, element: options.element, fromStatus: options.fromStatus },
    };
    emit(ctx, before);
    if (!isAlive(target)) return;

    let amount = before.damage.amount;
    const raw = Math.max(0, Math.round(amount));
    if (!options.ignoreDefense) amount = defended(ctx.content, source, target, amount, options.isAttack);
    amount = Math.max(0, Math.round(amount));
    const stoppedByDefense = raw - amount;

    const blocked = Math.min(target.guard, amount);
    target.guard -= blocked;
    amount -= blocked;
    // Guard lapses anyway, so it goes first and the lasting barrier is spared.
    // Runs saved before barriers existed have none.
    const absorbed = Math.min(target.barrier ?? 0, amount);
    target.barrier = (target.barrier ?? 0) - absorbed;
    amount -= absorbed;

    target.health = Math.max(0, target.health - amount);
    ctx.log.push({
        type: "damage",
        source: source.id,
        target: target.id,
        amount,
        blocked,
        absorbed,
        defended: stoppedByDefense > 0 ? stoppedByDefense : undefined,
        element: options.element,
        crit: options.crit,
        isAttack: options.isAttack,
        delivery: options.delivery,
        counter: options.counter,
        effectId: options.effectId,
    });

    if (amount > 0) {
        emit(ctx, {
            type: "damageTaken",
            actor: source.id,
            target: target.id,
            damage: { amount, element: options.element, fromStatus: options.fromStatus },
        });
    }

    if (target.health <= 0) defeat(ctx, target, source);
}

/**
 * A hit after the target's defense. Armor pen only on attacks, and never takes
 * defense below 0; defense never stops a whole hit (`MIN_DAMAGE_SHARE`).
 */
function defended(content: EngineContent, source: Combatant, target: Combatant, amount: number, isAttack: boolean): number {
    const pen = isAttack ? Math.max(0, statOf(source, ARMOR_PEN_STAT, content)) : 0;
    const defense = Math.max(0, statOf(target, CORE_STATS.defense, content) - pen);
    return Math.max(amount - defense, amount * MIN_DAMAGE_SHARE);
}

function defeat(ctx: Context, target: Combatant, killer: Combatant): void {
    target.statuses = [];
    target.guard = 0;
    target.barrier = 0;
    ctx.log.push({ type: "defeated", target: target.id });
    emit(ctx, { type: "defeated", actor: killer.id, target: target.id });

    checkOutcome(ctx);
}

/** One side has no one left standing: the fight is over. */
function checkOutcome(ctx: Context): void {
    const { state } = ctx;
    const playersAlive = state.combatants.some((c) => c.side === "player" && isAlive(c));
    const enemiesAlive = state.combatants.some((c) => c.side === "enemy" && isAlive(c));
    if (state.outcome === "ongoing" && (!playersAlive || !enemiesAlive)) {
        state.outcome = playersAlive ? "victory" : "defeat";
        ctx.log.push({ type: "battleEnd", outcome: state.outcome });
    }
}

// ---------------------------------------------------------------------------
// Statuses

function applyStatus(
    ctx: Context,
    target: Combatant,
    statusId: string,
    stacks: number,
    duration: number | undefined,
): void {
    const def = ctx.content.statuses[statusId];
    if (!def) return;
    const turns = duration ?? def.duration ?? null;

    const existing = target.statuses.find((s) => s.statusId === statusId);
    if (existing) {
        existing.stacks = Math.min(def.maxStacks, existing.stacks + stacks);
        if (turns !== null && existing.turnsLeft !== null) {
            existing.turnsLeft = Math.max(existing.turnsLeft, turns);
        }
    } else {
        target.statuses.push({ statusId, stacks: Math.min(def.maxStacks, stacks), turnsLeft: turns });
    }

    const applied = target.statuses.find((s) => s.statusId === statusId);
    ctx.log.push({
        type: "statusApplied",
        target: target.id,
        statusId,
        stacks: applied?.stacks ?? stacks,
    });
}

function removeStatus(ctx: Context, target: Combatant, statusId: string): void {
    const before = target.statuses.length;
    target.statuses = target.statuses.filter((s) => s.statusId !== statusId);
    if (target.statuses.length !== before) {
        ctx.log.push({ type: "statusRemoved", target: target.id, statusId });
    }
}

/**
 * Types for the geo-game combat engine.
 *
 * Every rule is data: an item, card, status or enemy carries `EffectDef`s, and
 * the engine resolves them through one event pipeline (`effects.ts`). Adding a
 * talisman that zaps attackers, a status that skips turns, or a card that is
 * free against burning targets is a content change, not an engine change.
 *
 * Everything in a `BattleState` is plain JSON, so a Run can be stored in a
 * `jsonb` column between turns and replayed from its seed.
 */

// ---------------------------------------------------------------------------
// Stats

/**
 * Stat ids. Open-ended on purpose: a new stat is a new string used by content
 * (a modifier, a condition or an action amount), with no engine change.
 */
export type StatId = string;

/** Stats every combatant has. Anything else defaults to 0 when read. */
export const CORE_STATS = {
    maxHealth: "maxHealth",
    attack: "attack",
    defense: "defense",
    speed: "speed",
    /** 0–1. */
    critChance: "critChance",
    /** Damage multiplier on a crit, e.g. 1.5. */
    critMultiplier: "critMultiplier",
} as const;

/**
 * Extra damage this combatant deals, as a fraction: a flat +0.25 = 25% more.
 * Every element and kind (blows, spells, procs), but never damage from a
 * status (a Burning tick) or to oneself: status damage changes only through
 * rules that say so (`damageFromStatus`).
 * Combat level gives the player some (`combat/combatants.ts`).
 */
export const DAMAGE_DEALT_STAT: StatId = "damageDealt";

/**
 * Flat defense an attack ignores: 2 against defense 4 meets 2. Per hit, never
 * below 0 defense, attacks only (counters too). Damage that already ignores
 * defense (status ticks, `ignoreDefense` procs) is unaffected.
 */
export const ARMOR_PEN_STAT: StatId = "armorPen";

/**
 * The share of a hit that defense can never stop: 0.25 = at least a quarter
 * of it lands, however high the defense. Per hit, before guard and barrier
 * (which still soak it). Damage that ignores defense is unaffected.
 */
export const MIN_DAMAGE_SHARE = 0.25;

/**
 * More crops from every harvest: a flat +100 = 100% more (×2), so 1000 is
 * ×11. The fraction left over is a chance of one more. Not seeds.
 * See `farming/farm.ts` `withFortune`.
 */
export const FARMING_FORTUNE_STAT: StatId = "farmingFortune";

/**
 * How likely pests are to arrive on a farm, as a multiplier on 1: a percent
 * -0.25 = 25% less likely. Swarms that force pests ignore it.
 */
export const PEST_CHANCE_STAT: StatId = "pestChance";

/** How likely mutations are to sprout, as a multiplier on 1: a percent +0.25 = 25% more likely. */
export const MUTATION_CHANCE_STAT: StatId = "mutationChance";

/**
 * Magic power. Nothing reads it by itself: a card or effect scales off it with
 * `amount: { stat: "intelligence", multiplier: … }`.
 */
export const INTELLIGENCE_STAT: StatId = "intelligence";

/**
 * How much more the bearer is healed, as a fraction: a flat +0.1 = heals on
 * them are 10% bigger. Every heal but food's.
 */
export const MENDING_STAT: StatId = "mending";

/**
 * 0–1: the chance to strike back after being attacked. Rolled once per
 * attack however many hits it had, and only while both sides still stand.
 * The counter is a blow for `COUNTER_DAMAGE_STAT` × the counterer's attack:
 * it can crit and meets defense like any attack, but is never countered.
 */
export const COUNTER_CHANCE_STAT: StatId = "counterChance";

/**
 * A counter's damage as a share of attack: 0.5 = half. The player's base is
 * in `config/player.ts` and gear adds to it; an enemy without one uses
 * `DEFAULT_COUNTER_DAMAGE`.
 */
export const COUNTER_DAMAGE_STAT: StatId = "counterDamage";
export const DEFAULT_COUNTER_DAMAGE = 0.5;

/**
 * Better loot: every chance on an enemy's loot list and chest offers is
 * scaled by (1 + magic find / 100), so +1 = 1% more likely, but only rare
 * ones: drops under 5% (`MAGIC_FIND_RARE_UNDER`), and never past that line.
 */
export const MAGIC_FIND_STAT: StatId = "magicFind";

export type Stats = Record<StatId, number>;

/**
 * A change to one stat from gear, a talisman or a status. Flat modifiers add
 * first, then percent modifiers scale the total: (base + flat) × (1 + Σ%).
 */
export type StatModifier = {
    stat: StatId;
    kind: "flat" | "percent";
    /** Flat: an amount. Percent: a fraction, 0.1 = +10%. */
    value: number;
};

// ---------------------------------------------------------------------------
// Events and effects

/**
 * Points in a turn that effects can react to. `actor` is whoever caused the
 * event, `target` whoever it happened to.
 *
 * - `battleStart`: once, before the first turn.
 * - `turnStart`: actor = whoever's turn it is.
 * - `beforeAction`: actor = whoever is about to act. `cancelAction` here skips
 *   the turn (Frozen).
 * - `cardPlayed`: actor played `card` at target. Only the card's own effects
 *   and the actor's gear hear it.
 * - `foodEaten`: actor ate `food` from their lunchbox (actor = target). The
 *   food's own effects hear it too.
 * - `attacked`: an attack is about to land; actor = attacker, target = defender.
 * - `beforeDamage`: damage is being worked out; `modifyDamage` here changes it.
 * - `damageTaken`: actor dealt `amount` to target.
 * - `attackFinished`: actor's attack has fully resolved (Burning ticks here).
 * - `turnEnd`: actor's turn is over; status durations tick down.
 * - `defeated`: target has hit 0 health; actor landed the blow ("on kill").
 */
export type EventType =
    | "battleStart"
    | "turnStart"
    | "beforeAction"
    | "cardPlayed"
    | "foodEaten"
    | "attacked"
    | "beforeDamage"
    | "damageTaken"
    | "attackFinished"
    | "turnEnd"
    | "defeated";

/** The owner's part in an event, for a trigger to match on. */
export type EventRole = "actor" | "target" | "any";

/**
 * Who an action or condition refers to, from the effect owner's point of view.
 *
 * - `self`: the effect's owner.
 * - `other`: the owner's counterpart in the event — the target if the owner is
 *   the actor, the actor if the owner is the target.
 * - `actor` / `target`: the event's actor or target, whoever that is.
 */
export type Who = "self" | "other" | "actor" | "target";

export type Trigger = {
    event: EventType;
    /** Defaults to "any". */
    as?: EventRole;
};

export type Condition =
    | { type: "hasStatus"; who: Who; status: string }
    | { type: "lacksStatus"; who: Who; status: string }
    /** Current health ≤ fraction × max health. */
    | { type: "healthBelow"; who: Who; fraction: number }
    /** The card in this event carries a tag, e.g. "fire". */
    | { type: "cardHasTag"; tag: string }
    /** The food in this event carries a tag, e.g. "spicy". */
    | { type: "foodHasTag"; tag: string }
    /** The damage in this event is of an element. */
    | { type: "damageElement"; element: string }
    /**
     * The damage in this event comes from a status's own effect (a Burning
     * tick); `status` narrows it to one. For rules that change status damage,
     * like an oil that makes burns hurt more.
     */
    | { type: "damageFromStatus"; status?: string }
    | { type: "not"; condition: Condition }
    /** At least one holds. (A plain list already means "all".) */
    | { type: "any"; conditions: Condition[] };

/**
 * How big a damage, heal, guard or barrier amount is. A bare number is flat. The object
 * form is (owner's `stat` × `multiplier`) + `flat`, then × stacks when
 * `perStack` — e.g. `{ stat: "attack", multiplier: 1.2 }` for a heavy blow,
 * `{ flat: 3, perStack: true }` for a burn.
 */
export type Amount =
    | number
    | {
          stat?: StatId;
          /** Defaults to 1. Ignored without a stat. */
          multiplier?: number;
          flat?: number;
          /** Multiply by the source status's stacks (Burning). */
          perStack?: boolean;
      };

export type Action =
    /**
     * A weapon blow: fires `attacked` and `attackFinished`, can crit, is
     * reduced by defense. `delivery` is for the app's animation only.
     * `hits` (default 1) repeats the blow: each hit fires `attacked`, rolls
     * its own crit and meets defense alone; `attackFinished` fires once after
     * the last. `amount` is per hit.
     */
    | {
          type: "attack";
          to: Who;
          amount: Amount;
          hits?: number;
          element?: string;
          delivery?: "melee" | "projectile";
      }
    /**
     * Damage that isn't an attack (lightning from a talisman, a burn): no
     * `attacked` event, so procs can't loop off each other, no crit.
     */
    | { type: "damage"; to: Who; amount: Amount; element?: string; ignoreDefense?: boolean }
    | { type: "heal"; to: Who; amount: Amount }
    /** Absorbs the next hits until used up. */
    | { type: "guard"; to: Who; amount: Amount }
    /**
     * Sets the target's barrier to `amount`, replacing any left (a recast
     * resets it, never stacks). Lasts the fight, until broken; spent after guard.
     */
    | { type: "barrier"; to: Who; amount: Amount }
    | {
          type: "applyStatus";
          to: Who;
          status: string;
          stacks?: number;
          /** Overrides the status's own duration, in the bearer's turns. */
          duration?: number;
      }
    | { type: "removeStatus"; from: Who; status: string }
    /** In `beforeAction`: the actor's turn is skipped. */
    | { type: "cancelAction" }
    /** In `cardPlayed`: the card costs no charge this time. */
    | { type: "freeCharge" }
    /** In `beforeDamage`: (amount + add) × multiply. */
    | { type: "modifyDamage"; add?: number; multiply?: number };

export type EffectDef = {
    /** For logs and debugging, e.g. "storm-charm.lightning". */
    id: string;
    trigger: Trigger;
    /** All must hold. */
    conditions?: Condition[];
    /** 0–1, rolled after conditions pass. Defaults to 1. */
    chance?: number;
    actions: Action[];
};

// ---------------------------------------------------------------------------
// Content definitions

export type StatusDef = {
    id: string;
    name: string;
    /** Default duration in the bearer's turns; omitted = until removed. */
    duration?: number;
    /** Reapplying adds stacks up to this; 1 = refreshes instead. */
    maxStacks: number;
    modifiers?: StatModifier[];
    effects?: EffectDef[];
};

export type CardDef = {
    id: string;
    name: string;
    skill: string;
    /** e.g. "fire", for conditions like "free if the target is Burning". */
    tags?: string[];
    /** Who the card is aimed at. */
    targets: "enemy" | "self";
    /** What playing it does, in order. */
    actions: Action[];
    /** Card-only rules, heard only when this card is played. */
    effects?: EffectDef[];
    /**
     * Weapon tags, any one of which the player's weapon must carry to play
     * this, e.g. ["dagger"] or ["melee"]. Omitted = playable with anything.
     */
    requiresWeapon?: string[];
    /** Off-hand types, any one of which the player's off-hand must be, e.g. ["shield"]. */
    requiresOffHand?: string[];
    /**
     * All must hold for it to be played, judged as if playing it now: `self`
     * is the player, `other` its target. e.g. a self-buff with
     * `lacksStatus self <its status>` can't be recast while it lasts.
     */
    playableIf?: Condition[];
};

/**
 * Food eaten from the lunchbox. Its id is the item's id: food is a consumable
 * item with these rules (`data/food/`). Eating takes the turn.
 */
export type FoodDef = {
    id: string;
    name: string;
    /** e.g. "spicy", for conditions like "spicy food heals more". */
    tags?: string[];
    /** What eating it does to the eater (`self`), in order. */
    actions: Action[];
    /** Food-only rules, heard only when this food is eaten. */
    effects?: EffectDef[];
};

/** What an enemy might do on its turn. Picked by weight. */
export type EnemyMove = {
    id: string;
    name: string;
    weight: number;
    actions: Action[];
};

// ---------------------------------------------------------------------------
// Battle state (plain JSON)

export type StatusInstance = {
    statusId: string;
    stacks: number;
    /** Bearer turns left; null = until removed. */
    turnsLeft: number | null;
};

export type CardInstance = {
    /** The player's inventory row this copy came from. */
    instanceId: string;
    cardId: string;
    chargesLeft: number;
};

/** One lunchbox slot: a stack of one food. */
export type LunchboxSlot = {
    /** 0-based slot index, as stored. */
    slot: number;
    foodId: string;
    quantity: number;
};

export type Combatant = {
    id: string;
    side: "player" | "enemy";
    name: string;
    baseStats: Stats;
    /** From gear and talismans; fixed for the battle. */
    modifiers: StatModifier[];
    /** From gear, talismans and enemy traits; fixed for the battle. */
    effects: EffectDef[];
    health: number;
    guard: number;
    /** Soaks damage after guard, until broken. Never carries past the fight. */
    barrier: number;
    statuses: StatusInstance[];
    /** Enemies only. */
    moves?: EnemyMove[];
    /**
     * Enemies only: the id of the move it makes on its next turn, chosen in
     * advance so the app can show it. Kept through a skipped turn. Battles
     * saved before intents choose on the spot.
     */
    intent?: string;
    /**
     * Enemies only: the player its next move is aimed at, rolled with the
     * move (rolled again if they're down or gone when it comes).
     */
    intentTarget?: string;
    /** Players in a shared fight: fled it. Out of the turn order, never a target. */
    left?: boolean;
    /** Players only. */
    hand?: CardInstance[];
    /** Players only: food packed for this Run. */
    lunchbox?: LunchboxSlot[];
    /** Players only: the wielded weapon's tags, e.g. ["dagger", "melee"]. */
    weaponTags?: string[];
    /** Players only: the off-hand's type, e.g. ["shield"]; empty with nothing (or untyped gear) there. */
    offHandTags?: string[];
};

export type BattleState = {
    seed: number;
    /** How many numbers the RNG has drawn, so a resumed battle continues it. */
    rngDraws: number;
    round: number;
    /** Combatant ids in acting order for this round. */
    order: string[];
    /** Index into `order` of whoever acts next. */
    turnIndex: number;
    combatants: Combatant[];
    outcome: "ongoing" | "victory" | "defeat";
};

// ---------------------------------------------------------------------------
// The turn log: what the app animates, in order. Defined in the shared
// contract so the app and server agree on it.

export type { GeoLogEntry as LogEntry } from "@geo/shared";

import type { GeoChestOffer } from "./chest.contract";

/**
 * A shared fight (a dungeon's boss, with the whole party in it): each player
 * has this long to act on their turn, or it's skipped. A player with no geo
 * socket gets the reconnect window (GEO_DUNGEON_RECONNECT_SECONDS) from when
 * they dropped, if that ends sooner; after it, their turns skip at once.
 * Solo fights have no clock.
 */
export const GEO_RUN_TURN_SECONDS = 30;

/**
 * The battle log: what happened in a turn, in order, for the app to animate.
 * Defined here (not in the engine) so the app and server agree on it.
 */
export type GeoLogEntry =
    | { type: "roundStart"; round: number; order: string[] }
    | { type: "turnStart"; actor: string }
    | { type: "turnSkipped"; actor: string; reason: string }
    | { type: "cardPlayed"; actor: string; cardId: string; target: string; chargeSpent: boolean }
    | { type: "enemyMove"; actor: string; moveId: string; target: string }
    /** The player ate one food from a lunchbox slot; its heals and statuses follow. */
    | { type: "foodEaten"; actor: string; foodId: string; slot: number }
    | {
          type: "damage";
          source: string;
          target: string;
          /** Health lost, after guard and barrier. */
          amount: number;
          /** Soaked by guard. */
          blocked: number;
          /** Soaked by barrier. */
          absorbed: number;
          /** Stopped by the target's defense, before guard and barrier. Absent when none was. */
          defended?: number;
          element: string;
          crit: boolean;
          isAttack: boolean;
          delivery?: "melee" | "projectile";
          /** A counterattack: the target struck back after being attacked. */
          counter?: boolean;
          /** The effect that caused it, when not the main action. */
          effectId?: string;
      }
    | { type: "heal"; target: string; amount: number }
    | { type: "guard"; target: string; amount: number }
    /** The target's barrier is now `amount`: set, not added to. */
    | { type: "barrier"; target: string; amount: number }
    | { type: "statusApplied"; target: string; statusId: string; stacks: number }
    | { type: "statusRemoved"; target: string; statusId: string }
    | { type: "proc"; owner: string; effectId: string }
    | { type: "defeated"; target: string }
    /** A player fled a shared fight: out of it, and nobody's target any more. */
    | { type: "left"; actor: string }
    | { type: "battleEnd"; outcome: "victory" | "defeat" };

export type GeoRunStatus = "active" | "victory" | "defeat" | "fled";

export type GeoCombatantView = {
    id: string;
    side: "player" | "enemy";
    name: string;
    /** Enemies: the app's sprite name. */
    sprite?: string;
    health: number;
    maxHealth: number;
    guard: number;
    /** Soaks damage after guard; the app draws it over the health bar. */
    barrier: number;
    statuses: { statusId: string; stacks: number; turnsLeft: number | null }[];
    /** Defense now, statuses included: taken off each hit they receive. */
    defense: number;
    /** Enemies: what they'll do on their next turn. Absent once the fight is over. */
    intent?: GeoEnemyIntent;
    /** Players in a shared fight: fled it. Still shown, never targeted. */
    left: boolean;
};

/**
 * One part of an enemy's next move. An attack's `damage` is per hit, after
 * the player's defense as it stands now, before crits, guard and barrier.
 * `self`: it lands on the enemy, not the player.
 */
export type GeoIntentPart =
    | { kind: "attack"; damage: number; hits: number }
    | { kind: "guard" | "barrier" | "heal"; amount: number; self: boolean }
    | { kind: "status"; statusId: string; self: boolean };

/**
 * An enemy's next move, chosen in advance: it always does this, unless its
 * turn is skipped. `targetId`: who it's aimed at, rolled when the move is
 * chosen (a new roll if they're down or gone by then); null for none.
 */
export type GeoEnemyIntent = { moveId: string; name: string; parts: GeoIntentPart[]; targetId: string | null };

export type GeoHandCard = {
    /** The inventory entry, sent back to play it. */
    inventoryId: string;
    itemId: string;
    cardId: string;
    chargesLeft: number;
    /**
     * Combat: whether it could be played now, turn aside: it has charges, the
     * weapon fits, and its own rule allows it (a self-buff already active
     * can't be recast until it's removed). Grey it out when false. Absent
     * (fishing, farming): playable while it has charges.
     */
    playable?: boolean;
    /**
     * Combat: what playing it now would do to its target, worked out like an
     * enemy's intent (an attack's damage is per hit, after the target's
     * defense). Absent outside combat or once the fight is over.
     */
    preview?: GeoIntentPart[];
};

/** One lunchbox slot: a stack of one food. */
export type GeoLunchboxSlot = {
    /** 0-based, below the player's lunchbox size. */
    slot: number;
    itemId: string;
    quantity: number;
};

export type GeoRewards = {
    /** Empty when the win gave chests instead. */
    items: { itemId: string; quantity: number }[];
    coins: number;
    xp: { skill: string; amount: number }[];
    /**
     * Chests to open one of, in place of `items`; null for a plain win. Opened
     * through `POST /geo/chests/:selectionId/open`, and listed as pending
     * until then.
     */
    chests: { selectionId: string; chests: GeoChestOffer[] } | null;
};

/** What killed the player, when it wasn't a lost fight. */
export type GeoDeathCause = "admin-kill";

/**
 * `POST /geo/dev/kill`, dev servers only: the player dies on the spot. Every
 * coin carried is lost, and a Run in progress ends as a defeat.
 */
export type GeoDeathResponse = {
    cause: GeoDeathCause;
    coinsLost: number;
};

export type GeoRunView = {
    id: string;
    kind: "combat";
    /** Yours: in a shared fight you can be out while the others fight on. */
    status: GeoRunStatus;
    /** Your combatant's id. In a shared fight the others on your side are your party. */
    you: string;
    /**
     * Goes up with every turn. Shared fights also arrive over the geo socket
     * (`run`): drop one older than what you hold.
     */
    version: number;
    /** Shared fights: when the current player's turn is skipped (ISO); null otherwise. */
    turnDeadline: string | null;
    /** The server's clock (ISO), for the turn countdown on a phone set wrong. */
    serverTime: string;
    round: number;
    /** Acting order this round, combatant ids. */
    order: string[];
    /** Whose turn it is; null once the Run is over. */
    currentActor: string | null;
    combatants: GeoCombatantView[];
    hand: GeoHandCard[];
    /** Food packed for this Run, what's left of it. Empty slots aren't listed. */
    lunchbox: GeoLunchboxSlot[];
    /** Set once the Run is won. */
    rewards: GeoRewards | null;
    /** Set once the Run is lost: defeat costs every coin you carry (never in a dungeon: 0 there). */
    coinsLost: number | null;
    /** True once an enemy that leaves after winning has won: no fighting it again. */
    enemyLeft: boolean;
    /** The dungeon run this is a room fight of: back to its map once it's over. Null outside dungeons. */
    dungeonRunId: string | null;
};

/**
 * `POST /geo/runs`: fight a spawn from `GET /geo/world`, standing within
 * reach of it. `enemyId` instead fights that enemy anywhere — dev builds of
 * the server only, for testing.
 */
export type GeoStartRunRequest = {
    kind: "combat";
    spawnId?: string;
    /** Where the player is now. Required with `spawnId`. */
    position?: { latitude: number; longitude: number };
    enemyId?: string;
};

/**
 * `POST /geo/runs/:runId/turns`: play a card from the hand, or eat one food
 * from a lunchbox slot. Either takes the turn.
 */
export type GeoPlayTurnRequest =
    | {
          inventoryId: string;
          targetId?: string;
      }
    | {
          lunchboxSlot: number;
      };

/** Every Run endpoint replies with the Run and what just happened in it. */
export type GeoRunResponse = {
    run: GeoRunView;
    log: GeoLogEntry[];
};

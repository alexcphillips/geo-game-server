import { randomUUID } from "node:crypto";
import {
    GEO_DUNGEON_RECONNECT_SECONDS,
    GEO_RUN_TURN_SECONDS,
    type GeoDeathCause,
    type GeoDeathResponse,
    type GeoRewards,
    type GeoRunResponse,
    type GeoRunStatus,
} from "@geo/shared";
import { query } from "../../db";
import { AppError } from "../../http/AppError";
import {
    enemyCombatant,
    PLAYER_COMBATANT_ID,
    playerCombatant,
    rollChests,
    rollCoins,
    rollLoot,
    type Drop,
    type RolledChest,
} from "../../combat/combatants";
import { CONTENT } from "../../content";
import { afterCommit, withTransaction, type TxQuery } from "../../db/transaction";
import {
    BattleRuleError,
    canWield,
    createBattle,
    currentActor,
    eatBetweenFights,
    eatFood,
    leaveBattle,
    playCard,
    skipTurn,
    type BattleResult,
    type CombatantSetup,
} from "../../engine/battle";
import {
    CORE_STATS,
    MAGIC_FIND_STAT,
    type BattleState,
    type CardInstance,
    type LogEntry,
    type LunchboxSlot,
    type StatModifier,
} from "../../engine/engine.types";
import { statOf } from "../../engine/stats";
import { createRng, randomSeed } from "../../engine/rng";
import { wakeAt } from "../../lib/wake";
import * as socketHub from "../../realtime/geo-socket-hub";
import * as chestsRepository from "../chests/geo-chests.repository";
import * as dungeonFights from "../dungeon-runs/geo-dungeon-runs.fights";
import * as fishingRepository from "../fishing/geo-fishing.repository";
import * as playerRepository from "../player/geo-player.repository";
import * as questsRepository from "../quests/geo-quests.repository";
import * as wardrobeRepository from "../wardrobe/geo-wardrobe.repository";
import * as worldRepository from "../world/geo-world.repository";
import { applyModifiers, globalModifiers, playerMaxHealth } from "../../world/global-effects";
import { activePetModifiers } from "../../pets/pets";
import { defeatHealth } from "../player/geo-camp.rules";
import {
    ABANDON_STALE_RUNS,
    FIND_ACTIVE_RUN,
    FIND_ACTIVE_RUN_FOR_UPDATE,
    FIND_BATTLE_PLAYERS,
    FIND_BATTLE_ROWS_FOR_UPDATE,
    FIND_DUE_BATTLES,
    FIND_PLAYER_BATTLE,
    FIND_RECENT_SHARED_RUN,
    FIND_RUN,
    FIND_RUN_FOR_UPDATE,
    INSERT_BATTLE_RUN,
    INSERT_RUN,
    SET_TURN_CLOCK,
    UPDATE_RUN,
} from "./geo-runs.sql";
import type { RunRow } from "./geo-runs.types";
import { toRunView } from "./geo-runs.view";

/** Loot gets its own RNG stream, so changing a loot table never changes a fight. */
const LOOT_SEED_SALT = 0x9e3779b9;

/** PLACEHOLDER: minutes of no turns before an active Run counts as fled. */
export const ABANDON_AFTER_MINUTES = 30;

export async function findActiveRun(playerId: string): Promise<GeoRunResponse | null> {
    await query(ABANDON_STALE_RUNS, [playerId, ABANDON_AFTER_MINUTES]);
    const [row] = await query<RunRow>(FIND_ACTIVE_RUN, [playerId]);
    // A fishing Run resumes from its own screen, not the fight's.
    return row && (row.kind as string) !== "fishing" ? { run: toRunView(row), log: [] } : null;
}

/** How long after a shared fight ends a (re)connecting player is still sent it, to see how it went. */
const SHARED_RESULT_MINUTES = 10;

/**
 * The player's shared fight, for the geo socket's snapshot on (re)connect:
 * still going, or ended moments ago (so a screen left open on it sees the
 * end). Null if neither.
 */
export async function findRecentSharedRun(playerId: string): Promise<GeoRunResponse | null> {
    const [row] = await query<RunRow>(FIND_RECENT_SHARED_RUN, [playerId, SHARED_RESULT_MINUTES]);
    return row ? { run: toRunView(row), log: [] } : null;
}

/**
 * Refuses while a Run is using the player's `skill` hand: the fight plays from
 * its own copy of that hand, so a card taken out of it now could be sold or
 * listed and still played. The caller must hold the player lock first.
 */
export async function assertHandNotInRun(tx: TxQuery, playerId: string, skill: string) {
    if ((await findLiveRun(tx, playerId))?.kind === skill) {
        throw AppError.badRequest("You can't change that hand mid-Run");
    }
}

/**
 * Refuses while the player is in any Run, with `message`. For things not to be
 * done mid-fight at all, like listing on the Market. The caller must hold the
 * player lock first, so a Run can't start alongside.
 */
export async function assertNotInRun(tx: TxQuery, playerId: string, message: string) {
    if (await findLiveRun(tx, playerId)) throw AppError.badRequest(message);
}

/** The Run in progress, once any left too long have been ended. */
async function findLiveRun(tx: TxQuery, playerId: string): Promise<RunRow | undefined> {
    await tx(ABANDON_STALE_RUNS, [playerId, ABANDON_AFTER_MINUTES]);
    const [active] = await tx<RunRow>(FIND_ACTIVE_RUN, [playerId]);
    return active;
}

/** The player's gear, talismans, active pet, combat hand and lunchbox, as the engine needs them. */
async function loadLoadout(tx: TxQuery, playerId: string) {
    // One after another: a transaction is one connection, and pg can't run
    // two queries on a connection at once.
    const equipment = await playerRepository.findEquipment(playerId, tx);
    const inventory = await playerRepository.findInventory(playerId, tx);
    const bag = await playerRepository.findTalismanBag(playerId, tx);
    const handIds = await playerRepository.findHand(playerId, "combat", tx);
    const packed = await playerRepository.findLunchbox(playerId, tx);
    const pet = await playerRepository.findActivePet(playerId, tx);

    const byId = new Map(inventory.map((row) => [row.id, row]));
    const worn = equipment.flatMap((slot) => byId.get(slot.inventory_id) ?? []);
    const equipped = worn.map((row) => row.item_id);
    const reforges = worn.flatMap((row) => (row.reforge ? [{ itemId: row.item_id, reforgeId: row.reforge }] : []));
    // Only the bag counts, and the bag holds one copy of each talisman.
    const talismans = bag.map((entry) => entry.item_id);

    const hand: CardInstance[] = [];
    for (const id of handIds) {
        const row = byId.get(id);
        const item = row ? CONTENT.items[row.item_id] : undefined;
        if (!row || item?.kind !== "card" || (row.charges_left ?? 0) <= 0) continue;
        hand.push({ instanceId: row.id, cardId: item.cardId, chargesLeft: row.charges_left ?? 0 });
    }

    // Food removed from the content since it was packed can't be eaten.
    const lunchbox: LunchboxSlot[] = packed.contents
        .filter((entry) => CONTENT.foods[entry.itemId])
        .map((entry) => ({ slot: entry.slot, foodId: entry.itemId, quantity: entry.quantity }));

    return { equipment: equipped, reforges, talismans, hand, lunchbox, petModifiers: activePetModifiers(pet ?? undefined) };
}

/**
 * Eats one lunchbox food between fights, through the battle engine, and
 * saves the health it leaves (statuses don't outlast it). Between rooms of a
 * dungeon it's the dungeon's health that changes. The caller holds the
 * player lock and has checked there's no Run in progress.
 */
export async function eatBetweenFightsFor(tx: TxQuery, playerId: string, slot: number): Promise<void> {
    const player = await playerRepository.findPlayer(playerId, tx);
    if (!player) throw AppError.notFound("Player not found");
    const loadout = await loadLoadout(tx, playerId);
    const packed = loadout.lunchbox.find((entry) => entry.slot === slot);
    if (!packed) throw AppError.badRequest("That lunchbox slot is empty");

    const combatLevel = (await playerRepository.findSkillLevels(tx, playerId)).combat ?? 1;
    const you = playerCombatant({ name: player.displayName, ...loadout, combatLevel, globalModifiers: await globalModifiers(tx) }, CONTENT);
    const dungeonRun = await dungeonFights.findActiveForUpdate(tx, playerId);
    const inDungeon = dungeonRun && dungeonFights.memberOf(dungeonRun, playerId);
    const health = inDungeon
        ? { current: inDungeon.state.health, max: inDungeon.state.maxHealth }
        : await playerRepository.findHealth(playerId, tx);
    you.health = health.current;

    let result: { health: number };
    try {
        result = eatBetweenFights(you, CONTENT, { slot }, randomSeed());
    } catch (error) {
        if (error instanceof BattleRuleError) throw AppError.badRequest(error.message);
        throw error;
    }
    await playerRepository.eatFromLunchbox(tx, playerId, { slot, itemId: packed.foodId, from: packed.quantity, to: packed.quantity - 1 });
    if (dungeonRun && inDungeon) {
        inDungeon.state = { ...inDungeon.state, health: Math.min(result.health, inDungeon.state.maxHealth) };
        await dungeonFights.saveRun(tx, dungeonRun);
    } else await playerRepository.setHealth(tx, playerId, result.health, health.max);
}

/**
 * What a fight is against: a real spawn, a dungeon boss, or (dev only) an
 * enemy by id. `enemyModifiers` make it stronger, e.g. a dungeon's boss.
 * `keepsHealth` fights at full health and leaves the player's own health as
 * it was, whatever happens (a dungeon); otherwise the fight starts from the
 * player's health and saves it every turn. `dungeonId` marks a dungeon's boss
 * fight, so a win counts toward quests. `dungeonRunId` and `dungeonRoom` mark
 * a room fight on a dungeon map, which starts at `startHealth` (the
 * dungeon's carried health) and reports back to the map when it ends.
 */
export type RunTarget = {
    enemyId: string;
    spawnId: string | null;
    enemyModifiers?: StatModifier[];
    keepsHealth?: boolean;
    dungeonId?: string;
    dungeonRunId?: string;
    dungeonRoom?: number;
    startHealth?: number;
};

export async function startCombatRun(playerId: string, target: RunTarget): Promise<GeoRunResponse> {
    if (!CONTENT.enemies[target.enemyId]) throw AppError.badRequest("Unknown enemy");

    return withTransaction(async (tx) => {
        // Before reading the hand: a hand change can't land while this starts.
        await playerRepository.lockPlayer(tx, playerId);
        // Checked again inside the transaction: it may have gone or been won since.
        if (target.spawnId && !(await worldRepository.findLiveSpawn(tx, playerId, target.spawnId))) {
            throw AppError.badRequest("That enemy has moved on");
        }
        await dungeonFights.assertNotInDungeon(tx, playerId);
        return openCombatRun(tx, playerId, target);
    });
}

/** The player's side of this row's fight: the solo "player", or theirs in a shared one. */
const combatantOf = (row: RunRow) => row.combatant_id ?? PLAYER_COMBATANT_ID;

/**
 * Gets one player ready to fight: leaves a fishing spot, puts on the combat
 * loadout (auto-swap), and builds their combatant from gear, hand and
 * lunchbox. Refuses (AppError) a player already in a Run, with an empty
 * hand, or with no card their gear can use. The caller holds the player lock.
 */
async function preparePlayer(tx: TxQuery, playerId: string, target: RunTarget, combatantId: string, startHealth?: number): Promise<CombatantSetup> {
    await tx(ABANDON_STALE_RUNS, [playerId, ABANDON_AFTER_MINUTES]);
    const [active] = await tx<RunRow>(FIND_ACTIVE_RUN, [playerId]);
    // Walking off from a fishing spot to fight leaves the spot.
    if (active && (active.kind as string) === "fishing") await fishingRepository.endOpenFishing(tx, active);
    else if (active) throw AppError.badRequest("You're already in a Run. Finish or flee it first.");
    // Before the gear is read: auto-swap puts on the combat loadout (a sea
    // creature hooked mid-cast included).
    await wardrobeRepository.autoSwap(tx, playerId, { activity: "combat", enemyId: target.enemyId, dungeonId: target.dungeonId ?? null });

    const player = await playerRepository.findPlayer(playerId, tx);
    if (!player) throw AppError.notFound("Player not found");
    const loadout = await loadLoadout(tx, playerId);
    if (loadout.hand.length === 0) throw AppError.badRequest("Your combat hand is empty");

    const combatLevel = (await playerRepository.findSkillLevels(tx, playerId)).combat ?? 1;
    const you: CombatantSetup = playerCombatant(
        { name: player.displayName, ...loadout, combatLevel, globalModifiers: await globalModifiers(tx) },
        CONTENT,
        combatantId,
    );
    // Carried from the last fight, unless this one is fought at full.
    if (!target.keepsHealth) you.health = (await playerRepository.findHealth(playerId, tx)).current;
    else if (startHealth !== undefined) you.health = startHealth;
    // Else the fight could only be fled.
    if (!loadout.hand.some((card) => canWield(CONTENT.cards[card.cardId]!, you.weaponTags, you.offHandTags))) {
        throw AppError.badRequest("None of the cards in your hand can be used with your gear");
    }
    return you;
}

const enemySetups = (target: RunTarget): CombatantSetup[] =>
    [target.enemyId].map((id, index) => ({ ...enemyCombatant(id, index, CONTENT), modifiers: target.enemyModifiers ?? [] }));

/**
 * Starts a combat Run in the caller's transaction, e.g. a sea creature
 * hooked while fishing. The caller holds the player lock and has checked the
 * spawn, if any.
 */
export async function openCombatRun(tx: TxQuery, playerId: string, target: RunTarget): Promise<GeoRunResponse> {
    const { enemyId, spawnId } = target;
    if (!CONTENT.enemies[enemyId]) throw new Error(`Unknown enemy "${enemyId}"`);
    const you = await preparePlayer(tx, playerId, target, PLAYER_COMBATANT_ID, target.startHealth);
    const { state, log } = createBattle([you, ...enemySetups(target)], randomSeed(), CONTENT);

    const [inserted] = await tx<RunRow>(INSERT_RUN, [
        playerId,
        "combat",
        [enemyId],
        spawnId,
        state,
        target.keepsHealth ?? false,
        target.dungeonId ?? null,
        target.dungeonRunId ?? null,
        target.dungeonRoom ?? null,
    ]);
    if (!inserted) throw new Error("Run insert returned nothing");
    // A battle can, in principle, end before the player acts.
    return settle(tx, inserted, inserted.state, state, log);
}

/**
 * Opens one fight for several players at once (a dungeon's boss): one
 * battle, a Runs row each (their own status, rewards, dungeon link), in the
 * order given. Each is set up as for a solo fight at their `startHealth`; a
 * player who can't fight (empty hand…) is left out (`refused`). The caller
 * holds every player's lock. The dungeon isn't told about anyone the
 * opening already put out: the caller is mid-change on it, and applies that
 * itself. Returns each player's Run.
 */
export async function openSharedCombatRun(
    tx: TxQuery,
    players: { playerId: string; startHealth: number }[],
    target: RunTarget,
): Promise<{ opened: Map<string, GeoRunResponse>; refused: string[] }> {
    if (!CONTENT.enemies[target.enemyId]) throw new Error(`Unknown enemy "${target.enemyId}"`);
    const ready: { playerId: string; setup: CombatantSetup }[] = [];
    const refused: string[] = [];
    for (const [seat, { playerId, startHealth }] of players.entries()) {
        await tx("SAVEPOINT shared_fighter");
        try {
            ready.push({ playerId, setup: await preparePlayer(tx, playerId, target, `player:${seat}`, startHealth) });
            await tx("RELEASE SAVEPOINT shared_fighter");
        } catch (error) {
            if (!(error instanceof AppError)) throw error;
            await tx("ROLLBACK TO SAVEPOINT shared_fighter");
            refused.push(playerId);
        }
    }
    if (ready.length === 0) return { opened: new Map(), refused };

    const { state, log } = createBattle([...ready.map((entry) => entry.setup), ...enemySetups(target)], randomSeed(), CONTENT);
    const battleId = randomUUID();
    const rows: RunRow[] = [];
    for (const { playerId, setup } of ready) {
        const [row] = await tx<RunRow>(INSERT_BATTLE_RUN, [
            playerId,
            "combat",
            [target.enemyId],
            null,
            state,
            target.keepsHealth ?? false,
            target.dungeonId ?? null,
            target.dungeonRunId ?? null,
            target.dungeonRoom ?? null,
            battleId,
            setup.id,
        ]);
        rows.push(row!);
    }
    const opened = await settleBattle(tx, rows, state, state, log, { actorId: null, newTurn: true, tellDungeon: false, push: false });
    return { opened, refused };
}

/** A turn: a card from the hand, or a food from a lunchbox slot. */
export type TurnPlay = { inventoryId: string; targetId?: string } | { lunchboxSlot: number };

export async function playTurn(playerId: string, runId: string, play: TurnPlay): Promise<GeoRunResponse> {
    const resolve = (state: BattleState, actorId: string) =>
        "lunchboxSlot" in play
            ? eatFood(state, CONTENT, { slot: play.lunchboxSlot, actorId })
            : playCard(state, CONTENT, { cardInstanceId: play.inventoryId, targetId: play.targetId, actorId });
    return withTransaction(async (tx) => {
        const [peek] = await tx<RunRow>(FIND_RUN, [runId, playerId]);
        if (peek?.battle_id) return sharedAction(tx, peek.battle_id, playerId, resolve);
        await playerRepository.lockPlayer(tx, playerId);
        // A Run left too long is over, here as everywhere else: its hand is
        // free to change again, so it mustn't be played on.
        await tx(ABANDON_STALE_RUNS, [playerId, ABANDON_AFTER_MINUTES]);
        const [row] = await tx<RunRow>(FIND_RUN_FOR_UPDATE, [runId, playerId]);
        if (!row) throw AppError.notFound("Run not found");
        if (row.status !== "active") throw AppError.badRequest("That Run is over");

        let result: BattleResult;
        try {
            result = resolve(row.state, combatantOf(row));
        } catch (error) {
            if (error instanceof BattleRuleError) throw AppError.badRequest(error.message);
            throw error;
        }
        return settle(tx, row, row.state, result.state, result.log);
    });
}

/**
 * Flees. Solo, the Run just ends. In a shared fight you leave it for good:
 * the others fight on, and you're nobody's target.
 */
export async function fleeRun(playerId: string, runId: string): Promise<GeoRunResponse> {
    return withTransaction(async (tx) => {
        const [peek] = await tx<RunRow>(FIND_RUN, [runId, playerId]);
        if (peek?.battle_id) return sharedAction(tx, peek.battle_id, playerId, (state, actorId) => leaveBattle(state, CONTENT, actorId));
        await playerRepository.lockPlayer(tx, playerId);
        const [row] = await tx<RunRow>(FIND_RUN_FOR_UPDATE, [runId, playerId]);
        if (!row) throw AppError.notFound("Run not found");
        if (row.status !== "active") throw AppError.badRequest("That Run is over");

        await tx(UPDATE_RUN, [row.id, row.state, "fled", null, null]);
        const you = row.state.combatants.find((c) => c.side === "player");
        await dungeonFights.dungeonFightOver(tx, row, "fled", you?.health ?? 0);
        return { run: toRunView({ ...row, status: "fled" }), log: [] };
    });
}

/**
 * The player dies outside a fight's own rules: every coin carried is lost,
 * as on a defeat, and a Run in progress ends as one. Health drops to what a
 * defeat leaves, unless the Run keeps it (a dungeon's).
 */
export async function killPlayer(playerId: string, cause: GeoDeathCause): Promise<GeoDeathResponse> {
    return withTransaction(async (tx) => {
        const [active] = await tx<RunRow>(FIND_ACTIVE_RUN_FOR_UPDATE, [playerId]);
        const coinsLost = await playerRepository.loseAllCoins(tx, playerId, cause, active?.id ?? cause);
        if (!active?.keeps_health) {
            const max = await playerMaxHealth(playerId, tx);
            await playerRepository.setHealth(tx, playerId, defeatHealth(max), max);
        }
        if (active) {
            const state: BattleState = { ...active.state, outcome: "defeat" };
            await tx(UPDATE_RUN, [active.id, state, "defeat", null, String(coinsLost)]);
        }
        return { cause, coinsLost };
    });
}

/** "Giant Spider", or the first enemy's name and how many more. */
function chestSourceName(enemyIds: string[]): string {
    const first = CONTENT.enemies[enemyIds[0] ?? ""]?.name ?? "Unknown";
    return enemyIds.length > 1 ? `${first} +${enemyIds.length - 1}` : first;
}

/**
 * Saves a turn: card charges spent, food eaten, the new battle state, and —
 * on a win — loot, XP and quest progress. All in the caller's transaction, so a turn is never half-saved.
 */
async function settle(
    tx: TxQuery,
    row: RunRow,
    before: BattleState,
    after: BattleState,
    log: LogEntry[],
    { tellDungeon = true }: { tellDungeon?: boolean } = {},
): Promise<GeoRunResponse> {
    const playerId = row.player_id;
    const mineIn = (state: BattleState) => state.combatants.find((c) => c.id === combatantOf(row));
    const handBefore = mineIn(before)?.hand ?? [];
    const handAfter = mineIn(after)?.hand ?? [];
    for (const card of handAfter) {
        const previous = handBefore.find((c) => c.instanceId === card.instanceId);
        if (previous && previous.chargesLeft !== card.chargesLeft) {
            await playerRepository.setCharges(tx, playerId, card.instanceId, card.chargesLeft);
        }
    }

    // Food eaten is taken from the stored lunchbox in this same transaction,
    // guarded on what the fight thought was there, so the heal and the food
    // leaving are saved together or not at all.
    const lunchboxBefore = mineIn(before)?.lunchbox ?? [];
    const lunchboxAfter = mineIn(after)?.lunchbox ?? [];
    for (const entry of lunchboxAfter) {
        const previous = lunchboxBefore.find((e) => e.slot === entry.slot);
        if (previous && previous.quantity !== entry.quantity) {
            await playerRepository.eatFromLunchbox(tx, playerId, {
                slot: entry.slot,
                itemId: entry.foodId,
                from: previous.quantity,
                to: entry.quantity,
            });
        }
    }

    // In a shared fight you can be down or gone while the others fight on.
    const you = mineIn(after);
    const status: GeoRunStatus = you?.left
        ? "fled"
        : after.outcome === "defeat" || (you && you.health <= 0)
          ? "defeat"
          : after.outcome === "victory"
            ? "victory"
            : "active";
    let rewards: GeoRewards | null = row.rewards;

    // Health carries out of the fight, saved every turn so closing the app
    // mid-fight keeps the damage. A defeat leaves a tenth of max. A Run that
    // keeps health (a dungeon's) never touches the player's.
    if (you && !row.keeps_health) {
        const max = statOf(you, CORE_STATS.maxHealth, CONTENT);
        await playerRepository.setHealth(tx, playerId, status === "defeat" ? defeatHealth(max) : you.health, max);
    }

    if (status === "victory" && !rewards) {
        // A shared fight's players each roll their own drops.
        const ownSalt = row.battle_id ? parseInt(row.id.slice(0, 8), 16) : 0;
        const lootRng = createRng((after.seed ^ LOOT_SEED_SALT ^ ownSalt) >>> 0);
        const magicFind = you ? statOf(you, MAGIC_FIND_STAT, CONTENT) : 0;
        // An enemy that gives chests this time gives them instead of its loot list.
        const chests: RolledChest[] = [];
        const items: Drop[] = [];
        for (const enemyId of row.enemy_ids) {
            const won = rollChests(enemyId, lootRng, CONTENT, magicFind);
            if (won) chests.push(...won);
            else items.push(...rollLoot(enemyId, lootRng, CONTENT, magicFind));
        }
        const rolled = row.enemy_ids.reduce((sum, id) => sum + rollCoins(id, lootRng, CONTENT), 0);
        // Global effects (e.g. Malphas's Grave Robber) scale coin drops.
        const coins = Math.round(applyModifiers(rolled, await globalModifiers(tx), "coinDrops"));
        const xp = row.enemy_ids.reduce((sum, id) => sum + (CONTENT.enemies[id]?.xp ?? 0), 0);

        await playerRepository.grantItems(tx, playerId, items);
        await playerRepository.addCoins(tx, playerId, coins, "run-loot", row.id);
        await playerRepository.addSkillXp(tx, playerId, "combat", xp);
        if (row.spawn_id) await worldRepository.claimSpawn(tx, playerId, row.spawn_id);
        await questsRepository.recordQuestEvents(tx, playerId, [
            ...row.enemy_ids.map((enemyId) => ({ type: "kill" as const, enemyId })),
            ...(row.dungeon_id ? [{ type: "dungeon" as const, dungeonId: row.dungeon_id }] : []),
        ]);

        let chestReward: GeoRewards["chests"] = null;
        if (chests.length > 0) {
            const source = { kind: "combat" as const, name: chestSourceName(row.enemy_ids) };
            const selection = await chestsRepository.createSelection(tx, playerId, source, row.id, chests);
            chestReward = { selectionId: selection.id, chests: chestsRepository.toSelectionView(selection).chests };
        }
        rewards = { items, coins, xp: [{ skill: "combat", amount: xp }], chests: chestReward };
    }

    // Defeat costs every coin carried, except in a dungeon (a fail there
    // only costs the chests). Fleeing costs nothing but the loot.
    let coinsLost = row.coins_lost;
    if (status === "defeat" && coinsLost === null && row.keeps_health) coinsLost = "0";
    if (status === "defeat" && coinsLost === null) {
        coinsLost = String(await playerRepository.loseAllCoins(tx, playerId, "run-defeat", row.id));
        // Some enemies leave once they've won; marking the spawn claimed takes
        // it off the map the same way a beaten one goes.
        const leaves = row.enemy_ids.some((id) => CONTENT.enemies[id]?.leavesAfterWinning);
        if (leaves && row.spawn_id) await worldRepository.claimSpawn(tx, playerId, row.spawn_id);
    }

    await tx(UPDATE_RUN, [row.id, after, status, rewards, coinsLost]);
    const wasActive = row.status === "active";
    Object.assign(row, { state: after, status, rewards, coins_lost: coinsLost, version: row.version + 1 });
    if (status !== "active" && wasActive && tellDungeon) await dungeonFights.dungeonFightOver(tx, row, status, you?.health ?? 0);
    return { run: toRunView(row), log };
}

// ---------------------------------------------------------------------------
// Shared fights: a party in one battle (a dungeon's boss).

const TURN_MS = GEO_RUN_TURN_SECONDS * 1000;
const RECONNECT_MS = GEO_DUNGEON_RECONNECT_SECONDS * 1000;

/** Locks everyone in the fight (players in id order, so two of these can't deadlock), then their rows. */
async function lockBattle(tx: TxQuery, battleId: string): Promise<RunRow[]> {
    for (const { player_id } of await tx<{ player_id: string }>(FIND_BATTLE_PLAYERS, [battleId])) {
        await playerRepository.lockPlayer(tx, player_id);
    }
    return tx<RunRow>(FIND_BATTLE_ROWS_FOR_UPDATE, [battleId]);
}

/** The fight as it stands: any row still in it holds it; null once nobody is. */
const liveState = (rows: RunRow[]) => rows.find((row) => row.status === "active")?.state ?? null;

/**
 * When the current player's turn is skipped (ms), or null when no player is
 * on the clock: GEO_RUN_TURN_SECONDS from the turn's start, or sooner for a
 * player with no socket, whose reconnect window counts from when they
 * dropped (and is gone at once if that was long enough ago).
 */
function turnDeadline(rows: RunRow[], state: BattleState, turnStart: number): number | null {
    const actor = currentActor(state);
    if (!actor || actor.side !== "player") return null;
    const theirs = rows.find((row) => combatantOf(row) === actor.id && row.status === "active");
    // Their Run ended outside the fight (left too long): nothing to wait for.
    if (!theirs) return turnStart;
    const offline = socketHub.offlineSince(theirs.player_id);
    const full = turnStart + TURN_MS;
    return offline === null ? full : Math.min(full, Math.max(turnStart, offline + RECONNECT_MS));
}

type SharedSave = {
    /** Who acted (they have the reply; the rest get a push); null for the clock. */
    actorId: string | null;
    /** A new turn began: its clock starts now. */
    newTurn: boolean;
    tellDungeon?: boolean;
    push?: boolean;
};

/**
 * Saves a shared fight's step for everyone still in it: each player's own
 * charges, food, status and rewards (`settle`), the same battle state on
 * every row, and the turn clock. Once committed, the others hear it over the
 * socket and the clock's wake is booked. Updates `rows` in place. Returns
 * each player's Run, by player.
 */
async function settleBattle(
    tx: TxQuery,
    rows: RunRow[],
    before: BattleState,
    after: BattleState,
    log: LogEntry[],
    save: SharedSave,
): Promise<Map<string, GeoRunResponse>> {
    const live = rows.filter((row) => row.status === "active");
    for (const row of live) await settle(tx, row, before, after, log, { tellDungeon: save.tellDungeon });

    const battleId = rows[0]!.battle_id!;
    const now = Date.now();
    const turnStart = save.newTurn || !rows[0]!.turn_started_at ? now : rows[0]!.turn_started_at.getTime();
    const deadline = turnDeadline(rows, after, turnStart);
    await tx(SET_TURN_CLOCK, [battleId, turnStart, deadline]);
    for (const row of rows) {
        row.turn_started_at = new Date(turnStart);
        row.turn_deadline = deadline === null ? null : new Date(deadline);
    }
    if (deadline !== null) afterCommit(tx, () => wakeAt(`battle:${battleId}`, deadline, () => settleBattleClock(battleId)));
    const saved = new Map(live.map((row) => [row.player_id, { run: toRunView(row), log }]));
    if (save.push !== false) {
        // Each view as of this step, beside its log: a fresh read could pair
        // this log with a later step's state, and the later push (same
        // version) would then be dropped with its log. Steps commit in order
        // (the battle is locked), so these go out in order too.
        const told = [...saved].filter(([id]) => id !== save.actorId);
        afterCommit(tx, () => {
            for (const [id, run] of told) socketHub.publish(id, { type: "run", run });
        });
    }
    return saved;
}

/**
 * Skips every turn whose clock has run out, up to now. Each skip is saved
 * like any turn. Rows are locked and updated in place. The deadline is
 * worked out afresh, not read from the row: one shortened when a player
 * dropped goes back to the full turn once they're back.
 */
async function applyClock(tx: TxQuery, rows: RunRow[], now = Date.now()): Promise<boolean> {
    let skipped = false;
    // A party all gone can't stall it: each of their turns skips at once. Bounded, and the wake comes straight back.
    for (let turns = 0; turns < 20; turns++) {
        const state = liveState(rows);
        const turnStart = rows[0]?.turn_started_at?.getTime();
        const actor = state && currentActor(state);
        if (!state || !actor || actor.side !== "player" || turnStart === undefined) break;
        const deadline = turnDeadline(rows, state, turnStart);
        if (deadline === null || now < deadline) break;
        const owner = rows.find((row) => combatantOf(row) === actor.id);
        const reason = owner && socketHub.offlineSince(owner.player_id) !== null ? "offline" : "timeout";
        const result = skipTurn(state, CONTENT, actor.id, reason);
        await settleBattle(tx, rows, state, result.state, result.log, { actorId: null, newTurn: true });
        skipped = true;
    }
    return skipped;
}

/**
 * A player's play in a shared fight: the clock first (their turn may have
 * gone), then `act` as them, saved for everyone. Throws AppError for an
 * illegal play.
 */
async function sharedAction(
    tx: TxQuery,
    battleId: string,
    playerId: string,
    act: (state: BattleState, actorId: string) => BattleResult,
): Promise<GeoRunResponse> {
    const rows = await lockBattle(tx, battleId);
    const mine = rows.find((row) => row.player_id === playerId);
    if (!mine) throw AppError.notFound("Run not found");
    await applyClock(tx, rows);
    if (mine.status !== "active") throw AppError.badRequest("That Run is over");

    const before = mine.state;
    let result: BattleResult;
    try {
        result = act(before, combatantOf(mine));
    } catch (error) {
        if (error instanceof BattleRuleError) throw AppError.badRequest(error.message);
        throw error;
    }
    const newTurn = currentActor(before)?.id !== currentActor(result.state)?.id || before.round !== result.state.round;
    const saved = await settleBattle(tx, rows, before, result.state, result.log, { actorId: playerId, newTurn });
    return saved.get(playerId) ?? { run: toRunView(mine), log: result.log };
}

/**
 * The clock's wake (and the job's sweep): skips turns that ran out, and
 * moves the deadline up for a player who just dropped, or back for one who
 * returned. Others hear of it.
 */
export async function settleBattleClock(battleId: string): Promise<void> {
    await withTransaction(async (tx) => {
        const rows = await lockBattle(tx, battleId);
        const state = liveState(rows);
        if (!state || (await applyClock(tx, rows))) return;
        const stored = rows[0]!.turn_deadline?.getTime() ?? null;
        const turnStart = rows[0]!.turn_started_at?.getTime() ?? Date.now();
        if (turnDeadline(rows, state, turnStart) !== stored) {
            await settleBattle(tx, rows, state, state, [], { actorId: null, newTurn: false });
        } else if (stored !== null) {
            afterCommit(tx, () => wakeAt(`battle:${battleId}`, stored, () => settleBattleClock(battleId)));
        }
    });
}

/** The job's sweep: shared fights whose turn clock ran out with no timer left to see it (a restart). */
export async function settleDueBattles(): Promise<void> {
    for (const { battle_id } of await query<{ battle_id: string }>(FIND_DUE_BATTLES)) await settleBattleClock(battle_id);
}

/** Looks at the player's shared fight now, if they're in one: their turn's clock may have moved. */
function wakePlayerBattle(playerId: string) {
    void query<{ battle_id: string }>(FIND_PLAYER_BATTLE, [playerId])
        .then(([found]) => found && wakeAt(`battle:${found.battle_id}`, Date.now(), () => settleBattleClock(found.battle_id)))
        .catch((error: unknown) => console.error("geo: presence battle wake failed", error));
}

// Dropped: their turn's clock may come in. Back: it goes out to the full turn again.
socketHub.onOffline(wakePlayerBattle);
socketHub.onOnline(wakePlayerBattle);

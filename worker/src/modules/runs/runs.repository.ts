import {
    GEO_RUN_TURN_SECONDS,
    type GeoDeathCause,
    type GeoDeathResponse,
    type GeoRewards,
    type GeoRunResponse,
    type GeoRunStatus,
} from "@geo/shared";
import {
    enemyCombatant,
    PLAYER_COMBATANT_ID,
    playerCombatant,
    rollChests,
    rollCoins,
    rollLoot,
    type Drop,
    type RolledChest,
} from "../../../../server/src/combat/combatants";
import { CONTENT } from "../../../../server/src/content";
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
} from "../../../../server/src/engine/battle";
import {
    CORE_STATS,
    MAGIC_FIND_STAT,
    type BattleState,
    type CardInstance,
    type LogEntry,
    type LunchboxSlot,
    type StatModifier,
} from "../../../../server/src/engine/engine.types";
import { createRng, randomSeed } from "../../../../server/src/engine/rng";
import { applyModifiers, statOf } from "../../../../server/src/engine/stats";
import { AppError } from "../../../../server/src/http/AppError";
import { defeatHealth } from "../../../../server/src/modules/player/geo-camp.rules";
import { activePetModifiers } from "../../../../server/src/pets/pets";
import type { World } from "../../app";
import type { Db } from "../../db/db";
import * as chestsRepository from "../chests/chests.repository";
import * as dungeonFights from "../dungeon-runs/dungeon-runs.fights";
import { endOpenFishing } from "../fishing/fishing.repository";
import { schedule } from "../jobs/jobs.repository";
import { globalModifiers } from "../mayor/mayor.repository";
import * as playerRepository from "../player/player.repository";
import { recordQuestEvents } from "../quests/quests.repository";
import { autoSwap } from "../wardrobe/wardrobe.repository";
import * as worldRepository from "../world/world.repository";
import { ABANDON_STALE_RUN, FIND_ACTIVE_RUN, FIND_BATTLE_ROWS, FIND_RUN, INSERT_RUN, SET_TURN_CLOCK, UPDATE_RUN, UPDATE_RUN_STATE } from "./runs.sql.ts";
import type { RunRecord, RunRow } from "./runs.types";
import { toRunView } from "./runs.view";

/**
 * Combat Runs, from server/src/modules/runs/geo-runs.repository.ts. Every
 * function is synchronous and runs inside the caller's `db.transaction`,
 * which is all the locking a fight needs: no player locks, no lock order.
 * A shared fight's turn clock is a `due` row (`battle:<id>`) the World's
 * alarm wakes (src/jobs.ts), where the Express server kept a timer.
 */

/** Loot gets its own RNG stream, so changing a loot table never changes a fight. */
const LOOT_SEED_SALT = 0x9e3779b9;

/** PLACEHOLDER: a Run untouched this long counts as fled (the app was closed mid-fight). */
export const ABANDON_AFTER_MS = 30 * 60_000;

/** A `runs` row read: JSON parsed, 0/1 as booleans. Fishing rows come through too; check `kind`. */
export function parseRun(record: RunRecord): RunRow {
    return {
        ...record,
        kind: record.kind as RunRow["kind"],
        enemy_ids: JSON.parse(record.enemy_ids) as string[],
        state: JSON.parse(record.state) as BattleState,
        rewards: record.rewards === null ? null : (JSON.parse(record.rewards) as GeoRewards),
        keeps_health: record.keeps_health === 1,
    };
}

/** Ends the player's Run if it's been left too long. Writes only when there is one to end. */
export function endStaleRun(db: Db, playerId: string, now = Date.now()) {
    db.run(ABANDON_STALE_RUN, now, playerId, now - ABANDON_AFTER_MS);
}

/** The Run in progress (combat or fishing), once one left too long has been ended. */
export function findLiveRun(db: Db, playerId: string): RunRecord | undefined {
    endStaleRun(db, playerId);
    return db.one<RunRecord>(FIND_ACTIVE_RUN, playerId);
}

/**
 * Refuses a change to `skill`'s hand while a Run of that skill is going: the
 * fight plays from its own copy of the hand, so a card taken out of it now
 * could be sold or listed and still played.
 */
export function assertHandNotInRun(db: Db, playerId: string, skill: string) {
    if (findLiveRun(db, playerId)?.kind === skill) throw AppError.badRequest("You can't change that hand mid-Run");
}

/** Refuses while the player is in any Run, with `message`. Call inside the transaction that does the work. */
export function assertNotInRun(db: Db, playerId: string, message: string) {
    if (findLiveRun(db, playerId)) throw AppError.badRequest(message);
}

/** The combat Run in progress, if any: for picking a fight back up after a restart. A fishing Run resumes from its own screen. */
export function findActiveRun(db: Db, playerId: string): GeoRunResponse | null {
    const row = findLiveRun(db, playerId);
    return row && row.kind === "combat" ? { run: toRunView(parseRun(row)), log: [] } : null;
}

/** The player's gear, talismans, active pet, combat hand and lunchbox, as the engine needs them. */
function loadLoadout(db: Db, playerId: string) {
    const inventory = playerRepository.findInventory(db, playerId);
    const byId = new Map(inventory.map((row) => [row.id, row]));
    const worn = playerRepository.findEquipment(db, playerId).flatMap((slot) => byId.get(slot.inventory_id) ?? []);
    const reforges = worn.flatMap((row) => (row.reforge ? [{ itemId: row.item_id, reforgeId: row.reforge }] : []));

    const hand: CardInstance[] = [];
    for (const id of playerRepository.findHand(db, playerId, "combat")) {
        const row = byId.get(id);
        const item = row ? CONTENT.items[row.item_id] : undefined;
        if (!row || item?.kind !== "card" || (row.charges_left ?? 0) <= 0) continue;
        hand.push({ instanceId: row.id, cardId: item.cardId, chargesLeft: row.charges_left ?? 0 });
    }

    // Food removed from the content since it was packed can't be eaten.
    const lunchbox: LunchboxSlot[] = playerRepository
        .findLunchbox(db, playerId)
        .contents.filter((entry) => CONTENT.foods[entry.itemId])
        .map((entry) => ({ slot: entry.slot, foodId: entry.itemId, quantity: entry.quantity }));

    return {
        equipment: worn.map((row) => row.item_id),
        reforges,
        // Only the bag counts, and the bag holds one copy of each talisman.
        talismans: playerRepository.findTalismanBag(db, playerId).map((entry) => entry.item_id),
        hand,
        lunchbox,
        petModifiers: activePetModifiers(playerRepository.findActivePet(db, playerId) ?? undefined),
    };
}

/** The player as the engine builds them from their loadout, without a hand check. */
function combatantFor(db: Db, playerId: string, loadout: ReturnType<typeof loadLoadout>, combatantId?: string): CombatantSetup {
    const player = playerRepository.findPlayer(db, playerId);
    if (!player) throw AppError.notFound("Player not found");
    const combatLevel = playerRepository.findSkillLevels(db, playerId).combat ?? 1;
    return playerCombatant({ name: player.displayName, ...loadout, combatLevel, globalModifiers: globalModifiers(db) }, CONTENT, combatantId);
}

/**
 * Eats one lunchbox food between fights, through the battle engine, and
 * saves the health it leaves (statuses don't outlast it). Between rooms of a
 * dungeon it's the dungeon's health that changes. The caller has checked
 * there's no Run in progress.
 */
export function eatBetweenFightsFor(world: World, playerId: string, slot: number) {
    const { db } = world;
    const loadout = loadLoadout(db, playerId);
    const packed = loadout.lunchbox.find((entry) => entry.slot === slot);
    if (!packed) throw AppError.badRequest("That lunchbox slot is empty");

    const you = combatantFor(db, playerId, loadout);
    const dungeonRun = dungeonFights.findActive(db, playerId);
    const inDungeon = dungeonRun && dungeonFights.memberOf(dungeonRun, playerId);
    const health = inDungeon
        ? { current: inDungeon.state.health, max: inDungeon.state.maxHealth }
        : playerRepository.findHealth(db, playerId);
    you.health = health.current;

    const result = ruled(() => eatBetweenFights(you, CONTENT, { slot }, randomSeed()));
    playerRepository.eatFromLunchbox(db, playerId, { slot, itemId: packed.foodId, from: packed.quantity, to: packed.quantity - 1 });
    if (dungeonRun && inDungeon) {
        inDungeon.state = { ...inDungeon.state, health: Math.min(result.health, inDungeon.state.maxHealth) };
        dungeonFights.saveRun(world, dungeonRun);
    } else playerRepository.setHealth(db, playerId, result.health, health.max);
}

/** Runs an engine step, turning a broken rule into a 400. */
function ruled<T>(step: () => T): T {
    try {
        return step();
    } catch (error) {
        if (error instanceof BattleRuleError) throw AppError.badRequest(error.message);
        throw error;
    }
}

/**
 * What a fight is against: a real spawn, a dungeon boss, or (dev only) an
 * enemy by id. `enemyModifiers` make it stronger, e.g. a dungeon's boss.
 * `keepsHealth` fights at full health and leaves the player's own health as
 * it was, whatever happens (a dungeon); otherwise the fight starts from the
 * player's health and saves it as it changes. `dungeonId` marks a dungeon's
 * boss fight, so a win counts toward quests. `dungeonRunId` and `dungeonRoom`
 * mark a room fight on a dungeon map, which starts at `startHealth` (the
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

/** Starts a fight with one of the player's spawns, or (dev) any enemy. The caller runs it in one transaction. */
export function startCombatRun(world: World, playerId: string, target: RunTarget): GeoRunResponse {
    if (!CONTENT.enemies[target.enemyId]) throw AppError.badRequest("Unknown enemy");
    // Checked again here: it may have gone or been won since the request looked.
    if (target.spawnId && !worldRepository.findLiveSpawn(world, playerId, target.spawnId, Date.now())) {
        throw AppError.badRequest("That enemy has moved on");
    }
    dungeonFights.assertNotInDungeon(world.db, playerId);
    return openCombatRun(world, playerId, target);
}

/** The player's side of this row's fight: the solo "player", or theirs in a shared one. */
const combatantOf = (row: RunRow) => row.combatant_id ?? PLAYER_COMBATANT_ID;

/**
 * Gets one player ready to fight: leaves a fishing spot, puts on the combat
 * loadout (auto-swap), and builds their combatant from gear, hand and
 * lunchbox. Refuses (AppError) a player already in a Run, with an empty
 * hand, or with no card their gear can use.
 */
function preparePlayer(world: World, playerId: string, target: RunTarget, combatantId: string, startHealth?: number): CombatantSetup {
    const { db } = world;
    const active = findLiveRun(db, playerId);
    // Walking off from a fishing spot to fight leaves the spot.
    if (active?.kind === "fishing") endOpenFishing(db, active);
    else if (active) throw AppError.badRequest("You're already in a Run. Finish or flee it first.");
    // Before the gear is read: auto-swap puts on the combat loadout (a sea
    // creature hooked mid-cast included).
    autoSwap(db, playerId, { activity: "combat", enemyId: target.enemyId, dungeonId: target.dungeonId ?? null });

    const loadout = loadLoadout(db, playerId);
    if (loadout.hand.length === 0) throw AppError.badRequest("Your combat hand is empty");
    const you = combatantFor(db, playerId, loadout, combatantId);
    // Carried from the last fight, unless this one is fought at full.
    if (!target.keepsHealth) you.health = playerRepository.findHealth(db, playerId).current;
    else if (startHealth !== undefined) you.health = startHealth;
    // Else the fight could only be fled.
    if (!loadout.hand.some((card) => canWield(CONTENT.cards[card.cardId]!, you.weaponTags, you.offHandTags))) {
        throw AppError.badRequest("None of the cards in your hand can be used with your gear");
    }
    return you;
}

const enemySetups = (target: RunTarget): CombatantSetup[] =>
    [target.enemyId].map((id, index) => ({ ...enemyCombatant(id, index, CONTENT), modifiers: target.enemyModifiers ?? [] }));

function insertRun(db: Db, playerId: string, state: BattleState, target: RunTarget, shared?: { battleId: string; combatantId: string }): RunRow {
    const record = db.one<RunRecord>(
        INSERT_RUN,
        crypto.randomUUID(),
        playerId,
        "combat",
        JSON.stringify([target.enemyId]),
        target.spawnId,
        JSON.stringify(state),
        target.keepsHealth ? 1 : 0,
        target.dungeonId ?? null,
        target.dungeonRunId ?? null,
        target.dungeonRoom ?? null,
        shared?.battleId ?? null,
        shared?.combatantId ?? null,
        Date.now(),
    );
    if (!record) throw new Error("Run insert returned nothing");
    return parseRun(record);
}

/**
 * Starts a combat Run in the caller's transaction, e.g. a sea creature
 * hooked while fishing. The caller has checked the spawn, if any.
 */
export function openCombatRun(world: World, playerId: string, target: RunTarget, { tellDungeon = true } = {}): GeoRunResponse {
    if (!CONTENT.enemies[target.enemyId]) throw new Error(`Unknown enemy "${target.enemyId}"`);
    const you = preparePlayer(world, playerId, target, PLAYER_COMBATANT_ID, target.startHealth);
    const { state, log } = createBattle([you, ...enemySetups(target)], randomSeed(), CONTENT);
    const row = insertRun(world.db, playerId, state, target);
    // A battle can, in principle, end before the player acts; and enemies
    // who go first have already hit. `tellDungeon: false` leaves a room fight
    // that ends at once for the caller to tell its dungeon run.
    return settle(world, row, state, state, log, { startHealth: you.health, tellDungeon });
}

/**
 * Opens one fight for several players at once (a dungeon's boss): one
 * battle, a Runs row each (their own status, rewards, dungeon link), in the
 * order given. Each is set up as for a solo fight at their `startHealth`; a
 * player who can't fight (empty hand…) is left out (`refused`), their setup
 * undone alone. The dungeon isn't told about anyone the opening already put
 * out: the caller is mid-change on it, and applies that itself.
 */
export function openSharedCombatRun(
    world: World,
    players: { playerId: string; startHealth: number }[],
    target: RunTarget,
): { opened: Map<string, GeoRunResponse>; refused: string[] } {
    if (!CONTENT.enemies[target.enemyId]) throw new Error(`Unknown enemy "${target.enemyId}"`);
    const ready: { playerId: string; setup: CombatantSetup }[] = [];
    const refused: string[] = [];
    for (const [seat, { playerId, startHealth }] of players.entries()) {
        try {
            // A savepoint: one who can't fight is undone alone.
            ready.push({ playerId, setup: world.db.transaction(() => preparePlayer(world, playerId, target, `player:${seat}`, startHealth)) });
        } catch (error) {
            if (!(error instanceof AppError)) throw error;
            refused.push(playerId);
        }
    }
    if (ready.length === 0) return { opened: new Map(), refused };

    const { state, log } = createBattle([...ready.map((entry) => entry.setup), ...enemySetups(target)], randomSeed(), CONTENT);
    const battleId = crypto.randomUUID();
    const rows = ready.map(({ playerId, setup }) => insertRun(world.db, playerId, state, target, { battleId, combatantId: setup.id }));
    const opened = settleBattle(world, rows, state, state, log, { actorId: null, newTurn: true, tellDungeon: false, push: false });
    return { opened, refused };
}

/** A turn: a card from the hand, or a food from a lunchbox slot. */
export type TurnPlay = { inventoryId: string; targetId?: string } | { lunchboxSlot: number };

export function playTurn(world: World, playerId: string, runId: string, play: TurnPlay): GeoRunResponse {
    const resolve = (state: BattleState, actorId: string) =>
        "lunchboxSlot" in play
            ? eatFood(state, CONTENT, { slot: play.lunchboxSlot, actorId })
            : playCard(state, CONTENT, { cardInstanceId: play.inventoryId, targetId: play.targetId, actorId });
    const { db } = world;
    // A Run left too long is over, here as everywhere else: its hand is
    // free to change again, so it mustn't be played on.
    endStaleRun(db, playerId);
    const row = findRun(db, playerId, runId);
    if (row.battle_id) return sharedAction(world, row.battle_id, playerId, resolve);
    if (row.status !== "active") throw AppError.badRequest("That Run is over");
    const result = ruled(() => resolve(row.state, combatantOf(row)));
    return settle(world, row, row.state, result.state, result.log);
}

function findRun(db: Db, playerId: string, runId: string): RunRow {
    const record = db.one<RunRecord>(FIND_RUN, runId, playerId);
    if (!record || record.kind !== "combat") throw AppError.notFound("Run not found");
    return parseRun(record);
}

/**
 * Flees. Solo, the Run just ends. In a shared fight you leave it for good:
 * the others fight on, and you're nobody's target.
 */
export function fleeRun(world: World, playerId: string, runId: string): GeoRunResponse {
    const row = findRun(world.db, playerId, runId);
    if (row.battle_id) return sharedAction(world, row.battle_id, playerId, (state, actorId) => leaveBattle(state, CONTENT, actorId));
    if (row.status !== "active") throw AppError.badRequest("That Run is over");

    world.db.run(UPDATE_RUN, row.id, JSON.stringify(row.state), "fled", null, null, Date.now());
    const you = row.state.combatants.find((c) => c.side === "player");
    dungeonFights.dungeonFightOver(world, row, "fled", you?.health ?? 0);
    return { run: toRunView({ ...row, status: "fled", version: row.version + 1 }), log: [] };
}

/**
 * The player dies outside a fight's own rules: every coin carried is lost,
 * as on a defeat, and a Run in progress ends as one. Health drops to what a
 * defeat leaves, unless the Run keeps it (a dungeon's).
 */
export function killPlayer(world: World, playerId: string, cause: GeoDeathCause): GeoDeathResponse {
    const { db } = world;
    const record = db.one<RunRecord>(FIND_ACTIVE_RUN, playerId);
    const active = record?.kind === "combat" ? parseRun(record) : undefined;
    const coinsLost = playerRepository.loseAllCoins(db, playerId, cause, active?.id ?? cause);
    if (!active?.keeps_health) {
        const max = playerRepository.playerMaxHealth(db, playerId);
        playerRepository.setHealth(db, playerId, defeatHealth(max), max);
    }
    if (active) {
        const state: BattleState = { ...active.state, outcome: "defeat" };
        db.run(UPDATE_RUN, active.id, JSON.stringify(state), "defeat", null, coinsLost, Date.now());
    }
    return { cause, coinsLost };
}

/** "Giant Spider", or the first enemy's name and how many more. */
function chestSourceName(enemyIds: string[]): string {
    const first = CONTENT.enemies[enemyIds[0] ?? ""]?.name ?? "Unknown";
    return enemyIds.length > 1 ? `${first} +${enemyIds.length - 1}` : first;
}

/**
 * Saves a turn: card charges spent, food eaten, the new battle state, and —
 * on a win — loot, XP and quest progress. All in the caller's transaction,
 * so a turn is never half-saved. Updates `row` in place.
 */
function settle(
    world: World,
    row: RunRow,
    before: BattleState,
    after: BattleState,
    log: LogEntry[],
    { tellDungeon = true, startHealth }: { tellDungeon?: boolean; startHealth?: number } = {},
): GeoRunResponse {
    const { db } = world;
    const playerId = row.player_id;
    const mineIn = (state: BattleState) => state.combatants.find((c) => c.id === combatantOf(row));
    const mineBefore = mineIn(before);
    const you = mineIn(after);

    for (const card of you?.hand ?? []) {
        const previous = mineBefore?.hand?.find((c) => c.instanceId === card.instanceId);
        if (previous && previous.chargesLeft !== card.chargesLeft) {
            playerRepository.setCharges(db, playerId, card.instanceId, card.chargesLeft);
        }
    }

    // Food eaten is taken from the stored lunchbox in this same transaction,
    // guarded on what the fight thought was there, so the heal and the food
    // leaving are saved together or not at all.
    for (const entry of you?.lunchbox ?? []) {
        const previous = mineBefore?.lunchbox?.find((e) => e.slot === entry.slot);
        if (previous && previous.quantity !== entry.quantity) {
            playerRepository.eatFromLunchbox(db, playerId, { slot: entry.slot, itemId: entry.foodId, from: previous.quantity, to: entry.quantity });
        }
    }

    // In a shared fight you can be down or gone while the others fight on.
    const status: GeoRunStatus = you?.left
        ? "fled"
        : after.outcome === "defeat" || (you && you.health <= 0)
          ? "defeat"
          : after.outcome === "victory"
            ? "victory"
            : "active";
    let rewards = row.rewards;

    // Health carries out of the fight, saved as it changes so closing the app
    // mid-fight keeps the damage (only when it changed: a write a turn is the
    // budget). A defeat leaves a tenth of max. A Run that keeps health (a
    // dungeon's) never touches the player's.
    const healthBefore = startHealth ?? mineBefore?.health;
    if (you && !row.keeps_health && (status === "defeat" || you.health !== healthBefore)) {
        const max = statOf(you, CORE_STATS.maxHealth, CONTENT);
        playerRepository.setHealth(db, playerId, status === "defeat" ? defeatHealth(max) : you.health, max);
    }

    if (status === "victory" && !rewards) rewards = winRewards(world, row, after, you ? statOf(you, MAGIC_FIND_STAT, CONTENT) : 0);

    // Defeat costs every coin carried, except in a dungeon (a fail there
    // only costs the chests). Fleeing costs nothing but the loot.
    let coinsLost = row.coins_lost;
    if (status === "defeat" && coinsLost === null && row.keeps_health) coinsLost = 0;
    if (status === "defeat" && coinsLost === null) {
        coinsLost = playerRepository.loseAllCoins(db, playerId, "run-defeat", row.id);
        // Some enemies leave once they've won; marking the spawn claimed takes
        // it off the map the same way a beaten one goes.
        const leaves = row.enemy_ids.some((id) => CONTENT.enemies[id]?.leavesAfterWinning);
        if (leaves && row.spawn_id) worldRepository.claimSpawn(db, playerId, row.spawn_id, Date.now());
    }

    const wasActive = row.status === "active";
    // A fight just opened and still going is saved as inserted.
    const unchanged = wasActive && status === "active" && after === before;
    if (unchanged) {
        // Nothing to write.
    } else if (wasActive && status === "active") db.run(UPDATE_RUN_STATE, JSON.stringify(after), Date.now(), row.id);
    else db.run(UPDATE_RUN, row.id, JSON.stringify(after), status, rewards && JSON.stringify(rewards), coinsLost, Date.now());
    Object.assign(row, { state: after, status, rewards, coins_lost: coinsLost, version: unchanged ? row.version : row.version + 1 });
    if (status !== "active" && wasActive && tellDungeon) dungeonFights.dungeonFightOver(world, row, status, you?.health ?? 0);
    return { run: toRunView(row), log };
}

/** A won fight's loot, coins, XP, chests and quest progress, handed over now. */
function winRewards(world: World, row: RunRow, after: BattleState, magicFind: number): GeoRewards {
    const { db } = world;
    const playerId = row.player_id;
    // A shared fight's players each roll their own drops.
    const ownSalt = row.battle_id ? parseInt(row.id.slice(0, 8), 16) : 0;
    const lootRng = createRng((after.seed ^ LOOT_SEED_SALT ^ ownSalt) >>> 0);
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
    const coins = Math.round(applyModifiers(rolled, globalModifiers(db), "coinDrops"));
    const xp = row.enemy_ids.reduce((sum, id) => sum + (CONTENT.enemies[id]?.xp ?? 0), 0);

    playerRepository.grantItems(db, playerId, items);
    playerRepository.addCoins(db, playerId, coins, "run-loot", row.id);
    playerRepository.addSkillXp(db, playerId, "combat", xp);
    if (row.spawn_id) worldRepository.claimSpawn(db, playerId, row.spawn_id, Date.now());
    recordQuestEvents(db, playerId, [
        ...row.enemy_ids.map((enemyId) => ({ type: "kill" as const, enemyId })),
        ...(row.dungeon_id ? [{ type: "dungeon" as const, dungeonId: row.dungeon_id }] : []),
    ]);

    let chestReward: GeoRewards["chests"] = null;
    if (chests.length > 0) {
        const source = { kind: "combat" as const, name: chestSourceName(row.enemy_ids) };
        const selection = chestsRepository.createSelection(world, playerId, source, row.id, chests);
        chestReward = { selectionId: selection.id, chests: chestsRepository.toSelectionView(selection).chests };
    }
    return { items, coins, xp: [{ skill: "combat", amount: xp }], chests: chestReward };
}

// ---------------------------------------------------------------------------
// Shared fights: a party in one battle (a dungeon's boss).

const TURN_MS = GEO_RUN_TURN_SECONDS * 1000;

/** The scheduler's key for a shared fight's turn clock (src/jobs.ts). */
export const battleKey = (battleId: string) => `battle:${battleId}`;

const loadBattle = (db: Db, battleId: string): RunRow[] => db.all<RunRecord>(FIND_BATTLE_ROWS, battleId).map(parseRun);

/** The fight as it stands: any row still in it holds it; null once nobody is. */
const liveState = (rows: RunRow[]) => rows.find((row) => row.status === "active")?.state ?? null;

/**
 * When the current player's turn is skipped (ms), or null when no player is
 * on the clock: GEO_RUN_TURN_SECONDS from the turn's start, or sooner for a
 * player with no socket, whose reconnect window counts from when they
 * dropped (and is gone at once if that was long enough ago).
 */
function turnDeadline(world: World, rows: RunRow[], state: BattleState, turnStart: number): number | null {
    const actor = currentActor(state);
    if (!actor || actor.side !== "player") return null;
    const theirs = rows.find((row) => combatantOf(row) === actor.id && row.status === "active");
    // Their Run ended outside the fight (left too long): nothing to wait for.
    if (!theirs) return turnStart;
    const offline = world.hub.offlineSince(theirs.player_id);
    const full = turnStart + TURN_MS;
    return offline === null ? full : Math.min(full, Math.max(turnStart, offline + dungeonFights.RECONNECT_MS));
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
 * every row, and the turn clock (on the rows for the app, and booked with
 * the scheduler). Once committed, the others hear it. Updates `rows` in
 * place. Returns each player's Run, by player.
 */
function settleBattle(
    world: World,
    rows: RunRow[],
    before: BattleState,
    after: BattleState,
    log: LogEntry[],
    save: SharedSave,
): Map<string, GeoRunResponse> {
    const live = rows.filter((row) => row.status === "active");
    for (const row of live) settle(world, row, before, after, log, { tellDungeon: save.tellDungeon });

    const battleId = rows[0]!.battle_id!;
    const turnStart = save.newTurn || rows[0]!.turn_started_at === null ? Date.now() : rows[0]!.turn_started_at;
    const deadline = turnDeadline(world, rows, after, turnStart);
    world.db.run(SET_TURN_CLOCK, turnStart, deadline, battleId);
    for (const row of rows) {
        row.turn_started_at = turnStart;
        row.turn_deadline = deadline;
    }
    schedule(world.db, battleKey(battleId), deadline);
    const saved = new Map(live.map((row) => [row.player_id, { run: toRunView(row), log }]));
    if (save.push !== false) {
        const told = [...saved].filter(([id]) => id !== save.actorId);
        world.db.afterCommit(() => {
            for (const [id, run] of told) world.hub.publish(id, { type: "run", run });
        });
    }
    return saved;
}

/**
 * Skips every turn whose clock has run out, up to now. Each skip is saved
 * like any turn. The deadline is worked out afresh, not read from the row:
 * one shortened when a player dropped goes back to the full turn once
 * they're back.
 */
function applyClock(world: World, rows: RunRow[], now = Date.now()): boolean {
    let skipped = false;
    // A party all gone can't stall it: each of their turns skips at once. Bounded, and the alarm comes straight back.
    for (let turns = 0; turns < 20; turns++) {
        const state = liveState(rows);
        const turnStart = rows[0]?.turn_started_at;
        const actor = state && currentActor(state);
        if (!state || !actor || actor.side !== "player" || turnStart === null || turnStart === undefined) break;
        const deadline = turnDeadline(world, rows, state, turnStart);
        if (deadline === null || now < deadline) break;
        const owner = rows.find((row) => combatantOf(row) === actor.id);
        const reason = owner && world.hub.offlineSince(owner.player_id) !== null ? "offline" : "timeout";
        const result = skipTurn(state, CONTENT, actor.id, reason);
        settleBattle(world, rows, state, result.state, result.log, { actorId: null, newTurn: true });
        skipped = true;
    }
    return skipped;
}

/**
 * A player's play in a shared fight: the clock first (their turn may have
 * gone), then `act` as them, saved for everyone. Throws AppError for an
 * illegal play.
 */
function sharedAction(
    world: World,
    battleId: string,
    playerId: string,
    act: (state: BattleState, actorId: string) => BattleResult,
): GeoRunResponse {
    const rows = loadBattle(world.db, battleId);
    const mine = rows.find((row) => row.player_id === playerId);
    if (!mine) throw AppError.notFound("Run not found");
    applyClock(world, rows);
    if (mine.status !== "active") throw AppError.badRequest("That Run is over");

    const before = mine.state;
    const result = ruled(() => act(before, combatantOf(mine)));
    const newTurn = currentActor(before)?.id !== currentActor(result.state)?.id || before.round !== result.state.round;
    const saved = settleBattle(world, rows, before, result.state, result.log, { actorId: playerId, newTurn });
    return saved.get(playerId) ?? { run: toRunView(mine), log: result.log };
}

/**
 * The turn clock's wake (the scheduler, src/jobs.ts): skips turns that ran
 * out, and moves the deadline up for a player who just dropped, or back for
 * one who returned. Others hear of it. The caller runs it in a transaction.
 */
export function settleBattleClock(world: World, battleId: string, now = Date.now()) {
    const rows = loadBattle(world.db, battleId);
    const state = liveState(rows);
    if (!state || applyClock(world, rows, now)) return;
    const stored = rows[0]!.turn_deadline;
    const turnStart = rows[0]!.turn_started_at ?? Date.now();
    if (turnDeadline(world, rows, state, turnStart) !== stored) settleBattle(world, rows, state, state, [], { actorId: null, newTurn: false });
    else schedule(world.db, battleKey(battleId), stored);
}

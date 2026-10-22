import { query } from "../db";
import { CONTENT, FIRST_MAYOR_ID, GAME_CONFIG, reforgeModifiers } from "../content";
import type { MayorDef } from "../content/content.types";
import { CORE_STATS, type StatModifier } from "../engine/engine.types";
import { applyModifiers } from "../engine/stats";
import type { TxQuery } from "../db/transaction";
import { activePetModifiers } from "../pets/pets";
import * as playerRepository from "../modules/player/geo-player.repository";

export { applyModifiers };

/**
 * Global effects: what applies to every player at once, such as the mayor's
 * perks. Any rule that should feel them reads its stat through here, e.g.
 * fishing's eel chance:
 *
 *     const modifiers = await playerModifiers(playerId);
 *     const eelChance = applyModifiers(BASE_EEL_CHANCE, modifiers, "eelChance");
 *
 * They are StatModifiers, the same as gear and talismans use, so one rule
 * reads one list and doesn't care where a bonus came from.
 */

/** The mayor in office: the last finished election's winner, or the first mayor. */
const CURRENT_MAYOR = `
  SELECT winner_id FROM geo.elections
  WHERE status = 'closed' AND winner_id IS NOT NULL
  ORDER BY closed_at DESC LIMIT 1;
`;

/**
 * Read at most this often. An election closing calls `forgetMayor`, so the
 * new mayor counts at once on this server; the cache only saves a query per
 * fight or cast.
 */
const CACHE_MS = 30_000;
let cached: { mayor: MayorDef; at: number } | null = null;

export async function currentMayor(tx: TxQuery = query): Promise<MayorDef> {
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.mayor;
    const [row] = await tx<{ winner_id: string }>(CURRENT_MAYOR);
    // A mayor since removed from content falls back rather than breaking.
    const mayor = CONTENT.mayors[row?.winner_id ?? FIRST_MAYOR_ID] ?? (CONTENT.mayors[FIRST_MAYOR_ID] as MayorDef);
    cached = { mayor, at: Date.now() };
    return mayor;
}

/** Called when a new mayor takes office. */
export function forgetMayor() {
    cached = null;
}

/** Every global modifier now: the mayor's perks. Events and the like would join here. */
export async function globalModifiers(tx: TxQuery = query): Promise<StatModifier[]> {
    const mayor = await currentMayor(tx);
    return mayor.perks.flatMap((perk) => perk.modifiers);
}

/** Modifiers from a player's own gear, the talismans in their bag, and their active pet. */
export async function ownModifiers(playerId: string, tx: TxQuery = query): Promise<StatModifier[]> {
    // One after another: a transaction is one connection.
    const equipment = await playerRepository.findEquipment(playerId, tx);
    const bag = await playerRepository.findTalismanBag(playerId, tx);
    const pet = await playerRepository.findActivePet(playerId, tx);
    const worn = await playerRepository.findInventoryByIds(
        playerId,
        equipment.map((slot) => slot.inventory_id),
        tx,
    );

    const itemIds = [...worn.map((row) => row.item_id), ...new Set(bag.map((entry) => entry.item_id))];
    return [
        ...itemIds.flatMap((itemId) => {
            const item = CONTENT.items[itemId];
            return item && (item.kind === "equipment" || item.kind === "talisman") ? (item.modifiers ?? []) : [];
        }),
        ...worn.flatMap((row) => reforgeModifiers(CONTENT, row.item_id, row.reforge)),
        ...activePetModifiers(pet ?? undefined),
    ];
}

/** Everything that changes a player's stats outside a fight: global effects, then their own. */
export async function playerModifiers(playerId: string, tx: TxQuery = query): Promise<StatModifier[]> {
    return [...(await globalModifiers(tx)), ...(await ownModifiers(playerId, tx))];
}

/** The player's max health from their gear right now, as a fight would start them. */
export async function playerMaxHealth(playerId: string, tx: TxQuery = query): Promise<number> {
    const base = GAME_CONFIG.player.baseStats[CORE_STATS.maxHealth] ?? 0;
    return Math.round(applyModifiers(base, await playerModifiers(playerId, tx), CORE_STATS.maxHealth));
}

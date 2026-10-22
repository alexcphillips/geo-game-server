import type { GeoChestSelection, GeoChestSource, GeoChestsResponse } from "@geo/shared";
import { query } from "../../db";
import { AppError } from "../../http/AppError";
import type { RolledChest } from "../../combat/combatants";
import { withTransaction, type TxQuery } from "../../db/transaction";
import { badgesChanged } from "../../realtime/geo-badges";
import * as playerRepository from "../player/geo-player.repository";
import { COUNT_PENDING, FIND_HISTORY, FIND_PENDING, FIND_SELECTION_FOR_UPDATE, INSERT_SELECTION, MARK_OPENED } from "./geo-chests.sql";
import type { ChestSelectionRow } from "./geo-chests.types";

/** A selection as the app sees it: closed chests show only tier and cost. */
export function toSelectionView(row: ChestSelectionRow): GeoChestSelection {
    const openedChest = row.opened_index === null ? undefined : row.chests[row.opened_index];
    return {
        id: row.id,
        source: { kind: row.source_kind, name: row.source_name },
        createdAt: row.created_at.toISOString(),
        chests: row.chests.map(({ tier, name, cost }) => ({ tier, name, cost })),
        opened:
            openedChest && row.opened_index !== null && row.opened_at
                ? { index: row.opened_index, items: openedChest.items, openedAt: row.opened_at.toISOString() }
                : null,
    };
}

/** Saves chests just won, pending until one is opened. In the win's own transaction. */
export async function createSelection(
    tx: TxQuery,
    playerId: string,
    source: GeoChestSource,
    runId: string | null,
    chests: RolledChest[],
): Promise<ChestSelectionRow> {
    const [row] = await tx<ChestSelectionRow>(INSERT_SELECTION, [
        playerId,
        source.kind,
        source.name,
        runId,
        JSON.stringify(chests),
    ]);
    if (!row) throw new Error("Chest selection insert returned nothing");
    badgesChanged(tx, [playerId]);
    return row;
}

/** Selections not opened yet, for the HUD badge. */
export async function countPending(playerId: string): Promise<number> {
    const [row] = await query<{ count: string }>(COUNT_PENDING, [playerId]);
    return Number(row?.count ?? 0);
}

export async function listChests(playerId: string): Promise<GeoChestsResponse> {
    const pending = await query<ChestSelectionRow>(FIND_PENDING, [playerId]);
    const history = await query<ChestSelectionRow>(FIND_HISTORY, [playerId]);
    return { pending: pending.map(toSelectionView), history: history.map(toSelectionView) };
}

/**
 * Whether the player may open a chest now. Always yes for now: once the
 * inventory has a size, a non-empty overflow will refuse here, leaving the
 * chests pending.
 */
async function assertCanOpenChests(_tx: TxQuery, _playerId: string) {}

/**
 * Opens one chest of a pending selection: its cost is taken first, then what
 * was rolled into it is handed over, and the rest of the selection is gone.
 * One transaction, so it's all or nothing.
 */
export async function openChest(playerId: string, selectionId: string, index: number): Promise<GeoChestSelection> {
    return withTransaction(async (tx) => {
        await playerRepository.lockPlayer(tx, playerId);
        const [row] = await tx<ChestSelectionRow>(FIND_SELECTION_FOR_UPDATE, [selectionId, playerId]);
        if (!row) throw AppError.notFound("Chests not found");
        if (row.opened_at) throw AppError.badRequest("You've already opened a chest from these");
        const chest = row.chests[index];
        if (!chest) throw AppError.badRequest("No such chest");

        await assertCanOpenChests(tx, playerId);
        await playerRepository.spendCoins(tx, playerId, chest.cost, "chest-open", `chests:${row.id}:${chest.tier}`);
        await playerRepository.grantItems(tx, playerId, chest.items);

        const [opened] = await tx<ChestSelectionRow>(MARK_OPENED, [row.id, index]);
        if (!opened) throw new Error("Chest selection update returned nothing");
        badgesChanged(tx, [playerId]);
        return toSelectionView(opened);
    });
}

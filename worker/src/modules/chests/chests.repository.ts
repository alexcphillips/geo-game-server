import type { GeoChestSelection, GeoChestSource, GeoChestsResponse } from "@geo/shared";
import type { RolledChest } from "../../../../server/src/combat/combatants";
import { AppError } from "../../../../server/src/http/AppError";
import type { World } from "../../app";
import type { Db } from "../../db/db";
import * as playerRepository from "../player/player.repository";
import { COUNT_PENDING, FIND_HISTORY, FIND_PENDING, FIND_SELECTION, INSERT_SELECTION, MARK_OPENED } from "./chests.sql.ts";
import type { ChestSelectionRecord } from "./chests.types";

/** Chests won and waiting to be opened, from server/src/modules/chests/geo-chests.repository.ts. */

const iso = (ms: number) => new Date(ms).toISOString();

/** A selection as the app sees it: closed chests show only tier and cost. */
export function toSelectionView(row: ChestSelectionRecord): GeoChestSelection {
    const chests = JSON.parse(row.chests) as RolledChest[];
    const openedChest = row.opened_index === null ? undefined : chests[row.opened_index];
    return {
        id: row.id,
        source: { kind: row.source_kind, name: row.source_name },
        createdAt: iso(row.created_at),
        chests: chests.map(({ tier, name, cost }) => ({ tier, name, cost })),
        opened:
            openedChest && row.opened_index !== null && row.opened_at !== null
                ? { index: row.opened_index, items: openedChest.items, openedAt: iso(row.opened_at) }
                : null,
    };
}

/** Saves chests just won, pending until one is opened. In the win's own transaction. */
export function createSelection(
    world: World,
    playerId: string,
    source: GeoChestSource,
    runId: string | null,
    chests: RolledChest[],
): ChestSelectionRecord {
    const row = world.db.one<ChestSelectionRecord>(
        INSERT_SELECTION,
        crypto.randomUUID(),
        playerId,
        source.kind,
        source.name,
        runId,
        JSON.stringify(chests),
        Date.now(),
    );
    if (!row) throw new Error("Chest selection insert returned nothing");
    world.db.afterCommit(() => world.hub.badgesChanged([playerId]));
    return row;
}

export function countPending(db: Db, playerId: string): number {
    return db.one<{ count: number }>(COUNT_PENDING, playerId)?.count ?? 0;
}

export function listChests(db: Db, playerId: string): GeoChestsResponse {
    return {
        pending: db.all<ChestSelectionRecord>(FIND_PENDING, playerId).map(toSelectionView),
        history: db.all<ChestSelectionRecord>(FIND_HISTORY, playerId).map(toSelectionView),
    };
}

/**
 * Opens one chest of a pending selection: its cost is taken first, then what
 * was rolled into it is handed over, and the rest of the selection is gone.
 * The caller runs it in one transaction, so it's all or nothing. (Once the
 * inventory has a size, a full one will refuse here, leaving them pending.)
 */
export function openChest(world: World, playerId: string, selectionId: string, index: number): GeoChestSelection {
    const { db } = world;
    const row = db.one<ChestSelectionRecord>(FIND_SELECTION, selectionId, playerId);
    if (!row) throw AppError.notFound("Chests not found");
    if (row.opened_at !== null) throw AppError.badRequest("You've already opened a chest from these");
    const chest = (JSON.parse(row.chests) as RolledChest[])[index];
    if (!chest) throw AppError.badRequest("No such chest");

    playerRepository.spendCoins(db, playerId, chest.cost, "chest-open", `chests:${row.id}:${chest.tier}`);
    playerRepository.grantItems(db, playerId, chest.items);
    const opened = db.one<ChestSelectionRecord>(MARK_OPENED, index, Date.now(), row.id);
    if (!opened) throw new Error("Chest selection update returned nothing");
    db.afterCommit(() => world.hub.badgesChanged([playerId]));
    return toSelectionView(opened);
}

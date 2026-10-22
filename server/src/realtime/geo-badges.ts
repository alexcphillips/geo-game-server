import type { GeoBadges } from "@geo/shared";
import { afterCommit, type TxQuery } from "../db/transaction";
import * as socketHub from "./geo-socket-hub";

/**
 * The HUD's badge counts, pushed over the geo socket: on connect and
 * whenever something changes one (a friend request, mail, chests). Whoever
 * changes a count calls `badgesChanged`; the counting itself is handed in
 * by the friends module (`setBadgeCounter`), so the inbox and chests can
 * call this without importing each other.
 */

let countBadges: ((playerId: string) => Promise<GeoBadges>) | null = null;

export function setBadgeCounter(counter: (playerId: string) => Promise<GeoBadges>) {
    countBadges = counter;
}

/** Sends the player their counts, read now, if they have a socket here. In order: an older count never lands last. */
export function pushBadges(playerId: string): void {
    const counter = countBadges;
    if (!counter) return;
    socketHub.pushFresh(playerId, "badges", async () => ({ type: "badges", badges: await counter(playerId) }));
}

/** Several changes in the same instant (a run of mail) push once. */
const COALESCE_MS = 250;
const pending = new Set<string>();

function schedule(playerId: string) {
    if (pending.has(playerId) || !socketHub.isConnected(playerId)) return;
    pending.add(playerId);
    setTimeout(() => {
        pending.delete(playerId);
        pushBadges(playerId);
    }, COALESCE_MS).unref();
}

/**
 * Once `tx` commits, sends fresh counts to each of `playerIds`, or to
 * everyone connected for `"everyone"` (an announcement). Dropped on a rollback.
 */
export function badgesChanged(tx: TxQuery, playerIds: string[] | "everyone") {
    afterCommit(tx, () => {
        for (const id of playerIds === "everyone" ? socketHub.connectedPlayers() : playerIds) schedule(id);
    });
}

import {
    GEO_FRIENDS_MAX,
    type GeoActivity,
    type GeoBadges,
    type GeoFriend,
    type GeoFriendRequest,
    type GeoFriendsResponse,
    type GeoSendFriendResponse,
} from "@geo/shared";
import { query } from "../../db";
import { AppError } from "../../http/AppError";
import { afterCommit, withTransaction, type TxQuery } from "../../db/transaction";
import { badgesChanged, setBadgeCounter } from "../../realtime/geo-badges";
import * as socketHub from "../../realtime/geo-socket-hub";
import { countPending } from "../chests/geo-chests.repository";
import { countUnread } from "../inbox/geo-inbox.repository";
import {
    ACCEPT_REQUEST,
    COUNT_INCOMING,
    COUNT_RELATIONS,
    DELETE_FRIEND,
    DELETE_REQUEST,
    FIND_FRIEND_IDS,
    FIND_FRIENDS,
    FIND_PAIR_FOR_UPDATE,
    FIND_PLAYER_BY_NAME,
    FIND_REQUESTS,
    INSERT_REQUEST,
    RESET_PRESENCE,
    SET_ACTIVITY,
    SET_OFFLINE,
    SET_ONLINE,
} from "./geo-friends.sql";
import type { ChangedPairRow, FriendRow, PairRow, RequestRow } from "./geo-friends.types";

function toFriend(row: FriendRow): GeoFriend {
    return {
        playerId: row.id,
        name: row.name,
        status: row.activity
            ? { online: true, activity: row.activity, skill: row.activity_skill }
            : { online: false },
        since: row.accepted_at.toISOString(),
    };
}

function toRequest(row: RequestRow): GeoFriendRequest {
    return { id: row.id, playerId: row.player_id, name: row.name, createdAt: row.created_at.toISOString() };
}

export async function findFriends(playerId: string): Promise<GeoFriendsResponse> {
    const [friendRows, requestRows] = await Promise.all([
        query<FriendRow>(FIND_FRIENDS, [playerId]),
        query<RequestRow>(FIND_REQUESTS, [playerId]),
    ]);
    const friends = friendRows
        .map(toFriend)
        .sort((a, b) => Number(b.status.online) - Number(a.status.online) || a.name.localeCompare(b.name));
    return {
        friends,
        incoming: requestRows.filter((row) => !row.outgoing).map(toRequest),
        outgoing: requestRows.filter((row) => row.outgoing).map(toRequest),
    };
}

/**
 * Asks `username` to be friends. If they already asked, this accepts theirs
 * instead, so two players asking each other end up friends, not stuck.
 */
export async function sendRequest(playerId: string, username: string): Promise<GeoSendFriendResponse> {
    return withTransaction(async (tx) => {
        const [target] = await tx<{ id: string; name: string }>(FIND_PLAYER_BY_NAME, [username]);
        if (!target) throw AppError.notFound(`No player called "${username}"`);
        if (target.id === playerId) throw AppError.badRequest("You can't add yourself");

        const [pair] = await tx<PairRow>(FIND_PAIR_FOR_UPDATE, [playerId, target.id]);
        if (pair?.status === "accepted") throw AppError.badRequest(`You and ${target.name} are already friends`);
        if (pair && pair.requester_id === playerId) throw AppError.badRequest(`You already asked ${target.name}`);
        if (pair) {
            const [accepted] = await tx<ChangedPairRow>(ACCEPT_REQUEST, [pair.id, playerId]);
            if (accepted) pairChanged(tx, accepted);
            return { result: "accepted" };
        }

        for (const [id, whose] of [
            [playerId, "You have"],
            [target.id, `${target.name} has`],
        ] as const) {
            const [row] = await tx<{ count: string }>(COUNT_RELATIONS, [id]);
            if (Number(row?.count ?? 0) >= GEO_FRIENDS_MAX) {
                throw AppError.badRequest(`${whose} as many friends and requests as allowed (${GEO_FRIENDS_MAX})`);
            }
        }

        const inserted = await tx(INSERT_REQUEST, [playerId, target.id]);
        // Lost a race with a request between the same two players.
        if (inserted.length === 0) throw AppError.badRequest(`There's already a request between you and ${target.name}`);
        pairChanged(tx, { requester_id: playerId, addressee_id: target.id });
        return { result: "sent" };
    });
}

/** False if there's no such request for this player to accept. */
export async function acceptRequest(playerId: string, requestId: string): Promise<boolean> {
    return changePair(await query<ChangedPairRow>(ACCEPT_REQUEST, [requestId, playerId]));
}

/** Declines (addressee) or cancels (requester). False if there's no such request. */
export async function deleteRequest(playerId: string, requestId: string): Promise<boolean> {
    return changePair(await query<ChangedPairRow>(DELETE_REQUEST, [requestId, playerId]));
}

/** False if they weren't friends. */
export async function deleteFriend(playerId: string, friendId: string): Promise<boolean> {
    return changePair(await query<ChangedPairRow>(DELETE_FRIEND, [playerId, friendId]));
}

function changePair([row]: ChangedPairRow[]): boolean {
    if (row) pairChanged(query, row);
    return Boolean(row);
}

/**
 * A request or friendship between two players changed: once `tx` commits,
 * both lists are stale, and the addressee's request badge may have moved.
 */
function pairChanged(tx: TxQuery, pair: Pick<ChangedPairRow, "requester_id" | "addressee_id">) {
    afterCommit(tx, () => {
        for (const id of [pair.requester_id, pair.addressee_id]) socketHub.publish(id, { type: "changed", topic: "friends" });
    });
    badgesChanged(tx, [pair.addressee_id]);
}

// ---------------------------------------------------------------------------
// Presence: online while the player has a geo socket open.

/**
 * Presence writes for one player run in order, so a quick drop and
 * reconnect (or an activity report as the socket closes) can't land
 * backwards and leave them wrongly on- or offline.
 */
const presenceQueue = new Map<string, Promise<void>>();

function inOrder(playerId: string, work: () => Promise<void>) {
    const next = (presenceQueue.get(playerId) ?? Promise.resolve())
        .then(work)
        .catch((error: unknown) => console.error("geo: presence update failed", error));
    presenceQueue.set(playerId, next);
    void next.finally(() => {
        if (presenceQueue.get(playerId) === next) presenceQueue.delete(playerId);
    });
}

/** Friends with their list open read it again. */
async function tellFriends(playerId: string) {
    for (const { id } of await query<{ id: string }>(FIND_FRIEND_IDS, [playerId])) {
        socketHub.publish(id, { type: "changed", topic: "friends" });
    }
}

/** What the player is doing now, from their app. Ignored without a socket: they're offline. */
export function reportActivity(playerId: string, activity: GeoActivity, skill: string | null) {
    inOrder(playerId, async () => {
        if (!socketHub.isConnected(playerId)) return;
        await query(SET_ACTIVITY, [playerId, activity, skill]);
        await tellFriends(playerId);
    });
}

socketHub.onOnline((playerId) =>
    inOrder(playerId, async () => {
        // Gone again before this ran: the offline write queued after it covers it.
        if (!socketHub.isConnected(playerId)) return;
        await query(SET_ONLINE, [playerId]);
        await tellFriends(playerId);
    }),
);

socketHub.onOffline((playerId) =>
    inOrder(playerId, async () => {
        // Back again before this ran: the online write queued after it covers it.
        if (socketHub.isConnected(playerId)) return;
        await query(SET_OFFLINE, [playerId]);
        await tellFriends(playerId);
    }),
);

/** At boot: nobody has a socket yet, so nobody is online (a crash can leave rows saying otherwise). */
export async function resetPresence(): Promise<void> {
    await query(RESET_PRESENCE);
}

// ---------------------------------------------------------------------------
// Badges

async function countBadges(playerId: string): Promise<GeoBadges> {
    const [[incoming], unreadInbox, pendingChests] = await Promise.all([
        query<{ count: string }>(COUNT_INCOMING, [playerId]),
        countUnread(playerId),
        countPending(playerId),
    ]);
    return { incomingRequests: Number(incoming?.count ?? 0), unreadInbox, pendingChests };
}

setBadgeCounter(countBadges);

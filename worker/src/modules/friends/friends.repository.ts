import {
    GEO_FRIENDS_MAX,
    type GeoActivity,
    type GeoBadges,
    type GeoFriend,
    type GeoFriendRequest,
    type GeoFriendsResponse,
    type GeoSendFriendResponse,
} from "@geo/shared";
import { AppError } from "../../../../server/src/http/AppError";
import type { World } from "../../app";
import type { Db } from "../../db/db";
import { countPending } from "../chests/chests.repository";
import { countUnread } from "../inbox/inbox.repository";
import {
    ACCEPT_REQUEST,
    COUNT_INCOMING,
    COUNT_RELATIONS,
    DELETE_FRIEND,
    DELETE_REQUEST,
    FIND_FRIEND_IDS,
    FIND_FRIENDS,
    FIND_PAIR,
    FIND_PLAYER_BY_NAME,
    FIND_REQUESTS,
    INSERT_REQUEST,
} from "./friends.sql.ts";
import type { ChangedPairRecord, FriendRecord, PairRecord, RequestRecord } from "./friends.types";

/**
 * Friends and requests, from server/src/modules/friends/geo-friends.repository.ts.
 * Presence is World memory, not rows: online while the hub has a socket for
 * them (session 5), doing what their app last reported; last seen is when
 * they were last heard from.
 */

const iso = (ms: number) => new Date(ms).toISOString();

function toFriend(world: World, row: FriendRecord): GeoFriend {
    const doing = world.hub.isConnected(row.id) ? world.presence.get(row.id) : undefined;
    const lastSeen = world.lastHeard.get(row.id);
    return {
        playerId: row.id,
        name: row.name,
        status: doing
            ? { online: true, activity: doing.activity, skill: doing.skill }
            : { online: false, lastSeenAt: lastSeen === undefined ? null : iso(lastSeen) },
        since: iso(row.accepted_at),
    };
}

function toRequest(row: RequestRecord): GeoFriendRequest {
    return { id: row.id, playerId: row.player_id, name: row.name, createdAt: iso(row.created_at) };
}

export function findFriends(world: World, playerId: string): GeoFriendsResponse {
    const friends = world.db
        .all<FriendRecord>(FIND_FRIENDS, playerId)
        .map((row) => toFriend(world, row))
        .sort((a, b) => Number(b.status.online) - Number(a.status.online) || a.name.localeCompare(b.name));
    const requests = world.db.all<RequestRecord>(FIND_REQUESTS, playerId);
    return {
        friends,
        incoming: requests.filter((row) => !row.outgoing).map(toRequest),
        outgoing: requests.filter((row) => row.outgoing).map(toRequest),
    };
}

/**
 * Asks `username` to be friends. If they already asked, this accepts theirs
 * instead, so two players asking each other end up friends, not stuck.
 */
export function sendRequest(world: World, playerId: string, username: string): GeoSendFriendResponse {
    const { db } = world;
    const target = db.one<{ id: string; name: string }>(FIND_PLAYER_BY_NAME, username);
    if (!target) throw AppError.notFound(`No player called "${username}"`);
    if (target.id === playerId) throw AppError.badRequest("You can't add yourself");

    const pair = db.one<PairRecord>(FIND_PAIR, playerId, target.id);
    if (pair?.status === "accepted") throw AppError.badRequest(`You and ${target.name} are already friends`);
    if (pair && pair.requester_id === playerId) throw AppError.badRequest(`You already asked ${target.name}`);
    if (pair) {
        const accepted = db.one<ChangedPairRecord>(ACCEPT_REQUEST, pair.id, playerId, Date.now());
        if (accepted) pairChanged(world, accepted);
        return { result: "accepted" };
    }

    for (const [id, whose] of [
        [playerId, "You have"],
        [target.id, `${target.name} has`],
    ] as const) {
        if ((db.one<{ count: number }>(COUNT_RELATIONS, id)?.count ?? 0) >= GEO_FRIENDS_MAX) {
            throw AppError.badRequest(`${whose} as many friends and requests as allowed (${GEO_FRIENDS_MAX})`);
        }
    }

    db.run(INSERT_REQUEST, crypto.randomUUID(), playerId, target.id, Date.now());
    pairChanged(world, { requester_id: playerId, addressee_id: target.id });
    return { result: "sent" };
}

/** False if there's no such request for this player to accept. */
export function acceptRequest(world: World, playerId: string, requestId: string): boolean {
    return changePair(world, world.db.one<ChangedPairRecord>(ACCEPT_REQUEST, requestId, playerId, Date.now()));
}

/** Declines (addressee) or cancels (requester). False if there's no such request. */
export function deleteRequest(world: World, playerId: string, requestId: string): boolean {
    return changePair(world, world.db.one<ChangedPairRecord>(DELETE_REQUEST, requestId, playerId));
}

/** False if they weren't friends. */
export function deleteFriend(world: World, playerId: string, friendId: string): boolean {
    return changePair(world, world.db.one<ChangedPairRecord>(DELETE_FRIEND, playerId, friendId));
}

function changePair(world: World, row: ChangedPairRecord | undefined): boolean {
    if (row) pairChanged(world, row);
    return Boolean(row);
}

/**
 * A request or friendship between two players changed: once committed,
 * both lists are stale, and the addressee's request badge may have moved.
 */
function pairChanged(world: World, pair: Pick<ChangedPairRecord, "requester_id" | "addressee_id">) {
    world.db.afterCommit(() => {
        for (const id of [pair.requester_id, pair.addressee_id]) world.hub.publish(id, { type: "changed", topic: "friends" });
        world.hub.badgesChanged([pair.addressee_id]);
    });
}

/** Friends with their list open read it again. */
export function tellFriends(world: World, playerId: string) {
    for (const { id } of world.db.all<{ id: string }>(FIND_FRIEND_IDS, playerId)) {
        world.hub.publish(id, { type: "changed", topic: "friends" });
    }
}

/** What the player is doing now, from their app: World memory, no write. Ignored without a socket: they're offline. */
export function reportActivity(world: World, playerId: string, activity: GeoActivity, skill: string | null) {
    if (!world.hub.isConnected(playerId)) return;
    world.presence.set(playerId, { activity, skill });
    tellFriends(world, playerId);
}

/** The HUD's badge counts, for the socket's pushes (session 5). */
export function countBadges(db: Db, playerId: string): GeoBadges {
    return {
        incomingRequests: db.one<{ count: number }>(COUNT_INCOMING, playerId)?.count ?? 0,
        unreadInbox: countUnread(db, playerId),
        pendingChests: countPending(db, playerId),
    };
}

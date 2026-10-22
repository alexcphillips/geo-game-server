import {
    GEO_DUNGEON_HOST_AWAY_SECONDS,
    type GeoDungeon,
    type GeoDungeonLobby,
    type GeoDungeonsResponse,
    type GeoRunResponse,
    type GeoStartDungeonLobbyResponse,
} from "@geo/shared";
import { CONTENT, type DungeonDef } from "../../../../server/src/content";
import { AppError } from "../../../../server/src/http/AppError";
import { requiredLevelProblem } from "../../../../server/src/modules/dungeons/geo-dungeons.rules";
import { hasArt } from "../../../../server/src/world/spawns";
import type { World } from "../../app";
import type { Db } from "../../db/db";
import { viewFor } from "../dungeon-runs/dungeon-runs.fights";
import * as dungeonRunsRepository from "../dungeon-runs/dungeon-runs.repository";
import { findSkillLevels } from "../player/player.repository";
import * as runsRepository from "../runs/runs.repository";
import {
    CLOSE_LOBBY,
    DELETE_MEMBER,
    FIND_LOBBY,
    FIND_MEMBERS,
    FIND_PLAYER_LOBBY,
    INSERT_LOBBY,
    INSERT_MEMBER,
    LIST_OPEN_LOBBIES,
    START_LOBBY,
} from "./dungeons.sql.ts";
import type { LobbyRow, MemberRow } from "./dungeons.types";

/**
 * Dungeon lobbies, from server/src/modules/dungeons/geo-dungeons.repository.ts.
 * Each function runs inside the caller's transaction.
 */

/** Most open lobbies one `GET /geo/dungeons` lists. */
const MAX_LISTED = 100;
const HOST_AWAY_MS = GEO_DUNGEON_HOST_AWAY_SECONDS * 1000;

/** A dungeon is only offered once the app can draw its boss, as with spawns. */
function offeredDungeon(dungeonId: string): DungeonDef | undefined {
    const dungeon = CONTENT.dungeons[dungeonId];
    return dungeon && hasArt(dungeon.boss) ? dungeon : undefined;
}

function toDungeonView(dungeon: DungeonDef): GeoDungeon {
    const boss = CONTENT.enemies[dungeon.boss]!;
    return {
        id: dungeon.id,
        name: dungeon.name,
        description: dungeon.description,
        bossName: boss.name,
        bossSprite: boss.sprite,
        requiredLevel: dungeon.requiredLevel,
        maxPlayers: dungeon.maxPlayers,
    };
}

function toLobbyView(row: LobbyRow, members?: { rows: MemberRow[]; viewerId: string }): GeoDungeonLobby {
    return {
        id: row.id,
        dungeonId: row.dungeon_id,
        hostName: row.host_name,
        requiredLevel: row.required_level,
        playerCount: row.player_count,
        maxPlayers: row.max_players,
        ...(members && {
            members: members.rows.map((member) => ({
                displayName: member.display_name,
                isHost: member.player_id === row.host_id,
                isYou: member.player_id === members.viewerId,
            })),
        }),
    };
}

const combatLevelOf = (db: Db, playerId: string) => findSkillLevels(db, playerId).combat ?? 1;
const isOpen = (lobby: LobbyRow) => lobby.started_at === null && lobby.closed_at === null;

/**
 * Closes open lobbies whose host has been away GEO_DUNGEON_HOST_AWAY_SECONDS:
 * no socket, and nothing heard from them since then (making the lobby counts
 * as being heard from). Presence is World memory, so after a restart a host
 * counts from their lobby's making until their next request. Run before
 * lobbies are read, so a host who walked off doesn't strand them.
 */
function closeAbandoned(world: World, now = Date.now()) {
    for (const lobby of world.db.all<LobbyRow>(LIST_OPEN_LOBBIES, MAX_LISTED)) {
        if (world.hub.isConnected(lobby.host_id)) continue;
        if (Math.max(world.lastHeard.get(lobby.host_id) ?? 0, lobby.created_at) >= now - HOST_AWAY_MS) continue;
        world.db.run(CLOSE_LOBBY, now, lobby.id);
        pushLobby(world, lobby.id);
    }
}

/**
 * Once the transaction commits, tells everyone in the lobby how it stands:
 * their view of it while it's open, null once it's closed or started.
 * `gone`: players no longer in it (they left), who are told too.
 */
function pushLobby(world: World, lobbyId: string, gone: string[] = []) {
    world.db.afterCommit(() => {
        const members = world.db.all<MemberRow>(FIND_MEMBERS, lobbyId).map((member) => member.player_id);
        for (const playerId of new Set([...gone, ...members])) {
            if (world.hub.isConnected(playerId)) world.hub.publish(playerId, { type: "lobby", lobby: findOwnLobby(world.db, playerId) });
        }
    });
}

/** The lobby the player is in, with who's in it, or null. */
export function findOwnLobby(db: Db, playerId: string): GeoDungeonLobby | null {
    const mine = db.one<LobbyRow>(FIND_PLAYER_LOBBY, playerId);
    return mine ? toLobbyView(mine, { rows: db.all<MemberRow>(FIND_MEMBERS, mine.id), viewerId: playerId }) : null;
}

/** The lobby, read fresh; refuses one that's gone or has started. */
function findOpenLobby(db: Db, lobbyId: string): LobbyRow {
    const row = db.one<LobbyRow>(FIND_LOBBY, lobbyId);
    if (!row || row.closed_at !== null) throw AppError.notFound("That lobby is gone");
    if (!isOpen(row)) throw AppError.badRequest("That lobby has already started");
    return row;
}

/**
 * What the dungeon menu shows: every dungeon on offer, the lobbies waiting
 * to start, and the player's own lobby with who's in it.
 */
export function listDungeons(world: World, playerId: string): GeoDungeonsResponse {
    const { db } = world;
    closeAbandoned(world);
    const dungeons = Object.values(CONTENT.dungeons).flatMap((dungeon) => (offeredDungeon(dungeon.id) ? [toDungeonView(dungeon)] : []));
    const mine = db.one<LobbyRow>(FIND_PLAYER_LOBBY, playerId);
    const lobbies = db
        .all<LobbyRow>(LIST_OPEN_LOBBIES, MAX_LISTED)
        .flatMap((row) => (row.id !== mine?.id && offeredDungeon(row.dungeon_id) ? [toLobbyView(row)] : []));
    const myLobby = mine ? toLobbyView(mine, { rows: db.all<MemberRow>(FIND_MEMBERS, mine.id), viewerId: playerId }) : null;
    return { dungeons, lobbies, myLobby, combatLevel: combatLevelOf(db, playerId) };
}

/** One lobby at a time: a player must leave theirs (or have it start) before another. */
function assertNotInLobby(db: Db, playerId: string) {
    if (db.one(FIND_PLAYER_LOBBY, playerId)) throw AppError.badRequest("You're already in a lobby. Leave it first.");
}

/** Opens a lobby for a dungeon, hosted by the player; it waits until they start it. */
export function createLobby(world: World, playerId: string, dungeonId: string, requiredLevel: unknown): GeoDungeonsResponse {
    const dungeon = offeredDungeon(dungeonId);
    if (!dungeon) throw AppError.badRequest("Unknown dungeon");
    const { db } = world;
    closeAbandoned(world);
    assertNotInLobby(db, playerId);
    const problem = requiredLevelProblem(requiredLevel, dungeon.requiredLevel, combatLevelOf(db, playerId));
    if (problem) throw AppError.badRequest(problem);
    const lobbyId = crypto.randomUUID();
    const now = Date.now();
    db.run(INSERT_LOBBY, lobbyId, dungeon.id, playerId, requiredLevel as number, dungeon.maxPlayers, now);
    db.run(INSERT_MEMBER, lobbyId, playerId, now);
    pushLobby(world, lobbyId);
    return listDungeons(world, playerId);
}

export function joinLobby(world: World, playerId: string, lobbyId: string): GeoDungeonsResponse {
    const { db } = world;
    closeAbandoned(world);
    const current = db.one<LobbyRow>(FIND_PLAYER_LOBBY, playerId);
    if (current?.id === lobbyId) return listDungeons(world, playerId);
    if (current) throw AppError.badRequest("You're already in a lobby. Leave it first.");

    const lobby = findOpenLobby(db, lobbyId);
    if (lobby.player_count >= lobby.max_players) throw AppError.badRequest("That lobby is full");
    if (combatLevelOf(db, playerId) < lobby.required_level) throw AppError.badRequest(`That lobby needs combat level ${lobby.required_level}`);
    db.run(INSERT_MEMBER, lobbyId, playerId, Date.now());
    pushLobby(world, lobbyId);
    return listDungeons(world, playerId);
}

/** Leaves the lobby. The host leaving closes it for everyone. */
export function leaveLobby(world: World, playerId: string, lobbyId: string): GeoDungeonsResponse {
    const { db } = world;
    const lobby = findOpenLobby(db, lobbyId);
    if (lobby.host_id === playerId) db.run(CLOSE_LOBBY, Date.now(), lobbyId);
    else db.run(DELETE_MEMBER, lobbyId, playerId);
    pushLobby(world, lobbyId, [playerId]);
    return listDungeons(world, playerId);
}

/**
 * The host starts the lobby: everyone in it goes in at once, and the lobby is
 * done. A dungeon with layouts opens one shared map for the whole party; one
 * without is a lone boss fight, each in their own Run (made bigger by the
 * dungeon's `bossModifiers`). Everyone fights at full health, and leaves with
 * their own health as it was. A member who can't fight right now (already in
 * a Run, an empty hand…) is left out rather than holding everyone back; the
 * host can't be. Members hear over the socket: the lobby goes, the map comes.
 */
export function startLobby(world: World, playerId: string, lobbyId: string): GeoStartDungeonLobbyResponse {
    const { db } = world;
    const lobby = findOpenLobby(db, lobbyId);
    if (lobby.host_id !== playerId) throw AppError.forbidden("Only the host can start the lobby");
    const dungeon = CONTENT.dungeons[lobby.dungeon_id];
    if (!dungeon) throw AppError.badRequest("That dungeon no longer exists");
    const hasMap = dungeon.layouts.length > 0;
    // Fought at full health; each player's own health is as it was after.
    const target = { enemyId: dungeon.boss, spawnId: null, enemyModifiers: dungeon.bossModifiers, keepsHealth: true, dungeonId: dungeon.id };
    // With a map, entering is only checked here; the party's run opens once everyone's known.
    const enter = (memberId: string): GeoRunResponse | null => {
        if (!hasMap) return runsRepository.openCombatRun(world, memberId, target);
        dungeonRunsRepository.assertCanEnter(world, memberId);
        return null;
    };

    // The host first: if they can't go in, nothing starts.
    const hostsFight = enter(playerId);

    const leftOut: string[] = [];
    const leftOutIds: string[] = [];
    const members = db.all<MemberRow>(FIND_MEMBERS, lobbyId);
    for (const member of members.filter((m) => m.player_id !== playerId)) {
        try {
            // A savepoint: one who can't go in is undone alone.
            db.transaction(() => enter(member.player_id));
        } catch (error) {
            if (!(error instanceof AppError)) throw error;
            db.run(DELETE_MEMBER, lobbyId, member.player_id);
            leftOut.push(member.display_name);
            leftOutIds.push(member.player_id);
        }
    }
    db.run(START_LOBBY, Date.now(), lobbyId);
    pushLobby(world, lobbyId, leftOutIds);

    if (!hasMap) return { opened: hostsFight, dungeonRun: null, leftOut };
    const going = members.filter((member) => !leftOutIds.includes(member.player_id)).map((member) => member.player_id);
    const run = dungeonRunsRepository.openPartyRun(world, dungeon, lobbyId, going);
    return { opened: null, dungeonRun: viewFor(run, playerId), leftOut };
}

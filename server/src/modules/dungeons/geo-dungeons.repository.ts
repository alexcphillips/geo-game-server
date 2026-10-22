import {
    GEO_DUNGEON_HOST_AWAY_SECONDS,
    type GeoDungeon,
    type GeoDungeonLobby,
    type GeoDungeonsResponse,
    type GeoStartDungeonLobbyResponse,
} from "@geo/shared";
import { query } from "../../db";
import { AppError } from "../../http/AppError";
import { CONTENT, type DungeonDef } from "../../content";
import { afterCommit, withTransaction, type TxQuery } from "../../db/transaction";
import * as socketHub from "../../realtime/geo-socket-hub";
import { hasArt } from "../../world";
import { viewFor } from "../dungeon-runs/geo-dungeon-runs.fights";
import * as dungeonRunsRepository from "../dungeon-runs/geo-dungeon-runs.repository";
import * as playerRepository from "../player/geo-player.repository";
import * as runsRepository from "../runs/geo-runs.repository";
import { isOpen, requiredLevelProblem } from "./geo-dungeons.rules";
import {
    CLOSE_ABANDONED_LOBBIES,
    CLOSE_LOBBY,
    DELETE_MEMBER,
    FIND_LOBBY,
    FIND_MEMBERS,
    FIND_PLAYER_LOBBY,
    INSERT_LOBBY,
    INSERT_MEMBER,
    LIST_OPEN_LOBBIES,
    LOCK_LOBBY,
    START_LOBBY,
} from "./geo-dungeons.sql";
import type { LobbyRow, MemberRow } from "./geo-dungeons.types";

/** Most open lobbies one `GET /geo/dungeons` lists. */
const MAX_LISTED = 100;

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

async function combatLevelOf(tx: TxQuery, playerId: string): Promise<number> {
    return (await playerRepository.findSkillLevels(tx, playerId)).combat ?? 1;
}

/** Closes unstarted lobbies whose host walked off; run before reading lobbies. */
async function closeAbandoned(tx: TxQuery) {
    const closed = await tx<{ id: string }>(CLOSE_ABANDONED_LOBBIES, [GEO_DUNGEON_HOST_AWAY_SECONDS]);
    for (const { id } of closed) pushLobby(tx, id);
}

/**
 * Once `tx` commits, tells everyone in the lobby how it stands now: their
 * view of it while it's open, null once it's closed or started. `gone`:
 * players no longer in it (they left), who are told too.
 */
function pushLobby(tx: TxQuery, lobbyId: string, gone: string[] = []) {
    afterCommit(tx, async () => {
        const members = await query<MemberRow>(FIND_MEMBERS, [lobbyId]);
        for (const playerId of new Set([...gone, ...members.map((member) => member.player_id)])) pushOwnLobby(playerId);
    });
}

/**
 * Sends the player the lobby they're in, or null, read fresh. In order per
 * player (lobbies carry no version), so an older view can't land last.
 */
export function pushOwnLobby(playerId: string) {
    socketHub.pushFresh(playerId, "lobby", async () => ({ type: "lobby", lobby: await findOwnLobby(query, playerId) }));
}

export async function findOwnLobby(tx: TxQuery, playerId: string): Promise<GeoDungeonLobby | null> {
    const mine = await findPlayerLobby(tx, playerId);
    return mine ? toLobbyView(mine, { rows: await tx<MemberRow>(FIND_MEMBERS, [mine.id]), viewerId: playerId }) : null;
}

async function findPlayerLobby(tx: TxQuery, playerId: string): Promise<LobbyRow | undefined> {
    const [row] = await tx<LobbyRow>(FIND_PLAYER_LOBBY, [playerId]);
    return row;
}

/** Locks the lobby and reads it fresh; refuses one that's gone or has started. */
async function lockOpenLobby(tx: TxQuery, lobbyId: string): Promise<LobbyRow> {
    const [locked] = await tx<{ id: string }>(LOCK_LOBBY, [lobbyId]);
    const [row] = locked ? await tx<LobbyRow>(FIND_LOBBY, [lobbyId]) : [];
    if (!row || row.closed_at) throw AppError.notFound("That lobby is gone");
    if (!isOpen(row)) throw AppError.badRequest("That lobby has already started");
    return row;
}

/**
 * What the dungeon menu shows: every dungeon on offer, the lobbies waiting
 * to start, and the player's own lobby with who's in it.
 */
export async function listDungeons(tx: TxQuery, playerId: string): Promise<GeoDungeonsResponse> {
    await closeAbandoned(tx);
    const dungeons = Object.values(CONTENT.dungeons).flatMap((dungeon) =>
        offeredDungeon(dungeon.id) ? [toDungeonView(dungeon)] : [],
    );
    const mine = await findPlayerLobby(tx, playerId);
    const open = await tx<LobbyRow>(LIST_OPEN_LOBBIES, [MAX_LISTED]);
    const lobbies = open.flatMap((row) =>
        row.id !== mine?.id && offeredDungeon(row.dungeon_id) ? [toLobbyView(row)] : [],
    );
    const myLobby = mine ? toLobbyView(mine, { rows: await tx<MemberRow>(FIND_MEMBERS, [mine.id]), viewerId: playerId }) : null;
    return { dungeons, lobbies, myLobby, combatLevel: await combatLevelOf(tx, playerId) };
}

/** One lobby at a time: a player must leave theirs (or have it start) before another. */
async function assertNotInLobby(tx: TxQuery, playerId: string) {
    if (await findPlayerLobby(tx, playerId)) throw AppError.badRequest("You're already in a lobby. Leave it first.");
}

/** Opens a lobby for a dungeon, hosted by the player; it waits until they start it. */
export async function createLobby(playerId: string, dungeonId: string, requiredLevel: unknown): Promise<GeoDungeonsResponse> {
    const dungeon = offeredDungeon(dungeonId);
    if (!dungeon) throw AppError.badRequest("Unknown dungeon");
    return withTransaction(async (tx) => {
        await playerRepository.lockPlayer(tx, playerId);
        await closeAbandoned(tx);
        await assertNotInLobby(tx, playerId);
        const problem = requiredLevelProblem(requiredLevel, dungeon.requiredLevel, await combatLevelOf(tx, playerId));
        if (problem) throw AppError.badRequest(problem);
        const [lobby] = await tx<{ id: string }>(INSERT_LOBBY, [
            dungeon.id,
            playerId,
            requiredLevel,
            dungeon.maxPlayers,
        ]);
        await tx(INSERT_MEMBER, [lobby!.id, playerId]);
        pushLobby(tx, lobby!.id);
        return listDungeons(tx, playerId);
    });
}

export async function joinLobby(playerId: string, lobbyId: string): Promise<GeoDungeonsResponse> {
    return withTransaction(async (tx) => {
        await playerRepository.lockPlayer(tx, playerId);
        await closeAbandoned(tx);
        const current = await findPlayerLobby(tx, playerId);
        if (current?.id === lobbyId) return listDungeons(tx, playerId);
        if (current) throw AppError.badRequest("You're already in a lobby. Leave it first.");

        const lobby = await lockOpenLobby(tx, lobbyId);
        if (lobby.player_count >= lobby.max_players) throw AppError.badRequest("That lobby is full");
        if ((await combatLevelOf(tx, playerId)) < lobby.required_level) {
            throw AppError.badRequest(`That lobby needs combat level ${lobby.required_level}`);
        }
        await tx(INSERT_MEMBER, [lobbyId, playerId]);
        pushLobby(tx, lobbyId);
        return listDungeons(tx, playerId);
    });
}

/** Leaves the lobby. The host leaving closes it for everyone. */
export async function leaveLobby(playerId: string, lobbyId: string): Promise<GeoDungeonsResponse> {
    return withTransaction(async (tx) => {
        const lobby = await lockOpenLobby(tx, lobbyId);
        if (lobby.host_id === playerId) await tx(CLOSE_LOBBY, [lobbyId]);
        else await tx(DELETE_MEMBER, [lobbyId, playerId]);
        pushLobby(tx, lobbyId, [playerId]);
        return listDungeons(tx, playerId);
    });
}

/**
 * The host starts the lobby: everyone in it goes in at once, and the lobby is
 * done. A dungeon with layouts opens one shared map for the whole party; one
 * without is a lone boss fight, each in their own Run (made bigger by the
 * dungeon's `bossModifiers`). Everyone fights at full health, and leaves with
 * their own health as it was. A member who can't fight right now (already in
 * a Run, an empty hand…) is left out rather than holding everyone back; the
 * host can't be. Members hear over the socket: the lobby goes, the map comes.
 *
 * Locks the lobby, then each member, as a join does them the other way round
 * only for a lobby the joiner isn't in yet, so the two can't deadlock.
 */
export async function startLobby(playerId: string, lobbyId: string): Promise<GeoStartDungeonLobbyResponse> {
    return withTransaction(async (tx) => {
        const lobby = await lockOpenLobby(tx, lobbyId);
        if (lobby.host_id !== playerId) throw AppError.forbidden("Only the host can start the lobby");
        const dungeon = CONTENT.dungeons[lobby.dungeon_id];
        if (!dungeon) throw AppError.badRequest("That dungeon no longer exists");
        const hasMap = dungeon.layouts.length > 0;
        // Fought at full health; each player's own health is as it was after.
        const target = {
            enemyId: dungeon.boss,
            spawnId: null,
            enemyModifiers: dungeon.bossModifiers,
            keepsHealth: true,
            dungeonId: dungeon.id,
        };
        // With a map, entering is only checked here; the party's run opens once everyone's known.
        const enter = (memberId: string) =>
            hasMap ? dungeonRunsRepository.assertCanEnter(tx, memberId).then(() => null) : runsRepository.openCombatRun(tx, memberId, target);

        // The host first: if they can't go in, nothing starts.
        await playerRepository.lockPlayer(tx, playerId);
        const hostsFight = await enter(playerId);

        const leftOut: string[] = [];
        const leftOutIds: string[] = [];
        const members = await tx<MemberRow>(FIND_MEMBERS, [lobbyId]);
        const others = members.filter((member) => member.player_id !== playerId);
        for (const member of [...others].sort((a, b) => a.player_id.localeCompare(b.player_id))) {
            await playerRepository.lockPlayer(tx, member.player_id);
            // A savepoint per member, so one who can't go in is undone alone.
            await tx("SAVEPOINT dungeon_member");
            try {
                await enter(member.player_id);
                await tx("RELEASE SAVEPOINT dungeon_member");
            } catch (error) {
                if (!(error instanceof AppError)) throw error;
                await tx("ROLLBACK TO SAVEPOINT dungeon_member");
                await tx(DELETE_MEMBER, [lobbyId, member.player_id]);
                leftOut.push(member.display_name);
                leftOutIds.push(member.player_id);
            }
        }
        await tx(START_LOBBY, [lobbyId]);
        pushLobby(tx, lobbyId, leftOutIds);

        if (!hasMap) return { opened: hostsFight, dungeonRun: null, leftOut };
        const going = members.filter((member) => !leftOutIds.includes(member.player_id)).map((member) => member.player_id);
        const run = await dungeonRunsRepository.openPartyRun(tx, dungeon, lobbyId, going);
        return { opened: null, dungeonRun: viewFor(run, playerId), leftOut };
    });
}

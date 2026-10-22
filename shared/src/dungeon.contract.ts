/**
 * Dungeons: raid-style boss fights, gathered for in lobbies.
 *
 * A POI is a lobby entrance. Every POI opens the same worldwide list of open
 * lobbies, so a lobby never says where anyone is. Creating or joining one
 * needs you at a POI; once in, you can walk off and still be taken along.
 *
 * A lobby has no countdown: it waits until the host starts it, and starting
 * takes everyone in at once. A host who walks off and closes the app doesn't
 * leave it up forever: it closes once they've been gone
 * GEO_DUNGEON_HOST_AWAY_SECONDS. A dungeon with a map gives the party one
 * shared map (see "Dungeon runs" below); one without is a lone boss fight in
 * a solo Run. Either way it's fought
 * at full health and leaves the player's own health (GeoHealth) as it was,
 * win or lose; food eaten still counts, and a defeat costs no coins.
 */
import type { GeoChestTier } from "./chest.contract";
import type { GeoPoint } from "./distance";
import type { GeoRunResponse } from "./run.contract";

/**
 * PLACEHOLDER: an unstarted lobby closes once its host has been offline (no
 * geo socket) for this long.
 */
export const GEO_DUNGEON_HOST_AWAY_SECONDS = 600;

/** A dungeon as the lobby menu shows it: one per kind of dungeon. */
export type GeoDungeon = {
    id: string;
    name: string;
    description: string;
    /** The boss's name and the app's sprite for it. */
    bossName: string;
    bossSprite: string;
    /** The combat level needed to make or join a lobby for it; 0 = none. */
    requiredLevel: number;
    maxPlayers: number;
};

export type GeoDungeonLobbyMember = {
    displayName: string;
    isHost: boolean;
    /** The player asking. */
    isYou: boolean;
};

/** A lobby waiting for its host to start it. Started lobbies are gone from the menu. */
export type GeoDungeonLobby = {
    id: string;
    dungeonId: string;
    hostName: string;
    /** The combat level needed to join: the dungeon's, or more if the host asked. */
    requiredLevel: number;
    playerCount: number;
    maxPlayers: number;
    /** Only filled in for the player's own lobby. */
    members?: GeoDungeonLobbyMember[];
};

/**
 * `GET /geo/dungeons`: every dungeon, the open lobbies (newest first,
 * the player's own left out), and the player's own lobby, if any.
 */
export type GeoDungeonsResponse = {
    dungeons: GeoDungeon[];
    lobbies: GeoDungeonLobby[];
    myLobby: GeoDungeonLobby | null;
    /** The player's combat level, for "can I join this". */
    combatLevel: number;
};

/**
 * Proof the player is at a POI: where they are, and the POI's marker. The
 * server checks the two are within GEO_PLACE_REACH_METRES.
 */
export type GeoDungeonEntrance = {
    position: GeoPoint;
    place: GeoPoint;
};

/** `POST /geo/dungeons/lobbies`: replies 201 with the new lobby as `myLobby`. */
export type GeoCreateDungeonLobbyRequest = GeoDungeonEntrance & {
    dungeonId: string;
    /** From the dungeon's requiredLevel up to the host's own combat level. */
    requiredLevel: number;
};

/** `POST /geo/dungeons/lobbies/:lobbyId/join`. */
export type GeoJoinDungeonLobbyRequest = GeoDungeonEntrance;

/**
 * `POST /geo/dungeons/lobbies/:lobbyId/start`, host only: everyone in the
 * lobby goes in at once, and the lobby is done. The host gets their Run back
 * to open at once; the others hear over the geo socket (their lobby goes
 * null, their dungeon run arrives).
 */
export type GeoStartDungeonLobbyResponse = {
    /** The host's boss fight, for a dungeon without a map. */
    opened: GeoRunResponse | null;
    /** The host's dungeon map, for a dungeon with one. Exactly one of the two is set. */
    dungeonRun: GeoDungeonRunView | null;
    /** Members who couldn't fight right now (already in a Run, empty hand…) and were left out. */
    leftOut: string[];
};

// ---------------------------------------------------------------------------
// Dungeon runs: a started dungeon's map, walked room by room.
//
// The server rolls one map for the whole party when the host starts the
// lobby, and is the only authority on it: the app sends what the player
// wants to do (enter a room, answer a puzzle) and gets back what they can
// see. Rooms under fog are never sent. What anyone explores, every member
// sees; fights, star and gold rooms and puzzles cleared by one are cleared
// for all, and they share one score. Loot and event rooms are each player's
// own, as is the wing behind a locked door: only whoever opened it sees in.
// The party can split up. Others' changes arrive over the geo socket
// (GeoSocketServerMessage `dungeonRun`). Room fights are ordinary combat Runs (GeoRunView.dungeonRunId),
// fought with the Run endpoints; health carries from room to room and the
// player's own health is as it was afterwards. Dying, or leaving, fails the
// dungeon: no chests, but the purse is kept. Beating the boss ends it, and
// the chests the score earned go to the Chests tab.

export type GeoDungeonRoomKind = "entrance" | "encounter" | "star" | "miniboss" | "puzzle" | "loot" | "event" | "boss" | "empty";

/** How a room's walls are drawn: from its cells and these numbers. A cell is 64 map units, with 18 between cells. */
export type GeoRoomStyle = {
    corner: "round" | "chamfer" | "circle";
    radius: number;
    /** How jagged the walls are; 0 = straight. */
    rough: number;
    wall: number;
    /** How far the walls sit inside the cells' edges. */
    inset: number;
    tone: "stone" | "moss" | "ember" | "bone" | "void";
};

export type GeoDungeonRoom = {
    id: number;
    /** The grid cells it covers, [column, row] from the top left. */
    cells: [number, number][];
    /** "miniboss" is a gold room. */
    kind: GeoDungeonRoomKind;
    name: string | null;
    /** A key of GeoDungeonRunView.styles; null = the app's default. */
    style: string | null;
    /** "visited": you've been in. "seen": next to a room you've been in (its shape and kind show), or the boss room. */
    seen: "visited" | "seen";
    /** Cleared, solved, collected or triggered, for you. Loot and events are each player's own. */
    done: boolean;
    /**
     * Someone else is fighting here, or working on its puzzle: you can't go
     * in until they're done. Their name.
     */
    busyWith: string | null;
    /** Locked, and you haven't opened it: entering uses a key from your inventory. */
    locked: boolean;
};

/** A door between two cells of different rooms, both of which you can see. */
export type GeoDungeonDoor = {
    a: [number, number];
    b: [number, number];
    rooms: [number, number];
    /** Leads into a room that's locked to you. */
    locked: boolean;
};

/** A puzzle waiting in the room you're in. One answer, one try. */
export type GeoDungeonPuzzle = {
    roomId: number;
    prompt: string;
    options: string[];
};

/** "active": still in. "won": beat the boss. "failed": out (see GeoDungeonOutReason). */
export type GeoDungeonRunStatus = "active" | "won" | "failed";

/**
 * Why a player is out: died in a fight, left, didn't reach the boss room
 * before the ready-up clock ran out, or fled the boss (no coming back).
 */
export type GeoDungeonOutReason = "died" | "left" | "missedBoss" | "fledBoss";

/**
 * The boss's ready-up. Standing in the unsealed boss room is being ready;
 * walking out un-readies. Once at least half of those still in are ready
 * (rounded up), everyone else has GEO_DUNGEON_READY_SECONDS to get there,
 * or they're out; a player in a room fight is off the clock until it ends.
 * When everyone still in is ready, the boss starts for all of them at once.
 */
export const GEO_DUNGEON_READY_SECONDS = 90;

/**
 * In a party (anyone else still in), a player with no geo socket for this
 * long stops holding things up: a room fight counts as fled, and they're
 * moved back a room from the boss room or a puzzle they were at.
 */
export const GEO_DUNGEON_RECONNECT_SECONDS = 30;

/** The ready-up as you see it; null until the boss room is open and someone's in it, and once the boss starts. */
export type GeoDungeonReadyUp = {
    /** In the boss room now, of those still in. */
    ready: number;
    total: number;
    /** How many ready start the clock on the rest. */
    needed: number;
    clockRunning: boolean;
    youAreReady: boolean;
    /** When you're out unless you're in the boss room (ISO); null if the clock isn't on you. */
    yourDeadline: string | null;
};

/** Someone in the party, as you see them. */
export type GeoDungeonPartyMember = {
    displayName: string;
    isYou: boolean;
    status: GeoDungeonRunStatus;
    outReason: GeoDungeonOutReason | null;
    /** Waiting in the boss room. */
    isReady: boolean;
    /** The ready-up clock on them (ISO); null when it isn't. */
    readyDeadline: string | null;
    /** The room they're in; null once they're out, or behind a locked door only they opened. */
    roomId: number | null;
    /** In a room fight right now. */
    isFighting: boolean;
    health: number;
    maxHealth: number;
};

export type GeoDungeonRunView = {
    id: string;
    dungeonId: string;
    dungeonName: string;
    /** Yours: you can be out while the others play on. */
    status: GeoDungeonRunStatus;
    outReason: GeoDungeonOutReason | null;
    /**
     * Goes up with every change anyone in the party makes. A view with a
     * lower version than the one you hold is older: drop it.
     */
    version: number;
    /** Everyone who went in, you included, in the order they joined the lobby. */
    party: GeoDungeonPartyMember[];
    /** The map's size in cells. */
    cols: number;
    rows: number;
    /** Only rooms you can see. */
    rooms: GeoDungeonRoom[];
    doors: GeoDungeonDoor[];
    styles: Record<string, GeoRoomStyle>;
    /** The room you're in. */
    currentRoom: number;
    /** Health inside the dungeon: full at the start, carried room to room. */
    health: number;
    maxHealth: number;
    /** Star rooms cleared, by anyone; the boss room opens when all are. */
    stars: { cleared: number; total: number };
    /** The fight going on in the room you're in; play it with the Run endpoints. */
    fightRunId: string | null;
    readyUp: GeoDungeonReadyUp | null;
    /** The boss fight has begun; nobody else can go in. */
    bossStarted: boolean;
    /** The server's clock when this was made (ISO), so a countdown on a phone set wrong still ends on time. */
    serverTime: string;
    puzzle: GeoDungeonPuzzle | null;
    /** The party's score so far, 0–100, and the chest tiers it would offer if the boss fell now. */
    score: number;
    chestTiers: GeoChestTier[];
    /** Once won: the chest selection waiting in the Chests tab. */
    chestSelectionId: string | null;
};

/** What a dungeon action did, besides the new map. */
export type GeoDungeonRunResponse = {
    dungeonRun: GeoDungeonRunView;
    /** A fight that just started in the room entered. */
    fight: GeoRunResponse | null;
    /** Items put straight into the inventory, e.g. from a loot room. */
    found: { itemId: string; quantity: number }[];
    /** Short lines for the player: "The door is sealed: 1 of 2 star rooms cleared." */
    notes: string[];
};

/** `POST /geo/dungeon-runs/:dungeonRunId/move`: walk into a room you can see. */
export type GeoDungeonMoveRequest = { roomId: number };

/** `POST /geo/dungeon-runs/:dungeonRunId/puzzle`: answer the puzzle in your room, by option index. */
export type GeoDungeonPuzzleRequest = { answer: number };

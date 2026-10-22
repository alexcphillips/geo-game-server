import type { GeoSocketServerMessage } from "@geo/shared";

/**
 * Who's connected, and pushes to them: server/src/realtime/geo-socket-hub.ts
 * and geo-badges.ts, as the Worker's modules call them.
 *
 * A stand-in until session 5 brings the World's hibernating sockets: nobody
 * is connected, so pushes go nowhere (as for a player with the app closed,
 * who reads the truth on their next request), and nobody counts as gone, so
 * a shared fight's turn clock runs its full length and a dungeon never lets
 * an offline player's hold lapse. Callers already push only after commit
 * (`db.afterCommit`), as the real hub needs.
 */
export type Hub = {
    /** Since when the player has been gone (ms), or null while they're here. */
    offlineSince(playerId: string): number | null;
    isConnected(playerId: string): boolean;
    /** Sends to every socket the player has open; nothing if none. */
    publish(playerId: string, message: GeoSocketServerMessage): void;
    /** The HUD's badge counts changed for these players (or everyone): fresh counts go out. */
    badgesChanged(playerIds: string[] | "everyone"): void;
};

export function createHub(): Hub {
    return {
        offlineSince: () => null,
        isConnected: () => false,
        publish: () => {},
        badgesChanged: () => {},
    };
}

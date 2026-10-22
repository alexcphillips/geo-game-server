import type { LobbyRow } from "./geo-dungeons.types";

/** Only open lobbies can be joined, left or started; started and closed ones are done. */
export function isOpen(lobby: Pick<LobbyRow, "started_at" | "closed_at">): boolean {
    return !lobby.started_at && !lobby.closed_at;
}

/**
 * Why a host can't make a lobby needing this combat level, or null if they
 * can: at least the dungeon's own requirement, and no more than the host's
 * level, so nobody makes a lobby they couldn't join themselves.
 */
export function requiredLevelProblem(requiredLevel: unknown, dungeonLevel: number, hostLevel: number): string | null {
    if (hostLevel < dungeonLevel) return `This dungeon needs combat level ${dungeonLevel}`;
    if (!Number.isInteger(requiredLevel)) return "requiredLevel must be a whole number";
    const level = requiredLevel as number;
    if (level < dungeonLevel) return `This dungeon needs at least combat level ${dungeonLevel}`;
    if (level > hostLevel) return "You can't ask for a higher combat level than your own";
    return null;
}

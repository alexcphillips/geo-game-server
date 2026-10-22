import { randomInt } from "node:crypto";
import { CONTENT, ELECTION_RULES } from "../../content";
import type { TallyRow } from "./geo-mayor.types";

/** Election rules with no database: when one ends, who stands, who wins. */

const DAY_MS = 86_400_000;
/** 1 Jan 2024 was a Monday. */
const MONDAY_EPOCH_MS = Date.UTC(2024, 0, 1);

/** The first Monday 00:00 UTC at least `minHours` after `now`. */
export function nextElectionEnd(now: number, minHours: number = ELECTION_RULES.minHours): Date {
    const earliest = now + minHours * 3_600_000;
    const weeks = Math.ceil((earliest - MONDAY_EPOCH_MS) / (7 * DAY_MS));
    return new Date(MONDAY_EPOCH_MS + weeks * 7 * DAY_MS);
}

/** Every mayor but the one in office, `ELECTION_RULES.candidates` of them at random. */
export function pickCandidates(incumbentId: string, pick: (n: number) => number = randomInt): string[] {
    const pool = Object.keys(CONTENT.mayors).filter((id) => id !== incumbentId);
    for (let i = pool.length - 1; i > 0; i--) {
        const j = pick(i + 1);
        [pool[i], pool[j]] = [pool[j] as string, pool[i] as string];
    }
    return pool.slice(0, ELECTION_RULES.candidates);
}

/**
 * The winner: most votes (weighted); then most voters; then whoever reached
 * their total first. With no votes at all, a candidate at random.
 */
export function pickWinner(candidateIds: string[], tally: TallyRow[], pick: (n: number) => number = randomInt): string {
    const counted = tally.filter((row) => candidateIds.includes(row.candidate_id));
    if (counted.length === 0) return candidateIds[pick(candidateIds.length)] as string;
    counted.sort(
        (a, b) =>
            Number(b.votes) - Number(a.votes) ||
            Number(b.voters) - Number(a.voters) ||
            a.last_vote_at.getTime() - b.last_vote_at.getTime(),
    );
    return (counted[0] as TallyRow).candidate_id;
}


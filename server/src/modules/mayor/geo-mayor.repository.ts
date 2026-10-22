import { GEO_ALREADY_VOTED, type GeoMayor, type GeoMayorResponse } from "@geo/shared";
import { query } from "../../db";
import { AppError } from "../../http/AppError";
import { CONTENT, type MayorDef } from "../../content";
import { afterCommit, withTransaction, type TxQuery } from "../../db/transaction";
import { broadcastChanged } from "../../realtime/geo-socket-hub";
import { applyModifiers, currentMayor, forgetMayor, playerModifiers } from "../../world/global-effects";
import {
    CLOSE_ELECTION,
    FIND_OPEN_ELECTION,
    FIND_VOTE,
    INSERT_ELECTION,
    INSERT_VOTE,
    LOCK_OPEN_ELECTION,
    SET_ENDS_AT,
    SHARE_ELECTION,
    TALLY,
} from "./geo-mayor.sql";
import { insertAnnouncement } from "../inbox/geo-inbox.repository";
import { nextElectionEnd, pickCandidates, pickWinner } from "./geo-mayor.rules";
import type { ElectionRow, TallyRow } from "./geo-mayor.types";

/**
 * Brings elections up to date: closes the open one if its time is up (its
 * winner takes office), and makes sure one is open. Run by the background
 * job and before every read, so a closed election is never shown as running.
 */
export async function advanceElections(): Promise<void> {
    await withTransaction(async (tx) => {
        const [open] = await tx<ElectionRow>(LOCK_OPEN_ELECTION);
        if (open && open.ends_at.getTime() > Date.now()) return;
        mayorChanged(tx);

        let incumbent = (await currentMayor(tx)).id;
        if (open) {
            const previous = incumbent;
            incumbent = pickWinner(open.candidate_ids, await tx<TallyRow>(TALLY, [open.id]));
            await tx(CLOSE_ELECTION, [open.id, incumbent]);
            await announceMayor(tx, incumbent, previous);
        }
        await tx(INSERT_ELECTION, [pickCandidates(incumbent), nextElectionEnd(Date.now())]);
    });
    // Outside the transaction: a rolled-back close must not clear it.
    forgetMayor();
}

/** Once `tx` commits, everyone with the election open reads it again. */
function mayorChanged(tx: TxQuery) {
    afterCommit(tx, () => broadcastChanged("mayor"));
}

/** Tells every player's inbox who won, and what their perks are. */
async function announceMayor(tx: TxQuery, winnerId: string, previousId: string) {
    const winner = CONTENT.mayors[winnerId];
    if (!winner) return;
    const perks = winner.perks.map((perk) => `• ${perk.name}: ${perk.description}`).join("\n");
    await insertAnnouncement(tx, {
        kind: "mayor",
        title: winnerId === previousId ? `${winner.name} stays mayor` : `${winner.name} is the new mayor`,
        body: perks ? `Their perks this term:\n${perks}` : "",
        version: null,
        postedBy: null,
        expiresAt: null,
    });
}

/** Only when an election might be due, so most reads cost one cheap query. */
async function advanceIfDue() {
    const [open] = await query<ElectionRow>(FIND_OPEN_ELECTION);
    if (!open || open.ends_at.getTime() <= Date.now()) await advanceElections();
}

/** What a player's vote counts for: 1, plus any `voteWeight` modifiers (e.g. a talisman). */
export async function voteWeight(playerId: string, tx: TxQuery = query): Promise<number> {
    return Math.max(1, Math.floor(applyModifiers(1, await playerModifiers(playerId, tx), "voteWeight")));
}

function toMayorView(mayor: MayorDef): GeoMayor {
    return {
        id: mayor.id,
        name: mayor.name,
        perks: mayor.perks.map((perk) => ({ id: perk.id, name: perk.name, description: perk.description, icon: perk.icon })),
    };
}

export async function findMayor(playerId: string): Promise<GeoMayorResponse> {
    await advanceIfDue();
    const [election] = await query<ElectionRow>(FIND_OPEN_ELECTION);
    if (!election) throw new Error("No open election after advancing");

    const [mayor, tally, [vote], weight] = await Promise.all([
        currentMayor(),
        query<TallyRow>(TALLY, [election.id]),
        query<{ candidate_id: string; weight: number }>(FIND_VOTE, [election.id, playerId]),
        voteWeight(playerId),
    ]);

    return {
        mayor: toMayorView(mayor),
        election: {
            id: election.id,
            startsAt: election.starts_at.toISOString(),
            endsAt: election.ends_at.toISOString(),
            candidates: election.candidate_ids.flatMap((id) => {
                const candidate = CONTENT.mayors[id];
                if (!candidate) return [];
                const votes = Number(tally.find((row) => row.candidate_id === id)?.votes ?? 0);
                return [{ ...toMayorView(candidate), votes }];
            }),
            yourVote: vote ? { candidateId: vote.candidate_id, weight: vote.weight } : null,
            yourVoteWeight: weight,
        },
        serverTime: new Date().toISOString(),
    };
}

/** One vote per player per election, final. Its weight is fixed when cast. */
export async function castVote(playerId: string, electionId: string, candidateId: string): Promise<void> {
    await advanceIfDue();
    await withTransaction(async (tx) => {
        const [election] = await tx<ElectionRow>(SHARE_ELECTION, [electionId]);
        if (!election) throw AppError.notFound("No such election");
        if (election.status !== "open" || election.ends_at.getTime() <= Date.now()) {
            throw AppError.badRequest("That election has closed");
        }
        if (!election.candidate_ids.includes(candidateId)) throw AppError.badRequest("That mayor isn't standing");

        const weight = await voteWeight(playerId, tx);
        const [cast] = await tx(INSERT_VOTE, [electionId, playerId, candidateId, weight]);
        if (!cast) throw new AppError(409, GEO_ALREADY_VOTED);
        mayorChanged(tx);
    });
}

/** Admin: ends the running election now; its winner takes office. */
export async function endElectionNow(): Promise<void> {
    await advanceIfDue();
    await withTransaction(async (tx) => {
        const [open] = await tx<ElectionRow>(LOCK_OPEN_ELECTION);
        if (open) await tx(SET_ENDS_AT, [open.id, new Date()]);
    });
    await advanceElections();
}

/** Admin: moves the running election's end. Returns the election's id. */
export async function setElectionEnd(endsAt: Date): Promise<string> {
    await advanceIfDue();
    return withTransaction(async (tx) => {
        const [open] = await tx<ElectionRow>(LOCK_OPEN_ELECTION);
        if (!open) throw AppError.notFound("No election is running");
        await tx(SET_ENDS_AT, [open.id, endsAt]);
        mayorChanged(tx);
        return open.id;
    });
}

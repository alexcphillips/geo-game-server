import { GEO_ALREADY_VOTED, type GeoMayor, type GeoMayorResponse } from "@geo/shared";
import { CONTENT, type MayorDef } from "../../../../server/src/content";
import { applyModifiers } from "../../../../server/src/engine/stats";
import type { StatModifier } from "../../../../server/src/engine/engine.types";
import { AppError } from "../../../../server/src/http/AppError";
import { nextElectionEnd, pickCandidates, pickWinner } from "../../../../server/src/modules/mayor/geo-mayor.rules";
import type { TallyRow } from "../../../../server/src/modules/mayor/geo-mayor.types";
import { mayorModifiers, mayorOf } from "../../../../server/src/world/modifiers";
import type { World } from "../../app";
import type { Db } from "../../db/db";
import { insertAnnouncement } from "../inbox/inbox.repository";
import { schedule } from "../jobs/jobs.repository";
import { playerModifiers } from "../player/player.repository";
import {
    CLOSE_ELECTION,
    CURRENT_MAYOR,
    FIND_ELECTION,
    FIND_OPEN_ELECTION,
    FIND_VOTE,
    INSERT_ELECTION,
    INSERT_VOTE,
    SET_ENDS_AT,
    TALLY,
} from "./mayor.sql.ts";
import type { ElectionRecord, TallyRecord } from "./mayor.types";

/**
 * The weekly election and the mayor in office, from
 * server/src/modules/mayor/geo-mayor.repository.ts. The open election's end
 * is the `election` row of the `due` table: the alarm closes it on time, and
 * every read closes it first if the alarm hasn't yet.
 */

const iso = (ms: number) => new Date(ms).toISOString();

/**
 * The mayor in office, or the first mayor when no election has closed. One
 * indexed row read: no cache, so a new mayor counts on the next request.
 */
export function currentMayor(db: Db): MayorDef {
    return mayorOf(db.one<{ winner_id: string }>(CURRENT_MAYOR)?.winner_id);
}

/** Every global modifier now (the mayor's perks), for any rule that reads a stat. */
export function globalModifiers(db: Db): StatModifier[] {
    return mayorModifiers(currentMayor(db));
}

const toTallyRow = (row: TallyRecord): TallyRow => ({
    candidate_id: row.candidate_id,
    votes: String(row.votes),
    voters: String(row.voters),
    last_vote_at: new Date(row.last_vote_at),
});

/** Tells everyone with the election open to read it again, once the caller's transaction commits. */
function mayorChanged(world: World) {
    world.db.afterCommit(() => world.hub.broadcastChanged("mayor"));
}

/** Tells every player's inbox who won, and what their perks are. */
function announceMayor(world: World, winnerId: string, previousId: string) {
    const winner = CONTENT.mayors[winnerId];
    if (!winner) return;
    const perks = winner.perks.map((perk) => `• ${perk.name}: ${perk.description}`).join("\n");
    insertAnnouncement(world, {
        kind: "mayor",
        title: winnerId === previousId ? `${winner.name} stays mayor` : `${winner.name} is the new mayor`,
        body: perks ? `Their perks this term:\n${perks}` : "",
        version: null,
        postedBy: null,
        expiresAt: null,
    });
}

/**
 * Brings elections up to date, in the caller's transaction: closes the open
 * one if its time is up (its winner takes office), makes sure one is open,
 * and books the `election` job for its end. The open election, after.
 */
export function advanceElections(world: World, now = Date.now()): ElectionRecord {
    const { db } = world;
    const open = db.one<ElectionRecord>(FIND_OPEN_ELECTION);
    if (open && open.ends_at > now) return open;

    let incumbent = currentMayor(db).id;
    if (open) {
        const previous = incumbent;
        const candidates = JSON.parse(open.candidate_ids) as string[];
        incumbent = pickWinner(candidates, db.all<TallyRecord>(TALLY, open.id).map(toTallyRow));
        db.run(CLOSE_ELECTION, incumbent, now, open.id);
        announceMayor(world, incumbent, previous);
    }
    const id = crypto.randomUUID();
    const endsAt = nextElectionEnd(now).getTime();
    db.run(INSERT_ELECTION, id, JSON.stringify(pickCandidates(incumbent)), now, endsAt);
    schedule(db, "election", endsAt);
    mayorChanged(world);
    return db.one<ElectionRecord>(FIND_ELECTION, id)!;
}

/** What a player's vote counts for: 1, plus any `voteWeight` modifiers (e.g. a talisman). */
export function voteWeight(db: Db, playerId: string): number {
    return Math.max(1, Math.floor(applyModifiers(1, playerModifiers(db, playerId), "voteWeight")));
}

function toMayorView(mayor: MayorDef): GeoMayor {
    return {
        id: mayor.id,
        name: mayor.name,
        perks: mayor.perks.map((perk) => ({ id: perk.id, name: perk.name, description: perk.description, icon: perk.icon })),
    };
}

/** The mayor and the running election, closing a finished one first. In a transaction: it may write. */
export function findMayor(world: World, playerId: string): GeoMayorResponse {
    const { db } = world;
    const election = advanceElections(world);
    const tally = db.all<TallyRecord>(TALLY, election.id);
    const vote = db.one<{ candidate_id: string; weight: number }>(FIND_VOTE, election.id, playerId);
    return {
        mayor: toMayorView(currentMayor(db)),
        election: {
            id: election.id,
            startsAt: iso(election.starts_at),
            endsAt: iso(election.ends_at),
            candidates: (JSON.parse(election.candidate_ids) as string[]).flatMap((id) => {
                const candidate = CONTENT.mayors[id];
                if (!candidate) return [];
                return [{ ...toMayorView(candidate), votes: tally.find((row) => row.candidate_id === id)?.votes ?? 0 }];
            }),
            yourVote: vote ? { candidateId: vote.candidate_id, weight: vote.weight } : null,
            yourVoteWeight: voteWeight(db, playerId),
        },
        serverTime: new Date().toISOString(),
    };
}

/** One vote per player per election, final. Its weight is fixed when cast. */
export function castVote(world: World, playerId: string, electionId: string, candidateId: string) {
    const { db } = world;
    advanceElections(world);
    const election = db.one<ElectionRecord>(FIND_ELECTION, electionId);
    if (!election) throw AppError.notFound("No such election");
    if (election.status !== "open") throw AppError.badRequest("That election has closed");
    if (!(JSON.parse(election.candidate_ids) as string[]).includes(candidateId)) throw AppError.badRequest("That mayor isn't standing");

    if (!db.one(INSERT_VOTE, electionId, playerId, candidateId, voteWeight(db, playerId), Date.now())) {
        throw new AppError(409, GEO_ALREADY_VOTED);
    }
    mayorChanged(world);
}

/** Admin: ends the running election now; its winner takes office. */
export function endElectionNow(world: World) {
    const now = Date.now();
    const open = advanceElections(world, now);
    world.db.run(SET_ENDS_AT, now, open.id);
    advanceElections(world, now);
}

/** Admin: moves the running election's end. Returns the election's id. */
export function setElectionEnd(world: World, endsAt: number): string {
    const open = advanceElections(world);
    world.db.run(SET_ENDS_AT, endsAt, open.id);
    schedule(world.db, "election", endsAt);
    mayorChanged(world);
    return open.id;
}

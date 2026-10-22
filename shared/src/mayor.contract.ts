/**
 * Mayors and elections. The mayor's perks are global: every player has them
 * while that mayor is in office. An election runs on a live timer; when it
 * ends, the candidate with the most votes takes office and the next opens.
 */

export type GeoMayorPerk = {
    id: string;
    name: string;
    description: string;
    /** A Game Icons name. */
    icon: string;
};

export type GeoMayor = {
    id: string;
    name: string;
    perks: GeoMayorPerk[];
};

export type GeoCandidate = GeoMayor & {
    /** Weighted: a vote worth 2 counts 2. */
    votes: number;
};

export type GeoElection = {
    id: string;
    startsAt: string;
    /** When voting closes and the winner takes office. */
    endsAt: string;
    candidates: GeoCandidate[];
    /** The viewer's vote, once cast. It can't be changed. */
    yourVote: { candidateId: string; weight: number } | null;
    /** What the viewer's vote would count for now (1, or more with a talisman). */
    yourVoteWeight: number;
};

/** `GET /geo/mayor`. */
export type GeoMayorResponse = {
    mayor: GeoMayor;
    election: GeoElection;
    /** Server time, so the app's countdown can correct for a wrong phone clock. */
    serverTime: string;
};

/** `POST /geo/elections/:electionId/votes`. Replies with `GeoMayorResponse`. */
export type GeoVoteRequest = {
    candidateId: string;
};

/** Refusal for a second vote in one election. */
export const GEO_ALREADY_VOTED = "You've already voted in this election";

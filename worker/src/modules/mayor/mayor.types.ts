/** An `elections` row as SQLite returns it. `candidate_ids`: a JSON array of mayor ids. */
export type ElectionRecord = {
    id: string;
    candidate_ids: string;
    status: "open" | "closed";
    starts_at: number;
    ends_at: number;
    winner_id: string | null;
    closed_at: number | null;
};

export type TallyRecord = { candidate_id: string; votes: number; voters: number; last_vote_at: number };

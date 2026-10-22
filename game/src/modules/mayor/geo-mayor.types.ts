export type ElectionRow = {
    id: string;
    candidate_ids: string[];
    status: "open" | "closed";
    starts_at: Date;
    ends_at: Date;
    winner_id: string | null;
    closed_at: Date | null;
};

export type TallyRow = {
    candidate_id: string;
    votes: string;
    voters: string;
    last_vote_at: Date;
};

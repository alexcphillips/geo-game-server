export type PairRecord = { id: string; requester_id: string; addressee_id: string; status: "pending" | "accepted" };

export type FriendRecord = { id: string; name: string; accepted_at: number };

/** A friendship row changed: both sides, to tell them. */
export type ChangedPairRecord = { id: string; requester_id: string; addressee_id: string };

export type RequestRecord = { id: string; outgoing: number; player_id: string; name: string; created_at: number };

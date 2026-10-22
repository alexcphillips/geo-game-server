import type { GeoActivity } from "@geo/shared";

export type PairRow = {
    id: string;
    requester_id: string;
    addressee_id: string;
    status: "pending" | "accepted";
};

export type FriendRow = {
    id: string;
    name: string;
    accepted_at: Date;
    last_seen_at: Date | null;
    activity: GeoActivity | null;
    activity_skill: string | null;
};

/** A friendship row changed: both sides, to tell them. */
export type ChangedPairRow = { id: string; requester_id: string; addressee_id: string };

export type RequestRow = {
    id: string;
    outgoing: boolean;
    player_id: string;
    name: string;
    created_at: Date;
};

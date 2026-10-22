export type SpawnRow = {
    id: string;
    enemy_id: string;
    latitude: number;
    longitude: number;
    despawns_at: Date;
    claimed_at: Date | null;
    out_of_reach_since: Date | null;
    created_at: Date;
};

export type TravelRow = {
    latitude: number;
    longitude: number;
    seen_at: Date;
    banked_metres: number;
    last_spawned_at: Date | null;
};

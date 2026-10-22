import type { GeoChestSource } from "@geo/shared";

/** A `chest_selections` row as SQLite returns it. `chests`: JSON, every chest with its contents; only the opened one's ever leave the server. */
export type ChestSelectionRecord = {
    id: string;
    player_id: string;
    source_kind: GeoChestSource["kind"];
    source_name: string;
    run_id: string | null;
    chests: string;
    opened_index: number | null;
    opened_at: number | null;
    created_at: number;
};

import type { GeoChestSource } from "@geo/shared";
import type { RolledChest } from "../../combat/combatants";

export type ChestSelectionRow = {
    id: string;
    player_id: string;
    source_kind: GeoChestSource["kind"];
    source_name: string;
    run_id: string | null;
    /** Every chest with its contents; only the opened one's ever leave the server. */
    chests: RolledChest[];
    opened_index: number | null;
    opened_at: Date | null;
    created_at: Date;
};

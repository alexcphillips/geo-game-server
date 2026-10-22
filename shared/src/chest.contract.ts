/** Chest tiers, cheapest first. What each costs is the server's content. */
export const GEO_CHEST_TIERS = ["plain", "gold", "ruby", "void"] as const;
export type GeoChestTier = (typeof GEO_CHEST_TIERS)[number];

/** A chest in a selection, closed: its contents stay on the server until it's opened. */
export type GeoChestOffer = {
    tier: GeoChestTier;
    name: string;
    /** Coins to open; 0 is free. Fixed when the chests were won. */
    cost: number;
};

/** Where a chest selection came from, e.g. the boss that was beaten. */
export type GeoChestSource = {
    kind: "combat" | "dungeon";
    /** As it was named when won. */
    name: string;
};

/**
 * Chests won together, to open one of. Pending until one is opened; the rest
 * are gone then, and what was in them is never shown.
 */
export type GeoChestSelection = {
    id: string;
    source: GeoChestSource;
    createdAt: string;
    chests: GeoChestOffer[];
    /** Null while pending. */
    opened: {
        /** Which of `chests`. */
        index: number;
        items: { itemId: string; quantity: number }[];
        openedAt: string;
    } | null;
};

/** `GET /geo/chests`: pending selections, oldest first, then recent history, newest first. */
export type GeoChestsResponse = {
    pending: GeoChestSelection[];
    history: GeoChestSelection[];
};

/** `POST /geo/chests/:selectionId/open`: opens one chest, paying its cost. */
export type GeoOpenChestRequest = {
    index: number;
};

export type GeoOpenChestResponse = {
    selection: GeoChestSelection;
};

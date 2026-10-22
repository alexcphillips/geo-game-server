/**
 * Crafting: recipes turn items into other items. Every recipe comes with the
 * content (`GeoContentResponse.recipes`), so the app can show an item's uses
 * without asking; the server re-checks everything when crafting.
 */

/** So many of one item. */
export type GeoItemAmount = {
    itemId: string;
    quantity: number;
};

/** A skill level a recipe needs, e.g. Combat 5. */
export type GeoSkillRequirement = {
    skill: string;
    level: number;
};

export type GeoRecipe = {
    id: string;
    /** Used up, per craft. Cards must be at full charge; nothing worn, bagged or in a hand counts. */
    inputs: GeoItemAmount[];
    /** Made, per craft. */
    output: GeoItemAmount;
    /** Every one must be met; none are spent. */
    skills: GeoSkillRequirement[];
    /** Where it's made: "cooking" puts it on the Cooking menu. Absent: the crafting screen. */
    station?: "cooking";
    /** Skill XP per craft. */
    xp?: { skill: string; amount: number };
};

/** `POST /geo/crafting/:recipeId`. Replies with the player (`GeoMeResponse`). */
export type GeoCraftRequest = {
    /** How many times to craft it. */
    quantity: number;
};

/** Most crafts one request may make. */
export const GEO_CRAFT_MAX_QUANTITY = 999;

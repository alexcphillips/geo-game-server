import type { CardDef, FoodDef, StatusDef } from "./engine.types";

/**
 * The content the engine looks things up in mid-battle. Passed in rather than
 * imported, so tests can run against tiny hand-made content and the engine
 * never depends on what's in the game today.
 */
export type EngineContent = {
    statuses: Record<string, StatusDef>;
    cards: Record<string, CardDef>;
    foods: Record<string, FoodDef>;
};

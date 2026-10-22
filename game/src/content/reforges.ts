import type { StatModifier } from "../engine/engine.types";
import type { GameContent, ItemDef, ReforgeDef } from "./content.types";

/**
 * Reforges: a named bonus a vendor rolls onto one copy of a weapon or piece
 * of armor (`data/reforges/`). The copy keeps its reforge id in
 * `geo.inventory.reforge`; its stats come from the reforge's modifiers for
 * the item's rarity, on top of the item's own.
 */

/** Which reforges an item can take: weapons, or armor (off hand, head, chest, hands, legs, cloak, belt). Rings, amulets, rods (main hand, no weapon) and the rest take none. */
export function reforgeTarget(item: ItemDef | undefined): "weapon" | "armor" | null {
    if (item?.kind !== "equipment") return null;
    if (item.weapon) return "weapon";
    return item.slot === "ring" || item.slot === "amulet" || item.slot === "mainHand" ? null : "armor";
}

/** Every reforge this item can take. */
export function reforgesFor(content: GameContent, item: ItemDef | undefined): ReforgeDef[] {
    const target = reforgeTarget(item);
    return target ? Object.values(content.reforges).filter((reforge) => reforge.appliesTo.includes(target)) : [];
}

/**
 * A copy's reforge modifiers. None for no reforge, a reforge since removed
 * from the content, or one that doesn't fit the item, so old saves can't break.
 */
export function reforgeModifiers(content: GameContent, itemId: string, reforgeId: string | null | undefined): StatModifier[] {
    if (!reforgeId) return [];
    const item = content.items[itemId];
    const reforge = content.reforges[reforgeId];
    const target = reforgeTarget(item);
    if (!item || !reforge || !target || !reforge.appliesTo.includes(target)) return [];
    return reforge.modifiers[item.rarity];
}

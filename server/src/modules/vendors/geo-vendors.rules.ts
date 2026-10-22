import type { GeoRarity, GeoVendor } from "@geo/shared";
import { CONTENT, npcBuys, sellValueOf, type VendorDef } from "../../content";
import type { StatModifier } from "../../engine/engine.types";
import { applyModifiers } from "../../engine/stats";

/** Vendor prices, with no database: the Express server and the Worker both use them. */

/**
 * What a vendor charges now: its list price, scaled by global effects (e.g.
 * Malphas's Dark Bargain), rounded up, and never under what vendors pay back
 * for it — so no perk can make buy-and-resell print coins.
 */
export function priceNow(itemId: string, listPrice: number, modifiers: StatModifier[]): number {
    const item = CONTENT.items[itemId];
    const floor = item && npcBuys(item) ? sellValueOf(item) : 1;
    return Math.max(floor, Math.ceil(applyModifiers(listPrice, modifiers, "vendorPrices")));
}

/** What a reroll costs now: the vendor's price for the rarity, scaled by global effects like any vendor price. */
export function reforgeCostNow(cost: Record<GeoRarity, number>, rarity: GeoRarity, modifiers: StatModifier[]): number {
    return Math.max(1, Math.ceil(applyModifiers(cost[rarity], modifiers, "vendorPrices")));
}

export function toVendorView(vendor: VendorDef, modifiers: StatModifier[]): GeoVendor {
    return {
        id: vendor.id,
        name: vendor.name,
        icon: vendor.icon,
        description: vendor.description,
        sells: vendor.sells.map((offer) => ({
            itemId: offer.itemId,
            price: priceNow(offer.itemId, offer.price, modifiers),
            stock: offer.stock,
            ...(offer.tab && { tab: offer.tab }),
        })),
        ...(vendor.reforge && {
            reforgeCost: Object.fromEntries(
                Object.keys(vendor.reforge.cost).map((rarity) => [
                    rarity,
                    reforgeCostNow(vendor.reforge!.cost, rarity as GeoRarity, modifiers),
                ]),
            ) as Record<GeoRarity, number>,
        }),
        ...(vendor.petUpgrades && { petUpgrades: true }),
    };
}

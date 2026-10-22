import type { Request, Response } from "express";
import type { GeoContentResponse, GeoItemSource, GeoItemStat, GeoItemView, GeoRecipe, GeoReforgeView } from "@geo/shared";
import { CONTENT, reforgeTarget, sellValueOf, type ItemDef, type RecipeDef, type ReforgeDef } from "../../content";
import { modifierRow } from "../../content/stat-rows";
import { petPreview } from "../../pets/pets";

const capitalise = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

/** Rows the server works out from the rules: a weapon's or off-hand's type, a card's gear requirement. */
function ruleRows(item: ItemDef): GeoItemStat[] {
    if (item.kind === "equipment" && item.weapon) {
        return [{ label: "Type", value: `${capitalise(item.weapon.type)} · ${capitalise(item.weapon.style)}` }];
    }
    if (item.kind === "equipment" && item.offHand) return [{ label: "Type", value: capitalise(item.offHand.type) }];
    const card = item.kind === "card" ? CONTENT.cards[item.cardId] : undefined;
    return [card?.requiresWeapon, card?.requiresOffHand].flatMap((requires) =>
        requires ? [{ label: "Requires", value: requires.map(capitalise).join(" or ") }] : [],
    );
}

function toItemView(item: ItemDef): GeoItemView {
    const modifiers =
        item.kind === "equipment" || item.kind === "talisman" || item.kind === "petItem" ? (item.modifiers ?? []) : [];
    const base = {
        id: item.id,
        kind: item.kind,
        name: item.name,
        icon: item.icon,
        rarity: item.rarity,
        description: item.description,
        stats: [...ruleRows(item), ...modifiers.map(modifierRow), ...(item.stats ?? [])],
        effects: item.effectText ?? [],
        sellValue: sellValueOf(item),
        ...(item.quality && { quality: item.quality }),
        ...(item.soulbound && { soulbound: true }),
    };
    switch (item.kind) {
        case "card":
            return {
                ...base,
                skill: CONTENT.cards[item.cardId]?.skill,
                maxCharges: item.maxCharges,
                ...(item.finesse && { finesse: item.finesse }),
            };
        case "equipment": {
            const target = reforgeTarget(item);
            return {
                ...base,
                slot: item.slot,
                ...(item.rod && { rod: true as const }),
                unlocksCards: item.unlocksCards?.map((cardId) => CONTENT.cards[cardId]?.name ?? cardId),
                ...(item.skills && { skills: item.skills }),
                ...(target && { reforgeTarget: target }),
            };
        }
        case "material": {
            const crop = Object.values(CONTENT.crops).find((entry) => entry.seed === item.id);
            return { ...base, skill: item.skill, ...(crop && { seedOf: crop.id }) };
        }
        case "consumable":
            return {
                ...base,
                ...(item.food && { food: { tags: item.food.tags ?? [] } }),
                ...(item.bait && { bait: true }),
            };
        case "pet": {
            const pet = CONTENT.pets[item.petId];
            if (!pet) return base;
            const preview = petPreview(pet, item.rarity);
            return {
                ...base,
                stats: [...preview.stats, ...base.stats],
                effects: [...preview.abilities, ...base.effects],
                pet: { petId: pet.id, image: pet.image, skill: pet.skill },
            };
        }
        case "petItem":
            return item.xpBoost
                ? { ...base, stats: [...base.stats, { label: "Pet XP", value: `×${item.xpBoost.multiplier}${item.xpBoost.skill ? ` (${item.xpBoost.skill})` : ""}` }] }
                : base;
        case "talisman":
        case "misc":
            return base;
    }
}

function toReforgeView(reforge: ReforgeDef): GeoReforgeView {
    const stats = Object.fromEntries(
        Object.entries(reforge.modifiers).map(([rarity, modifiers]) => [rarity, modifiers.map(modifierRow)]),
    ) as GeoReforgeView["stats"];
    return { id: reforge.id, name: reforge.name, appliesTo: reforge.appliesTo, stats };
}

function toRecipeView(recipe: RecipeDef): GeoRecipe {
    return {
        id: recipe.id,
        inputs: recipe.inputs,
        output: recipe.output,
        skills: recipe.skills ?? [],
        ...(recipe.station && { station: recipe.station }),
        ...(recipe.xp && { xp: recipe.xp }),
    };
}

/** Where items come from: enemy drops and vendor stock. Crafting is in the recipes. */
function itemSources(): GeoItemSource[] {
    const drops = Object.values(CONTENT.enemies).flatMap((enemy) =>
        enemy.loot.map(
            (drop): GeoItemSource => ({
                kind: "enemy",
                itemId: drop.itemId,
                name: enemy.name,
                chance: drop.chance,
                quantity: drop.quantity,
            }),
        ),
    );
    const stock = Object.values(CONTENT.vendors).flatMap((vendor) =>
        vendor.sells.map((offer): GeoItemSource => ({ kind: "vendor", itemId: offer.itemId, name: vendor.name })),
    );
    return [...drops, ...stock];
}

/** Item names, icons and rarities, so the app can draw an inventory; and every recipe. Pure: the Worker serves it too. */
export function contentBody(): GeoContentResponse {
    return {
        items: Object.values(CONTENT.items).map(toItemView),
        recipes: Object.values(CONTENT.recipes).map(toRecipeView),
        sources: itemSources(),
        reforges: Object.values(CONTENT.reforges).map(toReforgeView),
    };
}

export async function getContent(_req: Request, res: Response) {
    res.status(200).json(contentBody());
}

export async function getHealth(_req: Request, res: Response) {
    res.status(200).json({ ok: true });
}

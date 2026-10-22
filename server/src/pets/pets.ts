import type { GeoItemStat, GeoPetState, GeoPetUpgradeQuote } from "@geo/shared";
import { CONTENT, GAME_CONFIG } from "../content";
import { petItemId } from "../content/build";
import type { ItemDef, PetDef, PetStatDef, PetUpgradeDef, Rarity } from "../content/content.types";
import { RARITIES } from "../content/data.schema";
import { modifierRow } from "../content/stat-rows";
import type { StatModifier } from "../engine/engine.types";

/**
 * Pet rules, after Hypixel SkyBlock's: a pet gives stats while active and
 * never fights. Each copy carries its XP and held item; its level comes from
 * that XP and its rarity, so Kat raising the rarity keeps the XP and may
 * lower the level. Pure: no database here.
 */

/** What one owned pet copy carries, stored on its inventory row (`geo.inventory.pet`). */
export type PetCopy = { xp: number; heldItem: string | null };

export const NEW_PET: PetCopy = { xp: 0, heldItem: null };

const PETS = GAME_CONFIG.pets;

type PetItem = Extract<ItemDef, { kind: "pet" }>;
type HeldItem = Extract<ItemDef, { kind: "petItem" }>;

/** The pet item, if this id is one and its pet still exists. */
export function petOf(itemId: string): { item: PetItem; pet: PetDef } | null {
    const item = CONTENT.items[itemId];
    if (item?.kind !== "pet") return null;
    const pet = CONTENT.pets[item.petId];
    return pet ? { item, pet } : null;
}

function heldItemOf(itemId: string | null): HeldItem | null {
    const item = itemId ? CONTENT.items[itemId] : undefined;
    return item?.kind === "petItem" ? item : null;
}

/** XP from `level` to the next, for a pet of this rarity. */
export function xpToNextLevel(level: number, rarity: Rarity): number {
    return Math.round(PETS.xpCurve.base * level * PETS.xpCurve.rarityMultiplier[rarity]);
}

/** A pet's level from its total XP, and how far through that level it is. */
export function petProgress(xp: number, rarity: Rarity) {
    let level = 1;
    let remaining = Math.max(0, xp);
    while (level < PETS.maxLevel && remaining >= xpToNextLevel(level, rarity)) {
        remaining -= xpToNextLevel(level, rarity);
        level += 1;
    }
    if (level >= PETS.maxLevel) return { level, xpIntoLevel: 0, xpForLevel: 0 };
    return { level, xpIntoLevel: Math.floor(remaining), xpForLevel: xpToNextLevel(level, rarity) };
}

const rank = (rarity: Rarity) => RARITIES.indexOf(rarity);

function perLevel(stat: PetStatDef, rarity: Rarity): number {
    return typeof stat.perLevel === "number" ? stat.perLevel : (stat.perLevel[rarity] ?? 0);
}

function statAt(stat: PetStatDef, rarity: Rarity, level: number): StatModifier {
    return { stat: stat.stat, kind: stat.kind, value: perLevel(stat, rarity) * level };
}

const unlocked = (ability: PetDef["abilities"][number], rarity: Rarity) => rank(rarity) >= rank(ability.from);

/** What the pet gives, by where it comes from: its stats, its unlocked abilities, its held item. */
export type PetModifierSources = { stats: StatModifier[]; abilities: StatModifier[]; heldItem: StatModifier[] };

const NO_PET_MODIFIERS: PetModifierSources = { stats: [], abilities: [], heldItem: [] };

const nonZero = (modifiers: StatModifier[]) => modifiers.filter((modifier) => modifier.value !== 0);

export function petModifierSources(pet: PetDef, rarity: Rarity, copy: PetCopy): PetModifierSources {
    const { level } = petProgress(copy.xp, rarity);
    return {
        stats: nonZero(pet.stats.map((stat) => statAt(stat, rarity, level))),
        abilities: nonZero(
            pet.abilities
                .filter((ability) => unlocked(ability, rarity))
                .flatMap((ability) => ability.modifiers.map((stat) => statAt(stat, rarity, level))),
        ),
        heldItem: nonZero(heldItemOf(copy.heldItem)?.modifiers ?? []),
    };
}

/** Every stat the pet gives at this rarity and level: its stats, its unlocked abilities, its held item. */
export function petModifiers(pet: PetDef, rarity: Rarity, copy: PetCopy): StatModifier[] {
    const { stats, abilities, heldItem } = petModifierSources(pet, rarity, copy);
    return [...stats, ...abilities, ...heldItem];
}

/** The active pet's modifiers by source, from its inventory row; none for anything that isn't a pet. */
export function activePetModifierSources(row: { item_id: string; pet: PetCopy | null } | undefined): PetModifierSources {
    const found = row ? petOf(row.item_id) : null;
    return found && row ? petModifierSources(found.pet, found.item.rarity, row.pet ?? NEW_PET) : NO_PET_MODIFIERS;
}

/** The active pet's modifiers, from its inventory row; none for anything that isn't a pet. */
export function activePetModifiers(row: { item_id: string; pet: PetCopy | null } | undefined): StatModifier[] {
    const { stats, abilities, heldItem } = activePetModifierSources(row);
    return [...stats, ...abilities, ...heldItem];
}

/**
 * Pet XP from `amount` skill XP: all of it from the pet's own skill, a share
 * from any other, times the skill's multiplier and a held item's boost.
 */
export function petXpFrom(pet: PetDef, skill: string, amount: number, heldItemId: string | null): number {
    const share = skill === pet.skill ? 1 : PETS.otherSkillShare;
    const boost = heldItemOf(heldItemId)?.xpBoost;
    const boosted = boost && (!boost.skill || boost.skill === skill) ? boost.multiplier : 1;
    return amount * share * (PETS.skillMultiplier[skill] ?? 1) * boosted;
}

/** The rarity Kat raises it to, or null at its highest. */
export function nextRarity(pet: PetDef, rarity: Rarity): Rarity | null {
    return pet.rarities[pet.rarities.indexOf(rarity) + 1] ?? null;
}

/** Kat's price to raise this pet from `rarity`, at `level`; null when it can't go higher. */
export function upgradeQuote(pet: PetDef, rarity: Rarity, level: number): GeoPetUpgradeQuote | null {
    const next = nextRarity(pet, rarity);
    const price: PetUpgradeDef | undefined = pet.upgrades?.[rarity] ?? PETS.upgrades[rarity];
    if (!next || !price) return null;
    const discount = Math.max(0, 1 - level * PETS.upgradeDiscountPerLevel);
    return {
        toItemId: petItemId(pet.id, next),
        coins: Math.ceil(price.coins * discount),
        items: price.items,
        hours: Math.round(price.hours * discount * 100) / 100,
    };
}

/** One copy as the app shows it: level, XP, what it gives now, and Kat's price. */
export function petState(itemId: string, copy: PetCopy): GeoPetState | null {
    const found = petOf(itemId);
    if (!found) return null;
    const { pet, item } = found;
    const rarity = item.rarity;
    const { level, xpIntoLevel, xpForLevel } = petProgress(copy.xp, rarity);
    const held = heldItemOf(copy.heldItem);
    return {
        level,
        maxLevel: PETS.maxLevel,
        xp: Math.floor(copy.xp),
        xpIntoLevel,
        xpForLevel,
        heldItem: held ? held.id : null,
        stats: [
            ...pet.stats.map((stat) => modifierRow(statAt(stat, rarity, level))),
            ...(held?.modifiers ?? []).map((modifier) => ({ ...modifierRow(modifier), label: `${modifierRow(modifier).label} (${held!.name})` })),
        ],
        abilities: pet.abilities.map((ability) => ({
            name: ability.name,
            description: ability.description,
            from: ability.from,
            unlocked: unlocked(ability, rarity),
            stats: unlocked(ability, rarity) ? ability.modifiers.map((stat) => modifierRow(statAt(stat, rarity, level))) : [],
        })),
        upgrade: upgradeQuote(pet, rarity, level),
    };
}

/** What a pet item gives at the max level, for its item page before you own one. */
export function petPreview(pet: PetDef, rarity: Rarity): { stats: GeoItemStat[]; abilities: string[] } {
    const max = PETS.maxLevel;
    const atMax = (stat: PetStatDef) => {
        const row = modifierRow(statAt(stat, rarity, max));
        return { label: row.label, value: `${row.value} at Lv ${max}` };
    };
    return {
        stats: pet.stats.map(atMax),
        abilities: pet.abilities.filter((ability) => unlocked(ability, rarity)).map((ability) => `${ability.name}: ${ability.description}`),
    };
}

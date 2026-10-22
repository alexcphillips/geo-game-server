import { GEO_COMBAT_DAMAGE_PER_LEVEL, type GeoItemStat, type GeoStatGroup, type GeoStatLine } from "@geo/shared";
import { CONTENT, GAME_CONFIG, reforgeModifiers } from "../content";
import { FRACTION_STATS, modifierRow, statLabel, tidy } from "../content/stat-rows";
import { DAMAGE_DEALT_STAT, type StatId, type StatModifier } from "../engine/engine.types";
import { applyModifiers } from "../engine/stats";
import { FISHING_BASE } from "../fishing/fishing";
import type { PetModifierSources } from "../pets/pets";

/**
 * The character's Stats tab: every stat's total, and where it comes from.
 *
 * It gathers the same sources a fight does (`combat/combatants.ts`
 * `playerCombatant`) — gear, reforges, fists when unarmed, the Talisman Bag,
 * the pet, combat level, the mayor — so the numbers shown are the numbers
 * used. A new source of stats belongs both there and here. Pure: no database.
 */

export type StatSheetInput = {
    /** Worn copies: item id and reforge. */
    worn: { itemId: string; reforge: string | null }[];
    /** Item ids in the Talisman Bag. */
    talismans: string[];
    pet: PetModifierSources;
    combatLevel: number;
    globalModifiers: StatModifier[];
};

type StatDef = { id: StatId; group: GeoStatGroup; base: number };

/** What each stat does, for the tooltip. Keep in step with `data/EFFECTS.md`. */
const DESCRIPTIONS: Record<StatId, string> = {
    maxHealth: "The most health you can have. Health carries between fights; food restores it.",
    attack: "Weapon power. Attack cards hit harder with it.",
    defense: "Taken off every hit you receive, but a quarter of each hit always gets through.",
    speed: "Turn order: the fastest acts first each round.",
    critChance: "Chance for an attack to crit.",
    critMultiplier: "A crit's damage, as a share of a normal hit.",
    counterChance: "Chance to strike back after being attacked: once per attack, however many hits.",
    counterDamage: "A counter's damage, as a share of your attack.",
    damageDealt: "Extra damage on every hit you deal. Not on status damage like Burning.",
    armorPen: "Ignores this much of the target's defense on each attack hit.",
    intelligence: "Magic power. Spells that scale with it hit harder.",
    mending: "Heals you receive are this much bigger. Food's own heals aren't boosted.",
    magicFind: "Rare drops (under 5%) are likelier: +1 = 1% likelier.",
    seaCreatureChance: "Chance a bite is a sea creature to fight instead of a fish.",
    eelChance: "Chance a catch is an eel. Not in use yet.",
    baitSaveChance: "Chance a cast doesn't use up your bait.",
    farmingFortune: "More crops per harvest: each 100 adds the harvest again; the rest is a chance of one more.",
    pestChance: "How likely pests are to arrive, against normal (×1).",
    mutationChance: "How likely mutations are to sprout, against normal (×1).",
};

/**
 * Pest and mutation chance are multipliers on 1, shown as ×0.75; the
 * fishing chances are capped to 0–1 as fishing reads them.
 */
const MULTIPLIER_STATS = new Set<StatId>(["pestChance", "mutationChance"]);
const CAPPED_STATS = new Set<StatId>(Object.keys(FISHING_BASE));

const combatBase = (id: StatId) => GAME_CONFIG.player.baseStats[id] ?? 0;

/** Every stat the tab shows, in order. Global-only ones (coin drops, vendor prices) aren't the character's. */
const STATS: StatDef[] = [
    ...[
        "maxHealth",
        "attack",
        "defense",
        "speed",
        "critChance",
        "critMultiplier",
        "counterChance",
        "counterDamage",
        "damageDealt",
        "armorPen",
        "intelligence",
        "mending",
        "magicFind",
    ].map((id): StatDef => ({ id, group: "combat", base: combatBase(id) })),
    { id: "seaCreatureChance", group: "fishing", base: FISHING_BASE.seaCreatureChance },
    { id: "eelChance", group: "fishing", base: FISHING_BASE.eelChance },
    { id: "baitSaveChance", group: "fishing", base: FISHING_BASE.baitSaveChance },
    { id: "farmingFortune", group: "farming", base: 0 },
    { id: "pestChance", group: "farming", base: 1 },
    { id: "mutationChance", group: "farming", base: 1 },
];

function itemModifiers(itemId: string, kind: "equipment" | "talisman"): StatModifier[] {
    const item = CONTENT.items[itemId];
    return item?.kind === kind ? (item.modifiers ?? []) : [];
}

/** Each source's modifiers, in the order the tooltip lists them. */
function sourcesOf(input: StatSheetInput): { label: string; modifiers: StatModifier[] }[] {
    const hasWeapon = input.worn.some(({ itemId }) => {
        const item = CONTENT.items[itemId];
        return item?.kind === "equipment" && !!item.weapon;
    });
    return [
        { label: "Equipment", modifiers: input.worn.flatMap(({ itemId }) => itemModifiers(itemId, "equipment")) },
        { label: "Reforges", modifiers: input.worn.flatMap(({ itemId, reforge }) => reforgeModifiers(CONTENT, itemId, reforge)) },
        { label: "Fists", modifiers: hasWeapon ? [] : GAME_CONFIG.weapons.unarmed.modifiers },
        // A Set, as in a fight: a duplicate talisman never counts twice.
        { label: "Talismans", modifiers: [...new Set(input.talismans)].flatMap((itemId) => itemModifiers(itemId, "talisman")) },
        { label: "Pet", modifiers: input.pet.stats },
        { label: "Pet Ability", modifiers: input.pet.abilities },
        { label: "Pet Item", modifiers: input.pet.heldItem },
        {
            label: "Combat Level",
            modifiers: [{ stat: DAMAGE_DEALT_STAT, kind: "flat", value: input.combatLevel * GEO_COMBAT_DAMAGE_PER_LEVEL }],
        },
        { label: "Mayor", modifiers: input.globalModifiers },
    ];
}

/** "12", "7%", "×0.75": a total or base as shown. */
function formatValue(stat: StatId, value: number): string {
    if (MULTIPLIER_STATS.has(stat)) return `×${tidy(value)}`;
    if (FRACTION_STATS.has(stat)) return `${tidy(value * 100)}%`;
    return tidy(value);
}

/**
 * One source's part, e.g. "+10" or "+10, +5%". A percent of a fraction stat
 * scales the whole (×1.1), so it can't be mistaken for +10% added.
 */
function formatPart(stat: StatId, modifiers: StatModifier[]): string | null {
    let flat = 0;
    let percent = 0;
    for (const modifier of modifiers) {
        if (modifier.stat !== stat) continue;
        if (modifier.kind === "flat") flat += modifier.value;
        else percent += modifier.value;
    }
    const parts: string[] = [];
    if (flat !== 0) parts.push(modifierRow({ stat, kind: "flat", value: flat }).value);
    if (percent !== 0) {
        parts.push(FRACTION_STATS.has(stat) ? `×${tidy(1 + percent)}` : modifierRow({ stat, kind: "percent", value: percent }).value);
    }
    return parts.length > 0 ? parts.join(", ") : null;
}

export function statSheet(input: StatSheetInput): GeoStatLine[] {
    const sources = sourcesOf(input);
    const all = sources.flatMap((source) => source.modifiers);
    return STATS.map(({ id, group, base }) => {
        const raw = applyModifiers(base, all, id);
        const total = CAPPED_STATS.has(id) ? Math.min(1, Math.max(0, raw)) : raw;
        const rows: GeoItemStat[] = [{ label: "Base", value: formatValue(id, base) }];
        for (const source of sources) {
            const value = formatPart(id, source.modifiers);
            if (value) rows.push({ label: source.label, value });
        }
        return { id, group, label: statLabel(id), description: DESCRIPTIONS[id] ?? "", value: formatValue(id, total), sources: rows };
    });
}

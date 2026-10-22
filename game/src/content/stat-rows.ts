import type { GeoItemStat } from "@geo/shared";
import type { StatId, StatModifier } from "../engine/engine.types";

const STAT_LABELS: Partial<Record<StatId, string>> = {
    maxHealth: "Max Health",
    attack: "Attack",
    defense: "Defense",
    speed: "Speed",
    critChance: "Crit Chance",
    critMultiplier: "Crit Damage",
    counterChance: "Counter Chance",
    counterDamage: "Counter Damage",
    intelligence: "Intelligence",
    mending: "Mending",
    magicFind: "Magic Find",
    damageDealt: "Bonus Damage",
    armorPen: "Armor Pen",
    eelChance: "Eel Chance",
    baitSaveChance: "Bait Save Chance",
    seaCreatureChance: "Sea Creature Chance",
    farmingFortune: "Farming Fortune",
    pestChance: "Pest Chance",
    mutationChance: "Mutation Chance",
};

export const statLabel = (stat: StatId) => STAT_LABELS[stat] ?? stat;

/** Fractions, shown as percentages even when flat (+0.05 → +5%). */
export const FRACTION_STATS = new Set<StatId>([
    "critChance",
    "critMultiplier",
    "counterChance",
    "counterDamage",
    "damageDealt",
    "mending",
    "eelChance",
    "baitSaveChance",
    "seaCreatureChance",
]);

/** Up to two decimals, without trailing zeros: 0.3 × 7 shows as 2.1, not 2.0999999999999996. */
export const tidy = (value: number) => `${Math.round(value * 100) / 100}`;

/** "Defense +6", "Attack +10%": the modifier as the app shows it. */
export function modifierRow(modifier: StatModifier): GeoItemStat {
    const label = statLabel(modifier.stat);
    const asPercent = modifier.kind === "percent" || FRACTION_STATS.has(modifier.stat);
    const amount = asPercent ? `${tidy(modifier.value * 100)}%` : tidy(modifier.value);
    return { label, value: modifier.value < 0 ? amount : `+${amount}` };
}

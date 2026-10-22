import type { GeoSkillRequirement } from "./crafting.contract";

/**
 * Skill levels from XP, shared so the server enforces the same levels the app
 * shows (e.g. a recipe that needs Combat 5).
 */

/**
 * XP needed to go from `level` to the next — placeholder curve, 100 × level:
 * 100 XP for level 2, then 200 more for 3, 300 more for 4. Steep enough that
 * levels mean something, gentle enough that early ones come fast.
 */
export function geoXpToNextLevel(level: number): number {
    return 100 * level;
}

/** Every skill stops at this level. XP still counts past it; the level doesn't. */
export const GEO_MAX_SKILL_LEVEL = 50;

/** Extra damage per combat level, as a fraction: level 50 deals 50% more. */
export const GEO_COMBAT_DAMAGE_PER_LEVEL = 0.01;

/** A skill's level, and how far through it the player is. */
export type GeoSkillProgress = {
    level: number;
    /** 0–1 through the current level; 1 at the max level. */
    progress: number;
    /** XP earned within the current level, and what the level needs. 0 / 0 at the max. */
    xpIntoLevel: number;
    xpForLevel: number;
    isMax: boolean;
};

/** Total XP as a level (1 at 0 XP, at most GEO_MAX_SKILL_LEVEL) and progress through it. */
export function geoSkillProgress(totalXp: number): GeoSkillProgress {
    let level = 1;
    let remaining = Math.max(0, totalXp);
    while (level < GEO_MAX_SKILL_LEVEL && remaining >= geoXpToNextLevel(level)) {
        remaining -= geoXpToNextLevel(level);
        level += 1;
    }
    if (level >= GEO_MAX_SKILL_LEVEL) return { level, progress: 1, xpIntoLevel: 0, xpForLevel: 0, isMax: true };
    const xpForLevel = geoXpToNextLevel(level);
    return { level, progress: remaining / xpForLevel, xpIntoLevel: remaining, xpForLevel, isMax: false };
}

/** A skill's level for this much total XP. Level 1 at 0 XP, at most GEO_MAX_SKILL_LEVEL. */
export function geoSkillLevel(totalXp: number): number {
    return geoSkillProgress(totalXp).level;
}

/**
 * The first requirement these levels fall short of (a recipe's, or gear's to
 * equip it), or undefined when all are met. Skills missing from `levels` are level 1.
 */
export function geoUnmetSkill(
    levels: Record<string, number>,
    requirements: readonly GeoSkillRequirement[] = [],
): GeoSkillRequirement | undefined {
    return requirements.find(({ skill, level }) => (levels[skill] ?? 1) < level);
}

/** "combat" → "Combat", for refusals the player reads. */
export function geoSkillName(skill: string): string {
    return skill.charAt(0).toUpperCase() + skill.slice(1);
}

import type { Combatant, StatId, StatModifier, Stats } from "./engine.types";
import type { EngineContent } from "./content.types";

/**
 * A combatant's stat right now: base, plus every flat modifier, then scaled by
 * every percent modifier — from gear and talismans, and from statuses (scaled
 * by their stacks). Read fresh each time, so a status applied mid-turn counts
 * at once.
 */
export function statOf(combatant: Combatant, stat: StatId, content: EngineContent): number {
    const modifiers: StatModifier[] = [...combatant.modifiers];
    for (const status of combatant.statuses) {
        const def = content.statuses[status.statusId];
        for (const modifier of def?.modifiers ?? []) {
            if (modifier.stat === stat) {
                modifiers.push({ ...modifier, value: modifier.value * status.stacks });
            }
        }
    }

    let flat = combatant.baseStats[stat] ?? 0;
    let percent = 0;
    for (const modifier of modifiers) {
        if (modifier.stat !== stat) continue;
        if (modifier.kind === "flat") flat += modifier.value;
        else percent += modifier.value;
    }
    return flat * (1 + percent);
}

/** Every stat a combatant has a base for, worked out. For the app's display. */
export function allStats(combatant: Combatant, content: EngineContent): Stats {
    const ids = new Set([
        ...Object.keys(combatant.baseStats),
        ...combatant.modifiers.map((modifier) => modifier.stat),
    ]);
    return Object.fromEntries([...ids].map((id) => [id, statOf(combatant, id, content)]));
}

/**
 * A stat outside a fight, from its base: (base + Σ flat) × (1 + Σ percent),
 * the same sum `statOf` does. For rules that read global effects and gear
 * without a combatant, e.g. fishing's eel chance or a vote's weight.
 */
export function applyModifiers(base: number, modifiers: readonly StatModifier[], stat: StatId): number {
    let flat = base;
    let percent = 0;
    for (const modifier of modifiers) {
        if (modifier.stat !== stat) continue;
        if (modifier.kind === "flat") flat += modifier.value;
        else percent += modifier.value;
    }
    return flat * (1 + percent);
}

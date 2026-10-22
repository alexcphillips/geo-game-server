import type { PlayerConfig } from "#geo/models";

export default {
    baseStats: {
        maxHealth: 100,
        attack: 4,
        defense: 0,
        speed: 10,
        critChance: 0.05,
        critMultiplier: 1.5,
        counterChance: 0,
        counterDamage: 0.5,
    },
} satisfies PlayerConfig;

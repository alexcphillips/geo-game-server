import type { Pet } from "#geo/models";

// PLACEHOLDER stats and abilities: stand-ins until the real Tarantula is designed.
export default {
    id: "tarantula",
    name: "Tarantula",
    icon: "spider-alt",
    image: "tarantula",
    description: "Eight legs, eight eyes, and an opinion about all of it.",
    skill: "combat",
    rarities: ["common", "uncommon", "rare", "epic", "legendary"],
    stats: [
        { stat: "defense", perLevel: 0.2 },
        { stat: "critChance", perLevel: 0.0005 },
    ],
    abilities: [
        {
            id: "eight-legs",
            name: "Eight Legs",
            from: "common",
            description: "PLACEHOLDER: quicker on your feet.",
            modifiers: [
                {
                    stat: "speed",
                    perLevel: {
                        common: 0.02,
                        uncommon: 0.03,
                        rare: 0.04,
                        epic: 0.05,
                        legendary: 0.06,
                    },
                },
            ],
        },
        {
            id: "venom-sacs",
            name: "Venom Sacs",
            from: "rare",
            description: "PLACEHOLDER: hit harder.",
            modifiers: [
                {
                    stat: "attack",
                    kind: "percent",
                    perLevel: { rare: 0.001, epic: 0.0015, legendary: 0.002 },
                },
            ],
        },
        {
            id: "brood-mother",
            name: "Brood Mother",
            from: "legendary",
            description: "PLACEHOLDER: tougher to bring down.",
            modifiers: [{ stat: "maxHealth", perLevel: 0.5 }],
        },
    ],
    upgrades: {
        common: {
            coins: 1_000,
            items: [{ itemId: "silk-spool", quantity: 8 }],
            hours: 1,
        },
        uncommon: {
            coins: 5_000,
            items: [{ itemId: "silk-spool", quantity: 32 }],
            hours: 6,
        },
        rare: {
            coins: 25_000,
            items: [{ itemId: "spider-fang", quantity: 64 }],
            hours: 24,
        },
        epic: {
            coins: 100_000,
            items: [{ itemId: "spider-fang", quantity: 256 }],
            hours: 72,
        },
    },
} satisfies Pet;

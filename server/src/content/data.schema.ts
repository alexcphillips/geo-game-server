import { z } from "zod";
import { GEO_CHEST_TIERS, GEO_FARM_GROUNDS, GEO_FARM_SIZE, GEO_FARM_WEATHERS, GEO_FISHING_TIERS, GEO_LOADOUT_ACTIVITIES, GEO_MAX_SKILL_LEVEL, GEO_QUALITY_TIERS, GEO_WORLD_HABITAT_METRES, GEO_WORLD_HABITATS, GEO_WORLD_WATER_KINDS } from "@geo/shared";
import type { Action, Amount, Condition, EffectDef, StatModifier } from "../engine/engine.types";
import { DUNGEON_ROOM_KINDS } from "../dungeons/dungeon-map";
import type * as M from "./models";

/**
 * The runtime check of every file in `geo/data/`: what the editor checks
 * through the models (`models.ts`), the loader (`data.ts`) checks again as
 * it loads, and fills in defaults. The models are what you read; these are
 * kept equal to them by the checks at the bottom, which fail to compile if
 * the two drift apart.
 *
 * Objects are strict: a misspelt key ("maxCharge") is an error, not ignored.
 * A rule that needs other files (a card that exists, a weapon tag that's
 * listed) is checked after loading, in `content/index.ts`.
 */

const id = z.string().regex(/^[a-z0-9][a-z0-9.-]*$/, "use lower-case letters, digits, dots and dashes");
/** The id of another entry; checked after loading. */
const ref = z.string().min(1);
const count = z.int().min(1);
const fraction = z.number().min(0).max(1);
const range = (lowest: number) => z.strictObject({ min: z.int().min(lowest), max: z.int().min(lowest) });

export const RARITIES = ["common", "uncommon", "rare", "epic", "legendary"] as const;
export const FISH_TRAITS = ["slippery", "linebreaker", "deepdiver"] as const;
export const FISH_INTENTS = ["run", "thrash", "dive", "rest", "jump"] as const;
const Rarity = z.enum(RARITIES);

// ---------------------------------------------------------------------------
// Engine rules: modifiers, effects, actions, conditions

const StatModifierSchema = z.strictObject({
    stat: z.string().min(1),
    kind: z.enum(["flat", "percent"]),
    value: z.number(),
}) satisfies z.ZodType<StatModifier>;

const Who = z
    .enum(["self", "other", "actor", "target"]);

const AmountSchema: z.ZodType<Amount, Amount> = z
    .union([
        z.number(),
        z.strictObject({
            stat: z.string().optional(),
            multiplier: z.number().optional(),
            flat: z.number().optional(),
            perStack: z.boolean().optional(),
        }),
    ]);

const ConditionSchema: z.ZodType<Condition, Condition> = z.lazy(() =>
    z.discriminatedUnion("type", [
        z.strictObject({ type: z.literal("hasStatus"), who: Who, status: ref }),
        z.strictObject({ type: z.literal("lacksStatus"), who: Who, status: ref }),
        z.strictObject({ type: z.literal("healthBelow"), who: Who, fraction: fraction }),
        z.strictObject({ type: z.literal("cardHasTag"), tag: z.string() }),
        z.strictObject({ type: z.literal("foodHasTag"), tag: z.string() }),
        z.strictObject({ type: z.literal("damageElement"), element: z.string() }),
        z.strictObject({ type: z.literal("damageFromStatus"), status: z.string().optional() }),
        z.strictObject({ type: z.literal("not"), condition: ConditionSchema }),
        z.strictObject({ type: z.literal("any"), conditions: z.array(ConditionSchema) }),
    ]),
);

const ActionSchema = z.discriminatedUnion("type", [
    z
        .strictObject({
            type: z.literal("attack"),
            to: Who,
            amount: AmountSchema,
            hits: count.optional(),
            element: z.string().optional(),
            delivery: z.enum(["melee", "projectile"]).optional(),
        }),
    z
        .strictObject({
            type: z.literal("damage"),
            to: Who,
            amount: AmountSchema,
            element: z.string().optional(),
            ignoreDefense: z.boolean().optional(),
        }),
    z.strictObject({ type: z.literal("heal"), to: Who, amount: AmountSchema }),
    z.strictObject({ type: z.literal("guard"), to: Who, amount: AmountSchema }),
    z.strictObject({ type: z.literal("barrier"), to: Who, amount: AmountSchema }),
    z.strictObject({
        type: z.literal("applyStatus"),
        to: Who,
        status: ref,
        stacks: count.optional(),
        duration: count.optional(),
    }),
    z.strictObject({ type: z.literal("removeStatus"), from: Who, status: ref }),
    z.strictObject({ type: z.literal("cancelAction") }),
    z.strictObject({ type: z.literal("freeCharge") }),
    z
        .strictObject({ type: z.literal("modifyDamage"), add: z.number().optional(), multiply: z.number().optional() }),
]) satisfies z.ZodType<Action>;

const EffectSchema = z.strictObject({
    id: z.string().min(1),
    trigger: z.strictObject({
        event: z.enum([
            "battleStart",
            "turnStart",
            "beforeAction",
            "cardPlayed",
            "foodEaten",
            "attacked",
            "beforeDamage",
            "damageTaken",
            "attackFinished",
            "turnEnd",
            "defeated",
        ]),
        as: z.enum(["actor", "target", "any"]).optional(),
    }),
    conditions: z.array(ConditionSchema).optional(),
    chance: fraction.optional(),
    actions: z.array(ActionSchema),
}) satisfies z.ZodType<EffectDef>;

const ItemStat = z.strictObject({ label: z.string(), value: z.string() });
const ItemAmount = z.strictObject({ itemId: ref, quantity: count });

// ---------------------------------------------------------------------------
// Items

/** Fields every item file has, for the app to draw it. */
const itemBase = {
    id,
    name: z.string().min(1),
    icon: z.string().min(1),
    rarity: Rarity,
    description: z.string(),
    stats: z.array(ItemStat).optional(),
    effectText: z.array(z.string()).optional(),
    sellValue: z
        .int()
        .min(0)
        .optional(),
};

const gearRules = {
    modifiers: z.array(StatModifierSchema).optional(),
    effects: z.array(EffectSchema).optional(),
};

const equipmentRules = {
    ...gearRules,
    unlocksCards: z.array(ref).optional(),
    skills: z
        .array(z.strictObject({ skill: z.string().min(1), level: count }))
        .optional(),
};

/** A card: its rules and the item you own, in one file. The item's id is `card.<id>`. */
const CardFile = z.strictObject({
    ...itemBase,
    skill: z.string().min(1),
    maxCharges: count,
    targets: z.enum(["enemy", "self"]),
    tags: z.array(z.string()).optional(),
    requiresWeapon: z
        .array(z.string())
        .optional(),
    requiresOffHand: z.array(z.string()).optional(),
    playableIf: z.array(ConditionSchema).optional(),
    actions: z.array(ActionSchema).default([]),
    effects: z.array(EffectSchema).optional(),
    finesse: z.enum(["raises", "lowers"]).optional(),
});

const WeaponFile = z.strictObject({
    ...itemBase,
    ...equipmentRules,
    weapon: z.strictObject({
        type: z.string().min(1),
        style: z.string().min(1),
    }),
});

const ArmorFile = z.strictObject({
    ...itemBase,
    ...equipmentRules,
    slot: z.enum(["offHand", "head", "chest", "hands", "legs", "feet", "shoulders", "cloak", "belt"]),
    offHand: z.strictObject({ type: z.string().min(1) }).optional(),
});

const RingFile = z.strictObject({ ...itemBase, ...equipmentRules });

const AmuletFile = z.strictObject({ ...itemBase, ...equipmentRules });

const RodFile = z.strictObject({
    ...itemBase,
    ...equipmentRules,
    rod: z.strictObject({
        power: z.int().min(0),
        line: count,
        maxRarity: Rarity,
        maxTier: z.enum(GEO_QUALITY_TIERS).nullable(),
    }),
});

const TalismanFile = z.strictObject({ ...itemBase, ...gearRules });

const MaterialFile = z.strictObject({
    ...itemBase,
    skill: z.string().min(1),
    stackSize: count.default(999),
    compact: z
        .strictObject({ ratio: z.int().min(2) })
        .optional(),
});

const FoodFile = z.strictObject({
    ...itemBase,
    stackSize: count.default(99),
    heal: z.int().min(1).optional(),
    tags: z.array(z.string()).optional(),
    actions: z.array(ActionSchema).default([]),
    effects: z.array(EffectSchema).optional(),
});

const BaitFile = z.strictObject({
    ...itemBase,
    stackSize: count.default(99),
    scent: z.int().min(0),
    chum: z.boolean().optional(),
});

const MiscFile = z.strictObject({
    ...itemBase,
    kind: z.enum(["misc", "consumable"]).default("misc"),
    stackSize: count.default(99),
});

const PetStatSchema = z.strictObject({
    stat: z.string().min(1),
    kind: z.enum(["flat", "percent"]).default("flat"),
    perLevel: z.union([z.number(), z.partialRecord(Rarity, z.number())]),
});

const PetUpgradeSchema = z.strictObject({
    coins: z.int().min(0),
    items: z.array(ItemAmount).default([]),
    hours: z.number().min(0),
});

const PetFile = z.strictObject({
    id,
    name: z.string().min(1),
    icon: z.string().min(1),
    image: z.string().min(1),
    description: z.string(),
    skill: z.string().min(1),
    rarities: z
        .array(Rarity)
        .min(1)
        .refine((list) => list.every((rarity, i) => i === 0 || RARITIES.indexOf(rarity) > RARITIES.indexOf(list[i - 1]!)), {
            message: "list rarities once each, lowest first",
        }),
    stats: z.array(PetStatSchema),
    abilities: z.array(
        z.strictObject({
            id: z.string().min(1),
            name: z.string().min(1),
            from: Rarity,
            description: z.string(),
            modifiers: z.array(PetStatSchema).default([]),
        }),
    ),
    sellValue: z.partialRecord(Rarity, z.int().min(0)).optional(),
    upgrades: z.partialRecord(Rarity, PetUpgradeSchema).optional(),
});

const PetItemFile = z.strictObject({
    ...itemBase,
    modifiers: z.array(StatModifierSchema).optional(),
    xpBoost: z.strictObject({ multiplier: z.number().positive(), skill: z.string().min(1).optional() }).optional(),
    stackSize: count.default(64),
});

// ---------------------------------------------------------------------------
// Everything else

const FishFile = z.strictObject({
    id,
    name: z.string().min(1),
    rarity: Rarity,
    icon: z.string().min(1),
    description: z.string(),
    stamina: z.int().min(1),
    strength: z.number().positive(),
    distance: z.int().min(1),
    moves: z.record(z.enum(FISH_INTENTS), z.number().min(0)),
    traits: z.array(z.enum(FISH_TRAITS)).default([]),
    xp: z.int().min(0),
});

const CropFile = z.strictObject({
    id,
    name: z.string().min(1),
    icon: z.string().min(1),
    seed: ref,
    produce: ref,
    stages: count,
    yield: range(1),
    seedsBack: range(0),
    xp: z.int().min(0),
});

const FarmEventFile = z.strictObject({
    id,
    name: z.string().min(1),
    icon: z.string().min(1),
    description: z.string(),
    weight: z.number().min(0),
    effect: z.discriminatedUnion("kind", [
        z.strictObject({ kind: z.literal("pest-swarm"), count }),
        z.strictObject({ kind: z.literal("blood-moon"), pestBoost: z.number().min(1) }),
        z.strictObject({ kind: z.literal("bumper-harvest"), bonus: count }),
        z.strictObject({ kind: z.literal("merchant"), count, stock: z.array(z.strictObject({ itemId: ref, price: z.int().min(0) })).min(1) }),
        z.strictObject({ kind: z.literal("meteor-shower"), mutationBoost: z.number().min(1), dropChance: fraction, itemId: ref }),
    ]),
});

const StructureFile = z.strictObject({
    id,
    name: z.string().min(1),
    icon: z.string().min(1),
    description: z.string(),
    stats: z.array(ItemStat).optional(),
    cost: z.array(ItemAmount),
    size: z.strictObject({ width: z.int().min(1).max(GEO_FARM_SIZE), height: z.int().min(1).max(GEO_FARM_SIZE) }).optional(),
    requiredLevel: z.int().min(0).max(GEO_MAX_SKILL_LEVEL).optional(),
    effect: z.discriminatedUnion("kind", [
        z.strictObject({ kind: z.literal("jukebox"), boost: z.number().min(1) }),
        z.strictObject({ kind: z.literal("cage") }),
        z.strictObject({ kind: z.literal("beehive"), boost: z.number().min(1), swarmChance: fraction }),
        z.strictObject({ kind: z.literal("compost"), capacity: count, itemId: ref }),
        z.strictObject({ kind: z.literal("pond") }),
        z.strictObject({ kind: z.literal("greenhouse") }),
        z.strictObject({ kind: z.literal("reactor"), radius: count, growth: count, wasteChance: fraction }),
        z.strictObject({ kind: z.literal("portal"), wave: count, pests: z.array(ref).min(1) }),
        z.strictObject({ kind: z.literal("shrine") }),
        z.strictObject({ kind: z.literal("well"), radius: count }),
    ]),
});

const MutationFile = z.strictObject({
    id,
    name: z.string().min(1),
    icon: z.string().min(1),
    description: z.string(),
    produce: ref,
    stages: count,
    yield: range(1),
    xp: z.int().min(0),
    recipe: z.strictObject({
        parents: z.array(z.strictObject({ cropId: ref, count })).min(1),
        weather: z.enum(GEO_FARM_WEATHERS).optional(),
        event: ref.optional(),
        pest: ref.optional(),
        structure: ref.optional(),
        blessing: ref.optional(),
        ground: z.enum(GEO_FARM_GROUNDS).optional(),
    }),
    chance: fraction,
    research: z.strictObject({ coins: z.int().min(0), xp: z.int().min(0) }),
});

const PestFile = z.strictObject({
    id,
    name: z.string().min(1),
    icon: z.string().min(1),
    description: z.string(),
    likes: z.array(ref),
    behaviour: z.discriminatedUnion("kind", [
        z.strictObject({ kind: z.literal("eat"), reach: count }),
        z.strictObject({ kind: z.literal("sap") }),
        z.strictObject({ kind: z.literal("breed"), every: count }),
    ]),
    weight: z.number().min(0),
    hp: count.optional(),
    drops: z.array(z.strictObject({ itemId: ref, chance: fraction, quantity: range(1) })),
    xp: z.int().min(0),
    bounty: z.int().min(0).optional(),
});

const ChestTier = z.enum(GEO_CHEST_TIERS);

/** One pool of a chest: `rolls` weighted picks from `entries`. */
const ChestPoolSchema = z.strictObject({
    rolls: range(0),
    entries: z.array(z.strictObject({ itemId: ref, weight: z.number().positive(), quantity: range(1) })),
});

const EnemyFile = z.strictObject({
    id,
    name: z.string().min(1),
    sprite: z.string().min(1),
    tier: z.int().min(1),
    stats: z.record(z.string(), z.number()),
    barrier: z.int().min(1).optional(),
    moves: z
        .array(
            z.strictObject({
                id: z.string().min(1),
                name: z.string().min(1),
                weight: z.number().positive(),
                actions: z.array(ActionSchema),
            }),
        )
        .min(1),
    effects: z.array(EffectSchema).optional(),
    loot: z.array(z.strictObject({ itemId: ref, chance: fraction, quantity: range(1) })).default([]),
    chests: z
        .strictObject({
            chance: fraction,
            offers: z.array(
                z.strictObject({
                    tier: ChestTier,
                    chance: fraction,
                    pools: z.array(ChestPoolSchema),
                }),
            ),
        })
        .optional(),
    leavesAfterWinning: z.boolean().optional(),
    coins: range(0).optional(),
    xp: z.int().min(0),
    habitats: z
        .array(
            z.strictObject({
                near: z.enum(GEO_WORLD_HABITATS),
                weight: z.number().positive(),
                waters: z.array(z.enum(GEO_WORLD_WATER_KINDS)).min(1).optional(),
            }),
        )
        .optional(),
});

const StatusFile = z.strictObject({
    id,
    name: z.string().min(1),
    duration: count.optional(),
    maxStacks: count,
    modifiers: z.array(StatModifierSchema).optional(),
    effects: z.array(EffectSchema).optional(),
});

const RecipeFile = z.strictObject({
    id,
    inputs: z.array(ItemAmount).min(1),
    output: ItemAmount,
    skills: z
        .array(z.strictObject({ skill: z.string().min(1), level: count }))
        .optional(),
    station: z.enum(["cooking"]).optional(),
    xp: z.strictObject({ skill: z.string().min(1), amount: count }).optional(),
});

const VendorFile = z.strictObject({
    id,
    name: z.string().min(1),
    icon: z.string().min(1),
    description: z.string(),
    sells: z.array(
        z.strictObject({
            itemId: ref,
            price: count,
            stock: z.null().default(null),
            tab: z.string().min(1).optional(),
        }),
    ),
    reforge: z.strictObject({ cost: z.record(Rarity, count) }).optional(),
    petUpgrades: z.boolean().optional(),
});

const ReforgeFile = z.strictObject({
    id,
    name: z.string().min(1),
    appliesTo: z.array(z.enum(["weapon", "armor"])).min(1),
    modifiers: z.record(Rarity, z.array(StatModifierSchema).min(1)),
});

const MayorFile = z.strictObject({
    id,
    name: z.string().min(1),
    perks: z.array(
        z.strictObject({
            id: z.string().min(1),
            name: z.string().min(1),
            description: z.string(),
            icon: z.string().min(1),
            modifiers: z.array(StatModifierSchema),
        }),
    ),
});

const QuestFile = z.strictObject({
    id,
    title: z.string().min(1),
    giver: z.string().min(1).optional(),
    after: z.array(ref).optional(),
    unlocksTier: z.int().min(2).optional(),
    objectives: z
        .array(
            z.discriminatedUnion("type", [
                z.strictObject({ id: z.string().min(1), type: z.literal("kill"), enemy: ref, count }),
                z.strictObject({ id: z.string().min(1), type: z.literal("dungeon"), dungeon: ref, count }),
                z.strictObject({ id: z.string().min(1), type: z.literal("craft"), recipe: ref, count }),
                z.strictObject({ id: z.string().min(1), type: z.literal("camp"), count: z.literal(1) }),
                z.strictObject({ id: z.string().min(1), type: z.literal("deposit"), count }),
            ]),
        )
        .min(1),
    rewards: z.strictObject({
        coins: count.optional(),
        items: z.array(ItemAmount).optional(),
    }),
});

const DungeonRoomSchema = z.strictObject({
    kind: z.enum(DUNGEON_ROOM_KINDS),
    name: z.string().min(1).optional(),
    style: ref.optional(),
    lock: ref.optional(),
});
const DungeonRoomRefSchema = z.union([z.string().min(1), DungeonRoomSchema]);

const DungeonFile = z.strictObject({
    id,
    name: z.string().min(1),
    description: z.string(),
    boss: ref,
    bossModifiers: z.array(StatModifierSchema).optional(),
    requiredLevel: z.int().min(0).max(GEO_MAX_SKILL_LEVEL),
    maxPlayers: z.int().min(1).max(8),
    stars: z.int().min(0).optional(),
    minibosses: z.int().min(0).default(0),
    encounterEnemies: z.array(ref).default([]),
    starEnemies: z.array(ref).default([]),
    minibossEnemies: z.array(ref).default([]),
    chestScores: z
        .strictObject({ gold: z.int().min(0).max(100).default(40), ruby: z.int().min(0).max(100).default(70), void: z.int().min(0).max(100).default(90) })
        .default({ gold: 40, ruby: 70, void: 90 }),
    roomLoot: z.array(ChestPoolSchema).default([]),
    chests: z.partialRecord(ChestTier, z.array(ChestPoolSchema)).default({}),
    penalties: z
        .strictObject({ failedPuzzle: z.int().min(0).max(100).default(20), death: z.int().min(0).max(100).default(15) })
        .default({ failedPuzzle: 20, death: 15 }),
    roomStyle: ref.optional(),
    rooms: z.record(id, DungeonRoomSchema).default({}),
    pool: z
        .array(z.strictObject({ room: DungeonRoomRefSchema, weight: z.number().positive().default(1), max: count.optional() }))
        .default([]),
});

const DungeonLayoutFile = z.strictObject({
    id,
    dungeon: ref,
    map: z.string().min(1),
    rooms: z.record(z.string().regex(/^[A-Za-z]$/, "one letter: digits are slots"), DungeonRoomRefSchema),
    place: z
        .array(z.strictObject({ room: DungeonRoomRefSchema, at: z.array(z.int().min(0).max(9)).min(1), chance: fraction.default(1) }))
        .default([]),
    roomStyle: ref.optional(),
    mirror: z.boolean().default(true),
});

const RoomStyleFile = z.strictObject({
    id,
    corner: z.enum(["round", "chamfer", "circle"]),
    radius: z.number().min(0).default(8),
    rough: z.number().min(0).default(0),
    wall: z.number().positive().default(3),
    inset: z.number().min(0).default(4),
    tone: z.enum(["stone", "moss", "ember", "bone", "void"]),
});

/**
 * Each folder of `data/` and what its files hold: one entry per file, named
 * by its id. Subfolders are for you to sort things; they mean nothing.
 */
export const DATA_FOLDERS = {
    cards: CardFile,
    weapons: WeaponFile,
    armor: ArmorFile,
    rings: RingFile,
    amulets: AmuletFile,
    rods: RodFile,
    talismans: TalismanFile,
    materials: MaterialFile,
    food: FoodFile,
    bait: BaitFile,
    misc: MiscFile,
    pets: PetFile,
    "pet-items": PetItemFile,
    fish: FishFile,
    crops: CropFile,
    pests: PestFile,
    mutations: MutationFile,
    structures: StructureFile,
    "farm-events": FarmEventFile,
    enemies: EnemyFile,
    statuses: StatusFile,
    recipes: RecipeFile,
    vendors: VendorFile,
    reforges: ReforgeFile,
    mayors: MayorFile,
    dungeons: DungeonFile,
    "dungeon-layouts": DungeonLayoutFile,
    "room-styles": RoomStyleFile,
    quests: QuestFile,
} as const;

// ---------------------------------------------------------------------------
// config/: one file each, for tuning numbers that aren't a list of things

const byRarity = <T extends z.ZodType>(value: T) => z.record(Rarity, value);

const FishingConfig = z.strictObject({
    baseOdds: z.strictObject({
        eelChance: fraction,
        baitSaveChance: fraction,
        seaCreatureChance: fraction,
    }),
    rarityWeight: byRarity(z.number().min(0)),
    waterRarities: z.record(z.enum(GEO_FISHING_TIERS), z.array(Rarity).min(1)),
    rarityDifficulty: byRarity(z.number().positive()),
    rarityPower: byRarity(z.int().min(0)),
    parTurns: byRarity(count),
    sellValue: byRarity(z.int().min(0)),
    tuning: z.strictObject({
        zoneLow: fraction,
        zoneHigh: fraction,
        tierThresholds: z.record(z.enum(GEO_QUALITY_TIERS), z.number().positive()),
        maxTurns: count,
    }),
    seaCreatures: z.record(
        z.enum(GEO_FISHING_TIERS),
        z.array(z.strictObject({ enemyId: id, weight: z.number().positive() })),
    ),
});

const FarmingConfig = z.strictObject({
    turnHours: z.number().positive(),
    maxTurnsAway: count,
    startSize: count,
    unlockCost: z.strictObject({ first: z.int().min(0), step: z.int().min(0), compost: z.int().min(0), compostFrom: z.int().min(0), itemId: ref }),
    rotChances: z.array(fraction).min(1),
    mutationRamp: fraction,
    waste: z.strictObject({ spreadChance: fraction, mutationBoost: z.number().min(1), pestChance: fraction, pest: ref }),
    shrine: z.strictObject({
        halfValue: z.number().positive(),
        curseShare: fraction,
        blessings: z
            .array(
                z.strictObject({
                    id: z.enum(["growth", "plenty", "mutation", "pests"]),
                    name: z.string().min(1),
                    description: z.string(),
                    turns: count,
                    weight: z.number().min(0),
                    curse: z.boolean(),
                }),
            )
            .min(1),
    }),
    pests: z.strictObject({ fromTurn: z.int().min(0), chancePerCrop: fraction, maxChance: fraction, max: z.int().min(0) }),
    pollinateBoost: z.number().min(1),
    events: z.strictObject({ fromTurn: z.int().min(0), chance: fraction }),
    orders: z.strictObject({ perWeek: z.int().min(0), value: range(1), rewardMultiplier: z.number().min(1), depositShare: fraction }),
    contests: z.strictObject({ prizes: z.array(z.int().min(0)), participation: z.int().min(0) }),
    pesthunter: z.strictObject({ shop: z.array(z.strictObject({ itemId: ref, price: count })) }),
    globalEvents: z.array(z.strictObject({ eventId: ref, days: z.int().min(1).max(7), weight: z.number().min(0) })),
    weatherWeights: z.record(z.enum(GEO_FARM_WEATHERS), z.number().min(0)),
});

const PlayerConfig = z.strictObject({
    baseStats: z.record(z.string(), z.number()),
});

const SpawnsConfig = z.strictObject({
    reachMetres: z.number().positive(),
    maxSpawnMetres: z.number().positive(),
    minSpawnMetres: z.number().min(0),
    outOfReachSeconds: z.number().positive(),
    respawnAfterWinSeconds: z.number().min(0),
    countWeights: z.array(z.number().min(0)).min(1),
    windowMinutes: z.number().positive(),
    spawnGapSeconds: z.number().min(0),
    lifetimeMinutes: z.strictObject({ min: z.number().positive(), max: z.number().positive() }),
    tierUnlockLevels: z.array(z.int().min(1)).min(1),
    lowerTierWeights: z.array(z.number().positive()).min(1),
    questTargetWeight: z.number().positive(),
    enemies: z.array(z.strictObject({ enemyId: ref, weight: z.number().positive() })).min(1),
    habitats: z.record(
        z.enum(GEO_WORLD_HABITATS),
        z.strictObject({ influenceMetres: z.number().positive().max(GEO_WORLD_HABITAT_METRES), weight: z.number().min(0) }),
    ),
});

const StarterKitConfig = z.strictObject({
    items: z.array(ItemAmount),
    loadouts: z
        .array(
            z.strictObject({
                name: z.string().min(1).max(20),
                autoFor: z.enum(GEO_LOADOUT_ACTIVITIES).optional(),
                equip: z.partialRecord(z.enum(["mainHand", "offHand", "head", "chest", "hands", "legs", "feet", "shoulders", "cloak", "belt", "amulet", "ring"]), ref),
            }),
        )
        .min(1),
    handSkills: z.array(z.string()),
    lunchbox: z.array(ItemAmount),
    bait: z.array(ItemAmount),
});

const WardrobeConfig = z
    .strictObject({
        startingSlots: z.int().min(1),
        maxSlots: z.int().min(1),
        slotCost: z.strictObject({ first: z.int().min(0), step: z.int().min(0) }),
    })
    .refine((config) => config.maxSlots >= config.startingSlots, "maxSlots must be at least startingSlots");

const ElectionsConfig = z.strictObject({
    firstMayor: ref,
    candidates: count,
    minHours: z.number().min(0),
});

const EconomyConfig = z.strictObject({
    placeholderSellValue: byRarity(z.int().min(0)),
});

const WeaponsConfig = z.strictObject({
    types: z.array(z.string().min(1)),
    styles: z.array(z.string().min(1)),
    offHandTypes: z.array(z.string().min(1)),
    unarmed: z.strictObject({
        type: z.string().min(1),
        style: z.string().min(1),
        modifiers: z.array(StatModifierSchema),
    }),
});

const PetsConfig = z.strictObject({
    maxLevel: z.int().min(1),
    xpCurve: z.strictObject({ base: z.number().positive(), rarityMultiplier: byRarity(z.number().positive()) }),
    otherSkillShare: fraction,
    skillMultiplier: z.record(z.string(), z.number().positive()),
    upgrades: z.partialRecord(Rarity, PetUpgradeSchema),
    upgradeDiscountPerLevel: fraction,
    heldItemRemovalCost: byRarity(z.int().min(0)),
});

const ChestTiersConfig = z.strictObject({
    tiers: z.array(z.strictObject({ id: ChestTier, name: z.string().min(1), cost: z.int().min(0) })),
});

/** `data/config/<file>.ts`, each required. */
export const CONFIG_FILES = {
    fishing: FishingConfig,
    farming: FarmingConfig,
    player: PlayerConfig,
    spawns: SpawnsConfig,
    "starter-kit": StarterKitConfig,
    elections: ElectionsConfig,
    economy: EconomyConfig,
    weapons: WeaponsConfig,
    "chest-tiers": ChestTiersConfig,
    pets: PetsConfig,
    wardrobe: WardrobeConfig,
} as const;

export type DataFolder = keyof typeof DATA_FOLDERS;
export type ConfigFile = keyof typeof CONFIG_FILES;

/** What the loader hands over: every folder's entries, checked, with defaults filled in. */
export type GameData = { [F in DataFolder]: z.output<(typeof DATA_FOLDERS)[F]>[] } & {
    config: { [C in ConfigFile]: z.output<(typeof CONFIG_FILES)[C]> };
};

// ---------------------------------------------------------------------------
// Each schema accepts exactly its model: a field added to one and not the
// other fails `npm run typecheck` here.

type Assignable<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
/** Each assignable to the other, with the same fields: an optional field added to only one counts. */
type Same<A, B> = Assignable<A, B> extends true ? Assignable<keyof A, keyof B> : false;
const folderModels: { [K in DataFolder]: Same<z.input<(typeof DATA_FOLDERS)[K]>, ModelOf[K]> } = {
    cards: true,
    weapons: true,
    armor: true,
    rings: true,
    amulets: true,
    rods: true,
    talismans: true,
    materials: true,
    food: true,
    bait: true,
    misc: true,
    pets: true,
    "pet-items": true,
    fish: true,
    crops: true,
    pests: true,
    mutations: true,
    structures: true,
    "farm-events": true,
    enemies: true,
    statuses: true,
    recipes: true,
    vendors: true,
    reforges: true,
    mayors: true,
    dungeons: true,
    "dungeon-layouts": true,
    "room-styles": true,
    quests: true,
};
const configModels: { [K in ConfigFile]: Same<z.input<(typeof CONFIG_FILES)[K]>, ConfigModelOf[K]> } = {
    fishing: true,
    farming: true,
    player: true,
    spawns: true,
    "starter-kit": true,
    elections: true,
    economy: true,
    weapons: true,
    "chest-tiers": true,
    pets: true,
    wardrobe: true,
};
void folderModels;
void configModels;

/** Each folder's model. */
export type ModelOf = {
    cards: M.Card;
    weapons: M.Weapon;
    armor: M.Armor;
    rings: M.Ring;
    amulets: M.Amulet;
    rods: M.Rod;
    talismans: M.Talisman;
    materials: M.Material;
    food: M.Food;
    bait: M.Bait;
    misc: M.MiscItem;
    pets: M.Pet;
    "pet-items": M.PetItem;
    fish: M.Fish;
    crops: M.Crop;
    pests: M.Pest;
    mutations: M.Mutation;
    structures: M.Structure;
    "farm-events": M.FarmEvent;
    enemies: M.Enemy;
    statuses: M.Status;
    recipes: M.Recipe;
    vendors: M.Vendor;
    reforges: M.Reforge;
    mayors: M.Mayor;
    dungeons: M.Dungeon;
    "dungeon-layouts": M.DungeonLayout;
    "room-styles": M.RoomStyle;
    quests: M.Quest;
};

/** Each config file's model. */
export type ConfigModelOf = {
    fishing: M.FishingConfig;
    farming: M.FarmingConfig;
    player: M.PlayerConfig;
    spawns: M.SpawnsConfig;
    "starter-kit": M.StarterKitConfig;
    elections: M.ElectionsConfig;
    economy: M.EconomyConfig;
    weapons: M.WeaponsConfig;
    "chest-tiers": M.ChestTiersConfig;
    pets: M.PetsConfig;
    wardrobe: M.WardrobeConfig;
};

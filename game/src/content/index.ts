import { GEO_CHEST_TIERS, GEO_FARM_SIZE, GEO_MAX_SKILL_LEVEL } from "@geo/shared";
import type { Action, Condition, EffectDef } from "../engine/engine.types";
import { layoutProblems, type DungeonRoomRef } from "../dungeons/dungeon-map";
import { buildContent } from "./build";
import type { ChestLootPool, GameContent, ItemDef } from "./content.types";
import { GameDataError, readGameData } from "./data";
import { DATA_FILES } from "./data.generated";
import type { GameData } from "./data.schema";
import { FARMING_CARD_IDS, isFarmingCardId } from "./farming";
import { FISHING_CARD_IDS, isFishingCardId } from "./fishing";

export type GameConfig = GameData["config"];

/** What an NPC pays for one of this item, in coins. A compact item is worth what it holds. */
function sellValueIn(content: GameContent, config: GameConfig, item: ItemDef): number {
    if (item.sellValue !== undefined) return item.sellValue;
    if (item.kind === "material" && item.compactOf) {
        const base = content.items[item.compactOf.itemId];
        if (base) return sellValueIn(content, config, base) * item.compactOf.ratio;
    }
    return config.economy.placeholderSellValue[item.rarity];
}

/** Whether vendors buy this item: every vendor buys anything with an NPC sell value that isn't Soulbound. */
function npcBuysIn(content: GameContent, config: GameConfig, item: ItemDef): boolean {
    return !item.soulbound && sellValueIn(content, config, item) > 0;
}

/** Status ids an action list applies, removes or asks about, effects included. */
function statusesUsed(actions: Action[] = [], effects: EffectDef[] = []): string[] {
    const fromActions = (list: Action[]) =>
        list.flatMap((action) => (action.type === "applyStatus" ? [action.status] : action.type === "removeStatus" ? [action.status] : []));
    return [...fromActions(actions), ...effects.flatMap((effect) => [...fromActions(effect.actions), ...statusesIn(effect.conditions)])];
}

/** Statuses named in conditions, inside `not` and `any` too. */
function statusesIn(conditions: Condition[] = []): string[] {
    return conditions.flatMap((condition) => {
        switch (condition.type) {
            case "hasStatus":
            case "lacksStatus":
                return [condition.status];
            case "not":
                return statusesIn([condition.condition]);
            case "any":
                return statusesIn(condition.conditions);
            default:
                return [];
        }
    });
}

const isRange = ({ min, max }: { min: number; max: number }) => max >= min;

/**
 * Every rule that spans files: references exist, chests can't come out
 * empty, vendors can't print coins. Returns every problem found, so one
 * start shows them all.
 */
export function checkContent(content: GameContent, config: GameConfig): string[] {
    const problems: string[] = [];
    const item = (id: string) => content.items[id];
    const needItem = (where: string, id: string) => {
        if (!item(id)) problems.push(`${where} uses unknown item "${id}"`);
    };
    const needStatuses = (where: string, actions?: Action[], effects?: EffectDef[]) => {
        for (const id of statusesUsed(actions, effects)) {
            if (!content.statuses[id]) problems.push(`${where} uses unknown status "${id}"`);
        }
    };

    const weaponTags = new Set([...config.weapons.types, ...config.weapons.styles]);
    if (!config.weapons.types.includes(config.weapons.unarmed.type)) {
        problems.push(`Unarmed has unknown type "${config.weapons.unarmed.type}" (config/weapons.ts)`);
    }
    if (!config.weapons.styles.includes(config.weapons.unarmed.style)) {
        problems.push(`Unarmed has unknown style "${config.weapons.unarmed.style}" (config/weapons.ts)`);
    }
    for (const card of Object.values(content.cards)) {
        needStatuses(`Card "${card.id}"`, card.actions, card.effects);
        for (const id of statusesIn(card.playableIf)) {
            if (!content.statuses[id]) problems.push(`Card "${card.id}" playableIf uses unknown status "${id}"`);
        }
        for (const tag of card.requiresWeapon ?? []) {
            if (!weaponTags.has(tag)) problems.push(`Card "${card.id}" requires unknown weapon tag "${tag}" (config/weapons.ts)`);
        }
        for (const type of card.requiresOffHand ?? []) {
            if (!config.weapons.offHandTypes.includes(type)) {
                problems.push(`Card "${card.id}" requires unknown off-hand type "${type}" (config/weapons.ts)`);
            }
        }
        if (card.skill === "fishing" && !isFishingCardId(card.id)) {
            problems.push(`Fishing card "${card.id}" has no rules in fishing/fishing-run.ts (known: ${FISHING_CARD_IDS.join(", ")})`);
        }
    }
    for (const id of FISHING_CARD_IDS) {
        if (!content.cards[id]) problems.push(`Fishing card "${id}" has rules in fishing/fishing-run.ts but no file in data/cards`);
    }
    for (const card of Object.values(content.cards)) {
        if (card.skill === "farming" && !isFarmingCardId(card.id)) {
            problems.push(`Farming card "${card.id}" has no rules in farming/farm.ts (known: ${FARMING_CARD_IDS.join(", ")})`);
        }
    }
    for (const id of FARMING_CARD_IDS) {
        if (!content.cards[id]) problems.push(`Farming card "${id}" has rules in farming/farm.ts but no file in data/cards`);
    }

    const seedsSeen = new Map<string, string>();
    for (const crop of Object.values(content.crops)) {
        for (const itemId of [crop.seed, crop.produce]) {
            const entry = item(itemId);
            if (!entry) problems.push(`Crop "${crop.id}" uses unknown item "${itemId}"`);
            else if (entry.kind !== "material" || entry.skill !== "farming") problems.push(`Crop "${crop.id}" uses "${itemId}", which isn't a farming material`);
        }
        const other = seedsSeen.get(crop.seed);
        if (other) problems.push(`Crops "${other}" and "${crop.id}" share the seed "${crop.seed}"`);
        seedsSeen.set(crop.seed, crop.id);
        if (!isRange(crop.yield) || !isRange(crop.seedsBack)) problems.push(`Crop "${crop.id}": a min is over its max`);
    }

    for (const mutation of Object.values(content.mutations)) {
        const where = `Mutation "${mutation.id}"`;
        if (content.crops[mutation.id]) problems.push(`${where} shares its id with a crop`);
        const produce = item(mutation.produce);
        if (!produce) problems.push(`${where} uses unknown item "${mutation.produce}"`);
        else if (produce.kind !== "material" || produce.skill !== "farming") problems.push(`${where} uses "${mutation.produce}", which isn't a farming material`);
        if (!isRange(mutation.yield)) problems.push(`${where}: yield min is over its max`);
        for (const parent of mutation.recipe.parents) {
            if (!content.crops[parent.cropId]) problems.push(`${where} needs unknown crop "${parent.cropId}" (mutations can't be parents yet)`);
        }
        if (mutation.recipe.parents.reduce((sum, parent) => sum + parent.count, 0) > 8) problems.push(`${where} needs more than 8 parents`);
        if (mutation.recipe.pest && !content.pests[mutation.recipe.pest]) problems.push(`${where} needs unknown pest "${mutation.recipe.pest}"`);
        if (mutation.recipe.structure && !content.structures[mutation.recipe.structure]) problems.push(`${where} needs unknown structure "${mutation.recipe.structure}"`);
        if (mutation.recipe.event && !content.farmEvents[mutation.recipe.event]) problems.push(`${where} needs unknown farm event "${mutation.recipe.event}"`);
    }
    for (const global of config.farming.globalEvents) {
        const event = content.farmEvents[global.eventId];
        if (!event) problems.push(`config/farming.ts globalEvents has unknown farm event "${global.eventId}"`);
        // Only events that act on the turn itself can be global.
        else if (event.effect.kind !== "blood-moon" && event.effect.kind !== "meteor-shower") {
            problems.push(`config/farming.ts globalEvents: "${global.eventId}" can't be global (only blood-moon and meteor-shower kinds)`);
        }
    }
    for (const event of Object.values(content.farmEvents)) {
        if (event.effect.kind === "meteor-shower" && !item(event.effect.itemId)) problems.push(`Farm event "${event.id}" drops unknown item "${event.effect.itemId}"`);
        if (event.effect.kind !== "merchant") continue;
        for (const offer of event.effect.stock) {
            if (!item(offer.itemId)) problems.push(`Farm event "${event.id}" sells unknown item "${offer.itemId}"`);
        }
    }

    const { waste, shrine, unlockCost } = config.farming;
    if (!item(unlockCost.itemId)) problems.push(`config/farming.ts unlockCost uses unknown item "${unlockCost.itemId}"`);
    for (const structure of Object.values(content.structures)) {
        if (structure.effect.kind === "compost" && !item(structure.effect.itemId)) problems.push(`Structure "${structure.id}" makes unknown item "${structure.effect.itemId}"`);
    }
    for (const mutation of Object.values(content.mutations)) {
        const blessing = mutation.recipe.blessing;
        if (blessing && !shrine.blessings.some((entry) => entry.id === blessing)) problems.push(`Mutation "${mutation.id}" needs unknown Shrine blessing "${blessing}"`);
    }
    for (const offer of config.farming.pesthunter.shop) {
        if (!item(offer.itemId)) problems.push(`config/farming.ts pesthunter sells unknown item "${offer.itemId}"`);
    }
    if (!content.pests[waste.pest]) problems.push(`config/farming.ts waste.pest is unknown pest "${waste.pest}"`);
    if (!shrine.blessings.some((blessing) => !blessing.curse)) problems.push("config/farming.ts shrine needs a blessing that isn't a curse");
    if (!shrine.blessings.some((blessing) => blessing.curse)) problems.push("config/farming.ts shrine needs a curse");
    for (const structure of Object.values(content.structures)) {
        if (structure.effect.kind !== "portal") continue;
        for (const pestId of structure.effect.pests) {
            if (!content.pests[pestId]) problems.push(`Structure "${structure.id}" brings unknown pest "${pestId}"`);
        }
    }

    for (const pest of Object.values(content.pests)) {
        for (const cropId of pest.likes) {
            if (!content.crops[cropId]) problems.push(`Pest "${pest.id}" likes unknown crop "${cropId}"`);
        }
        for (const drop of pest.drops) {
            if (!item(drop.itemId)) problems.push(`Pest "${pest.id}" drops unknown item "${drop.itemId}"`);
            if (!isRange(drop.quantity)) problems.push(`Pest "${pest.id}": a drop's min is over its max`);
        }
    }

    for (const entry of Object.values(content.items)) {
        if (entry.kind === "equipment" || entry.kind === "talisman") needStatuses(`Item "${entry.id}"`, [], entry.effects);
        if (entry.kind === "equipment") {
            for (const cardId of entry.unlocksCards ?? []) {
                if (!content.cards[cardId]) problems.push(`Item "${entry.id}" unlocks unknown card "${cardId}"`);
            }
            for (const { skill, level } of entry.skills ?? []) {
                if (level > GEO_MAX_SKILL_LEVEL) problems.push(`Item "${entry.id}" needs ${skill} ${level}, past the max of ${GEO_MAX_SKILL_LEVEL}`);
            }
            if (entry.weapon && !config.weapons.types.includes(entry.weapon.type)) {
                problems.push(`Weapon "${entry.id}" has unknown type "${entry.weapon.type}" (config/weapons.ts)`);
            }
            if (entry.weapon && !config.weapons.styles.includes(entry.weapon.style)) {
                problems.push(`Weapon "${entry.id}" has unknown style "${entry.weapon.style}" (config/weapons.ts)`);
            }
            if (entry.offHand && entry.slot !== "offHand") problems.push(`Item "${entry.id}" has an off-hand type but isn't worn in the off-hand`);
            if (entry.offHand && !config.weapons.offHandTypes.includes(entry.offHand.type)) {
                problems.push(`Item "${entry.id}" has unknown off-hand type "${entry.offHand.type}" (config/weapons.ts)`);
            }
        }
    }
    const rarityOrder = ["common", "uncommon", "rare", "epic", "legendary"];
    for (const pet of Object.values(content.pets)) {
        const where = `Pet "${pet.id}"`;
        const top = rarityOrder.indexOf(pet.rarities[pet.rarities.length - 1]!);
        const perRarityKeys = [...pet.stats, ...pet.abilities.flatMap((ability) => ability.modifiers)].flatMap((stat) =>
            typeof stat.perLevel === "number" ? [] : Object.keys(stat.perLevel),
        );
        for (const rarity of perRarityKeys) {
            if (!pet.rarities.includes(rarity as (typeof pet.rarities)[number])) problems.push(`${where} sets a stat for "${rarity}", which it doesn't come in`);
        }
        if (new Set(pet.abilities.map((ability) => ability.id)).size !== pet.abilities.length) problems.push(`${where} lists an ability id twice`);
        for (const ability of pet.abilities) {
            if (rarityOrder.indexOf(ability.from) > top) problems.push(`${where} ability "${ability.id}" is from ${ability.from}, past its highest rarity`);
        }
        // Kat needs a price for every step up.
        for (const rarity of pet.rarities.slice(0, -1)) {
            const price = pet.upgrades?.[rarity] ?? config.pets.upgrades[rarity];
            if (!price) problems.push(`${where} has no Kat price from ${rarity} (its file or config/pets.ts upgrades)`);
            for (const { itemId } of price?.items ?? []) needItem(`${where} upgrade from ${rarity}`, itemId);
        }
    }
    for (const price of Object.values(config.pets.upgrades)) {
        for (const { itemId } of price?.items ?? []) needItem("config/pets.ts upgrades", itemId);
    }

    for (const food of Object.values(content.foods)) needStatuses(`Food "${food.id}"`, food.actions, food.effects);
    for (const status of Object.values(content.statuses)) needStatuses(`Status "${status.id}"`, [], status.effects);

    for (const tier of GEO_CHEST_TIERS) {
        if (!content.chestTiers[tier]) problems.push(`Chest tier "${tier}" is missing from config/chest-tiers.ts`);
    }

    for (const enemy of Object.values(content.enemies)) {
        needStatuses(`Enemy "${enemy.id}"`, enemy.moves.flatMap((move) => move.actions), enemy.effects);
        if (!enemy.moves.some((move) => move.weight > 0)) problems.push(`Enemy "${enemy.id}" needs a move with weight above 0`);
        for (const move of enemy.moves) {
            if (move.next && !enemy.moves.some((other) => other.id === move.next)) {
                problems.push(`Enemy "${enemy.id}" move "${move.id}" has unknown next "${move.next}"`);
            }
        }
        for (const drop of enemy.loot) {
            needItem(`Enemy "${enemy.id}" loot`, drop.itemId);
            if (!isRange(drop.quantity)) problems.push(`Enemy "${enemy.id}" loot "${drop.itemId}": quantity min is over max`);
        }
        if (enemy.coins && !isRange(enemy.coins)) problems.push(`Enemy "${enemy.id}" coins: min is over max`);
        // Every chest must give something: no empty pools, no zero rolls.
        const chests = enemy.chests;
        if (!chests) continue;
        const where = `Enemy "${enemy.id}" chests`;
        if (!chests.offers.some((offer) => offer.chance === 1)) {
            problems.push(`${where} need one offer with chance 1, so a selection is never empty`);
        }
        for (const offer of chests.offers) {
            if (offer.pools.length === 0 || !offer.pools.some((pool) => pool.rolls.min >= 1)) {
                problems.push(`${where}: "${offer.tier}" can come out empty`);
            }
            for (const pool of offer.pools) {
                if (!isRange(pool.rolls) || pool.entries.length === 0) problems.push(`${where}: "${offer.tier}" has a bad pool`);
                for (const entry of pool.entries) {
                    needItem(`${where}: "${offer.tier}"`, entry.itemId);
                    if (!isRange(entry.quantity)) problems.push(`${where}: "${offer.tier}" "${entry.itemId}" quantity min is over max`);
                }
            }
        }
    }

    const vendors = Object.values(content.vendors);
    for (const vendor of vendors) {
        for (const offer of vendor.sells) {
            const sold = item(offer.itemId);
            if (!sold) {
                problems.push(`Vendor "${vendor.id}" sells unknown item "${offer.itemId}"`);
                continue;
            }
            // Buying from one vendor and selling to another must never profit.
            const value = sellValueIn(content, config, sold);
            if (npcBuysIn(content, config, sold) && offer.price < value) {
                problems.push(`Vendor "${vendor.id}" sells "${offer.itemId}" for ${offer.price}, under the ${value} vendors pay`);
            }
        }
        if (vendor.reforge) {
            for (const target of ["weapon", "armor"] as const) {
                const count = Object.values(content.reforges).filter((reforge) => reforge.appliesTo.includes(target)).length;
                if (count < 2) problems.push(`Vendor "${vendor.id}" reforges, but there are under 2 ${target} reforges to roll between`);
            }
        }
    }

    for (const structure of Object.values(content.structures)) {
        for (const { itemId } of structure.cost) needItem(`Structure "${structure.id}"`, itemId);
        if (new Set(structure.cost.map((entry) => entry.itemId)).size !== structure.cost.length) problems.push(`Structure "${structure.id}" lists a cost twice`);
    }

    for (const recipe of Object.values(content.recipes)) {
        for (const { itemId } of [...recipe.inputs, recipe.output]) needItem(`Recipe "${recipe.id}"`, itemId);
        if (new Set(recipe.inputs.map((input) => input.itemId)).size !== recipe.inputs.length) {
            problems.push(`Recipe "${recipe.id}" lists an input twice`);
        }
        for (const { skill, level } of recipe.skills ?? []) {
            if (level > GEO_MAX_SKILL_LEVEL) problems.push(`Recipe "${recipe.id}" needs ${skill} ${level}, past the max of ${GEO_MAX_SKILL_LEVEL}`);
        }
    }

    const { elections, spawns, fishing, farming } = config;
    if (farming.startSize > GEO_FARM_SIZE || farming.startSize % 2 === 0) {
        problems.push(`config/farming.ts: startSize must be odd and at most ${GEO_FARM_SIZE}`);
    }
    if (!content.mayors[elections.firstMayor]) problems.push(`config/elections.ts: first mayor "${elections.firstMayor}" doesn't exist`);
    // Each election leaves the mayor in office out, so the pool needs one spare.
    if (Object.keys(content.mayors).length <= elections.candidates) {
        problems.push(`An election needs more than ${elections.candidates} mayors to pick ${elections.candidates} candidates`);
    }
    checkDungeons(content, problems);
    for (const quest of Object.values(content.quests)) {
        if (new Set(quest.objectives.map((objective) => objective.id)).size !== quest.objectives.length) {
            problems.push(`Quest "${quest.id}" uses an objective id twice`);
        }
        for (const objective of quest.objectives) {
            if (objective.type === "kill" && !content.enemies[objective.enemy]) {
                problems.push(`Quest "${quest.id}" has unknown enemy "${objective.enemy}"`);
            }
            if (objective.type === "dungeon" && !content.dungeons[objective.dungeon]) {
                problems.push(`Quest "${quest.id}" has unknown dungeon "${objective.dungeon}"`);
            }
            if (objective.type === "craft" && !content.recipes[objective.recipe]) {
                problems.push(`Quest "${quest.id}" has unknown recipe "${objective.recipe}"`);
            }
        }
        for (const { itemId } of quest.rewards.items) {
            if (!content.items[itemId]) problems.push(`Quest "${quest.id}" rewards unknown item "${itemId}"`);
        }
        for (const before of quest.after) {
            if (!content.quests[before]) problems.push(`Quest "${quest.id}" comes after unknown quest "${before}"`);
        }
        // A Trial's reward is the tier it opens.
        if (quest.unlocksTier === null && quest.rewards.coins === 0 && quest.rewards.items.length === 0) {
            problems.push(`Quest "${quest.id}" has no reward`);
        }
        if (quest.unlocksTier !== null && quest.unlocksTier > spawns.tierUnlockLevels.length) {
            problems.push(`Quest "${quest.id}" unlocks tier ${quest.unlocksTier}, but config/spawns.ts has only ${spawns.tierUnlockLevels.length}`);
        }
    }
    const trialTiers = Object.values(content.quests).flatMap((quest) => (quest.unlocksTier === null ? [] : [quest.unlocksTier]));
    if (new Set(trialTiers).size !== trialTiers.length) problems.push("Two quests are the Trial for the same tier");
    // `after` must never loop, or the quests in the loop could never be given.
    const settled = new Set<string>();
    const visit = (id: string, path: string[]): void => {
        if (settled.has(id)) return;
        if (path.includes(id)) {
            problems.push(`Quests come after each other in a loop: ${[...path, id].join(" → ")}`);
            return;
        }
        for (const before of content.quests[id]?.after ?? []) visit(before, [...path, id]);
        settled.add(id);
    };
    for (const id of Object.keys(content.quests)) visit(id, []);
    for (const { enemyId } of spawns.enemies) {
        if (!content.enemies[enemyId]) problems.push(`config/spawns.ts spawns unknown enemy "${enemyId}"`);
    }
    const unlocks = spawns.tierUnlockLevels;
    if (unlocks[0] !== 1) problems.push("config/spawns.ts: tierUnlockLevels must start at 1, so new players have tier 1");
    if (unlocks.some((level, i) => i > 0 && level <= unlocks[i - 1]!)) problems.push("config/spawns.ts: tierUnlockLevels must go up");
    if (unlocks.some((level) => level > GEO_MAX_SKILL_LEVEL)) problems.push(`config/spawns.ts: tierUnlockLevels is past the max level of ${GEO_MAX_SKILL_LEVEL}`);
    if (!spawns.enemies.some(({ enemyId }) => content.enemies[enemyId]?.tier === 1)) {
        problems.push("config/spawns.ts: enemies needs a tier 1 enemy, for new players");
    }
    for (const enemy of Object.values(content.enemies)) {
        if (enemy.tier > unlocks.length) problems.push(`Enemy "${enemy.id}" is tier ${enemy.tier}, but tierUnlockLevels only opens ${unlocks.length}`);
        const habitats = enemy.habitats ?? [];
        if (new Set(habitats.map((habitat) => habitat.near)).size !== habitats.length) {
            problems.push(`Enemy "${enemy.id}" lists a habitat twice`);
        }
        for (const habitat of habitats) {
            if (habitat.waters && habitat.near !== "water") problems.push(`Enemy "${enemy.id}" gives waters to its ${habitat.near} habitat`);
        }
    }
    // Farther, water creatures would land inland, facing water out of reach.
    if (spawns.habitats.water.influenceMetres > spawns.maxSpawnMetres) problems.push("config/spawns.ts: water influenceMetres is past maxSpawnMetres");
    if (spawns.minSpawnMetres > spawns.maxSpawnMetres) problems.push("config/spawns.ts: minSpawnMetres is past maxSpawnMetres");
    if (spawns.maxSpawnMetres > spawns.reachMetres) problems.push("config/spawns.ts: maxSpawnMetres is past reachMetres");
    if (spawns.lifetimeMinutes.min > spawns.lifetimeMinutes.max) problems.push("config/spawns.ts: lifetimeMinutes min is over max");
    if (fishing.tuning.zoneLow >= fishing.tuning.zoneHigh) problems.push("config/fishing.ts: zoneLow must be under zoneHigh");
    for (const [water, creatures] of Object.entries(fishing.seaCreatures)) {
        for (const { enemyId } of creatures) {
            if (!content.enemies[enemyId]) problems.push(`config/fishing.ts: ${water} seaCreatures has unknown enemy "${enemyId}"`);
        }
    }

    const kit = config["starter-kit"];
    for (const { itemId } of kit.items) needItem("config/starter-kit.ts items", itemId);
    for (const [slot, itemId] of kit.loadouts.flatMap((loadout) => Object.entries(loadout.equip))) {
        const gear = item(itemId);
        if (gear?.kind !== "equipment" || gear.slot !== slot) problems.push(`config/starter-kit.ts equips "${itemId}", which isn't ${slot} gear`);
        else if (!kit.items.some((granted) => granted.itemId === itemId)) problems.push(`config/starter-kit.ts equips "${itemId}" without granting it`);
    }
    for (const { itemId } of kit.lunchbox) {
        if (!content.foods[itemId]) problems.push(`config/starter-kit.ts lunchbox has "${itemId}", which isn't food`);
    }
    for (const { itemId } of kit.bait) {
        const bait = item(itemId);
        if (bait?.kind !== "consumable" || !bait.bait) problems.push(`config/starter-kit.ts bait has "${itemId}", which isn't bait`);
    }
    return problems;
}

/** Dungeons and their layouts: enemies, styles and keys exist, and every roll of every layout is playable. */
function checkDungeons(content: GameContent, problems: string[]) {
    const needStyle = (where: string, style: string | null) => {
        if (style && !content.roomStyles[style]) problems.push(`${where} uses unknown room style "${style}"`);
    };
    const needRoom = (where: string, ref: DungeonRoomRef) => {
        if (typeof ref === "string") return;
        needStyle(where, ref.style);
        if (ref.lock && !content.items[ref.lock]) problems.push(`${where} is locked by unknown item "${ref.lock}"`);
    };
    // Every pool must give something: rolls at least once, from items that exist.
    const checkPools = (where: string, pools: ChestLootPool[]) => {
        if (pools.length > 0 && !pools.some((pool) => pool.rolls.min >= 1)) problems.push(`${where} can come out empty`);
        for (const pool of pools) {
            if (!isRange(pool.rolls) || pool.entries.length === 0) problems.push(`${where} has a bad pool`);
            for (const entry of pool.entries) {
                if (!content.items[entry.itemId]) problems.push(`${where} has unknown item "${entry.itemId}"`);
                if (!isRange(entry.quantity)) problems.push(`${where} "${entry.itemId}" quantity min is over max`);
            }
        }
    };
    for (const dungeon of Object.values(content.dungeons)) {
        const name = `Dungeon "${dungeon.id}"`;
        if (!content.enemies[dungeon.boss]) problems.push(`${name} has unknown boss "${dungeon.boss}"`);
        const pools = { encounterEnemies: dungeon.encounterEnemies, starEnemies: dungeon.starEnemies, minibossEnemies: dungeon.minibossEnemies };
        for (const [field, ids] of Object.entries(pools)) {
            for (const enemyId of ids) if (!content.enemies[enemyId]) problems.push(`${name} ${field} has unknown enemy "${enemyId}"`);
        }
        needStyle(name, dungeon.roomStyle);
        for (const [key, room] of Object.entries(dungeon.rooms)) needRoom(`${name} room "${key}"`, room);
        dungeon.pool.forEach((entry, index) => needRoom(`${name} pool ${index + 1}`, entry.room));
        const { gold, ruby, void: voidScore } = dungeon.chestScores;
        if (!(gold <= ruby && ruby <= voidScore)) problems.push(`${name} chestScores must climb: gold ≤ ruby ≤ void`);
        checkPools(`${name} roomLoot`, dungeon.roomLoot);
        for (const [tier, pools] of Object.entries(dungeon.chests)) checkPools(`${name} chests "${tier}"`, pools);
        if (dungeon.layouts.length === 0) continue;
        if (!dungeon.chests.plain) problems.push(`${name} has layouts, so it needs chests.plain: the chest everyone can take`);
        if (dungeon.roomLoot.length === 0) problems.push(`${name} has layouts, so it needs roomLoot for its loot rooms`);
        if (dungeon.stars === null) problems.push(`${name} has layouts, so it needs stars: the number of star rooms in each`);
        if (dungeon.encounterEnemies.length === 0) problems.push(`${name} has layouts, so it needs encounterEnemies`);
        if (dungeon.starEnemies.length === 0) problems.push(`${name} has layouts, so it needs starEnemies`);
        if (dungeon.minibosses > 0 && dungeon.minibossEnemies.length === 0) problems.push(`${name} has gold rooms, so it needs minibossEnemies`);
        for (const layout of dungeon.layouts) {
            const where = `Dungeon layout "${layout.id}"`;
            needStyle(where, layout.roomStyle);
            for (const [key, ref] of Object.entries(layout.legend)) needRoom(`${where} room "${key}"`, ref);
            layout.place.forEach((rule, index) => needRoom(`${where} place ${index + 1}`, rule.room));
            for (const problem of layoutProblems(dungeon, layout)) problems.push(`${where}: ${problem}`);
        }
    }
    for (const layout of Object.values(content.dungeonLayouts)) {
        if (!content.dungeons[layout.dungeon]) problems.push(`Dungeon layout "${layout.id}" is for unknown dungeon "${layout.dungeon}"`);
    }
}

/** The checked data files, as loaded from `geo/data/`. */
const GAME_DATA = readGameData(DATA_FILES);
const built = buildContent(GAME_DATA);

/** Every tuning number in `data/config/`. */
export const GAME_CONFIG: GameConfig = GAME_DATA.config;

/**
 * All geo-game content, indexed by id, built from `geo/data/` at startup.
 * A bad file or broken reference fails the start, listing every problem.
 */
export const CONTENT: GameContent = built.content;

const problems = checkContent(CONTENT, GAME_CONFIG);
if (problems.length > 0) throw new GameDataError(problems);

export const sellValueOf = (item: ItemDef) => sellValueIn(CONTENT, GAME_CONFIG, item);
export const npcBuys = (item: ItemDef) => npcBuysIn(CONTENT, GAME_CONFIG, item);

/** Bait that draws sea creatures and makes the bite come sooner. */
export const CHUM_BAIT_IDS = built.chumBaitIds;

const { fishing, elections } = GAME_CONFIG;
export const RARITY_WEIGHT = fishing.rarityWeight;
export const WATER_RARITIES = fishing.waterRarities;
export const RARITY_DIFFICULTY = fishing.rarityDifficulty;
export const RARITY_POWER = fishing.rarityPower;
export const PAR_TURNS = fishing.parTurns;
export const FISHING_TUNING = fishing.tuning;
/** The enemies a sea creature can be, per water. */
export const SEA_CREATURES = fishing.seaCreatures;

/** Every farming tuning number (`data/config/farming.ts`). */
export const FARMING = GAME_CONFIG.farming;

export const ELECTION_RULES = elections;
/** In office before any election has finished. */
export const FIRST_MAYOR_ID = elections.firstMayor;

export { reforgeModifiers, reforgesFor, reforgeTarget } from "./reforges";
export type { DungeonDef, EnemyDef, GameContent, ItemDef, MayorDef, QuestDef, RecipeDef, ReforgeDef, VendorDef } from "./content.types";

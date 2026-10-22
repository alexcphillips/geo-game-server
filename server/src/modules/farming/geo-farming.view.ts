import {
    GEO_FARM_SIZE,
    type GeoCropView,
    type GeoFarmEventView,
    type GeoFarmContests,
    type GeoFarmGain,
    type GeoGlobalFarmEvent,
    type GeoFarmPestIntent,
    type GeoFarmView,
    type GeoFarmWeather,
    type GeoResearchLab,
} from "@geo/shared";
import { CONTENT, FARMING } from "../../content";
import { FARMING_CARDS, isFarmingCardId, type GrowsDef, type MutationRecipe } from "../../content/farming";
import {
    forecast,
    groundAt,
    isRipe,
    isUnlockable,
    playsLeft,
    nextTurnAt,
    rotChance,
    tileXY,
    unlockCost,
    weekEndsAt,
    type FarmHandCard,
    type FarmState,
    type WeatherLookup,
} from "../../farming/farm";

const where = (index: number) => {
    const { x, y } = tileXY(index);
    return `(${x + 1}, ${y + 1})`;
};

const growsDef = (id: string): GrowsDef | undefined => CONTENT.crops[id] ?? CONTENT.mutations[id];

const WEATHER_NAMES: Record<GeoFarmWeather, string> = { clear: "a Clear day", rain: "Rain", heatwave: "a Heatwave", frost: "a Frost" };

/** "2 ripe Wheat next to an empty tile, on a Heatwave, with a Field Mouse near". */
export function recipeText(recipe: MutationRecipe): string {
    const parents = recipe.parents
        .map((parent) => `${parent.count > 1 ? `${parent.count} ` : ""}ripe ${CONTENT.crops[parent.cropId]?.name ?? parent.cropId}`)
        .join(" and ");
    const parts = [`${parents} next to an empty tile`];
    if (recipe.weather) parts.push(`on ${WEATHER_NAMES[recipe.weather]}`);
    if (recipe.event) parts.push(`during a ${CONTENT.farmEvents[recipe.event]?.name ?? recipe.event}`);
    if (recipe.pest) parts.push(`with a ${CONTENT.pests[recipe.pest]?.name ?? recipe.pest} on or beside it`);
    if (recipe.structure) parts.push(`with a ${CONTENT.structures[recipe.structure]?.name ?? recipe.structure} beside it`);
    if (recipe.blessing) parts.push(`under ${FARMING.shrine.blessings.find((entry) => entry.id === recipe.blessing)?.name ?? recipe.blessing}`);
    if (recipe.ground) parts.push(`on ${recipe.ground} ground`);
    return parts.join(", ");
}

/** The Research Lab: what's been found, and what could be turned in from what the player holds. */
function toLab(state: FarmState, held: Record<string, number>): GeoResearchLab {
    const mutations = Object.values(CONTENT.mutations);
    return {
        found: state.lab.flatMap((id) => {
            const mutation = CONTENT.mutations[id];
            if (!mutation) return [];
            const { name, icon, description, produce } = mutation;
            return [{ mutationId: id, name, icon, description, produceItemId: produce, recipe: recipeText(mutation.recipe) }];
        }),
        total: mutations.length,
        ready: mutations
            .filter((mutation) => !state.lab.includes(mutation.id) && (held[mutation.produce] ?? 0) > 0)
            .map((mutation) => ({ mutationId: mutation.id, itemId: mutation.produce, ...mutation.research })),
    };
}

/** Crops to draw and plan with: every plain crop, and the mutations found or growing here. */
function cropViews(state: FarmState): GeoCropView[] {
    const growing = new Set(state.tiles.flatMap((tile) => (tile.crop ? [tile.crop.cropId] : [])));
    const mutations = Object.values(CONTENT.mutations).filter((mutation) => state.lab.includes(mutation.id) || growing.has(mutation.id));
    return [
        ...Object.values(CONTENT.crops).map((crop) => ({
            id: crop.id,
            name: crop.name,
            icon: crop.icon,
            seedItemId: crop.seed,
            produceItemId: crop.produce,
            stages: crop.stages,
            mutation: false,
        })),
        ...mutations.map((mutation) => ({
            id: mutation.id,
            name: mutation.name,
            icon: mutation.icon,
            seedItemId: null,
            produceItemId: mutation.produce,
            stages: mutation.stages,
            mutation: true,
        })),
    ];
}

/** A pest's next move in words, naming the crop it's after as things stand. */
function intentText(state: FarmState, from: number, intent: GeoFarmPestIntent): string {
    const crop = state.tiles[intent.tile]?.crop;
    const cropName = crop ? (growsDef(crop.cropId)?.name ?? "crop") : null;
    switch (intent.kind) {
        case "eat":
            if (!cropName) return `Goes for ${where(intent.tile)}, but nothing grows there now`;
            return intent.tile === from ? `Eats the ${cropName} here` : `Moves to ${where(intent.tile)} and eats the ${cropName}`;
        case "move":
            return intent.tile === from ? "Sits tight" : `Moves to ${where(intent.tile)}`;
        case "sap":
            return cropName ? `Saps the ${cropName}: it won't grow` : "Sits tight";
        case "breed":
            return `Breeds onto ${where(intent.tile)}`;
    }
}

/** A farm event as the app shows it. */
function eventView(eventId: string | null, offers: GeoFarmEventView["offers"]): GeoFarmEventView | null {
    const event = eventId ? CONTENT.farmEvents[eventId] : undefined;
    if (!event) return null;
    return { id: event.id, name: event.name, icon: event.icon, description: event.description, offers };
}


/** What the last action did, for the reply. */
export type FarmReport = { log: string[]; gained: GeoFarmGain[]; xpGained: number };

const NO_REPORT: FarmReport = { log: [], gained: [], xpGained: 0 };

/** The farm as the app sees it: every tile, the clock and the hand. */
/** Everything a farm view needs besides the farm itself, loaded by the repository. */
export type FarmViewExtras = {
    hand: FarmHandCard[];
    /** How many of each item the player holds, for the Research Lab and structures. */
    held: Record<string, number>;
    weather: WeatherLookup;
    contests: GeoFarmContests;
    global: GeoGlobalFarmEvent | null;
    farmingLevel: number;
    /** Farming Fortune from gear, talismans and global perks. */
    fortune: number;
};

export function toFarmView(state: FarmState, { hand, held, weather, contests, global, farmingLevel, fortune }: FarmViewExtras, report: FarmReport = NO_REPORT): GeoFarmView {
    const sky = forecast(state, FARMING, weather);
    const standing = new Set(state.tiles.flatMap((tile) => [tile.structure?.structureId, tile.roof?.structureId].filter((id): id is string => Boolean(id))));
    // The ground each tile will have on the coming turn.
    const coming = sky[0]!;
    return {
        size: GEO_FARM_SIZE,
        tiles: state.tiles.map((tile, index) => {
            const def = tile.crop ? growsDef(tile.crop.cropId) : undefined;
            return {
                index,
                ...tileXY(index),
                owned: tile.owned,
                unlockable: isUnlockable(state, index),
                crop:
                    tile.crop && def
                        ? {
                              cropId: def.id,
                              stage: tile.crop.stage,
                              stages: def.stages,
                              ripe: isRipe(tile.crop, def),
                              ripeTurns: tile.crop.ripeTurns,
                              rotChance: rotChance(tile.crop, def, FARMING),
                              held: tile.crop.held,
                              rotten: tile.crop.rotten,
                          }
                        : null,
                ground: tile.owned ? groundAt(state, index, coming, CONTENT.structures) : "normal",
                blueprint: tile.blueprint,
                trap: tile.trap,
                pollinated: tile.pollinated,
                structure: tile.structure,
                partOf: tile.partOf,
                setups: state.setups.filter((setup) => setup.tile === index).map(({ mutationId, cycles }) => ({ mutationId, cycles })),
                roof: tile.roof,
                waste: tile.waste,
            };
        }),
        turn: state.turn,
        playsLeft: playsLeft(state),
        farmingLevel,
        fortune,
        nextTurnAt: nextTurnAt(state, FARMING).toISOString(),
        turnHours: FARMING.turnHours,
        maxTurnsAway: FARMING.maxTurnsAway,
        forecast: sky,
        events: {
            next: eventView(state.nextEvent, []),
            active: state.activeEvent ? eventView(state.activeEvent.eventId, state.activeEvent.offers) : null,
        },
        global,
        contests,
        blessings: state.blessings.flatMap((blessing) => {
            const def = FARMING.shrine.blessings.find((entry) => entry.id === blessing.id);
            return def ? [{ id: def.id, name: def.name, description: def.description, curse: def.curse, turnsLeft: blessing.turnsLeft }] : [];
        }),
        orders: {
            orders: state.orders?.list ?? [],
            endsAt: weekEndsAt(state.orders?.week ?? 0).toISOString(),
        },
        unlockCost: unlockCost(state, FARMING),
        compostItemId: FARMING.unlockCost.itemId,
        hand: hand.flatMap((card) =>
            isFarmingCardId(card.cardId) ? [{ ...card, shape: FARMING_CARDS[card.cardId].shape, played: state.played.includes(card.inventoryId) }] : [],
        ),
        crops: cropViews(state),
        pests: state.pests.map((pest) => ({
            id: pest.id,
            pestId: pest.pestId,
            tile: pest.tile,
            intent: pest.intent,
            intentText: intentText(state, pest.tile, pest.intent),
            hp: pest.hp ?? 1,
        })),
        pestTypes: Object.values(CONTENT.pests).map(({ id, name, icon, description, likes, bounty }) => ({ id, name, icon, description, likes, bounty })),
        lab: toLab(state, held),
        pesthunter: { points: state.pesthunterPoints, shop: FARMING.pesthunter.shop },
        // Only what's built or buildable: a structure past the player's level stays hidden.
        structureTypes: Object.values(CONTENT.structures)
            .filter((structure) => structure.requiredLevel <= farmingLevel || standing.has(structure.id))
            .map(({ id, name, icon, description, stats, cost, size, requiredLevel, effect }) => ({
                id,
                kind: effect.kind,
                name,
                icon,
                description,
                stats,
                cost,
                size,
                requiredLevel,
                capacity: effect.kind === "compost" ? effect.capacity : null,
            })),
        buildList: Object.values(CONTENT.structures)
            .filter((structure) => structure.requiredLevel <= farmingLevel)
            .sort((a, b) => a.requiredLevel - b.requiredLevel)
            .map((structure) => structure.id),
        log: report.log,
        gained: report.gained,
        xpGained: report.xpGained,
    };
}

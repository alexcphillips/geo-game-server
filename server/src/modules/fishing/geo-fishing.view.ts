import type { GeoFishingOutcome, GeoFishingRunView } from "@geo/shared";
import { CONTENT } from "../../content";
import { fishItemId, qualityFishItemId } from "../../content/fishing";
import { type FishingSetup, type FishingState } from "../../fishing/fishing-run";

/**
 * A fishing Run as the app sees it. The fish's name and rarity stay hidden
 * until it lands, and only the fish's next move is sent unless the player is
 * reading the water.
 */
export function toFishingView(id: string, state: FishingState, setup: FishingSetup): GeoFishingRunView {
    const fish = state.fishId ? CONTENT.fish[state.fishId] : undefined;
    const showFish = state.phase === "fight";
    const fight = state.fight && state.phase === "fight" ? state.fight : null;

    return {
        id,
        tier: state.tier,
        phase: state.phase,
        fish: showFish && fish ? { fishId: fish.id } : null,
        fight: fight && {
            ...fight,
            intents: fight.statuses.reading > 0 ? fight.intents : fight.intents.slice(0, 1),
            traits: fish?.traits ?? [],
        },
        outcome: state.phase === "over" ? toOutcome(state) : null,
        message: state.message,
        lastTurn: state.lastTurn,
        hand: state.hand.map((card) => ({ ...card })),
        baitItemId: state.baitItemId,
        power: setup.power,
        rod: { name: setup.rod.name, maxRarity: setup.rod.maxRarity, maxTier: setup.rod.maxTier },
    };
}

function toOutcome(state: FishingState): GeoFishingOutcome | null {
    const result = state.result;
    if (!result) return null;
    if (result.kind === "lost") return result;
    if (result.kind === "creature") {
        const enemy = CONTENT.enemies[result.enemyId];
        return { kind: "creature", enemyId: result.enemyId, name: enemy?.name ?? "Sea creature" };
    }
    const fish = CONTENT.fish[result.fishId];
    if (!fish) return null;
    return {
        kind: "landed",
        fishId: fish.id,
        name: fish.name,
        rarity: fish.rarity,
        tier: result.tier,
        itemId: result.tier ? qualityFishItemId(fish.id, result.tier) : fishItemId(fish.id),
        how: result.how,
        turns: result.turns,
        xp: fish.xp,
    };
}

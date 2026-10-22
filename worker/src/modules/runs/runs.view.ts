import type { GeoCombatantView, GeoHandCard, GeoLunchboxSlot, GeoRunView } from "@geo/shared";
import { PLAYER_COMBATANT_ID } from "../../../../server/src/combat/combatants";
import { CONTENT } from "../../../../server/src/content";
import { canPlayCard, currentActor, previewCard, previewIntent } from "../../../../server/src/engine/battle";
import { CORE_STATS } from "../../../../server/src/engine/engine.types";
import { statOf } from "../../../../server/src/engine/stats";
import type { RunRow } from "./runs.types";

/** Card id → the item that plays it, for the app's name and icon. */
const ITEM_FOR_CARD = new Map(
    Object.values(CONTENT.items).flatMap((item) => (item.kind === "card" ? [[item.cardId, item.id] as const] : [])),
);

/**
 * A Run as its player sees it, from server/src/modules/runs/geo-runs.view.ts:
 * health, statuses, their own hand. Enemy rules and the RNG stay on the
 * server. In a shared fight the other players show as combatants on your
 * side, and the turn clock comes along.
 */
export function toRunView(row: RunRow, now = Date.now()): GeoRunView {
    const { state } = row;
    const you = row.combatant_id ?? PLAYER_COMBATANT_ID;

    const combatants: GeoCombatantView[] = state.combatants.map((c) => {
        const enemyIndex = c.side === "enemy" ? Number(c.id.split(":")[1]) : -1;
        const enemyId = row.enemy_ids[enemyIndex];
        return {
            id: c.id,
            side: c.side,
            name: c.name,
            sprite: enemyId ? CONTENT.enemies[enemyId]?.sprite : undefined,
            health: c.health,
            maxHealth: statOf(c, CORE_STATS.maxHealth, CONTENT),
            guard: c.guard,
            barrier: c.barrier ?? 0,
            statuses: c.statuses.map((s) => ({ ...s })),
            defense: statOf(c, CORE_STATS.defense, CONTENT),
            intent: (c.side === "enemy" && row.status === "active" && previewIntent(state, CONTENT, c.id)) || undefined,
            left: c.left ?? false,
        };
    });

    const player = state.combatants.find((c) => c.id === you);
    const hand: GeoHandCard[] = (player?.hand ?? []).map((card) => ({
        inventoryId: card.instanceId,
        itemId: ITEM_FOR_CARD.get(card.cardId) ?? card.cardId,
        cardId: card.cardId,
        chargesLeft: card.chargesLeft,
        playable: canPlayCard(state, CONTENT, card.instanceId, you),
        preview: (row.status === "active" && previewCard(state, CONTENT, card.instanceId, you)) || undefined,
    }));

    const lunchbox: GeoLunchboxSlot[] = (player?.lunchbox ?? [])
        .filter((entry) => entry.quantity > 0)
        .map((entry) => ({ slot: entry.slot, itemId: entry.foodId, quantity: entry.quantity }));

    return {
        id: row.id,
        kind: row.kind,
        status: row.status,
        you,
        version: row.version,
        turnDeadline: row.status === "active" && row.turn_deadline !== null ? new Date(row.turn_deadline).toISOString() : null,
        serverTime: new Date(now).toISOString(),
        round: state.round,
        order: state.order,
        currentActor: row.status === "active" ? (currentActor(state)?.id ?? null) : null,
        combatants,
        hand,
        lunchbox,
        rewards: row.rewards,
        coinsLost: row.coins_lost,
        enemyLeft: row.status === "defeat" && row.enemy_ids.some((id) => CONTENT.enemies[id]?.leavesAfterWinning),
        dungeonRunId: row.dungeon_run_id,
    };
}

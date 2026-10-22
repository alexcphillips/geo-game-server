import { GEO_FARM_CONTESTS, type GeoFarmContestId, type GeoFarmContests, type GeoGlobalFarmEvent } from "@geo/shared";
import { query } from "../../db";
import { CONTENT, FARMING } from "../../content";
import { withTransaction, type TxQuery } from "../../db/transaction";
import { contestCropFor, globalEventFor, weekEndsAt, weekOf, type FarmStepResult } from "../../farming/farm";
import { insertAnnouncement, insertMessage } from "../inbox/geo-inbox.repository";
import * as playerRepository from "../player/geo-player.repository";
import { ADD_CONTEST_SCORE, BEST_CONTEST_SCORE, CLAIM_ANNOUNCE, CLAIM_SETTLE, CONTEST_STANDINGS, RANK_CONTEST, UNSETTLED_WEEKS } from "./geo-farming.sql";

/**
 * The weekly farm contests and server-wide events. Weeks run Monday to
 * Monday UTC (`weekOf`). Harvests add to the week's scores as they happen;
 * the background job pays each finished week once, mails every entrant
 * their placings, and posts the new week's announcement: its crop contest,
 * its global event and last week's winners. Scores are NPC sell value, so
 * Market prices can't be pumped to win.
 */

const CONTEST_NAMES: Record<GeoFarmContestId, string> = { harvest: "Total Harvest", mutation: "Top Mutation", crop: "Crop Contest" };

const valueOf = (itemId: string, quantity: number) => (CONTENT.items[itemId]?.sellValue ?? 0) * quantity;
const cropName = (cropId: string | null) => (cropId ? (CONTENT.crops[cropId]?.name ?? cropId) : "no crop");

/** A step's harvests into this week's contest scores. */
export async function recordHarvests(tx: TxQuery, playerId: string, harvested: FarmStepResult["harvested"], now: Date) {
    if (harvested.length === 0) return;
    const week = weekOf(now);
    const cropId = contestCropFor(week, CONTENT.crops);
    const plain = harvested.filter((entry) => !entry.mutation);
    const total = plain.reduce((sum, entry) => sum + valueOf(entry.itemId, entry.quantity), 0);
    const crop = plain.filter((entry) => entry.cropId === cropId).reduce((sum, entry) => sum + valueOf(entry.itemId, entry.quantity), 0);
    const bestMutation = Math.max(0, ...harvested.filter((entry) => entry.mutation).map((entry) => valueOf(entry.itemId, entry.quantity)));
    if (total > 0) await tx(ADD_CONTEST_SCORE, [week, "harvest", playerId, total]);
    if (crop > 0) await tx(ADD_CONTEST_SCORE, [week, "crop", playerId, crop]);
    if (bestMutation > 0) await tx(BEST_CONTEST_SCORE, [week, "mutation", playerId, bestMutation]);
}

type StandingRow = { contest: GeoFarmContestId; player_id: string; score: string; display_name: string; rank: string; entrants: string };

/** This week's contests as the player sees them. */
export async function findContests(tx: TxQuery, playerId: string, now: Date): Promise<GeoFarmContests> {
    const week = weekOf(now);
    const rows = await tx<StandingRow>(CONTEST_STANDINGS, [week, playerId]);
    return {
        endsAt: weekEndsAt(week).toISOString(),
        cropId: contestCropFor(week, CONTENT.crops) ?? "",
        prizes: FARMING.contests.prizes,
        participation: FARMING.contests.participation,
        standings: GEO_FARM_CONTESTS.map((contest) => {
            const mine = rows.filter((row) => row.contest === contest);
            const own = mine.find((row) => row.player_id === playerId);
            return {
                contest,
                score: Number(own?.score ?? 0),
                rank: own ? Number(own.rank) : null,
                entrants: Number(mine[0]?.entrants ?? 0),
                top: mine.filter((row) => Number(row.rank) <= 3).map((row) => ({ name: row.display_name, score: Number(row.score) })),
            };
        }),
    };
}

/** This week's server-wide event, if it has one. */
export function findGlobalEvent(now: Date): GeoGlobalFarmEvent | null {
    const global = globalEventFor(weekOf(now), FARMING);
    const event = global ? CONTENT.farmEvents[global.eventId] : undefined;
    if (!global || !event) return null;
    return {
        event: { id: event.id, name: event.name, icon: event.icon, description: event.description, offers: [] },
        startsAt: global.startsAt.toISOString(),
        endsAt: global.endsAt.toISOString(),
        active: now >= global.startsAt && now < global.endsAt,
    };
}

const ordinal = (rank: number) => `${rank}${rank === 1 ? "st" : rank === 2 ? "nd" : rank === 3 ? "rd" : "th"}`;

/** Pays out one finished week, once: prizes in coins, and a message to each entrant. Returns its winners, by contest. */
async function settleWeek(week: number): Promise<Partial<Record<GeoFarmContestId, string>> | null> {
    return withTransaction(async (tx) => {
        const [claimed] = await tx<{ week: number }>(CLAIM_SETTLE, [week]);
        if (!claimed) return null;
        const { prizes, participation } = FARMING.contests;
        const lines = new Map<string, string[]>();
        const payouts = new Map<string, number>();
        const winners: Partial<Record<GeoFarmContestId, string>> = {};
        for (const contest of GEO_FARM_CONTESTS) {
            const ranked = await tx<{ player_id: string; score: string; display_name: string }>(RANK_CONTEST, [week, contest]);
            const label = contest === "crop" ? `${CONTEST_NAMES.crop} (${cropName(contestCropFor(week, CONTENT.crops))})` : CONTEST_NAMES[contest];
            if (ranked[0]) winners[contest] = ranked[0].display_name;
            for (const [i, row] of ranked.entries()) {
                const prize = prizes[i] ?? participation;
                payouts.set(row.player_id, (payouts.get(row.player_id) ?? 0) + prize);
                const list = lines.get(row.player_id) ?? [];
                list.push(`${label}: ${ordinal(i + 1)} of ${ranked.length} with ${Number(row.score).toLocaleString("en")}. +${prize} coins.`);
                lines.set(row.player_id, list);
            }
        }
        for (const [playerId, coins] of payouts) {
            await playerRepository.addCoins(tx, playerId, coins, "farm-contest", `week:${week}`);
            await insertMessage(tx, {
                playerId,
                kind: "contest",
                title: "Your farm contest results",
                body: `${(lines.get(playerId) ?? []).join("\n")}\n\n${coins.toLocaleString("en")} coins in all, paid to you.`,
                sentBy: null,
                feedbackId: null,
            });
        }
        return winners;
    });
}

/** Posts a week's announcement once: its crop contest, its global event, and last week's winners. */
async function announceWeek(week: number, lastWinners: Partial<Record<GeoFarmContestId, string>> | null) {
    await withTransaction(async (tx) => {
        const [claimed] = await tx<{ week: number }>(CLAIM_ANNOUNCE, [week]);
        if (!claimed) return;
        const global = globalEventFor(week, FARMING);
        const event = global ? CONTENT.farmEvents[global.eventId] : undefined;
        const day = (date: Date) => date.toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
        const parts = [
            `This week's crop contest: ${cropName(contestCropFor(week, CONTENT.crops))}. Total Harvest and Top Mutation run as always; prizes are paid next Monday.`,
        ];
        if (global && event) {
            const when = global.endsAt.getTime() - global.startsAt.getTime() > 24 * 3_600_000 ? `${day(global.startsAt)} to Sunday` : day(global.startsAt);
            parts.push(`${event.name}, everywhere, ${when} (UTC): ${event.description}`);
        }
        if (lastWinners && Object.keys(lastWinners).length > 0) {
            const list = GEO_FARM_CONTESTS.flatMap((contest) => (lastWinners[contest] ? [`${CONTEST_NAMES[contest]}: ${lastWinners[contest]}`] : []));
            parts.push(`Last week's winners. ${list.join(". ")}.`);
        }
        await insertAnnouncement(tx, {
            kind: "event",
            title: event ? `This week on the farm: ${event.name}` : "This week on the farm",
            body: parts.join("\n\n"),
            version: null,
            postedBy: null,
            expiresAt: weekEndsAt(week),
        });
    });
}

/**
 * Brings the farm weeks up to date: pays out every finished week not yet
 * paid, then announces this one. Run by the background job; safe on several
 * servers at once, since each week is claimed before it's touched.
 */
export async function settleFarmWeeks(now = new Date()): Promise<void> {
    const current = weekOf(now);
    let lastWinners: Partial<Record<GeoFarmContestId, string>> | null = null;
    for (const { week } of await query<{ week: number }>(UNSETTLED_WEEKS, [current])) {
        const winners = await settleWeek(week);
        if (week === current - 1) lastWinners = winners;
    }
    await announceWeek(current, lastWinners);
}

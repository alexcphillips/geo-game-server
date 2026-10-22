import { GEO_FARM_CONTESTS, type GeoFarmContestId, type GeoFarmContests, type GeoGlobalFarmEvent } from "@geo/shared";
import { CONTENT, FARMING } from "../../../../server/src/content";
import { contestCropFor, globalEventFor, weekEndsAt, weekOf, type FarmStepResult } from "../../../../server/src/farming/farm";
import type { World } from "../../app";
import type { Db } from "../../db/db";
import { insertAnnouncement, insertMessage } from "../inbox/inbox.repository";
import * as playerRepository from "../player/player.repository";
import { ADD_CONTEST_SCORE, BEST_CONTEST_SCORE, CLAIM_ANNOUNCE, CLAIM_SETTLE, CONTEST_STANDINGS, RANK_CONTEST, UNSETTLED_WEEKS } from "./farming.sql.ts";

/**
 * The weekly farm contests and server-wide events, from
 * server/src/modules/farming/geo-farming.contests.ts. Weeks run Monday to
 * Monday UTC (`weekOf`). Harvests add to the week's scores as they happen;
 * the scheduler's `farm-weeks` job (src/jobs.ts) pays each finished week
 * once, mails every entrant their placings, and posts the new week's
 * announcement. Scores are NPC sell value, so Market prices can't be pumped
 * to win.
 */

const CONTEST_NAMES: Record<GeoFarmContestId, string> = { harvest: "Total Harvest", mutation: "Top Mutation", crop: "Crop Contest" };

const valueOf = (itemId: string, quantity: number) => (CONTENT.items[itemId]?.sellValue ?? 0) * quantity;
const cropName = (cropId: string | null) => (cropId ? (CONTENT.crops[cropId]?.name ?? cropId) : "no crop");

/** A step's harvests into this week's contest scores. */
export function recordHarvests(db: Db, playerId: string, harvested: FarmStepResult["harvested"], now: Date) {
    if (harvested.length === 0) return;
    const week = weekOf(now);
    const cropId = contestCropFor(week, CONTENT.crops);
    const plain = harvested.filter((entry) => !entry.mutation);
    const total = plain.reduce((sum, entry) => sum + valueOf(entry.itemId, entry.quantity), 0);
    const crop = plain.filter((entry) => entry.cropId === cropId).reduce((sum, entry) => sum + valueOf(entry.itemId, entry.quantity), 0);
    const bestMutation = Math.max(0, ...harvested.filter((entry) => entry.mutation).map((entry) => valueOf(entry.itemId, entry.quantity)));
    const at = now.getTime();
    if (total > 0) db.run(ADD_CONTEST_SCORE, week, "harvest", playerId, total, at);
    if (crop > 0) db.run(ADD_CONTEST_SCORE, week, "crop", playerId, crop, at);
    if (bestMutation > 0) db.run(BEST_CONTEST_SCORE, week, "mutation", playerId, bestMutation, at);
}

type StandingRow = { contest: GeoFarmContestId; player_id: string; score: number; display_name: string; rank: number; entrants: number };

/** This week's contests as the player sees them. */
export function findContests(db: Db, playerId: string, now: Date): GeoFarmContests {
    const week = weekOf(now);
    const rows = db.all<StandingRow>(CONTEST_STANDINGS, week, playerId);
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
                score: own?.score ?? 0,
                rank: own ? own.rank : null,
                entrants: mine[0]?.entrants ?? 0,
                top: mine.filter((row) => row.rank <= 3).map((row) => ({ name: row.display_name, score: row.score })),
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
function settleWeek(world: World, week: number, now: number): Partial<Record<GeoFarmContestId, string>> | null {
    const { db } = world;
    if (!db.one(CLAIM_SETTLE, week, now)) return null;
    const { prizes, participation } = FARMING.contests;
    const lines = new Map<string, string[]>();
    const payouts = new Map<string, number>();
    const winners: Partial<Record<GeoFarmContestId, string>> = {};
    for (const contest of GEO_FARM_CONTESTS) {
        const ranked = db.all<{ player_id: string; score: number; display_name: string }>(RANK_CONTEST, week, contest);
        const label = contest === "crop" ? `${CONTEST_NAMES.crop} (${cropName(contestCropFor(week, CONTENT.crops))})` : CONTEST_NAMES[contest];
        if (ranked[0]) winners[contest] = ranked[0].display_name;
        for (const [i, row] of ranked.entries()) {
            const prize = prizes[i] ?? participation;
            payouts.set(row.player_id, (payouts.get(row.player_id) ?? 0) + prize);
            const list = lines.get(row.player_id) ?? [];
            list.push(`${label}: ${ordinal(i + 1)} of ${ranked.length} with ${row.score.toLocaleString("en")}. +${prize} coins.`);
            lines.set(row.player_id, list);
        }
    }
    for (const [playerId, coins] of payouts) {
        playerRepository.addCoins(db, playerId, coins, "farm-contest", `week:${week}`);
        insertMessage(world, {
            playerId,
            kind: "contest",
            title: "Your farm contest results",
            body: `${(lines.get(playerId) ?? []).join("\n")}\n\n${coins.toLocaleString("en")} coins in all, paid to you.`,
            sentBy: null,
            feedbackId: null,
        });
    }
    return winners;
}

/** Posts a week's announcement once: its crop contest, its global event, and last week's winners. */
function announceWeek(world: World, week: number, lastWinners: Partial<Record<GeoFarmContestId, string>> | null, now: number) {
    if (!world.db.one(CLAIM_ANNOUNCE, week, now)) return;
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
    insertAnnouncement(world, {
        kind: "event",
        title: event ? `This week on the farm: ${event.name}` : "This week on the farm",
        body: parts.join("\n\n"),
        version: null,
        postedBy: null,
        expiresAt: weekEndsAt(week),
    });
}

/**
 * Brings the farm weeks up to date: pays out every finished week not yet
 * paid, then announces this one. Returns when it's next due: the start of
 * next week. The caller runs it in one transaction.
 */
export function settleFarmWeeks(world: World, now = Date.now()): number {
    const current = weekOf(new Date(now));
    let lastWinners: Partial<Record<GeoFarmContestId, string>> | null = null;
    for (const { week } of world.db.all<{ week: number }>(UNSETTLED_WEEKS, 0, current)) {
        const winners = settleWeek(world, week, now);
        if (week === current - 1) lastWinners = winners;
    }
    announceWeek(world, current, lastWinners, now);
    return weekEndsAt(current).getTime();
}

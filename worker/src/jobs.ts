import type { World } from "./app";
import { settleRun } from "./modules/dungeon-runs/dungeon-runs.repository";
import { settleFarmWeeks } from "./modules/farming/farming.contests";
import { deleteOldRefreshTokens, findDue, schedule, scheduleOnce } from "./modules/jobs/jobs.repository";
import { settleAuction } from "./modules/market/market.repository";
import { advanceElections } from "./modules/mayor/mayor.repository";
import { settleBattleClock } from "./modules/runs/runs.repository";

/**
 * The World's clock, replacing the Express server's 15 s tick and
 * in-process timers: work booked in the `due` table by key,
 * run when the World's alarm goes off (world.ts keeps it at the soonest
 * row). Each key runs in its own transaction, which first takes its row off
 * the table; what it runs books its next time itself.
 *
 * Every read that a job's work matters to also settles it first (a shared
 * fight's clock on the next play, a dungeon on the next look), so the alarm
 * is what makes it happen when nobody is looking, not what makes it correct.
 */

const DAY_MS = 24 * 3_600_000;
/** After a job throws, it's tried again this much later rather than on the next alarm at once. */
const RETRY_MS = 60_000;
/** Most keys one alarm runs; the rest go on the next (booked at once, being due). */
const BATCH = 50;

type Job = (world: World, id: string, now: number) => void;

/** Each key's prefix (before the first ":") → what it runs, given the rest. */
const JOBS: Record<string, Job> = {
    battle: (world, battleId, now) => settleBattleClock(world, battleId, now),
    dungeon: (world, dungeonRunId, now) => settleRun(world, dungeonRunId, now),
    /** An auction's end: the winner gets the item, or it goes back to the seller. */
    auction: (world, listingId, now) => void settleAuction(world, listingId, now),
    /** Refresh tokens long past use, once a day. */
    cleanup: (world, _id, now) => {
        deleteOldRefreshTokens(world.db, now);
        schedule(world.db, "cleanup", now + DAY_MS);
    },
    /** Pays out finished farm weeks and announces the new one, each Monday 00:00 UTC. */
    "farm-weeks": (world, _id, now) => schedule(world.db, "farm-weeks", settleFarmWeeks(world, now)),
    /** Closes the week's election (its winner takes office) and opens the next, booked for its end. */
    election: (world, _id, now) => schedule(world.db, "election", advanceElections(world, now).ends_at),
};

/** Books the jobs that always come back, unless they're booked already. Run when the World starts. */
export function bookRecurringJobs(world: World, now = Date.now()) {
    scheduleOnce(world.db, "cleanup", now);
    scheduleOnce(world.db, "farm-weeks", now);
    scheduleOnce(world.db, "election", now);
}

/** Runs every job due by `now`. One failing doesn't hold up the rest. */
export function runDueJobs(world: World, now = Date.now()) {
    for (const { key } of findDue(world.db, now, BATCH)) {
        const split = key.indexOf(":");
        const [kind, id] = split < 0 ? [key, ""] : [key.slice(0, split), key.slice(split + 1)];
        const job = JOBS[kind];
        try {
            world.db.transaction(() => {
                schedule(world.db, key, null);
                if (job) job(world, id, now);
                else console.error(`jobs: nothing runs "${key}"; dropped`);
            });
        } catch (error) {
            console.error(`jobs: ${key} failed`, error);
            schedule(world.db, key, now + RETRY_MS);
        }
    }
}

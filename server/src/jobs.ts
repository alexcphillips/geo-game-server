import { query } from "./db";
import { settleDueRuns } from "./modules/dungeon-runs/geo-dungeon-runs.repository";
import { settleFarmWeeks } from "./modules/farming/geo-farming.contests";
import { settleDueBattles } from "./modules/runs/geo-runs.repository";
import { settleEndedAuctions } from "./modules/market/geo-market.repository";
import { advanceElections } from "./modules/mayor/geo-mayor.repository";

/** How often the clock-driven work runs. */
const TICK_MS = 15_000;
/** Housekeeping runs this often. */
const CLEANUP_MS = 60 * 60_000;

/**
 * Refresh tokens a week past expiry or revocation. Kept that long so a reused
 * (revoked) token is still recognised as stolen for a while.
 */
const DELETE_OLD_REFRESH_TOKENS = `
  DELETE FROM geo.refresh_tokens
  WHERE expires_at < now() - interval '7 days' OR revoked_at < now() - interval '7 days';
`;

/**
 * geo-game's clock: settles auctions whose time is up, closes elections
 * when theirs is, pays out last week's farm contests (and announces the
 * new week's), and wakes dungeon runs and shared fights whose timers a
 * restart dropped. Every read also does this first, so the job is what makes
 * it happen when nobody is looking (a winner gets their item, the new mayor's
 * perks start) rather than what makes it correct.
 *
 * Safe on several servers at once: each step locks what it settles. Once an
 * hour it also deletes refresh tokens long past use.
 */
export function startGeoJobs(): () => void {
    let running = false;
    const tick = async () => {
        if (running) return;
        running = true;
        // Each on its own, so one failing (a bad auction row) can't hold up the others.
        const steps = { settleEndedAuctions, advanceElections, settleFarmWeeks, settleDueRuns, settleDueBattles };
        try {
            for (const [name, step] of Object.entries(steps)) {
                await step().catch((error: unknown) => console.error(`geo jobs (${name}):`, error));
            }
        } finally {
            running = false;
        }
    };
    const cleanup = () =>
        query(DELETE_OLD_REFRESH_TOKENS).catch((error: unknown) => console.error("geo cleanup:", error));

    void tick();
    void cleanup();
    const timer = setInterval(() => void tick(), TICK_MS);
    const cleanupTimer = setInterval(() => void cleanup(), CLEANUP_MS);
    timer.unref();
    cleanupTimer.unref();
    return () => {
        clearInterval(timer);
        clearInterval(cleanupTimer);
    };
}

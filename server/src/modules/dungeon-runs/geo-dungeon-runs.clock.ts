import { wakeAt } from "../../lib/wake";

/**
 * Wakes a dungeon run when something is due without anyone acting: the
 * ready-up clock running out on someone, or a player offline long enough
 * to stop holding things up. The timer fires on time (`lib/wake.ts`);
 * `wake_at` on the row lets the 15 s job catch whatever a restart dropped.
 *
 * Knows nothing of what settling does: the repository hands it `settle`,
 * which keeps this file (imported by the fight hooks) free of the Run code.
 */

let settle: ((dungeonRunId: string) => Promise<void>) | null = null;

export function setSettler(settler: (dungeonRunId: string) => Promise<void>) {
    settle = settler;
}

/** Settles the run at `at` (ms), unless it's already due to wake sooner; settling books the next wake. */
export function wakeRunAt(dungeonRunId: string, at: number) {
    wakeAt(`dungeon:${dungeonRunId}`, at, () => settle?.(dungeonRunId) ?? Promise.resolve());
}

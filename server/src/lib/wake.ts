/**
 * Timers for work due with nobody acting: a ready-up clock running out, a
 * turn clock, a player offline too long. One per key; asking again for a
 * later time keeps the sooner one (whatever it runs books the next). In this
 * process only: what owns the deadline also stores it, so a sweep can catch
 * what a restart dropped. On Cloudflare this would be the Durable Object's alarm.
 */
const timers = new Map<string, { at: number; timer: NodeJS.Timeout }>();

/** Runs `work` at `at` (ms), unless `key` is already due sooner. Errors are logged. */
export function wakeAt(key: string, at: number, work: () => Promise<void>) {
    const existing = timers.get(key);
    if (existing && existing.at <= at) return;
    if (existing) clearTimeout(existing.timer);
    const timer = setTimeout(
        () => {
            timers.delete(key);
            work().catch((error: unknown) => console.error(`geo: wake ${key} failed`, error));
        },
        // A little after, so "now >= deadline" holds when it runs.
        Math.max(0, at - Date.now()) + 50,
    );
    timer.unref();
    timers.set(key, { at, timer });
}

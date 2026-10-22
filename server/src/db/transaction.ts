import type { PoolClient, QueryResultRow } from "pg";
import { pool } from "./";

/** A query function bound to one transaction. */
export type TxQuery = <Row extends QueryResultRow>(
    text: string,
    params?: readonly unknown[],
) => Promise<Row[]>;

/** Postgres gave up on the transaction, not the work: deadlock, serialization. */
const RETRYABLE = new Set(["40P01", "40001"]);
const ATTEMPTS = 3;

/**
 * Runs `work` in one transaction: commits if it resolves, rolls back if it
 * throws. Anything touching more than one row that must agree — a turn and
 * its card charges, loot and XP, a trade's coins and items — goes through here.
 *
 * Two trades locking the same players in opposite orders can deadlock;
 * Postgres then aborts one, and it's run again from the start (up to 3 tries),
 * so `work` must only touch the database through `tx`.
 */
export async function withTransaction<T>(work: (tx: TxQuery) => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
        try {
            return await runOnce(work);
        } catch (error) {
            const code = (error as { code?: string }).code;
            if (attempt >= ATTEMPTS || !code || !RETRYABLE.has(code)) throw error;
        }
    }
}

/** Work waiting on each open transaction's commit. */
const commitHooks = new WeakMap<TxQuery, (() => Promise<void> | void)[]>();

/**
 * Runs `hook` once `tx` has committed, e.g. pushing the new state to other
 * players, so nobody is told about something that then rolls back. Dropped
 * on a rollback (a retry queues its own). Outside a transaction (a plain
 * query function) it runs right after the current work. Its errors are
 * logged, never thrown: the work it follows is already saved.
 */
export function afterCommit(tx: TxQuery, hook: () => Promise<void> | void): void {
    const hooks = commitHooks.get(tx);
    if (hooks) hooks.push(hook);
    else setImmediate(() => runHook(hook));
}

function runHook(hook: () => Promise<void> | void) {
    Promise.resolve()
        .then(hook)
        .catch((error: unknown) => console.error("geo: after-commit work failed", error));
}

async function runOnce<T>(work: (tx: TxQuery) => Promise<T>): Promise<T> {
    const client: PoolClient = await pool.connect();
    const tx: TxQuery = async (text, params = []) =>
        (await client.query(text, params as unknown[])).rows;
    const hooks: (() => Promise<void> | void)[] = [];
    commitHooks.set(tx, hooks);

    try {
        await client.query("BEGIN");
        const result = await work(tx);
        await client.query("COMMIT");
        for (const hook of hooks) runHook(hook);
        return result;
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

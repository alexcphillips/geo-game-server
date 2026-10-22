/** A value SQLite can take as a parameter. Booleans go in as 0 or 1. */
export type SqlValue = string | number | null | ArrayBuffer;

/**
 * The World's SQLite database: every query goes through here. Calls are
 * synchronous; nothing else can run on the World object in between, so a
 * read-check-write in one `transaction` is atomic.
 *
 * `rowsWritten` counts as the free plan does (100k a day), so tests can hold
 * an endpoint to its budget.
 */
export class Db {
    rowsRead = 0;
    rowsWritten = 0;
    private readonly storage: DurableObjectStorage;
    /** Work waiting on the outermost transaction's commit; null outside one. */
    private committing: (() => void)[] | null = null;

    constructor(storage: DurableObjectStorage) {
        this.storage = storage;
    }

    /** Every row. Always pass values as params, never in the SQL text. */
    all<Row extends Record<string, SqlStorageValue>>(sql: string, ...params: SqlValue[]): Row[] {
        const cursor = this.storage.sql.exec<Row>(sql, ...params);
        const rows = cursor.toArray();
        this.count(cursor);
        return rows;
    }

    /** The first row, or undefined. */
    one<Row extends Record<string, SqlStorageValue>>(sql: string, ...params: SqlValue[]): Row | undefined {
        return this.all<Row>(sql, ...params)[0];
    }

    /** For statements where nothing comes back. Returns the rows written. */
    run(sql: string, ...params: SqlValue[]): number {
        const cursor = this.storage.sql.exec(sql, ...params);
        cursor.toArray();
        this.count(cursor);
        return cursor.rowsWritten;
    }

    /**
     * All or nothing: a throw inside rolls every write back. Synchronous on
     * purpose. Nested, it's a savepoint: a throw out of the inner one undoes
     * only its own writes, and the outer one can carry on.
     */
    transaction<T>(work: () => T): T {
        if (this.committing) return this.storage.transactionSync(work);
        const queue: (() => void)[] = [];
        this.committing = queue;
        let result: T;
        try {
            result = this.storage.transactionSync(work);
        } finally {
            this.committing = null;
        }
        for (const then of queue) {
            try {
                then();
            } catch (error) {
                console.error("after commit:", error);
            }
        }
        return result;
    }

    /**
     * Runs `then` once the transaction in progress commits (straight away
     * outside one); never if it rolls back. For telling players about a
     * change: a push must not go out for writes that were undone.
     */
    afterCommit(then: () => void) {
        if (this.committing) this.committing.push(then);
        else then();
    }

    private count(cursor: SqlStorageCursor<Record<string, SqlStorageValue>>) {
        this.rowsRead += cursor.rowsRead;
        this.rowsWritten += cursor.rowsWritten;
    }
}

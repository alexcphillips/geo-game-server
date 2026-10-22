import pg, { type QueryResultRow } from "pg";
import { ENV } from "../config/env";

const { Pool, types } = pg;

/**
 * pg returns NUMERIC as a string to protect precision. Every numeric column in
 * this schema is a nutrition or weight figure that comfortably fits a float, and
 * the API contract promises `number`, so parse it once here rather than in each
 * repository (and, historically, in each React component).
 */
types.setTypeParser(types.builtins.NUMERIC, (value) => Number(value));

export const pool = new Pool({
    user: ENV.DB.USER,
    host: ENV.DB.HOST,
    database: ENV.DB.NAME,
    password: ENV.DB.PASSWORD,
    port: ENV.DB.PORT,
});

/**
 * The only way to talk to Postgres. Always pass values as `params` - string
 * interpolation into `text` is how SQL injection gets in.
 *
 * @example
 * const rows = await query<UserRow>(FIND_USER_BY_EMAIL, [email]);
 */
export async function query<Row extends QueryResultRow>(
    text: string,
    params: readonly unknown[] = [],
): Promise<Row[]> {
    const result = await pool.query<Row>(text, params as unknown[]);
    return result.rows;
}

/** Like {@link query}, for statements where "how many rows" is the answer. */
export async function execute(
    text: string,
    params: readonly unknown[] = [],
): Promise<number> {
    const result = await pool.query(text, params as unknown[]);
    return result.rowCount ?? 0;
}

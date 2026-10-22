import type { Context } from "hono";
import type { GeoRole } from "@geo/shared";
import { CONTENT } from "../../../../server/src/content";
import { AppError } from "../../../../server/src/http/AppError";
import type { AppEnv } from "../../app";
import type { SqlValue } from "../../db/db";
import { jsonBody } from "../../http/body";
import { devTools } from "../../http/dev";
import { grantStarterKit } from "../accounts/starter-kit";
import { setRoleByEmail } from "../admin/admin.repository";
import { grantItems, type ItemGrant } from "../player/player.repository";
import { DELETE_PROGRESS_JOBS, PROGRESS_TABLES, RESET_PLAYERS } from "./ops.sql.ts";

/** The operator's tools (GEO_OPS_PATHS), replacing scripts that reached into Postgres. */

type Ctx = Context<AppEnv>;

export async function setRole(c: Ctx) {
    const { email, role } = (await jsonBody(c)) as { email?: unknown; role?: unknown };
    if (typeof email !== "string" || !email) throw AppError.badRequest("Missing email");
    if (role !== "player" && role !== "admin") throw AppError.badRequest("role must be player or admin");
    const { db } = c.var.world;
    const name = db.transaction(() => setRoleByEmail(db, email, role as GeoRole));
    if (!name) throw AppError.notFound(`No geo-game account for ${email}`);
    return c.json({ displayName: name, role }, 200);
}

/**
 * Wipes every player's progress back to a fresh start, keeping their account,
 * then hands each the starter kit again, as if they'd just signed up. Without
 * `confirm`, only says what it would delete.
 */
export async function wipe(c: Ctx) {
    const { confirm } = (await jsonBody(c)) as { confirm?: unknown };
    const { world } = c.var;
    const { db } = world;
    const rows = Object.fromEntries(
        PROGRESS_TABLES.map((table) => [table, db.one<{ n: number }>(`SELECT count(*) AS n FROM ${table};`)?.n ?? 0]),
    );
    const players = db.all<{ id: string }>(`SELECT id FROM players;`).map((row) => row.id);
    if (confirm !== true) return c.json({ accounts: players.length, rows, wiped: false }, 200);

    db.transaction(() => {
        for (const table of PROGRESS_TABLES) db.run(`DELETE FROM ${table};`);
        db.run(DELETE_PROGRESS_JOBS);
        db.run(RESET_PLAYERS);
        for (const id of players) grantStarterKit(db, id);
    });
    world.travel.clear();
    return c.json({ accounts: players.length, rows, wiped: true }, 200);
}

function requireDevTools(c: Ctx) {
    if (!devTools(c)) throw AppError.notFound("Not found");
}

/** One statement, in its own transaction: the smoke kit's setup and checks. Dev tools only. */
export async function runSql(c: Ctx) {
    requireDevTools(c);
    const { sql, params } = (await jsonBody(c)) as { sql?: unknown; params?: unknown };
    if (typeof sql !== "string" || !sql.trim()) throw AppError.badRequest("Missing sql");
    if (params !== undefined && !Array.isArray(params)) throw AppError.badRequest("params must be a list");
    const { db } = c.var.world;
    try {
        const rows = db.transaction(() => db.all(sql, ...((params ?? []) as SqlValue[])));
        return c.json({ rows }, 200);
    } catch (error) {
        throw AppError.badRequest(error instanceof Error ? error.message : String(error));
    }
}

/** Items straight into a player's inventory, as a test needs. Dev tools only. */
export async function grant(c: Ctx) {
    requireDevTools(c);
    const { playerId, items } = (await jsonBody(c)) as { playerId?: unknown; items?: unknown };
    if (typeof playerId !== "string" || !Array.isArray(items)) throw AppError.badRequest("playerId and items are needed");
    for (const item of items as ItemGrant[]) {
        if (!CONTENT.items[item?.itemId]) throw AppError.badRequest(`Unknown item ${String(item?.itemId)}`);
    }
    const { db } = c.var.world;
    return c.json({ ids: db.transaction(() => grantItems(db, playerId, items as ItemGrant[])) }, 200);
}

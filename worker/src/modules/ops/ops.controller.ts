import type { Context } from "hono";
import type { GeoRole } from "@geo/shared";
import { CONTENT } from "../../../../game/src/content";
import { AppError } from "../../../../game/src/http/AppError";
import type { AppEnv } from "../../app";
import type { SqlValue } from "../../db/db";
import { jsonBody } from "../../http/body";
import { devTools } from "../../http/dev";
import { grantStarterKit } from "../accounts/starter-kit";
import { setRoleByEmail } from "../admin/admin.repository";
import { runDueJobs } from "../../jobs";
import { settleFarmWeeks } from "../farming/farming.contests";
import { addCoins, addSkillXp, grantItems, ownModifiers, type CoinReason, type ItemGrant } from "../player/player.repository";
import { recordQuestEvents } from "../quests/quests.repository";
import { DELETE_PROGRESS_JOBS, PROGRESS_TABLES, RESET_PLAYERS } from "./ops.sql.ts";

/** The operator's tools (GEO_OPS_PATHS), for worker/scripts. */

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

/** A dev-tools-only body with a player id that exists. */
async function playerBody<T>(c: Ctx): Promise<T & { playerId: string }> {
    requireDevTools(c);
    const body = (await jsonBody(c)) as T & { playerId?: unknown };
    if (typeof body.playerId !== "string") throw AppError.badRequest("Missing playerId");
    if (!c.var.world.db.one(`SELECT 1 FROM players WHERE id = ?;`, body.playerId)) throw AppError.notFound("No such player");
    return body as T & { playerId: string };
}

export async function coins(c: Ctx) {
    const { playerId, amount, reason, reference } = await playerBody<{ amount?: unknown; reason?: unknown; reference?: unknown }>(c);
    if (typeof amount !== "number" || !Number.isSafeInteger(amount)) throw AppError.badRequest("amount must be a whole number");
    const { db } = c.var.world;
    db.transaction(() => addCoins(db, playerId, amount, (reason ?? "admin-grant") as CoinReason, typeof reference === "string" ? reference : "ops"));
    return c.body(null, 204);
}

export async function xp(c: Ctx) {
    const { playerId, skill, amount } = await playerBody<{ skill?: unknown; amount?: unknown }>(c);
    if (typeof skill !== "string" || typeof amount !== "number" || !Number.isSafeInteger(amount)) throw AppError.badRequest("skill and a whole amount are needed");
    const { db } = c.var.world;
    db.transaction(() => addSkillXp(db, playerId, skill, amount));
    return c.body(null, 204);
}

export async function questEvents(c: Ctx) {
    const { playerId, events } = await playerBody<{ events?: unknown }>(c);
    if (!Array.isArray(events)) throw AppError.badRequest("events must be a list");
    const { db } = c.var.world;
    db.transaction(() => recordQuestEvents(db, playerId, events as Parameters<typeof recordQuestEvents>[2]));
    return c.body(null, 204);
}

export async function modifiers(c: Ctx) {
    const { playerId } = await playerBody<object>(c);
    return c.json({ modifiers: ownModifiers(c.var.world.db, playerId) }, 200);
}

function timeIn(body: { at?: unknown }): number {
    if (body.at === undefined) return Date.now();
    if (typeof body.at !== "number" || !Number.isSafeInteger(body.at)) throw AppError.badRequest("at must be a time in ms");
    return body.at;
}

export async function farmWeeks(c: Ctx) {
    requireDevTools(c);
    const at = timeIn((await jsonBody(c)) as { at?: unknown });
    const { world } = c.var;
    return c.json({ nextAt: world.db.transaction(() => settleFarmWeeks(world, at)) }, 200);
}

export async function jobs(c: Ctx) {
    requireDevTools(c);
    runDueJobs(c.var.world, timeIn((await jsonBody(c)) as { at?: unknown }));
    return c.body(null, 204);
}

export async function spawnClock(c: Ctx) {
    const { playerId, seconds } = await playerBody<{ seconds?: unknown }>(c);
    if (typeof seconds !== "number" || !Number.isFinite(seconds)) throw AppError.badRequest("seconds must be a number");
    const away = c.var.world.travel.get(playerId)?.outOfReachSince;
    for (const [spawnId, since] of away ?? []) away!.set(spawnId, since - Math.round(seconds * 1000));
    return c.json({ moved: away?.size ?? 0 }, 200);
}

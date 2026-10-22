import { env, runInDurableObject, SELF } from "cloudflare:test";
import { GEO_API_PATHS, type GeoMeResponse, type GeoSession } from "@geo/shared";
import type { Db } from "../src/db/db";
import { addCoins, grantItems } from "../src/modules/player/player.repository";
import type { World } from "../src/world";

/** Shared by the endpoint tests: requests against the real Worker, and reaching into the World's database. */

const BASE = "https://geo-game.test";

let caller = 0;
/** A fresh caller address each time, so rate limits never get in the way. */
const nextIp = () => `10.1.${Math.floor(++caller / 250)}.${caller % 250}`;

export type Reply<T> = { status: number; body: T };

export async function call<T = { error: string }>(
    method: string,
    path: string,
    token?: string,
    body?: unknown,
): Promise<Reply<T>> {
    const headers: Record<string, string> = { "CF-Connecting-IP": nextIp() };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await SELF.fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    return { status: response.status, body: (text ? JSON.parse(text) : undefined) as T };
}

export const world = () => env.WORLD.get(env.WORLD.idFromName(env.WORLD_NAME));

/** Runs `work` on the World's database, in one transaction: test setup that no endpoint does yet. */
export function inWorld<T>(work: (db: Db, instance: World) => T): Promise<T> {
    return runInDurableObject(world(), (instance: World) => instance.db.transaction(() => work(instance.db, instance)));
}

/** Rows written by `work`, counted the way the free plan counts them. */
export async function rowsWrittenBy(work: () => Promise<unknown>): Promise<number> {
    const before = await runInDurableObject(world(), (instance: World) => instance.db.rowsWritten);
    await work();
    return (await runInDurableObject(world(), (instance: World) => instance.db.rowsWritten)) - before;
}

let next = 0;
/** A new player, signed in: their session and an `me()` that reads `/geo/me`. */
export async function newPlayer(name = "player") {
    next += 1;
    const signUp = await call<GeoSession>("POST", GEO_API_PATHS.auth.register, undefined, {
        username: `${name}${next}`,
        email: `${name}${next}@example.test`,
        password: "long-enough-pw",
    });
    if (signUp.status !== 201) throw new Error(`Sign-up failed: ${JSON.stringify(signUp.body)}`);
    const { accessToken: token, player } = signUp.body;
    const me = async () => (await call<GeoMeResponse>("GET", GEO_API_PATHS.me.root, token)).body;
    return { token, id: player.id, me };
}

/** The total of an item across a player's inventory rows. */
export const amountOf = (me: GeoMeResponse, itemId: string) =>
    me.inventory.filter((entry) => entry.itemId === itemId).reduce((sum, entry) => sum + entry.quantity, 0);

export const path = (template: string, params: Record<string, string | number>) =>
    Object.entries(params).reduce((result, [key, value]) => result.replace(`:${key}`, String(value)), template);

/** Puts items straight into a player's inventory; their new rows' ids. */
export const grant = (playerId: string, itemId: string, quantity = 1) => inWorld((db) => grantItems(db, playerId, [{ itemId, quantity }]));

/** Makes a player a game admin, as the first admin is made (ops) or another admin would. */
export const makeAdmin = (playerId: string) => inWorld((db) => db.run(`UPDATE players SET role = 'admin' WHERE id = ?;`, playerId));

/** Gives a player coins straight away, through the ledger. */
export const giveCoins = (playerId: string, amount: number) =>
    inWorld((db) => addCoins(db, playerId, amount, "admin-grant", "test"));

import { env, runInDurableObject, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { GEO_API_PATHS, type GeoSession } from "@geo/shared";
import type { World } from "../src/world";

const BASE = "https://geo-game.test";

let caller = 0;
/** A fresh address per request unless one is given, so only the rate-limit test meets the limits. */
async function call<T = unknown>(path: string, body?: unknown, ip = `10.0.${Math.floor(++caller / 250)}.${caller % 250}`) {
    const response = await SELF.fetch(BASE + path, {
        method: "POST",
        headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, body: (text ? JSON.parse(text) : undefined) as T, headers: response.headers };
}

const world = () => env.WORLD.get(env.WORLD.idFromName(env.WORLD_NAME));

/** Rows written by `work`, counted the way the free plan counts them. */
async function rowsWrittenBy(work: () => Promise<unknown>): Promise<number> {
    const before = await runInDurableObject(world(), (instance: World) => instance.db.rowsWritten);
    await work();
    return (await runInDurableObject(world(), (instance: World) => instance.db.rowsWritten)) - before;
}

let next = 0;
const account = () => {
    next += 1;
    return { username: `walker${next}`, email: `walker${next}@example.test`, password: "long-enough-pw" };
};

describe("accounts", () => {
    it("signs up, signs in, refreshes and signs out", async () => {
        const details = account();
        const registered = await call<GeoSession>(GEO_API_PATHS.auth.register, details);
        expect(registered.status).toBe(201);
        expect(registered.body.player).toMatchObject({ displayName: details.username, coins: 0, bankCoins: 0, role: "player" });
        expect(registered.body.accessToken.split(".")).toHaveLength(3);

        const signedIn = await call<GeoSession>(GEO_API_PATHS.auth.login, { email: details.email.toUpperCase(), password: details.password });
        expect(signedIn.status).toBe(200);
        expect(signedIn.body.player.id).toBe(registered.body.player.id);

        const refreshed = await call<GeoSession>(GEO_API_PATHS.auth.refresh, { refreshToken: signedIn.body.refreshToken });
        expect(refreshed.status).toBe(200);
        expect(refreshed.body.refreshToken).not.toBe(signedIn.body.refreshToken);

        expect((await call(GEO_API_PATHS.auth.logout, { refreshToken: refreshed.body.refreshToken })).status).toBe(204);
        expect((await call(GEO_API_PATHS.auth.refresh, { refreshToken: refreshed.body.refreshToken })).status).toBe(401);
    });

    it("rejects a wrong password and an unknown email the same way", async () => {
        const details = account();
        await call(GEO_API_PATHS.auth.register, details);
        const wrong = await call<{ error: string }>(GEO_API_PATHS.auth.login, { email: details.email, password: "not-the-password" });
        const unknown = await call<{ error: string }>(GEO_API_PATHS.auth.login, { email: "nobody@example.test", password: "not-the-password" });
        expect(wrong.status).toBe(401);
        expect(unknown).toMatchObject({ status: 401, body: wrong.body });
    });

    it("refuses a taken username or email, ignoring case", async () => {
        const details = account();
        await call(GEO_API_PATHS.auth.register, details);
        const sameName = await call<{ error: string }>(GEO_API_PATHS.auth.register, { ...account(), username: details.username.toUpperCase() });
        expect(sameName).toMatchObject({ status: 400, body: { error: "That username is taken" } });
        const sameEmail = await call<{ error: string }>(GEO_API_PATHS.auth.register, { ...account(), email: details.email.toUpperCase() });
        expect(sameEmail).toMatchObject({ status: 400, body: { error: "Invalid email or password" } });
    });

    it("checks the sign-up rules", async () => {
        expect((await call(GEO_API_PATHS.auth.register, { ...account(), password: "short" })).status).toBe(400);
        expect((await call(GEO_API_PATHS.auth.register, { ...account(), email: "no-at-sign" })).status).toBe(400);
        expect((await call(GEO_API_PATHS.auth.register, { ...account(), username: "ab" })).status).toBe(400);
        expect((await call(GEO_API_PATHS.auth.register, {})).status).toBe(400);
    });

    it("a refresh token used twice ends every session of that player", async () => {
        const registered = await call<GeoSession>(GEO_API_PATHS.auth.register, account());
        const first = await call<GeoSession>(GEO_API_PATHS.auth.refresh, { refreshToken: registered.body.refreshToken });
        expect(first.status).toBe(200);
        // The old token again: someone copied it.
        expect((await call(GEO_API_PATHS.auth.refresh, { refreshToken: registered.body.refreshToken })).status).toBe(401);
        // So the new one is dead too.
        expect((await call(GEO_API_PATHS.auth.refresh, { refreshToken: first.body.refreshToken })).status).toBe(401);
    });

    it("limits sign-in attempts per address", async () => {
        const ip = "198.51.100.7";
        for (let i = 0; i < 10; i++) await call(GEO_API_PATHS.auth.login, { email: "x@example.test", password: "whatever-pw" }, ip);
        const blocked = await call(GEO_API_PATHS.auth.login, { email: "x@example.test", password: "whatever-pw" }, ip);
        expect(blocked.status).toBe(429);
        expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
    });

    it("answers a bad body and an unknown path with JSON errors", async () => {
        const response = await SELF.fetch(BASE + GEO_API_PATHS.auth.login, { method: "POST", body: "{nope", headers: { "CF-Connecting-IP": "192.0.2.9" } });
        expect(response.status).toBe(400);
        const missing = await SELF.fetch(BASE + "/geo/nothing-here");
        expect(missing.status).toBe(404);
        expect(await missing.json()).toEqual({ error: "No route for GET /geo/nothing-here" });
    });

    it("stays inside its write budget", async () => {
        const details = account();
        let session: GeoSession | undefined;
        const signUp = await rowsWrittenBy(async () => {
            session = (await call<GeoSession>(GEO_API_PATHS.auth.register, details, "192.0.2.50")).body;
        });
        const signIn = await rowsWrittenBy(() => call(GEO_API_PATHS.auth.login, { email: details.email, password: details.password }, "192.0.2.50"));
        const refresh = await rowsWrittenBy(() => call(GEO_API_PATHS.auth.refresh, { refreshToken: session?.refreshToken }, "192.0.2.50"));
        console.log(`rows written: sign-up ${signUp}, sign-in ${signIn}, refresh ${refresh}`);
        // A player (row + 2 indexes) and a token (row + player index); a refresh also ends the old token.
        expect(signUp).toBeLessThanOrEqual(5);
        expect(signIn).toBeLessThanOrEqual(2);
        expect(refresh).toBeLessThanOrEqual(3);
    });
});

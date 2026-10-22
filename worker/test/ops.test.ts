import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { GEO_API_PATHS, type GeoMeResponse } from "@geo/shared";
import { GEO_OPS_PATHS } from "../src/modules/ops/ops.paths";
import { amountOf, call, giveCoins, grant, newPlayer } from "./helpers";

/** The operator's routes: hidden without the secret, then the first admin, the wipe, and the smoke kit's SQL. */

async function ops<T>(path: string, body: unknown, secret = "ops-secret"): Promise<{ status: number; body: T }> {
    const response = await SELF.fetch(`https://geo-game.test${path}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    return { status: response.status, body: (await response.json()) as T };
}

describe("ops", () => {
    it("doesn't exist without the secret", async () => {
        expect((await ops(GEO_OPS_PATHS.sql, { sql: "SELECT 1" }, "wrong")).status).toBe(404);
        expect((await ops(GEO_OPS_PATHS.wipe, {}, "")).status).toBe(404);
    });

    it("makes the first admin by email", async () => {
        const player = await newPlayer("founder");
        const email = `${(await player.me()).player.displayName}@example.test`;
        const made = await ops<{ role: string }>(GEO_OPS_PATHS.role, { email: email.toUpperCase(), role: "admin" });
        expect(made).toEqual({ status: 200, body: { displayName: expect.any(String), role: "admin" } });
        expect((await call("GET", GEO_API_PATHS.admin.players, player.token)).status).toBe(200);
        expect((await ops(GEO_OPS_PATHS.role, { email: "nobody@example.test", role: "admin" })).status).toBe(404);
    });

    it("runs SQL and grants items for the smoke kit", async () => {
        const player = await newPlayer("smoked");
        const selected = await ops<{ rows: { coins: number }[] }>(GEO_OPS_PATHS.sql, { sql: "SELECT coins FROM players WHERE id = ?", params: [player.id] });
        expect(selected.body.rows).toEqual([{ coins: expect.any(Number) }]);
        expect((await ops(GEO_OPS_PATHS.sql, { sql: "SELEKT" })).status).toBe(400);
        const granted = await ops<{ ids: string[] }>(GEO_OPS_PATHS.grant, { playerId: player.id, items: [{ itemId: "bones", quantity: 2 }] });
        expect(granted.body.ids.length).toBe(1);
        expect(amountOf(await player.me(), "bones")).toBe(2);
    });

    it("wipes progress back to the starter kit, keeping accounts, only when confirmed", async () => {
        const player = await newPlayer("wiped");
        const fresh = await player.me();
        await giveCoins(player.id, 500);
        await grant(player.id, "venomfang-dagger");

        const dry = await ops<{ wiped: boolean; rows: Record<string, number> }>(GEO_OPS_PATHS.wipe, {});
        expect(dry.body.wiped).toBe(false);
        expect(dry.body.rows.inventory).toBeGreaterThan(0);
        expect(amountOf(await player.me(), "venomfang-dagger")).toBe(1);

        const wiped = await ops<{ wiped: boolean; accounts: number }>(GEO_OPS_PATHS.wipe, { confirm: true });
        expect(wiped.body.wiped).toBe(true);
        const after = (await call<GeoMeResponse>("GET", GEO_API_PATHS.me.root, player.token)).body;
        expect(after.player.coins).toBe(fresh.player.coins);
        expect(amountOf(after, "venomfang-dagger")).toBe(0);
        expect(after.inventory.map((entry) => entry.itemId).sort()).toEqual(fresh.inventory.map((entry) => entry.itemId).sort());
    });
});

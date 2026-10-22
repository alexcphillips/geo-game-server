import { describe, expect, it } from "vitest";
import { GEO_API_PATHS, type GeoPlacesResponse, type GeoWorldResponse } from "@geo/shared";
import { MAX_SPAWNS, SPAWN_RULES } from "../../server/src/world/spawns";
import { call, inWorld, newPlayer, rowsWrittenBy } from "./helpers";

/** Spawns and places around the player, in workerd. */

const HERE = { latitude: 51.5007, longitude: -0.1246 };
const worldAt = (point: { latitude: number; longitude: number }, extra = "") =>
    `${GEO_API_PATHS.world}?latitude=${point.latitude}&longitude=${point.longitude}${extra}`;

describe("world", () => {
    it("needs a position", async () => {
        const { token } = await newPlayer("nowhere");
        expect((await call("GET", GEO_API_PATHS.world, token)).status).toBe(400);
    });

    it("places spawns within reach, and keeps them between fetches", async () => {
        const { token } = await newPlayer("spawns");
        const filled = await call<GeoWorldResponse>("GET", worldAt(HERE, "&fill=true"), token);
        expect(filled.status).toBe(200);
        expect(filled.body.spawns).toHaveLength(MAX_SPAWNS);
        expect(filled.body.reachMetres).toBe(SPAWN_RULES.reachMetres);

        const again = await call<GeoWorldResponse>("GET", worldAt(HERE), token);
        expect(again.body.spawns.map((spawn) => spawn.id).sort()).toEqual(filled.body.spawns.map((spawn) => spawn.id).sort());
    });

    it("starts a countdown on spawns walked away from, kept in memory", async () => {
        const { token, id } = await newPlayer("walker");
        const filled = await call<GeoWorldResponse>("GET", worldAt(HERE, "&fill=true"), token);
        const far = { latitude: HERE.latitude + 0.05, longitude: HERE.longitude };
        const writes = await rowsWrittenBy(() => call("GET", worldAt(far), token));
        // No rows: the countdowns are in memory, and no new spawn fits while the old ones count down.
        expect(writes).toBe(0);

        const back = await call<GeoWorldResponse>("GET", worldAt(HERE), token);
        const soonest = Math.min(...back.body.spawns.map((spawn) => Date.parse(spawn.despawnsAt)));
        const lifetimes = Math.min(...filled.body.spawns.map((spawn) => Date.parse(spawn.despawnsAt)));
        // Back within reach: the countdown is off again, so each leaves at its own lifetime.
        expect(soonest).toBe(lifetimes);
        const remembered = await inWorld((_db, world) => world.state.travel.get(id)?.outOfReachSince.size);
        expect(remembered).toBe(0);
    });

    it("puts a dev spawn within reach", async () => {
        const { token } = await newPlayer("dev");
        const made = await call<GeoWorldResponse>("POST", GEO_API_PATHS.dev.spawn, token, { enemyId: "spider", ...HERE });
        expect(made.status).toBe(201);
        expect(made.body.spawns.some((spawn) => spawn.enemyId === "spider")).toBe(true);
        expect((await call("POST", GEO_API_PATHS.dev.spawn, token, { enemyId: "no-such-enemy", ...HERE })).status).toBe(400);
    });

    it("stays inside its write budget", async () => {
        const { token } = await newPlayer("spawnbudget");
        const fill = await rowsWrittenBy(() => call("GET", worldAt(HERE, "&fill=true"), token));
        const refetch = await rowsWrittenBy(() => call("GET", worldAt(HERE), token));
        console.log(`rows written: world fetch placing ${MAX_SPAWNS} spawns ${fill}, a refetch ${refetch}`);
        // One row per spawn placed (no index); a refetch with nothing new writes none.
        expect(fill).toBe(MAX_SPAWNS);
        expect(refetch).toBe(0);
    });

    it("lists active hand-made places nearby", async () => {
        const { token } = await newPlayer("places");
        await inWorld((db) => {
            const insert = `INSERT INTO places (id, kind, name, latitude, longitude, active, settings, created_at, updated_at)
                            VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0);`;
            db.run(insert, crypto.randomUUID(), "fishing", "Pond", HERE.latitude + 0.001, HERE.longitude, 1, `{"fishing":{"tier":"pond"}}`);
            db.run(insert, crypto.randomUUID(), "mining", "Shut", HERE.latitude, HERE.longitude, 0, "{}");
            db.run(insert, crypto.randomUUID(), "landmark", "Far", HERE.latitude + 1, HERE.longitude, 1, "{}");
        });
        const near = await call<GeoPlacesResponse>("GET", `${GEO_API_PATHS.places}?latitude=${HERE.latitude}&longitude=${HERE.longitude}`, token);
        expect(near.status).toBe(200);
        expect(near.body.places.map((place) => place.name)).toEqual(["Pond"]);
        expect(near.body.places[0]?.settings).toEqual({ fishing: { tier: "pond" } });
    });
});

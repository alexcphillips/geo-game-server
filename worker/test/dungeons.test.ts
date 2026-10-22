import { describe, expect, it } from "vitest";
import {
    GEO_API_PATHS,
    GEO_DUNGEON_HOST_AWAY_SECONDS,
    type GeoDungeonRunResponse,
    type GeoDungeonRunView,
    type GeoDungeonsResponse,
    type GeoRunResponse,
    type GeoStartDungeonLobbyResponse,
} from "@geo/shared";
import { addCoins } from "../src/modules/player/player.repository";
import { call, grant, inWorld, newPlayer, path, rowsWrittenBy } from "./helpers";

/** Dungeon lobbies and maps end to end in workerd: ported from server/src/dev/geo-dungeons-smoke.ts. */

const HERE = { latitude: 51.5007, longitude: -0.1246 };
const paths = GEO_API_PATHS.dungeonRuns;
type Err = { error: string };

const createLobby = (token: string) =>
    call<GeoDungeonsResponse>("POST", GEO_API_PATHS.dungeons.lobbies, token, { dungeonId: "slime-pits", requiredLevel: 0, position: HERE, place: HERE });
const lobbyPath = (template: string, lobbyId: string) => path(template, { lobbyId });

/** Plays the first playable card until the fight ends, eating from the lunchbox at 30 health or less. */
async function fight(token: string, start: GeoRunResponse): Promise<GeoRunResponse> {
    let current = start;
    for (let turn = 0; turn < 300 && current.run.status === "active"; turn++) {
        const you = current.run.combatants.find((c) => c.id === current.run.you)!;
        const food = current.run.lunchbox[0];
        const enemy = current.run.combatants.find((c) => c.side === "enemy" && c.health > 0);
        const body =
            you.health <= 30 && food ? { lunchboxSlot: food.slot } : { inventoryId: current.run.hand.find((c) => c.playable)!.inventoryId, targetId: enemy?.id };
        const played = await call<GeoRunResponse>("POST", path(GEO_API_PATHS.runs.turns, { runId: current.run.id }), token, body);
        expect(played.status, JSON.stringify(played.body)).toBe(200);
        current = played.body;
    }
    return current;
}

describe("dungeon lobbies", () => {
    it("creates, joins, lists and leaves a lobby; the host leaving closes it", async () => {
        const host = await newPlayer("host");
        const guest = await newPlayer("guest");
        const created = await createLobby(host.token);
        expect(created.status, JSON.stringify(created.body)).toBe(201);
        const lobby = created.body.myLobby!;
        expect(lobby.members).toEqual([{ displayName: expect.any(String), isHost: true, isYou: true }]);
        expect((await createLobby(host.token)).status).toBe(400);

        const listed = await call<GeoDungeonsResponse>("GET", GEO_API_PATHS.dungeons.root, guest.token);
        expect(listed.body.dungeons.some((d) => d.id === "slime-pits")).toBe(true);
        expect(listed.body.lobbies.some((l) => l.id === lobby.id)).toBe(true);
        expect((await call("POST", lobbyPath(GEO_API_PATHS.dungeons.join, lobby.id), guest.token, { position: HERE, place: { latitude: 52, longitude: 0 } })).status).toBe(400);
        const joined = await call<GeoDungeonsResponse>("POST", lobbyPath(GEO_API_PATHS.dungeons.join, lobby.id), guest.token, { position: HERE, place: HERE });
        expect(joined.body.myLobby?.playerCount).toBe(2);
        expect((await call<Err>("POST", lobbyPath(GEO_API_PATHS.dungeons.start, lobby.id), guest.token)).status).toBe(403);

        const left = await call<GeoDungeonsResponse>("POST", lobbyPath(GEO_API_PATHS.dungeons.leave, lobby.id), guest.token);
        expect(left.body.myLobby).toBeNull();
        expect((await call<GeoDungeonsResponse>("POST", lobbyPath(GEO_API_PATHS.dungeons.leave, lobby.id), host.token)).body.myLobby).toBeNull();
        expect((await call("POST", lobbyPath(GEO_API_PATHS.dungeons.join, lobby.id), guest.token, { position: HERE, place: HERE })).status).toBe(404);
    });

    it("closes a lobby whose host has been away", async () => {
        const host = await newPlayer("away");
        const lobby = (await createLobby(host.token)).body.myLobby!;
        const long = Date.now() - (GEO_DUNGEON_HOST_AWAY_SECONDS + 5) * 1000;
        await inWorld((db, instance) => {
            db.run(`UPDATE dungeon_lobbies SET created_at = ? WHERE id = ?;`, long, lobby.id);
            instance.state.lastHeard.set(host.id, long);
        });
        const viewer = await newPlayer("viewer");
        const listed = await call<GeoDungeonsResponse>("GET", GEO_API_PATHS.dungeons.root, viewer.token);
        expect(listed.body.lobbies.some((l) => l.id === lobby.id)).toBe(false);
    });
});

describe("dungeon runs", () => {
    it("starts a party on one map, walks it room by room, and ends it: no coins lost to a death", async () => {
        const host = await newPlayer("delver");
        const guest = await newPlayer("delver");
        await grant(host.id, "sluice-key");
        await inWorld((db) => addCoins(db, host.id, 120, "admin-grant", "test"));
        const lobby = (await createLobby(host.token)).body.myLobby!;
        await call("POST", lobbyPath(GEO_API_PATHS.dungeons.join, lobby.id), guest.token, { position: HERE, place: HERE });
        const started = await call<GeoStartDungeonLobbyResponse>("POST", lobbyPath(GEO_API_PATHS.dungeons.start, lobby.id), host.token);
        expect(started.status, JSON.stringify(started.body)).toBe(200);
        let map: GeoDungeonRunView = started.body.dungeonRun!;
        expect(map.status).toBe("active");
        expect(map.health).toBe(map.maxHealth);
        expect((await call<GeoDungeonRunResponse>("GET", paths.active, guest.token)).body.dungeonRun.id).toBe(map.id);
        const spawnFight = await call<Err>("POST", GEO_API_PATHS.runs.start, host.token, { kind: "combat", enemyId: "green-slime" });
        expect(spawnFight.body.error).toMatch(/in a dungeon/);

        const move = (roomId: number, token = host.token) => call<GeoDungeonRunResponse & Err>("POST", path(paths.move, { dungeonRunId: map.id }), token, { roomId });
        expect((await move(999)).status).toBe(400);
        const boss = map.rooms.find((room) => room.kind === "boss")!;
        expect((await move(boss.id)).status).toBe(400);

        // The guest leaves; the host walks on alone. Leaving writes only what changed.
        const leaving = await rowsWrittenBy(() => call("POST", path(paths.leave, { dungeonRunId: map.id }), guest.token));
        expect(leaving).toBeLessThanOrEqual(4);
        expect((await call<GeoDungeonRunResponse | null>("GET", paths.active, guest.token)).body).toBeNull();

        const coinsBefore = (await host.me()).player.coins;
        let fights = 0;
        for (let steps = 0; steps < 60 && map.status === "active"; steps++) {
            const options = map.rooms
                .filter((room) => room.id !== map.currentRoom && !room.done && room.kind !== "entrance")
                .sort((a, b) => Number(a.kind === "boss") - Number(b.kind === "boss") || Number(a.seen === "visited") - Number(b.seen === "visited"));
            let moved: GeoDungeonRunResponse | null = null;
            for (const room of options) {
                const tried = await move(room.id);
                if (tried.status === 200) {
                    moved = tried.body;
                    break;
                }
            }
            expect(moved, `some room can be entered (at ${map.currentRoom})`).toBeTruthy();
            map = moved!.dungeonRun;
            if (moved!.fight) {
                expect(moved!.fight.run.dungeonRunId).toBe(map.id);
                const over = await fight(host.token, moved!.fight);
                fights += 1;
                expect(over.run.status).not.toBe("active");
                if (over.run.status === "defeat") expect(over.run.coinsLost).toBe(0);
                map = (await call<GeoDungeonRunResponse>("GET", path(paths.one, { dungeonRunId: map.id }), host.token)).body.dungeonRun;
            }
            if (map.puzzle) {
                const answered = await call<GeoDungeonRunResponse>("POST", path(paths.puzzle, { dungeonRunId: map.id }), host.token, { answer: 0 });
                expect(answered.status).toBe(200);
                expect(JSON.stringify(answered.body)).not.toContain('"answer"');
                map = answered.body.dungeonRun;
            }
            if (map.status === "active") expect(map.health).toBeLessThanOrEqual(map.maxHealth);
        }
        expect(fights).toBeGreaterThan(0);
        expect(map.status).not.toBe("active");
        expect((await host.me()).player.coins).toBeGreaterThanOrEqual(coinsBefore);
        expect((await call<GeoDungeonRunResponse | null>("GET", paths.active, host.token)).body).toBeNull();
        // Nothing left booked for it.
        expect(await inWorld((db) => db.one(`SELECT at FROM due WHERE key = ?;`, `dungeon:${map.id}`))).toBeUndefined();
    });
});

import { describe, expect, it } from "vitest";
import { GEO_API_PATHS, type GeoFarmAction, type GeoFarmView } from "@geo/shared";
import { FARMING } from "../../server/src/content";
import { weekEndsAt, weekOf } from "../../server/src/farming/farm";
import { runDueJobs } from "../src/jobs";
import { dueAt, schedule } from "../src/modules/jobs/jobs.repository";
import { addCoins } from "../src/modules/player/player.repository";
import { amountOf, call, inWorld, newPlayer, rowsWrittenBy } from "./helpers";

/** The farm end to end in workerd: ported from server/src/dev/geo-farming-smoke.ts. */

const MID = 40;

describe("farming", () => {
    it("makes a farm on first look, plants, plays a card, takes turns, and unlocks a tile", async () => {
        const { token, id, me } = await newPlayer("farmer");
        let farm = (await call<GeoFarmView>("GET", GEO_API_PATHS.farm.root, token)).body;
        expect(farm.tiles.filter((tile) => tile.owned).length).toBe(9);
        expect(farm.playsLeft).toBe(5);
        expect(farm.hand.length).toBe(5);
        // Looking again with nothing due writes nothing.
        expect(await rowsWrittenBy(() => call("GET", GEO_API_PATHS.farm.root, token))).toBe(0);

        const act = async (action: GeoFarmAction, status = 200) => {
            const response = await call<GeoFarmView>("POST", GEO_API_PATHS.farm.actions, token, action);
            expect(response.status, JSON.stringify(response.body)).toBe(status);
            if (status === 200) farm = response.body;
        };
        await act({ type: "plant", tile: MID, itemId: "wheat-seeds" });
        expect(amountOf(await me(), "wheat-seeds")).toBe(11);
        expect(farm.tiles[MID]!.crop?.cropId).toBe("wheat");
        await act({ type: "plant", tile: MID, itemId: "wheat-seeds" }, 400);
        await act({ type: "plant", tile: 0, itemId: "wheat-seeds" }, 400);

        const sky = farm.hand.find((card) => card.cardId === "farm.read-sky")!;
        await act({ type: "play", inventoryId: sky.inventoryId, tile: 0 });
        expect(farm.playsLeft).toBe(4);
        await act({ type: "play", inventoryId: sky.inventoryId, tile: 0 }, 400);

        // A cycle passes while away: the look plays it.
        await inWorld((db) => {
            const row = db.one<{ state: string }>(`SELECT state FROM farms WHERE player_id = ?;`, id)!;
            const state = JSON.parse(row.state) as { accruedAt: string };
            state.accruedAt = new Date(Date.now() - FARMING.turnHours * 3_600_000 - 60_000).toISOString();
            db.run(`UPDATE farms SET state = ? WHERE player_id = ?;`, JSON.stringify(state), id);
        });
        farm = (await call<GeoFarmView>("GET", GEO_API_PATHS.farm.root, token)).body;
        expect(farm.turn).toBe(1);
        expect(farm.playsLeft).toBe(5);

        const edge = MID - 2;
        await act({ type: "unlock", tile: edge }, 400);
        await inWorld((db) => addCoins(db, id, 1000, "admin-grant", "test"));
        await act({ type: "unlock", tile: edge });
        expect(farm.tiles[edge]!.owned).toBe(true);
        expect((await me()).player.coins).toBe(950);
    });

    it("pays out last week's contests once, mails the entrants, announces the new week, and books next Monday", async () => {
        const a = await newPlayer("grower");
        const b = await newPlayer("grower");
        const now = Date.now();
        const lastWeek = weekOf(new Date(now)) - 1;
        await inWorld((db) => {
            db.run(`DELETE FROM farm_weeks;`);
            for (const [playerId, score] of [
                [a.id, 500],
                [b.id, 200],
            ] as const) {
                db.run(`INSERT INTO farm_contest_scores (week, contest, player_id, score, updated_at) VALUES (?, 'harvest', ?, ?, ?);`, lastWeek, playerId, score, now);
            }
            schedule(db, "farm-weeks", now);
        });
        await inWorld((_db, instance) => runDueJobs(instance.state, now));

        const [first, second] = FARMING.contests.prizes;
        expect((await a.me()).player.coins).toBe(first);
        expect((await b.me()).player.coins).toBe(second);
        const mail = await inWorld((db) => db.all<{ title: string }>(`SELECT title FROM messages WHERE player_id = ?;`, a.id));
        expect(mail.map((m) => m.title)).toEqual(["Your farm contest results"]);
        expect(await inWorld((db) => db.one(`SELECT 1 FROM announcements WHERE kind = 'event' AND title LIKE 'This week on the farm%';`))).toBeTruthy();
        expect(await inWorld((db) => dueAt(db, "farm-weeks"))).toBe(weekEndsAt(weekOf(new Date(now))).getTime());

        // Run again: nothing is paid twice.
        await inWorld((db, instance) => {
            schedule(db, "farm-weeks", now);
            runDueJobs(instance.state, now);
        });
        expect((await a.me()).player.coins).toBe(first);
    });
});

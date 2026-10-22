import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { advanceTravel, spendTravel, TRAVEL_RULES, type Travel } from "./travel";

const DALLAS = { latitude: 32.7894, longitude: -96.8016 };
const METRES_PER_DEGREE_LAT = 111_320;

/** `metres` north of DALLAS. */
const north = (metres: number) => ({ latitude: DALLAS.latitude + metres / METRES_PER_DEGREE_LAT, longitude: DALLAS.longitude });
const start = (bankedMetres = 0): Travel => ({ ...DALLAS, at: 0, bankedMetres });

describe("travel", () => {
    it("starts with nothing banked", () => {
        assert.equal(advanceTravel(null, DALLAS, 0).bankedMetres, 0);
    });

    it("banks a walk", () => {
        const travel = advanceTravel(start(), north(60), 60_000);
        assert.ok(Math.abs(travel.bankedMetres - 60) < 1, `${travel.bankedMetres}`);
        assert.equal(travel.at, 60_000);
    });

    it("ignores GPS drift and keeps the anchor", () => {
        const travel = advanceTravel(start(), north(15), 60_000);
        assert.equal(travel.bankedMetres, 0);
        assert.equal(travel.at, 0, "anchor kept");
    });

    it("moves a stale anchor without banking, so the next walk still counts", () => {
        const travel = advanceTravel(start(40), north(10), (TRAVEL_RULES.maxLegSeconds + 1) * 1000);
        assert.equal(travel.bankedMetres, 40);
        assert.notEqual(travel.at, 0);
    });

    it("doesn't bank driving or GPS jumps", () => {
        assert.equal(advanceTravel(start(), north(1000), 60_000).bankedMetres, 0, "60 km/h");
        assert.equal(advanceTravel(start(), north(100), 0).bankedMetres, 0, "no time at all");
    });

    it("doesn't bank a leg too long apart to have been watched", () => {
        assert.equal(advanceTravel(start(), north(500), 10 * 60_000).bankedMetres, 0);
    });

    it("caps what's banked", () => {
        const most = TRAVEL_RULES.metresPerSpawn * TRAVEL_RULES.maxBankedSpawns;
        assert.equal(advanceTravel(start(most - 10), north(60), 60_000).bankedMetres, most);
    });

    it("spends whole spawns only, up to what's wanted", () => {
        const per = TRAVEL_RULES.metresPerSpawn;
        assert.deepEqual(spendTravel(start(per * 2 + 20), 5), { spawns: 2, travel: start(20) });
        assert.deepEqual(spendTravel(start(per * 2 + 20), 1), { spawns: 1, travel: start(per + 20) });
        assert.equal(spendTravel(start(per - 1), 5).spawns, 0);
        assert.equal(spendTravel(start(per * 2), 0).spawns, 0);
    });
});

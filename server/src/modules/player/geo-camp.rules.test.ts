import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { distanceMetres } from "@geo/shared";
import { campMovableAt, currentHealth, defeatHealth, isAtCamp, roundCamp } from "./geo-camp.rules";

describe("roundCamp", () => {
    it("drops the exact point to four decimals", () => {
        assert.deepEqual(roundCamp({ latitude: 51.507351, longitude: -0.127758 }), { latitude: 51.5074, longitude: -0.1278 });
    });

    it("stays within reach of the point it came from", () => {
        const exact = { latitude: 51.50755, longitude: -0.12755 };
        assert.ok(isAtCamp(exact, roundCamp(exact)));
    });
});

describe("isAtCamp", () => {
    const camp = { latitude: 51.507, longitude: -0.128 };

    it("is false with no camp", () => {
        assert.equal(isAtCamp(camp, null), false);
    });

    it("is true near camp and false a street away", () => {
        assert.equal(isAtCamp({ latitude: 51.5075, longitude: -0.128 }, camp), true);
        const away = { latitude: 51.51, longitude: -0.128 };
        assert.ok(distanceMetres(away, camp) > 300);
        assert.equal(isAtCamp(away, camp), false);
    });
});

describe("campMovableAt", () => {
    it("is now for a camp never set, and GEO_CAMP_MOVE_DAYS after it was", () => {
        assert.ok(campMovableAt(null).getTime() <= Date.now());
        const setAt = new Date("2026-10-15T12:00:00Z");
        assert.equal(campMovableAt(setAt).toISOString(), "2026-10-17T12:00:00.000Z");
    });
});

describe("health", () => {
    it("reads NULL as full and clamps to max", () => {
        assert.equal(currentHealth(null, 80), 80);
        assert.equal(currentHealth(120, 80), 80);
        assert.equal(currentHealth(30, 80), 30);
    });

    it("leaves a tenth of max after a defeat, rounded up, at least 1", () => {
        assert.equal(defeatHealth(100), 10);
        assert.equal(defeatHealth(85), 9);
        assert.equal(defeatHealth(3), 1);
    });
});

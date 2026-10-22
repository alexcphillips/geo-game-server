import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isOpen, requiredLevelProblem } from "./geo-dungeons.rules";

describe("isOpen", () => {
    it("is open until started or closed", () => {
        assert.equal(isOpen({ started_at: null, closed_at: null }), true);
        assert.equal(isOpen({ started_at: new Date(), closed_at: null }), false);
        assert.equal(isOpen({ started_at: null, closed_at: new Date() }), false);
    });
});

describe("requiredLevelProblem", () => {
    it("allows 0 for a dungeon with no requirement", () => {
        assert.equal(requiredLevelProblem(0, 0, 1), null);
    });

    it("allows the dungeon's requirement up to the host's level", () => {
        assert.equal(requiredLevelProblem(12, 12, 20), null);
        assert.equal(requiredLevelProblem(20, 12, 20), null);
    });

    it("refuses below the dungeon's requirement", () => {
        assert.match(requiredLevelProblem(5, 12, 20) ?? "", /at least combat level 12/);
    });

    it("refuses a host below the dungeon's requirement", () => {
        assert.match(requiredLevelProblem(12, 12, 9) ?? "", /needs combat level 12/);
    });

    it("refuses above the host's own level", () => {
        assert.match(requiredLevelProblem(10, 0, 9) ?? "", /higher combat level than your own/);
    });

    it("refuses a non-integer", () => {
        assert.match(requiredLevelProblem(2.5, 0, 9) ?? "", /whole number/);
    });
});

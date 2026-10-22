import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyModifiers } from "../../engine/stats";
import { nextElectionEnd, pickCandidates, pickWinner } from "./geo-mayor.rules";

const at = (iso: string) => new Date(iso);

describe("elections", () => {
    it("end on the first Monday 00:00 UTC at least a day away", () => {
        // Wednesday → the coming Monday.
        assert.equal(nextElectionEnd(Date.parse("2026-10-14T12:00:00Z")).toISOString(), "2026-10-19T00:00:00.000Z");
        // Sunday evening is under a day from Monday, so the Monday after.
        assert.equal(nextElectionEnd(Date.parse("2026-10-18T20:00:00Z")).toISOString(), "2026-10-26T00:00:00.000Z");
    });

    it("leave the mayor in office out of the candidates", () => {
        for (let i = 0; i < 20; i++) {
            const picked = pickCandidates("marlon");
            assert.equal(picked.length, 3);
            assert.ok(!picked.includes("marlon"));
            assert.equal(new Set(picked).size, 3);
        }
    });

    it("go to the most votes, weighted", () => {
        const tally = [
            { candidate_id: "luna", votes: "3", voters: "3", last_vote_at: at("2026-10-12T00:00:00Z") },
            { candidate_id: "malphas", votes: "4", voters: "2", last_vote_at: at("2026-10-12T00:00:00Z") },
        ];
        assert.equal(pickWinner(["luna", "malphas", "siegmoor"], tally), "malphas");
    });

    it("break a tie on voters, then on who got there first", () => {
        const tied = [
            { candidate_id: "luna", votes: "4", voters: "4", last_vote_at: at("2026-10-12T05:00:00Z") },
            { candidate_id: "malphas", votes: "4", voters: "2", last_vote_at: at("2026-10-12T01:00:00Z") },
        ];
        assert.equal(pickWinner(["luna", "malphas"], tied), "luna");
        const sameVoters = [
            { candidate_id: "luna", votes: "4", voters: "4", last_vote_at: at("2026-10-12T05:00:00Z") },
            { candidate_id: "malphas", votes: "4", voters: "4", last_vote_at: at("2026-10-12T01:00:00Z") },
        ];
        assert.equal(pickWinner(["luna", "malphas"], sameVoters), "malphas");
    });

    it("pick at random when nobody voted", () => {
        assert.equal(pickWinner(["luna", "malphas", "siegmoor"], [], () => 2), "siegmoor");
    });

    it("weigh a vote by voteWeight modifiers, e.g. a talisman", () => {
        const talisman = [{ stat: "voteWeight", kind: "flat" as const, value: 1 }];
        assert.equal(Math.floor(applyModifiers(1, [], "voteWeight")), 1);
        assert.equal(Math.floor(applyModifiers(1, talisman, "voteWeight")), 2);
    });
});

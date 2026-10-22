import { describe, expect, it } from "vitest";
import {
    GEO_ALREADY_VOTED,
    GEO_API_PATHS,
    type GeoFriendsResponse,
    type GeoInboxResponse,
    type GeoMayorResponse,
    type GeoMyFeedbackResponse,
    type GeoQuestsResponse,
} from "@geo/shared";
import { runDueJobs } from "../src/jobs";
import { dueAt } from "../src/modules/jobs/jobs.repository";
import { recordQuestEvents } from "../src/modules/quests/quests.repository";
import { call, giveCoins, inWorld, makeAdmin, newPlayer, path, rowsWrittenBy } from "./helpers";

/** Mayors, quests, friends, the inbox, feedback and suggestions in workerd: ported from the Express smoke suites. */

describe("mayor", () => {
    it("shows the running election, takes one vote each, and closes on its alarm", async () => {
        const voter = await newPlayer("voter");
        const mayor = await call<GeoMayorResponse>("GET", GEO_API_PATHS.mayor.root, voter.token);
        expect(mayor.status).toBe(200);
        const { election } = mayor.body;
        expect(election.candidates.length).toBe(3);
        expect(await inWorld((db) => dueAt(db, "election"))).toBe(Date.parse(election.endsAt));
        // Reading the election with nothing due writes nothing.
        expect(await rowsWrittenBy(() => call("GET", GEO_API_PATHS.mayor.root, voter.token))).toBe(0);

        const pick = election.candidates[0]!.id;
        const vote = path(GEO_API_PATHS.mayor.vote, { electionId: election.id });
        expect((await call("POST", vote, voter.token, { candidateId: "nobody" })).status).toBe(400);
        const cast = await call<GeoMayorResponse>("POST", vote, voter.token, { candidateId: pick });
        expect(cast.status).toBe(201);
        expect(cast.body.election.yourVote).toEqual({ candidateId: pick, weight: 1 });
        const again = await call<{ error: string }>("POST", vote, voter.token, { candidateId: pick });
        expect(again).toEqual({ status: 409, body: { error: GEO_ALREADY_VOTED } });

        // The alarm closes it: the only candidate with a vote wins, and everyone hears.
        await inWorld((_db, instance) => runDueJobs(instance.state, Date.parse(election.endsAt) + 1));
        const after = await call<GeoMayorResponse>("GET", GEO_API_PATHS.mayor.root, voter.token);
        expect(after.body.mayor.id).toBe(pick);
        expect(after.body.election.id).not.toBe(election.id);
        expect(await inWorld((db) => dueAt(db, "election"))).toBe(Date.parse(after.body.election.endsAt));
        const inbox = await call<GeoInboxResponse>("GET", GEO_API_PATHS.inbox.root, voter.token);
        expect(inbox.body.announcements.some((mail) => mail.kind === "mayor" && !mail.read)).toBe(true);
    });

    it("lets an admin end the election now or move its end", async () => {
        const admin = await newPlayer("admin");
        await makeAdmin(admin.id);
        const before = (await call<GeoMayorResponse>("GET", GEO_API_PATHS.mayor.root, admin.token)).body;
        const soon = new Date(Date.now() + 120_000).toISOString();
        const moved = await call<GeoMayorResponse>("PUT", GEO_API_PATHS.admin.electionEndsAt, admin.token, { endsAt: soon });
        expect(moved.body.election.endsAt).toBe(soon);
        expect(await inWorld((db) => dueAt(db, "election"))).toBe(Date.parse(soon));
        const ended = await call<GeoMayorResponse>("POST", GEO_API_PATHS.admin.endElection, admin.token);
        expect(ended.status).toBe(200);
        expect(ended.body.election.id).not.toBe(before.election.id);
    });
});

describe("quests", () => {
    it("gives the first quests, tracks one, counts kills, and pays out on claim", async () => {
        const { token, id, me } = await newPlayer("quester");
        const log = await call<GeoQuestsResponse>("GET", GEO_API_PATHS.quests.root, token);
        expect(log.status).toBe(200);
        expect(log.body.quests.length).toBeGreaterThan(0);
        expect(log.body.quests.filter((quest) => quest.tracked).length).toBe(1);

        expect(log.body.quests.map((quest) => quest.id)).toContain("slime-cull");
        const tracked = await call<GeoQuestsResponse>("PUT", path(GEO_API_PATHS.quests.track, { questId: "slime-cull" }), token);
        expect(tracked.body.quests.find((quest) => quest.tracked)?.id).toBe("slime-cull");
        expect((await call("POST", path(GEO_API_PATHS.quests.claim, { questId: "slime-cull" }), token)).status).toBe(400);

        await inWorld((db) => recordQuestEvents(db, id, [{ type: "kill", enemyId: "green-slime" }]));
        const ready = (await call<GeoQuestsResponse>("GET", GEO_API_PATHS.quests.root, token)).body.quests.find((quest) => quest.id === "slime-cull")!;
        expect(ready.status).toBe("ready");
        const coins = (await me()).player.coins;
        const claimed = await call<GeoQuestsResponse>("POST", path(GEO_API_PATHS.quests.claim, { questId: "slime-cull" }), token);
        expect(claimed.status, JSON.stringify(claimed.body)).toBe(200);
        expect(claimed.body.quests.some((quest) => quest.id === "slime-cull")).toBe(false);
        expect((await me()).player.coins).toBe(coins + ready.rewards.coins);
        expect((await call("POST", path(GEO_API_PATHS.quests.claim, { questId: "slime-cull" }), token)).status).toBe(404);
    });

    it("counts a deposit made before the bank quest was given", async () => {
        const { token, id } = await newPlayer("saver");
        await giveCoins(id, 50);
        await inWorld((db) => {
            db.run(`UPDATE players SET camp_set_at = ? WHERE id = ?;`, Date.now(), id);
            db.run(`INSERT INTO coin_ledger (player_id, delta, reason, reference, created_at) VALUES (?, -10, 'bank-deposit', NULL, ?);`, id, Date.now());
            // Given now, after both were done (it comes later in the tutorial chain).
            db.run(`INSERT INTO player_quests (player_id, quest_id, started_at) VALUES (?, 'rainy-day-fund', ?);`, id, Date.now());
        });
        const quests = (await call<GeoQuestsResponse>("GET", GEO_API_PATHS.quests.root, token)).body.quests;
        expect(quests.find((entry) => entry.id === "rainy-day-fund")?.status).toBe("ready");
    });
});

describe("friends", () => {
    it("sends, accepts, lists and removes; asking back accepts", async () => {
        const a = await newPlayer("pal");
        const b = await newPlayer("pal");
        const c = await newPlayer("pal");
        const nameOf = async (player: { me: () => Promise<{ player: { displayName: string } }> }) => (await player.me()).player.displayName;

        expect((await call("POST", GEO_API_PATHS.friends.requests, a.token, { username: "nobody-here" })).status).toBe(404);
        expect((await call("POST", GEO_API_PATHS.friends.requests, a.token, { username: await nameOf(a) })).status).toBe(400);
        const sent = await call<{ result: string }>("POST", GEO_API_PATHS.friends.requests, a.token, { username: (await nameOf(b)).toUpperCase() });
        expect(sent).toEqual({ status: 201, body: { result: "sent" } });
        expect((await call("POST", GEO_API_PATHS.friends.requests, a.token, { username: await nameOf(b) })).status).toBe(400);

        const incoming = (await call<GeoFriendsResponse>("GET", GEO_API_PATHS.friends.root, b.token)).body.incoming;
        expect(incoming.length).toBe(1);
        const accepted = await call<GeoFriendsResponse>("POST", path(GEO_API_PATHS.friends.accept, { requestId: incoming[0]!.id }), b.token);
        expect(accepted.body.friends.map((friend) => friend.playerId)).toEqual([a.id]);
        expect(accepted.body.friends[0]!.status.online).toBe(false);

        // c asks a, a asks c back: friends.
        await call("POST", GEO_API_PATHS.friends.requests, c.token, { username: await nameOf(a) });
        expect((await call<{ result: string }>("POST", GEO_API_PATHS.friends.requests, a.token, { username: await nameOf(c) })).body.result).toBe("accepted");
        expect((await call<GeoFriendsResponse>("GET", GEO_API_PATHS.friends.root, a.token)).body.friends.length).toBe(2);

        const removed = await call<GeoFriendsResponse>("DELETE", path(GEO_API_PATHS.friends.friend, { playerId: b.id }), a.token);
        expect(removed.body.friends.map((friend) => friend.playerId)).toEqual([c.id]);
        expect((await call("DELETE", path(GEO_API_PATHS.friends.friend, { playerId: b.id }), a.token)).status).toBe(404);
        expect((await call("POST", GEO_API_PATHS.presence, a.token, { activity: "exploring" })).status).toBe(204);
        expect((await call("POST", GEO_API_PATHS.presence, a.token, { activity: "dancing" })).status).toBe(400);
    });
});

describe("inbox, feedback and suggestions", () => {
    it("sends feedback, replies to it in the inbox, and marks it read", async () => {
        const player = await newPlayer("reporter");
        const admin = await newPlayer("admin");
        await makeAdmin(admin.id);

        const sent = await call<GeoMyFeedbackResponse>("POST", GEO_API_PATHS.feedback, player.token, { kind: "bug", title: "Map goes black", body: "after a fight" });
        expect(sent.status).toBe(201);
        expect(sent.body.feedback[0]).toMatchObject({ title: "Map goes black", status: "new", replies: 0 });
        expect((await call("POST", GEO_API_PATHS.feedback, player.token, { kind: "bug", title: "" })).status).toBe(400);

        const id = sent.body.feedback[0]!.id;
        const replied = await call<{ status: string; replies: unknown[] }>("POST", path(GEO_API_PATHS.admin.feedbackReplies, { feedbackId: id }), admin.token, { body: "Fixed in 1.0.1" });
        expect(replied.status).toBe(200);
        expect(replied.body.status).toBe("seen");
        expect(replied.body.replies.length).toBe(1);

        const inbox = await call<GeoInboxResponse>("GET", GEO_API_PATHS.inbox.root, player.token);
        const reply = inbox.body.messages.find((mail) => mail.kind === "feedbackReply")!;
        expect(reply).toMatchObject({ title: "Re: Map goes black", read: false, feedback: { title: "Map goes black" } });
        expect(inbox.body.unread).toBeGreaterThan(0);
        expect((await call("POST", GEO_API_PATHS.inbox.read, player.token, { asOf: inbox.body.asOf })).status).toBe(204);
        expect((await call<GeoInboxResponse>("GET", GEO_API_PATHS.inbox.root, player.token)).body.unread).toBe(0);
        expect((await call<GeoMyFeedbackResponse>("GET", GEO_API_PATHS.feedback, player.token)).body.feedback[0]!.replies).toBe(1);
        // Reading again moves nothing.
        expect(await rowsWrittenBy(() => call("POST", GEO_API_PATHS.inbox.read, player.token, { asOf: inbox.body.asOf }))).toBe(0);
    });

    it("takes a suggestion, and an admin rejects, reopens, moves and places it", async () => {
        const player = await newPlayer("scout");
        const admin = await newPlayer("admin");
        await makeAdmin(admin.id);
        const here = { latitude: 51.5, longitude: -0.12 };
        const created = await call<{ id: string }>("POST", GEO_API_PATHS.suggestions, player.token, {
            kind: "fishing",
            latitude: 51.501,
            longitude: -0.12,
            note: "pond",
            player: here,
        });
        expect(created.status).toBe(201);
        const suggestion = path(GEO_API_PATHS.admin.suggestion, { suggestionId: created.body.id });

        expect((await call("GET", GEO_API_PATHS.admin.suggestions, player.token)).status).toBe(403);
        const listed = await call<{ suggestions: { id: string; distanceMetres: number }[] }>("GET", `${GEO_API_PATHS.admin.suggestions}?status=open`, admin.token);
        expect(listed.body.suggestions.find((entry) => entry.id === created.body.id)?.distanceMetres).toBeGreaterThan(100);

        expect((await call<{ status: string }>("PUT", suggestion, admin.token, { status: "rejected", reviewNote: "no" })).body.status).toBe("rejected");
        expect((await call<{ status: string; reviewNote: string | null }>("PUT", suggestion, admin.token, { status: "open" })).body).toMatchObject({ status: "open", reviewNote: null });
        const moved = await call<{ latitude: number; originalLatitude: number }>("PATCH", suggestion, admin.token, { latitude: 51.502, longitude: -0.12 });
        expect(moved.body).toMatchObject({ latitude: 51.502, originalLatitude: 51.501 });

        const place = await call<{ id: string; suggestionId: string }>("POST", GEO_API_PATHS.admin.places, admin.token, {
            kind: "fishing",
            latitude: 51.502,
            longitude: -0.12,
            suggestionId: created.body.id,
            settings: { fishing: { tier: "pond" } },
        });
        expect(place.status, JSON.stringify(place.body)).toBe(201);
        expect(place.body.suggestionId).toBe(created.body.id);
        expect((await call("POST", GEO_API_PATHS.admin.places, admin.token, { kind: "fishing", latitude: 51.5, longitude: -0.12, suggestionId: created.body.id })).status).toBe(409);
        const after = await call<{ suggestions: { id: string; status: string; placeId: string | null }[] }>("GET", GEO_API_PATHS.admin.suggestions, admin.token);
        expect(after.body.suggestions.find((entry) => entry.id === created.body.id)).toMatchObject({ status: "accepted", placeId: place.body.id });

        const edited = await call<{ name: string; active: boolean }>("PATCH", path(GEO_API_PATHS.admin.place, { placeId: place.body.id }), admin.token, { name: "Pond", active: false });
        expect(edited.body).toMatchObject({ name: "Pond", active: false });
        expect((await call("DELETE", path(GEO_API_PATHS.admin.place, { placeId: place.body.id }), admin.token)).status).toBe(204);
    });
});

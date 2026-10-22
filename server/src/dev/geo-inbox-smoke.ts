import assert from "node:assert/strict";
import {
    GEO_API_PATHS,
    type GeoAdminAnnouncementsResponse,
    type GeoAdminFeedback,
    type GeoAdminFeedbackResponse,
    type GeoInboxResponse,
    type GeoMyFeedbackResponse,
    type GeoSocketServerMessage,
} from "@geo/shared";
import { startSmokeServer, step } from "./smoke-kit";

/**
 * End-to-end check of feedback and the inbox against the local database: a
 * player sends feedback, an admin sees it, changes its status and replies;
 * the reply and an announcement land in the inbox, count toward the badge,
 * and are read once the inbox is. `npm run smoke:geo-inbox`.
 *
 * Announcements are everyone's, so the ones made here are deleted at the end.
 */
const { call, registerPlayer, openSocket, sql, makeAdmin, stop } = await startSmokeServer();
const announcementIds: string[] = [];

const inbox = async (token: string) => (await call<GeoInboxResponse>("GET", GEO_API_PATHS.inbox.root, token)).body;
/** The unread count a socket is sent on connect, as the HUD badge shows it. */
async function badge(token: string): Promise<number> {
    const socket = openSocket(token);
    const { badges } = await socket.next((m: GeoSocketServerMessage): m is Extract<GeoSocketServerMessage, { type: "badges" }> => m.type === "badges");
    socket.ws.close();
    return badges.unreadInbox;
}

try {
    const admin = await registerPlayer("in-admin");
    await makeAdmin(admin.player.id);
    const player = await registerPlayer("in-player");
    const a = admin.accessToken;
    const p = player.accessToken;

    assert.equal(await badge(p), 0);
    assert.equal((await inbox(p)).unread, 0);
    step("a new player starts with nothing unread, whatever news came before them");

    assert.equal((await call("POST", GEO_API_PATHS.feedback, p, { kind: "rant", title: "x" })).status, 400);
    assert.equal((await call("POST", GEO_API_PATHS.feedback, p, { kind: "bug", title: "  " })).status, 400);
    const sent = await call<GeoMyFeedbackResponse>("POST", GEO_API_PATHS.feedback, p, {
        kind: "bug",
        title: "Map goes black",
        body: "After a fight the map is black until I restart.",
        appVersion: "1.0.0",
        platform: "ios 18.1",
    });
    assert.equal(sent.status, 201, JSON.stringify(sent.body));
    assert.equal(sent.body.feedback.length, 1);
    assert.equal(sent.body.feedback[0]?.status, "new");
    step("a player sends feedback and sees it in their list");

    assert.equal((await call("GET", GEO_API_PATHS.admin.feedback, p)).status, 403);
    const listed = await call<GeoAdminFeedbackResponse>("GET", `${GEO_API_PATHS.admin.feedback}?status=new`, a);
    assert.equal(listed.status, 200);
    const mine = listed.body.feedback.find((item) => item.playerId === player.player.id);
    assert.ok(mine, "the admin sees it");
    assert.equal(mine.appVersion, "1.0.0");
    assert.equal(mine.platform, "ios 18.1");
    assert.ok(listed.body.counts.new >= 1);
    step("an admin sees it with the app's version and platform; players can't");

    const replyPath = GEO_API_PATHS.admin.feedbackReplies.replace(":feedbackId", mine.id);
    assert.equal((await call("POST", replyPath, a, { body: " " })).status, 400);
    const replied = await call<GeoAdminFeedback>("POST", replyPath, a, { body: "Thanks, fixed in the next update." });
    assert.equal(replied.status, 200, JSON.stringify(replied.body));
    assert.equal(replied.body.status, "seen", "a reply marks new feedback seen");
    assert.equal(replied.body.replies.length, 1);
    assert.equal(replied.body.replies[0]?.from, admin.player.displayName);
    step("replying marks it seen and keeps the reply on it");

    const statusPath = GEO_API_PATHS.admin.feedbackItem.replace(":feedbackId", mine.id);
    assert.equal((await call("PATCH", statusPath, a, { status: "nope" })).status, 400);
    const planned = await call<GeoAdminFeedback>("PATCH", statusPath, a, { status: "planned" });
    assert.equal(planned.body.status, "planned");
    assert.equal(planned.body.updatedBy, admin.player.displayName);
    const myList = (await call<GeoMyFeedbackResponse>("GET", GEO_API_PATHS.feedback, p)).body.feedback;
    assert.equal(myList[0]?.status, "planned");
    assert.equal(myList[0]?.replies, 1);
    step("the status changes, and the player sees it and the reply count");

    const announcements = GEO_API_PATHS.admin.announcements;
    assert.equal((await call("POST", announcements, p, { kind: "news", title: "x" })).status, 403);
    assert.equal((await call("POST", announcements, a, { kind: "mayor", title: "x" })).status, 400, "mayor is the server's");
    assert.equal((await call("POST", announcements, a, { kind: "changelog", title: "x" })).status, 400, "needs a version");
    const posted = await call<GeoAdminAnnouncementsResponse>("POST", announcements, a, {
        kind: "changelog",
        title: "Smoke test changelog",
        body: "• Things",
        version: "1.0.1",
    });
    assert.equal(posted.status, 201, JSON.stringify(posted.body));
    const changelog = posted.body.announcements.find((item) => item.title === "Smoke test changelog")!;
    announcementIds.push(changelog.id);
    assert.equal(changelog.postedBy, admin.player.displayName);
    const expired = await call<GeoAdminAnnouncementsResponse>("POST", announcements, a, {
        kind: "event",
        title: "Smoke test event",
        expiresInHours: 0.0001,
    });
    announcementIds.push(expired.body.announcements.find((item) => item.title === "Smoke test event")!.id);
    step("admins post announcements; mayor ones and versionless changelogs are refused");

    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.equal(await badge(p), 2, "the reply and the changelog; the expired event doesn't count");
    const before = await inbox(p);
    assert.equal(before.unread, 2);
    assert.equal(before.messages[0]?.title, "Re: Map goes black");
    assert.equal(before.messages[0]?.feedback?.title, "Map goes black");
    assert.equal(before.messages[0]?.read, false);
    assert.ok(before.announcements.some((item) => item.id === changelog.id && !item.read));
    assert.ok(!before.announcements.some((item) => item.title === "Smoke test event"), "expired is gone");
    step("the inbox has the reply and the announcement, unread, and the badge counts them");

    assert.equal((await call("POST", GEO_API_PATHS.inbox.read, p, { asOf: "soon" })).status, 400);
    assert.equal((await call("POST", GEO_API_PATHS.inbox.read, p, { asOf: before.asOf })).status, 204);
    const late = await call<GeoAdminAnnouncementsResponse>("POST", announcements, a, { kind: "news", title: "Smoke test news" });
    announcementIds.push(late.body.announcements.find((item) => item.title === "Smoke test news")!.id);
    const after = await inbox(p);
    assert.equal(after.unread, 1, "only what came after the inbox was read");
    assert.ok(after.messages.every((message) => message.read));
    assert.equal(after.announcements.find((item) => !item.read)?.title, "Smoke test news");
    step("reading marks what was seen, not what arrived after");

    const deletePath = GEO_API_PATHS.admin.announcement.replace(":announcementId", announcementIds.pop()!);
    assert.equal((await call("DELETE", deletePath, a)).status, 200);
    assert.equal((await inbox(p)).unread, 0);
    assert.equal((await call("DELETE", deletePath, a)).status, 404);
    step("deleting an announcement takes it out of every inbox");
} finally {
    if (announcementIds.length > 0) await sql(`DELETE FROM announcements WHERE id IN (SELECT value FROM json_each(?))`, [JSON.stringify(announcementIds)]);
    // Feedback outlives its player (unsigned), so the test's own goes too.
    await sql(`DELETE FROM feedback WHERE title = 'Map goes black' AND app_version = '1.0.0' AND platform = 'ios 18.1'`);
    await stop();
}

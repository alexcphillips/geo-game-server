import assert from "node:assert/strict";
import {
    GEO_API_PATHS,
    type GeoBadges,
    type GeoFriendsResponse,
    type GeoFriendStatus,
    type GeoSendFriendResponse,
    type GeoSocketServerMessage,
} from "@geo/shared";
import { OFFLINE_GRACE_MS } from "../src/realtime/timing";
import { startSmokeServer, step } from "./smoke-kit";

/**
 * End-to-end check of friends against the Worker: requests by
 * username, refusals, accepting (and asking back), presence from the geo
 * socket with the app's activity, badge and list pushes, declining,
 * cancelling and removing.
 * `npm run smoke:geo-friends`.
 */
const { call, registerPlayer, openSocket, stop } = await startSmokeServer();

const friends = async (token: string) => (await call<GeoFriendsResponse>("GET", GEO_API_PATHS.friends.root, token)).body;
const ask = (token: string, username: string) =>
    call<GeoSendFriendResponse>("POST", GEO_API_PATHS.friends.requests, token, { username });
const report = (token: string, activity: string, skill?: string) => call("POST", GEO_API_PATHS.presence, token, { activity, skill });
const isReady = (m: GeoSocketServerMessage): m is GeoSocketServerMessage => m.type === "ready";
const friendsHint = (m: GeoSocketServerMessage): m is GeoSocketServerMessage => m.type === "changed" && m.topic === "friends";
const badges = (match: (badges: GeoBadges) => boolean) => (m: GeoSocketServerMessage): m is Extract<GeoSocketServerMessage, { type: "badges" }> =>
    m.type === "badges" && match(m.badges);

/** Presence is written just after a socket opens or closes: waits for the status a friend sees to match. */
async function statusOf(token: string, match: (status: GeoFriendStatus) => boolean): Promise<GeoFriendStatus> {
    for (let tries = 0; ; tries++) {
        const status = (await friends(token)).friends[0]!.status;
        if (match(status) || tries >= 20) return status;
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
}

try {
    const ana = await registerPlayer("fr-a");
    const ben = await registerPlayer("fr-b");
    const cat = await registerPlayer("fr-c");
    const a = ana.accessToken;
    const b = ben.accessToken;
    const c = cat.accessToken;

    assert.equal((await ask(a, "no-such-player-anywhere")).status, 404);
    assert.equal((await ask(a, ana.player.displayName)).status, 400);
    step("unknown names and yourself are refused");

    // Ben has the app open: a socket, so pushes.
    const benSocket = openSocket(b);
    await benSocket.next(isReady);
    await benSocket.next(badges((counts) => counts.incomingRequests === 0));

    // Case doesn't matter: usernames are unique ignoring it.
    const sent = await ask(a, ben.player.displayName.toUpperCase());
    assert.equal(sent.status, 201, JSON.stringify(sent.body));
    assert.equal(sent.body.result, "sent");
    assert.equal((await ask(a, ben.player.displayName)).status, 400, "asking twice");
    assert.equal((await friends(a)).outgoing.length, 1);
    const incoming = (await friends(b)).incoming;
    assert.equal(incoming.length, 1);
    assert.equal(incoming[0]?.name, ana.player.displayName);
    step("a request by username shows on both sides");

    await benSocket.next(badges((counts) => counts.incomingRequests === 1));
    await benSocket.next(friendsHint);
    step("the request reaches Ben over the socket: his badge count and a friends-list hint");

    const requestId = incoming[0]!.id;
    const acceptPath = GEO_API_PATHS.friends.accept.replace(":requestId", requestId);
    assert.equal((await call("POST", acceptPath, a)).status, 404, "only the addressee accepts");
    const accepted = await call<GeoFriendsResponse>("POST", acceptPath, b);
    assert.equal(accepted.status, 200);
    assert.equal(accepted.body.friends[0]?.name, ana.player.displayName);
    assert.equal(accepted.body.incoming.length, 0);
    assert.equal((await ask(b, ana.player.displayName)).status, 400, "already friends");
    step("accepting makes friends both ways");

    // Ben has a socket; Ana has none.
    let ofAna = await statusOf(a, (status) => status.online);
    assert.deepEqual(ofAna, { online: true, activity: "exploring", skill: null });
    assert.equal((await friends(b)).friends[0]?.status.online, false);
    step("online while the app has a socket (exploring until it says otherwise); offline without one");

    const anaSocket = openSocket(a);
    await anaSocket.next(isReady);
    anaSocket.drain();
    assert.equal((await report(b, "skilling", "fishing")).status, 204);
    await anaSocket.next(friendsHint);
    ofAna = await statusOf(a, (status) => status.online && status.activity === "skilling");
    assert.deepEqual(ofAna, { online: true, activity: "skilling", skill: "fishing" });
    assert.equal((await report(b, "skilling")).status, 400, "skilling needs a skill");
    assert.equal((await report(b, "napping")).status, 400);
    step("an activity report shows to friends, and those with the list open get a hint");

    anaSocket.drain();
    benSocket.ws.close();
    await anaSocket.next(friendsHint, OFFLINE_GRACE_MS + 5000);
    const gone = await statusOf(a, (status) => !status.online);
    assert.ok(!gone.online, JSON.stringify(gone));
    assert.equal((await report(b, "trading")).status, 204);
    assert.equal((await statusOf(a, (status) => status.online)).online, false, "a report without a socket is ignored");
    step(`closing the app's socket goes offline after the ${OFFLINE_GRACE_MS / 1000} s grace; friends hear`);

    // Cat asks Ana, then Ana asks Cat back: that accepts Cat's.
    await ask(c, ana.player.displayName);
    const back = await ask(a, cat.player.displayName);
    assert.equal(back.body.result, "accepted");
    assert.equal((await friends(a)).friends.length, 2);
    step("asking someone who asked you accepts theirs");

    const removePath = GEO_API_PATHS.friends.friend.replace(":playerId", cat.player.id);
    assert.equal((await call("DELETE", removePath, a)).status, 200);
    assert.equal((await friends(c)).friends.length, 0);
    assert.equal((await call("DELETE", removePath, a)).status, 404);
    step("removing a friend removes it for both");

    await ask(c, ben.player.displayName);
    const toBen = (await friends(c)).outgoing[0]!.id;
    const requestPath = GEO_API_PATHS.friends.request.replace(":requestId", toBen);
    assert.equal((await call("DELETE", requestPath, a)).status, 404, "a stranger can't touch it");
    assert.equal((await call("DELETE", requestPath, b)).status, 200);
    assert.equal((await friends(c)).outgoing.length, 0);
    await ask(c, ben.player.displayName);
    const again = (await friends(c)).outgoing[0]!.id;
    assert.equal((await call("DELETE", GEO_API_PATHS.friends.request.replace(":requestId", again), c)).status, 200);
    assert.equal((await friends(b)).incoming.length, 0);
    step("declining and cancelling both clear the request");
} finally {
    await stop();
}

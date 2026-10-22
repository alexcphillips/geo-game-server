import assert from "node:assert/strict";
import {
    GEO_API_PATHS,
    type GeoAdminSuggestion,
    type GeoAdminSuggestionsResponse,
    type GeoSuggestionRequest,
} from "@geo/shared";
import { startSmokeServer, step } from "./smoke-kit";

/**
 * Location suggestions against the local database: a player sends one, an
 * admin lists, accepts and reopens it, and players can't reach the admin side.
 */
async function main() {
    const { call, registerPlayer, sql, makeAdmin, stop } = await startSmokeServer();
    try {
        const player = await registerPlayer("suggest");
        const admin = await registerPlayer("admin");
        await makeAdmin(admin.player.id);

        const request: GeoSuggestionRequest = {
            kind: "fishing",
            latitude: 51.5007,
            longitude: -0.1246,
            note: "  pond behind the library  ",
            player: { latitude: 51.5, longitude: -0.1246, accuracy: 8 },
        };
        const created = await call<{ id: string }>("POST", GEO_API_PATHS.suggestions, player.accessToken, request);
        assert.equal(created.status, 201);
        step("a player sends a suggestion");

        assert.equal((await call("POST", GEO_API_PATHS.suggestions, player.accessToken, { ...request, kind: "lava" })).status, 400);
        assert.equal((await call("POST", GEO_API_PATHS.suggestions, player.accessToken, { ...request, latitude: 200 })).status, 400);
        assert.equal((await call("POST", GEO_API_PATHS.suggestions, player.accessToken, { ...request, note: "x".repeat(281) })).status, 400);
        step("bad kinds, points and notes are refused");

        assert.equal((await call("GET", GEO_API_PATHS.admin.suggestions, player.accessToken)).status, 403);
        step("players can't list suggestions");

        const open = await call<GeoAdminSuggestionsResponse>("GET", `${GEO_API_PATHS.admin.suggestions}?status=open`, admin.accessToken);
        assert.equal(open.status, 200);
        const mine = open.body.suggestions.find((s) => s.id === created.body.id);
        assert.ok(mine, "the new suggestion is listed as open");
        assert.equal(mine.note, "pond behind the library");
        assert.equal(mine.playerName, player.player.displayName);
        assert.ok(mine.distanceMetres > 70 && mine.distanceMetres < 85, `distance ${mine.distanceMetres}`);
        assert.equal(mine.gpsAccuracy, 8);
        step("an admin sees it, with distance and accuracy");

        const path = GEO_API_PATHS.admin.suggestion.replace(":suggestionId", created.body.id);
        assert.equal((await call("PUT", path, admin.accessToken, { status: "accepted" })).status, 400);
        step("accepting without placing it is refused (smoke:geo-places covers accepting by placing)");

        const rejected = await call<GeoAdminSuggestion>("PUT", path, admin.accessToken, { status: "rejected", reviewNote: "private land" });
        assert.equal(rejected.status, 200);
        assert.equal(rejected.body.status, "rejected");
        assert.equal(rejected.body.reviewNote, "private land");
        assert.equal(rejected.body.reviewedBy, admin.player.displayName);
        const reopened = await call<GeoAdminSuggestion>("PUT", path, admin.accessToken, { status: "open" });
        assert.equal(reopened.body.status, "open");
        assert.equal(reopened.body.reviewedAt, null);
        step("an admin rejects it, then reopens it");

        const audit = await sql(`SELECT 1 FROM admin_actions WHERE action = 'review-suggestion' AND target = ?`, [created.body.id]);
        assert.equal(audit.length, 2);
        step("both reviews are audited");

        assert.equal(mine.originalLatitude, null, "never moved, so no original pin");
        assert.equal((await call("PATCH", path, player.accessToken, { latitude: 51.5008, longitude: -0.1246 })).status, 403);
        assert.equal((await call("PATCH", path, admin.accessToken, { latitude: 51.5008 })).status, 400);
        assert.equal((await call("PATCH", path, admin.accessToken, { kind: "lava" })).status, 400);
        assert.equal((await call("PATCH", path, admin.accessToken, {})).status, 400);
        const moved = await call<GeoAdminSuggestion>("PATCH", path, admin.accessToken, { latitude: 51.5008, longitude: -0.1247 });
        assert.equal(moved.status, 200);
        assert.equal(moved.body.latitude, 51.5008);
        assert.equal(moved.body.originalLatitude, 51.5007, "the player's pin is kept");
        const movedAgain = await call<GeoAdminSuggestion>("PATCH", path, admin.accessToken, { latitude: 51.5009, longitude: -0.1248, kind: "mining" });
        assert.equal(movedAgain.body.kind, "mining");
        assert.equal(movedAgain.body.originalLatitude, 51.5007, "a second move keeps the first pin");
        assert.equal(movedAgain.body.originalLongitude, -0.1246);
        assert.equal(movedAgain.body.note, "pond behind the library", "the note is the player's");
        const adjusts = await sql(`SELECT 1 FROM admin_actions WHERE action = 'adjust-suggestion' AND target = ?`, [created.body.id]);
        assert.equal(adjusts.length, 2);
        step("an admin moves its pin and changes its kind; the player's pin is kept, both audited");

        await sql(`DELETE FROM location_suggestions WHERE id = ?`, [created.body.id]);
    } finally {
        await stop();
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

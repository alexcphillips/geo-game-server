import assert from "node:assert/strict";
import {
    GEO_API_PATHS,
    type GeoAdminCreatePlaceRequest,
    type GeoAdminPlace,
    type GeoAdminPlacesResponse,
    type GeoAdminSuggestionsResponse,
    type GeoPlacesResponse,
} from "@geo/shared";
import { startSmokeServer, step } from "./smoke-kit";

/**
 * Hand-made places against the Worker: an admin makes, edits, moves,
 * hides and removes one; players see only active ones near them; a place
 * made from a suggestion accepts and links it; every change is audited.
 */
async function main() {
    const { call, registerPlayer, sql, makeAdmin, stop } = await startSmokeServer();
    const placeIds: string[] = [];
    let suggestionId: string | null = null;
    try {
        const player = await registerPlayer("places");
        const admin = await registerPlayer("admin");
        await makeAdmin(admin.player.id);

        // Somewhere no other test or real place will be: the middle of the South Atlantic.
        const here = { latitude: -40.123, longitude: -20.456 };
        const near = (point: { latitude: number; longitude: number }) =>
            `${GEO_API_PATHS.places}?latitude=${point.latitude}&longitude=${point.longitude}`;

        const request: GeoAdminCreatePlaceRequest = {
            kind: "fishing",
            name: "  Smoke Pond  ",
            description: " a pond for testing ",
            latitude: here.latitude + 0.0002,
            longitude: here.longitude,
            settings: { fishing: { tier: "open" } },
        };
        assert.equal((await call("POST", GEO_API_PATHS.admin.places, player.accessToken, request)).status, 403);
        assert.equal((await call("GET", GEO_API_PATHS.admin.places, player.accessToken)).status, 403);
        step("players can't make or list places");

        const bad = async (body: unknown) => (await call("POST", GEO_API_PATHS.admin.places, admin.accessToken, body)).status;
        assert.equal(await bad({ ...request, kind: "other" }), 400);
        assert.equal(await bad({ ...request, name: 42 }), 400);
        assert.equal(await bad({ ...request, name: "x".repeat(61) }), 400);
        assert.equal(await bad({ ...request, description: "x".repeat(281) }), 400);
        assert.equal(await bad({ ...request, latitude: 91 }), 400);
        assert.equal(await bad({ ...request, settings: { fishing: { tier: "abyss" } } }), 400);
        assert.equal(await bad({ ...request, settings: { fishing: { water: "lava" } } }), 400);
        step("bad kinds, names, descriptions, points and settings are refused");

        const created = await call<GeoAdminPlace>("POST", GEO_API_PATHS.admin.places, admin.accessToken, request);
        assert.equal(created.status, 201);
        placeIds.push(created.body.id);
        assert.equal(created.body.name, "Smoke Pond");
        assert.equal(created.body.description, "a pond for testing");
        assert.equal(created.body.active, true);
        assert.equal(created.body.createdBy, admin.player.displayName);

        // The name is optional, when made and when edited.
        const { name: _name, ...unnamedRequest } = request;
        const unnamed = await call<GeoAdminPlace>("POST", GEO_API_PATHS.admin.places, admin.accessToken, unnamedRequest);
        assert.equal(unnamed.status, 201);
        placeIds.push(unnamed.body.id);
        assert.equal(unnamed.body.name, "");
        const unnamedPath = GEO_API_PATHS.admin.place.replace(":placeId", unnamed.body.id);
        const renamed = await call<GeoAdminPlace>("PATCH", unnamedPath, admin.accessToken, { name: "Named" });
        assert.equal(renamed.body.name, "Named");
        const cleared = await call<GeoAdminPlace>("PATCH", unnamedPath, admin.accessToken, { name: "   " });
        assert.equal(cleared.status, 200);
        assert.equal(cleared.body.name, "");
        step("a place needs no name");
        assert.deepEqual(created.body.settings, { fishing: { tier: "open" } });
        step("an admin makes a fishing place with its tier");

        const seen = await call<GeoPlacesResponse>("GET", near(here), player.accessToken);
        assert.equal(seen.status, 200);
        const mine = seen.body.places.find((place) => place.id === created.body.id);
        assert.ok(mine, "the player sees it nearby");
        assert.equal(mine.kind, "fishing");
        assert.ok(!("active" in mine), "players get no admin fields");
        assert.deepEqual(mine.settings, { fishing: { tier: "open" } }, "players get the tier");
        const far = await call<GeoPlacesResponse>("GET", near({ latitude: here.latitude + 0.05, longitude: here.longitude }), player.accessToken);
        assert.ok(!far.body.places.some((place) => place.id === created.body.id), "5 km away it isn't listed");
        assert.equal((await call("GET", GEO_API_PATHS.places, player.accessToken)).status, 400);
        step("players see it near, not far");

        const path = GEO_API_PATHS.admin.place.replace(":placeId", created.body.id);
        assert.equal((await call("PATCH", path, player.accessToken, { name: "Mine now" })).status, 403);
        const retiered = await call<GeoAdminPlace>("PATCH", path, admin.accessToken, { settings: { fishing: { tier: "puddle", water: "river" } } });
        assert.deepEqual(retiered.body.settings, { fishing: { tier: "puddle", water: "river" } });
        step("an admin changes its tier and water");

        const edited = await call<GeoAdminPlace>("PATCH", path, admin.accessToken, { name: "Smoke Lake", kind: "landmark" });
        assert.equal(edited.status, 200);
        assert.equal(edited.body.name, "Smoke Lake");
        assert.equal(edited.body.kind, "landmark");
        assert.equal(edited.body.description, "a pond for testing", "fields not sent stay");
        assert.deepEqual(edited.body.settings, {}, "no longer fishing, so no fishing settings");
        assert.equal((await call("PATCH", path, admin.accessToken, { latitude: here.latitude })).status, 400);
        const moved = await call<GeoAdminPlace>("PATCH", path, admin.accessToken, { latitude: here.latitude, longitude: here.longitude + 0.0001 });
        assert.equal(moved.body.longitude, here.longitude + 0.0001);
        step("an admin edits and moves it; a move needs both coordinates");

        await call("PATCH", path, admin.accessToken, { active: false });
        const hidden = await call<GeoPlacesResponse>("GET", near(here), player.accessToken);
        assert.ok(!hidden.body.places.some((place) => place.id === created.body.id), "inactive places are hidden");
        const listed = await call<GeoAdminPlacesResponse>("GET", GEO_API_PATHS.admin.places, admin.accessToken);
        assert.equal(listed.body.places.find((place) => place.id === created.body.id)?.active, false);
        step("deactivated, it's hidden from players but kept for admins");

        // From a suggestion: the place links to it, and it's accepted.
        const suggestion = await call<{ id: string }>("POST", GEO_API_PATHS.suggestions, player.accessToken, {
            kind: "mining",
            latitude: here.latitude,
            longitude: here.longitude + 0.001,
            note: "rocks",
            player: { latitude: here.latitude, longitude: here.longitude, accuracy: 5 },
        });
        suggestionId = suggestion.body.id;
        const fromSuggestion = await call<GeoAdminPlace>("POST", GEO_API_PATHS.admin.places, admin.accessToken, {
            kind: "mining",
            name: "Smoke Quarry",
            description: "rocks",
            latitude: here.latitude,
            longitude: here.longitude + 0.001,
            suggestionId,
        });
        assert.equal(fromSuggestion.status, 201);
        placeIds.push(fromSuggestion.body.id);
        assert.equal(fromSuggestion.body.suggestionId, suggestionId);
        const reviewed = await call<GeoAdminSuggestionsResponse>("GET", `${GEO_API_PATHS.admin.suggestions}?status=accepted`, admin.accessToken);
        const accepted = reviewed.body.suggestions.find((s) => s.id === suggestionId);
        assert.ok(accepted, "the suggestion is accepted");
        assert.equal(accepted.placeId, fromSuggestion.body.id);
        assert.equal(accepted.reviewedBy, admin.player.displayName);
        const again = await call("POST", GEO_API_PATHS.admin.places, admin.accessToken, { ...request, suggestionId });
        assert.equal(again.status, 409);
        const unknown = await call("POST", GEO_API_PATHS.admin.places, admin.accessToken, { ...request, suggestionId: "00000000-0000-0000-0000-000000000000" });
        assert.equal(unknown.status, 404);
        step("a place made from a suggestion accepts and links it, once");

        assert.equal((await call("DELETE", path, player.accessToken)).status, 403);
        assert.equal((await call("DELETE", path, admin.accessToken)).status, 204);
        assert.equal((await call("DELETE", path, admin.accessToken)).status, 404);
        placeIds.shift();
        step("an admin removes it for good");

        const audit = await sql<{ action: string }>(
            `SELECT action FROM admin_actions WHERE target = ? ORDER BY id`,
            [created.body.id],
        );
        assert.deepEqual(
            audit.map((row) => row.action),
            ["create-place", "update-place", "update-place", "update-place", "update-place", "delete-place"],
        );
        step("every change is audited");
    } finally {
        await sql(`DELETE FROM places WHERE id IN (SELECT value FROM json_each(?))`, [JSON.stringify(placeIds)]);
        if (suggestionId) await sql(`DELETE FROM location_suggestions WHERE id = ?`, [suggestionId]);
        await stop();
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

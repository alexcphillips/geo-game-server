import assert from "node:assert/strict";
import { GEO_API_PATHS, type GeoContentResponse, type GeoMeResponse } from "@geo/shared";
import { startSmokeServer, step } from "./smoke-kit";

/**
 * End-to-end check of crafting against the local database: recipes come with
 * the content, a craft takes its inputs and gives its output, and a refusal
 * (too few inputs, too low a level) takes nothing.
 * `npm run smoke:geo-crafting`. Dev only.
 */
const { call, registerPlayer, grant, sql, stop } = await startSmokeServer();

const craftPath = (recipeId: string) => GEO_API_PATHS.crafting.craft.replace(":recipeId", recipeId);
const quantityOf = (me: GeoMeResponse, itemId: string) =>
    me.inventory.filter((entry) => entry.itemId === itemId).reduce((sum, entry) => sum + entry.quantity, 0);

try {
    const session = await registerPlayer("crafter");
    const token = session.accessToken;
    await grant(session.player.id, [
        { itemId: "silk-spool", quantity: 250 },
        { itemId: "spider-fang", quantity: 16 },
        { itemId: "sturdy-shell", quantity: 1 },
    ]);

    const content = await call<GeoContentResponse>("GET", GEO_API_PATHS.content);
    assert.ok(content.body.recipes.some((recipe) => recipe.id === "compact-silk-spool"));
    // Several enemies drop silk; the spider is one of them.
    const silkDroppers = content.body.sources.filter((source) => source.kind === "enemy" && source.itemId === "silk-spool");
    assert.ok(silkDroppers.some((source) => source.name === "Giant Spider"), JSON.stringify(silkDroppers));
    assert.ok(content.body.sources.some((source) => source.kind === "vendor" && source.itemId === "wheat"));
    step(`the content carries ${content.body.recipes.length} recipes and ${content.body.sources.length} item sources`);

    const before = (await call<GeoMeResponse>("GET", GEO_API_PATHS.me.root, token)).body;
    const silk = quantityOf(before, "silk-spool");
    assert.equal(silk, 250);

    const crafted = await call<GeoMeResponse>("POST", craftPath("compact-silk-spool"), token, { quantity: 2 });
    assert.equal(crafted.status, 200, JSON.stringify(crafted.body));
    assert.equal(quantityOf(crafted.body, "silk-spool"), silk - 200);
    assert.equal(quantityOf(crafted.body, "compact-silk-spool"), 2);
    step("2 Compact Silk Spools took 200 Silk Spools");

    const short = await call<{ error: string }>("POST", craftPath("compact-silk-spool"), token, { quantity: 1 });
    assert.equal(short.status, 400);
    assert.match(short.body.error, /You need 100 Silk Spool/);
    const afterShort = (await call<GeoMeResponse>("GET", GEO_API_PATHS.me.root, token)).body;
    assert.equal(quantityOf(afterShort, "silk-spool"), silk - 200);
    step(`too few inputs is refused, taking nothing: "${short.body.error}"`);

    const unskilled = await call<{ error: string }>("POST", craftPath("venomfang-dagger"), token, { quantity: 1 });
    assert.equal(unskilled.status, 400);
    assert.match(unskilled.body.error, /Combat level 5/);
    step(`a recipe above the player's level is refused: "${unskilled.body.error}"`);

    // Combat 5 is 1,000 XP (100 + 200 + 300 + 400).
    await sql(
        `INSERT INTO skill_xp (player_id, skill, xp) VALUES (?, 'combat', 1000)
         ON CONFLICT (player_id, skill) DO UPDATE SET xp = 1000`,
        [session.player.id],
    );
    const fangs = quantityOf(afterShort, "spider-fang");
    const dagger = await call<GeoMeResponse>("POST", craftPath("venomfang-dagger"), token, { quantity: 1 });
    assert.equal(dagger.status, 200, JSON.stringify(dagger.body));
    assert.equal(quantityOf(dagger.body, "venomfang-dagger"), 1);
    assert.equal(quantityOf(dagger.body, "spider-fang"), fangs - 5);
    assert.equal(quantityOf(dagger.body, "silk-spool"), silk - 215);
    assert.equal(quantityOf(dagger.body, "sturdy-shell"), 0);
    step("at Combat 5, a Venomfang Dagger took 15 Silk Spool, 5 Spider Fang and 1 Sturdy Shell");

    const envenom = await call<GeoMeResponse>("POST", craftPath("envenom"), token, { quantity: 1 });
    assert.equal(envenom.status, 200, JSON.stringify(envenom.body));
    const card = envenom.body.inventory.find((entry) => entry.itemId === "card.envenom");
    assert.equal(card?.chargesLeft, 10);
    step("Envenom arrived with 10 charges");

    const bad = await call<{ error: string }>("POST", craftPath("compact-silk-spool"), token, { quantity: 0 });
    assert.equal(bad.status, 400);
    step("a quantity of 0 is refused");

    console.log("\nAll geo crafting smoke checks passed.");
} finally {
    await stop();
}

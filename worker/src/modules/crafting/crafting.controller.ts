import type { Context } from "hono";
import { GEO_CRAFT_MAX_QUANTITY, geoSkillName, geoUnmetSkill, type GeoCraftRequest } from "@geo/shared";
import { CONTENT } from "../../../../game/src/content";
import { AppError } from "../../../../game/src/http/AppError";
import { wholeNumber } from "../../../../game/src/lib/validate";
import type { AppEnv } from "../../app";
import { jsonBody } from "../../http/body";
import { changeMe } from "../player/player.controller";
import * as playerRepository from "../player/player.repository";
import { recordQuestEvents } from "../quests/quests.repository";

type Ctx = Context<AppEnv>;

/**
 * Crafts a recipe `quantity` times, in one transaction: the skill levels are
 * checked, every input is taken (refusing, with nothing taken, if any falls
 * short), and only then is the output handed over, with any skill XP and
 * quest progress.
 */
export async function craft(c: Ctx) {
    const recipe = CONTENT.recipes[c.req.param("recipeId") ?? ""];
    if (!recipe) throw AppError.notFound("No such recipe");
    const { quantity } = (await jsonBody(c)) as Partial<GeoCraftRequest>;
    const times = wholeNumber(quantity, 1, GEO_CRAFT_MAX_QUANTITY, AppError.badRequest(`Choose between 1 and ${GEO_CRAFT_MAX_QUANTITY}`));

    return changeMe(c, (db, playerId) => {
        const unmet = geoUnmetSkill(playerRepository.findSkillLevels(db, playerId), recipe.skills);
        if (unmet) throw AppError.badRequest(`Needs ${geoSkillName(unmet.skill)} level ${unmet.level}`);
        for (const input of recipe.inputs) playerRepository.takeItems(db, playerId, input.itemId, input.quantity * times);
        playerRepository.grantItems(db, playerId, [{ itemId: recipe.output.itemId, quantity: recipe.output.quantity * times }]);
        if (recipe.xp) playerRepository.addSkillXp(db, playerId, recipe.xp.skill, recipe.xp.amount * times);
        recordQuestEvents(db, playerId, [{ type: "craft", recipeId: recipe.id, times }]);
    });
}

import type { Request, Response } from "express";
import { GEO_CRAFT_MAX_QUANTITY, geoSkillName, geoUnmetSkill, type GeoCraftRequest } from "@geo/shared";
import { AppError } from "../../http/AppError";
import { CONTENT } from "../../content";
import { withTransaction } from "../../db/transaction";
import { requirePlayerId } from "../../middleware/geo-auth";
import { wholeNumber } from "../../lib/validate";
import * as playerRepository from "../player/geo-player.repository";
import * as questsRepository from "../quests/geo-quests.repository";

function readQuantity(value: unknown): number {
    return wholeNumber(value, 1, GEO_CRAFT_MAX_QUANTITY, AppError.badRequest(`Choose between 1 and ${GEO_CRAFT_MAX_QUANTITY}`));
}

/**
 * Crafts a recipe `quantity` times, in one transaction: the skill levels are
 * checked, every input is taken (refusing, with nothing taken, if any falls
 * short), and only then is the output handed over, with any skill XP and
 * quest progress.
 */
export async function craft(req: Request, res: Response) {
    const playerId = requirePlayerId(req);
    const recipe = CONTENT.recipes[String(req.params.recipeId)];
    if (!recipe) throw AppError.notFound("No such recipe");
    const { quantity } = (req.body ?? {}) as Partial<GeoCraftRequest>;
    const times = readQuantity(quantity);

    await withTransaction(async (tx) => {
        // Before the items and quests: the same order as a won fight takes them.
        await playerRepository.lockPlayer(tx, playerId);
        const unmet = geoUnmetSkill(await playerRepository.findSkillLevels(tx, playerId), recipe.skills);
        if (unmet) throw AppError.badRequest(`Needs ${geoSkillName(unmet.skill)} level ${unmet.level}`);
        for (const input of recipe.inputs) {
            await playerRepository.takeItems(tx, playerId, input.itemId, input.quantity * times);
        }
        await playerRepository.grantItems(tx, playerId, [
            { itemId: recipe.output.itemId, quantity: recipe.output.quantity * times },
        ]);
        if (recipe.xp) await playerRepository.addSkillXp(tx, playerId, recipe.xp.skill, recipe.xp.amount * times);
        await questsRepository.recordQuestEvents(tx, playerId, [{ type: "craft", recipeId: recipe.id, times }]);
    });

    res.status(200).json(await playerRepository.findMe(playerId));
}

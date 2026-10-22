import { Router } from "express";
import { GEO_API_PATHS } from "@geo/shared";
import { asyncHandler } from "../../http/asyncHandler";
import { geoAuth } from "../../middleware/geo-auth";
import * as questsController from "./geo-quests.controller";

/** Quests: the player's quest log, tracking one, and turning them in. */
export const geoQuestsRouter: Router = Router();

geoQuestsRouter.get(GEO_API_PATHS.quests.root, geoAuth, asyncHandler(questsController.listQuests));
geoQuestsRouter.put(GEO_API_PATHS.quests.track, geoAuth, asyncHandler(questsController.trackQuest));
geoQuestsRouter.post(GEO_API_PATHS.quests.claim, geoAuth, asyncHandler(questsController.claimQuest));

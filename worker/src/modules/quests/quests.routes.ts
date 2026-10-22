import { Hono } from "hono";
import { GEO_API_PATHS } from "@geo/shared";
import type { AppEnv } from "../../app";
import { auth } from "../../http/auth";
import * as questsController from "./quests.controller";

/** Quests: the player's quest log, tracking one, and turning them in. */
export const questsRoutes = new Hono<AppEnv>();

questsRoutes.get(GEO_API_PATHS.quests.root, auth, questsController.listQuests);
questsRoutes.put(GEO_API_PATHS.quests.track, auth, questsController.trackQuest);
questsRoutes.post(GEO_API_PATHS.quests.claim, auth, questsController.claimQuest);

import { Hono } from "hono";
import { GEO_API_PATHS } from "@geo/shared";
import type { AppEnv } from "../../app";
import { auth } from "../../http/auth";
import * as dungeonRunsController from "./dungeon-runs.controller";

/** Dungeon runs: the map of a started dungeon, walked room by room. Room fights use the Run routes. */
export const dungeonRunsRoutes = new Hono<AppEnv>();

const paths = GEO_API_PATHS.dungeonRuns;

// Before `one`: "active" isn't an id.
dungeonRunsRoutes.get(paths.active, auth, dungeonRunsController.getActive);
dungeonRunsRoutes.get(paths.one, auth, dungeonRunsController.getOne);
dungeonRunsRoutes.post(paths.move, auth, dungeonRunsController.move);
dungeonRunsRoutes.post(paths.puzzle, auth, dungeonRunsController.answerPuzzle);
dungeonRunsRoutes.post(paths.leave, auth, dungeonRunsController.leave);

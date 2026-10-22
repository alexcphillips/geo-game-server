import { Hono } from "hono";
import type { AppEnv } from "../../app";
import { opsOnly } from "../../http/ops";
import * as opsController from "./ops.controller";
import { GEO_OPS_PATHS } from "./ops.paths";

/** The operator's tools, behind GEO_OPS_SECRET. */
export const opsRoutes = new Hono<AppEnv>();

opsRoutes.post(GEO_OPS_PATHS.role, opsOnly, opsController.setRole);
opsRoutes.post(GEO_OPS_PATHS.wipe, opsOnly, opsController.wipe);
opsRoutes.post(GEO_OPS_PATHS.sql, opsOnly, opsController.runSql);
opsRoutes.post(GEO_OPS_PATHS.grant, opsOnly, opsController.grant);
opsRoutes.post(GEO_OPS_PATHS.coins, opsOnly, opsController.coins);
opsRoutes.post(GEO_OPS_PATHS.xp, opsOnly, opsController.xp);
opsRoutes.post(GEO_OPS_PATHS.questEvents, opsOnly, opsController.questEvents);
opsRoutes.post(GEO_OPS_PATHS.modifiers, opsOnly, opsController.modifiers);
opsRoutes.post(GEO_OPS_PATHS.farmWeeks, opsOnly, opsController.farmWeeks);
opsRoutes.post(GEO_OPS_PATHS.jobs, opsOnly, opsController.jobs);
opsRoutes.post(GEO_OPS_PATHS.spawnClock, opsOnly, opsController.spawnClock);

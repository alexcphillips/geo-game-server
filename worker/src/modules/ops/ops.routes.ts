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

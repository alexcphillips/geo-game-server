import { Router } from "express";
import { GEO_API_PATHS } from "@geo/shared";
import { asyncHandler } from "../../http/asyncHandler";
import { geoAuth } from "../../middleware/geo-auth";
import * as inboxController from "./geo-inbox.controller";

/** The player's inbox. Sending to it is the admin module's, and the mayor's. */
export const geoInboxRouter: Router = Router();

geoInboxRouter.get(GEO_API_PATHS.inbox.root, geoAuth, asyncHandler(inboxController.getInbox));
geoInboxRouter.post(GEO_API_PATHS.inbox.read, geoAuth, asyncHandler(inboxController.markRead));

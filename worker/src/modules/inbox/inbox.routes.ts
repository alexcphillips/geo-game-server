import { Hono } from "hono";
import { GEO_API_PATHS } from "@geo/shared";
import type { AppEnv } from "../../app";
import { auth } from "../../http/auth";
import * as inboxController from "./inbox.controller";

/** The player's inbox. Sending to it is the admin module's, and the mayor's. */
export const inboxRoutes = new Hono<AppEnv>();

inboxRoutes.get(GEO_API_PATHS.inbox.root, auth, inboxController.getInbox);
inboxRoutes.post(GEO_API_PATHS.inbox.read, auth, inboxController.markRead);

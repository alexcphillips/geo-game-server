import { Hono } from "hono";
import { GEO_API_PATHS } from "@geo/shared";
import type { AppEnv } from "../../app";
import { auth, requirePlayerId } from "../../http/auth";
import { rateLimit } from "../../http/rate-limit";
import * as friendsController from "./friends.controller";

/** Friends and requests, and the activity their status shows (online itself is the geo socket). */
export const friendsRoutes = new Hono<AppEnv>();

// Also stops guessing usernames one after another.
const requestLimit = rateLimit({
    windowMs: 60 * 60_000,
    max: 30,
    key: (c) => `friend-request:${requirePlayerId(c)}`,
    message: "That's a lot of friend requests. Try again in an hour.",
});

friendsRoutes.get(GEO_API_PATHS.friends.root, auth, friendsController.getFriends);
friendsRoutes.post(GEO_API_PATHS.friends.requests, auth, requestLimit, friendsController.sendRequest);
friendsRoutes.post(GEO_API_PATHS.friends.accept, auth, friendsController.acceptRequest);
friendsRoutes.delete(GEO_API_PATHS.friends.request, auth, friendsController.deleteRequest);
friendsRoutes.delete(GEO_API_PATHS.friends.friend, auth, friendsController.removeFriend);

friendsRoutes.post(GEO_API_PATHS.presence, auth, friendsController.report);

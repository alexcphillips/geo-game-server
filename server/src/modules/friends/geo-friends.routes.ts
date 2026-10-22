import { Router } from "express";
import { GEO_API_PATHS } from "@geo/shared";
import { asyncHandler } from "../../http/asyncHandler";
import { geoAuth } from "../../middleware/geo-auth";
import { rateLimit } from "../../middleware/rate-limit";
import * as friendsController from "./geo-friends.controller";

/** Friends and requests, and the activity their status shows (online itself is the geo socket). */
export const geoFriendsRouter: Router = Router();

// Also stops guessing usernames one after another.
const requestLimit = rateLimit({
    windowMs: 60 * 60_000,
    max: 30,
    key: (req) => `friend-request:${req.geoPlayerId}`,
    message: "That's a lot of friend requests. Try again in an hour.",
});

geoFriendsRouter.get(GEO_API_PATHS.friends.root, geoAuth, asyncHandler(friendsController.getFriends));
geoFriendsRouter.post(
    GEO_API_PATHS.friends.requests,
    geoAuth,
    requestLimit,
    asyncHandler(friendsController.sendRequest),
);
geoFriendsRouter.post(GEO_API_PATHS.friends.accept, geoAuth, asyncHandler(friendsController.acceptRequest));
geoFriendsRouter.delete(GEO_API_PATHS.friends.request, geoAuth, asyncHandler(friendsController.deleteRequest));
geoFriendsRouter.delete(GEO_API_PATHS.friends.friend, geoAuth, asyncHandler(friendsController.removeFriend));

geoFriendsRouter.post(GEO_API_PATHS.presence, geoAuth, asyncHandler(friendsController.report));

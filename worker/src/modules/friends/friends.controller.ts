import type { Context } from "hono";
import { GEO_ACTIVITIES, type GeoActivity, type GeoPresenceRequest, type GeoSendFriendRequest } from "@geo/shared";
import { AppError } from "../../../../game/src/http/AppError";
import type { AppEnv, World } from "../../app";
import { requirePlayerId } from "../../http/auth";
import { jsonBody } from "../../http/body";
import * as friendsRepository from "./friends.repository";

type Ctx = Context<AppEnv>;

/** A skill id: a short slug, never free text a friend would see. */
const SKILL = /^[a-z][a-z0-9-]{0,39}$/;

const isActivity = (activity: unknown): activity is GeoActivity => GEO_ACTIVITIES.includes(activity as GeoActivity);

export function getFriends(c: Ctx) {
    return c.json(friendsRepository.findFriends(c.var.world, requirePlayerId(c)), 200);
}

export async function sendRequest(c: Ctx) {
    const { username } = (await jsonBody(c)) as Partial<GeoSendFriendRequest>;
    const name = typeof username === "string" ? username.trim() : "";
    if (!name) throw AppError.badRequest("Enter a username");
    const playerId = requirePlayerId(c);
    const { world } = c.var;
    return c.json(world.db.transaction(() => friendsRepository.sendRequest(world, playerId, name)), 201);
}

/** Runs one change to a pair; `missing` if it found nothing to change. Replies with the lists. */
function changeAndList(c: Ctx, param: string, missing: string, change: (world: World, playerId: string, id: string) => boolean) {
    const playerId = requirePlayerId(c);
    const { world } = c.var;
    const id = c.req.param(param) ?? "";
    const body = world.db.transaction(() => {
        if (!change(world, playerId, id)) throw AppError.notFound(missing);
        return friendsRepository.findFriends(world, playerId);
    });
    return c.json(body, 200);
}

export const acceptRequest = (c: Ctx) => changeAndList(c, "requestId", "No such request", friendsRepository.acceptRequest);
export const deleteRequest = (c: Ctx) => changeAndList(c, "requestId", "No such request", friendsRepository.deleteRequest);
export const removeFriend = (c: Ctx) => changeAndList(c, "playerId", "Not friends", friendsRepository.deleteFriend);

/** What the player is doing now; the app sends it when it changes. Online itself comes from the geo socket. */
export async function report(c: Ctx) {
    const { activity, skill } = (await jsonBody(c)) as Partial<GeoPresenceRequest>;
    if (!isActivity(activity)) throw AppError.badRequest(`activity must be one of ${GEO_ACTIVITIES.join(", ")}`);
    if (activity === "skilling" && (typeof skill !== "string" || !SKILL.test(skill))) {
        throw AppError.badRequest("skilling needs a skill");
    }
    friendsRepository.reportActivity(c.var.world, requirePlayerId(c), activity, activity === "skilling" ? skill! : null);
    return c.body(null, 204);
}

import type { Context } from "hono";
import {
    GEO_FEEDBACK_STATUSES,
    GEO_MAIL_BODY_MAX,
    GEO_MAIL_TITLE_MAX,
    GEO_POSTABLE_ANNOUNCEMENT_KINDS,
    GEO_SUGGESTION_KINDS,
    isValidPoint,
    type GeoAdminAdjustSuggestionRequest,
    type GeoAdminAnnouncementRequest,
    type GeoAdminAnnouncementsResponse,
    type GeoAdminBanRequest,
    type GeoAdminCoinsRequest,
    type GeoAdminFeedbackReplyRequest,
    type GeoAdminFeedbackResponse,
    type GeoAdminFeedbackStatusRequest,
    type GeoAdminGrantItemRequest,
    type GeoAdminPlayerDetail,
    type GeoAdminReviewSuggestionRequest,
    type GeoAdminSeaCreatures,
    type GeoAdminSetRoleRequest,
    type GeoAdminSuggestionsResponse,
    type GeoFeedbackStatus,
    type GeoPostableAnnouncementKind,
    type GeoSuggestionKind,
    type GeoSuggestionStatus,
} from "@geo/shared";
import { CONTENT } from "../../../../server/src/content";
import { AppError } from "../../../../server/src/http/AppError";
import type { AppEnv } from "../../app";
import type { Db } from "../../db/db";
import { requirePlayerId } from "../../http/auth";
import { jsonBody } from "../../http/body";
import { REVOKE_ALL_FOR_PLAYER } from "../accounts/accounts.sql.ts";
import * as farmingRepository from "../farming/farming.repository";
import * as feedbackRepository from "../feedback/feedback.repository";
import * as inboxRepository from "../inbox/inbox.repository";
import * as marketRepository from "../market/market.repository";
import * as mayorRepository from "../mayor/mayor.repository";
import * as playerRepository from "../player/player.repository";
import * as suggestionsRepository from "../suggestions/suggestions.repository";
import * as adminRepository from "./admin.repository";

/**
 * Game-admin tools, from server/src/modules/admin/geo-admin.controller.ts.
 * Every route needs a geo admin, and every change is audited in its own
 * transaction.
 */

type Ctx = Context<AppEnv>;

/** Most coins one grant may move, so a typo can't flood the economy. */
const MAX_COIN_GRANT = 10_000_000;
/** Most of one item one grant may hand out. */
const MAX_ITEM_GRANT = 999;
/** Longest an announcement may stay up before it expires, if it expires at all. */
const MAX_EXPIRY_HOURS = 24 * 365;

const SUGGESTION_STATUSES: GeoSuggestionStatus[] = ["open", "accepted", "rejected"];
const isSuggestionStatus = (status: unknown): status is GeoSuggestionStatus => SUGGESTION_STATUSES.includes(status as GeoSuggestionStatus);
const isFeedbackStatus = (status: unknown): status is GeoFeedbackStatus => GEO_FEEDBACK_STATUSES.includes(status as GeoFeedbackStatus);

/** Runs `work` as the signed-in admin, in one transaction, and replies with what it returns. */
function asAdmin<T>(c: Ctx, work: (db: Db, adminId: string) => T, status: 200 | 201 = 200) {
    const adminId = requirePlayerId(c);
    const { db } = c.var.world;
    return c.json(db.transaction(() => work(db, adminId)), status);
}

/** The target player after a change, or not found. */
function playerAfter(db: Db, playerId: string) {
    const player = adminRepository.findPlayer(db, playerId);
    if (!player) throw AppError.notFound("Player not found");
    return player;
}

export function listPlayers(c: Ctx) {
    const search = c.req.query("search")?.trim() || null;
    return c.json(adminRepository.findPlayers(c.var.world.db, search), 200);
}

export function getPlayer(c: Ctx) {
    const { db } = c.var.world;
    const playerId = c.req.param("playerId") ?? "";
    const player = playerAfter(db, playerId);
    const body: GeoAdminPlayerDetail = {
        ...player,
        inventory: playerRepository.findInventory(db, playerId).map(playerRepository.toInventoryEntry),
        ledger: adminRepository.findLedger(db, playerId),
    };
    return c.json(body, 200);
}

export async function setRole(c: Ctx) {
    const { role } = (await jsonBody(c)) as Partial<GeoAdminSetRoleRequest>;
    if (role !== "player" && role !== "admin") throw AppError.badRequest("role must be player or admin");
    const playerId = c.req.param("playerId") ?? "";
    return asAdmin(c, (db, adminId) => {
        // Keeps there always being at least one admin who can undo things.
        if (playerId === adminId && role !== "admin") throw AppError.badRequest("You can't remove your own admin role");
        if (!adminRepository.setRole(db, playerId, role)) throw AppError.notFound("Player not found");
        adminRepository.audit(db, adminId, "set-role", playerId, { role });
        return playerAfter(db, playerId);
    });
}

export async function setBanned(c: Ctx) {
    const { banned } = (await jsonBody(c)) as Partial<GeoAdminBanRequest>;
    if (typeof banned !== "boolean") throw AppError.badRequest("banned must be true or false");
    const playerId = c.req.param("playerId") ?? "";
    return asAdmin(c, (db, adminId) => {
        if (playerId === adminId) throw AppError.badRequest("You can't ban yourself");
        if (!adminRepository.setBanned(db, playerId, banned)) throw AppError.notFound("Player not found");
        // The auth check reads the ban on every request; ending sessions stops refreshes too.
        if (banned) db.run(REVOKE_ALL_FOR_PLAYER, Date.now(), playerId);
        adminRepository.audit(db, adminId, banned ? "ban" : "unban", playerId);
        return playerAfter(db, playerId);
    });
}

/** Gives coins, or takes them with a negative amount (never below 0). */
export async function grantCoins(c: Ctx) {
    const { amount, note } = (await jsonBody(c)) as Partial<GeoAdminCoinsRequest>;
    if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount === 0) throw AppError.badRequest("amount must be a whole number, not 0");
    if (Math.abs(amount) > MAX_COIN_GRANT) throw AppError.badRequest(`At most ${MAX_COIN_GRANT.toLocaleString()} at once`);
    const cleanNote = typeof note === "string" ? note.trim().slice(0, 200) : "";
    const playerId = c.req.param("playerId") ?? "";
    return asAdmin(c, (db, adminId) => {
        playerAfter(db, playerId);
        const reference = `admin:${adminId}`;
        if (amount > 0) playerRepository.addCoins(db, playerId, amount, "admin-grant", reference);
        else playerRepository.spendCoins(db, playerId, -amount, "admin-grant", reference);
        adminRepository.audit(db, adminId, "grant-coins", playerId, { amount, note: cleanNote || null });
        return playerAfter(db, playerId);
    });
}

export async function grantItem(c: Ctx) {
    const { itemId, quantity } = (await jsonBody(c)) as Partial<GeoAdminGrantItemRequest>;
    if (typeof itemId !== "string" || !CONTENT.items[itemId]) throw AppError.badRequest("Unknown item");
    if (typeof quantity !== "number" || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > MAX_ITEM_GRANT) {
        throw AppError.badRequest(`quantity must be 1–${MAX_ITEM_GRANT}`);
    }
    const playerId = c.req.param("playerId") ?? "";
    return asAdmin(c, (db, adminId) => {
        playerAfter(db, playerId);
        playerRepository.grantItems(db, playerId, [{ itemId, quantity }]);
        adminRepository.audit(db, adminId, "grant-item", playerId, { itemId, quantity });
        return playerAfter(db, playerId);
    });
}

export const getAudit = (c: Ctx) => c.json(adminRepository.findAudit(c.var.world.db), 200);

export const getEconomy = (c: Ctx) => c.json(adminRepository.findEconomy(c.var.world.db), 200);

/** Ends the running election now: its winner takes office and the next opens. */
export function endElection(c: Ctx) {
    const { world } = c.var;
    return asAdmin(c, (db, adminId) => {
        mayorRepository.endElectionNow(world);
        adminRepository.audit(db, adminId, "end-election", null);
        return mayorRepository.findMayor(world, adminId);
    });
}

/** Moves the running election's end, e.g. to test a close in two minutes. */
export async function setElectionEnd(c: Ctx) {
    const { endsAt } = (await jsonBody(c)) as { endsAt?: unknown };
    const when = typeof endsAt === "string" ? Date.parse(endsAt) : NaN;
    if (Number.isNaN(when) || when <= Date.now()) throw AppError.badRequest("endsAt must be a time in the future");
    const { world } = c.var;
    return asAdmin(c, (db, adminId) => {
        const electionId = mayorRepository.setElectionEnd(world, when);
        adminRepository.audit(db, adminId, "set-election-end", electionId, { endsAt: new Date(when).toISOString() });
        return mayorRepository.findMayor(world, adminId);
    });
}

/** The calling admin's "every bite is a sea creature" switch. */
export function getSeaCreatures(c: Ctx) {
    const always = adminRepository.findAlwaysSeaCreatures(c.var.world.db, requirePlayerId(c));
    return c.json({ always } satisfies GeoAdminSeaCreatures, 200);
}

/** Turns it on or off for the calling admin only, e.g. to test sea-creature fights. */
export async function setSeaCreatures(c: Ctx) {
    const { always } = (await jsonBody(c)) as Partial<GeoAdminSeaCreatures>;
    if (typeof always !== "boolean") throw AppError.badRequest("always must be true or false");
    return asAdmin(c, (db, adminId) => {
        adminRepository.setAlwaysSeaCreatures(db, adminId, always);
        adminRepository.audit(db, adminId, "set-always-sea-creatures", adminId, { always });
        return { always } satisfies GeoAdminSeaCreatures;
    });
}

/** Playtesting: the calling admin's own farm takes its next cycle now. */
export function farmNextCycle(c: Ctx) {
    return asAdmin(c, (db, adminId) => {
        const view = farmingRepository.adminNextCycle(db, adminId);
        adminRepository.audit(db, adminId, "farm-next-cycle", adminId, { turn: view.turn });
        return view;
    });
}

/** Takes a listing down, bids or not; everything goes back to whoever it belongs to. */
export function removeListing(c: Ctx) {
    const listingId = c.req.param("listingId") ?? "";
    const adminId = requirePlayerId(c);
    const { world } = c.var;
    world.db.transaction(() => {
        const row = marketRepository.removeListing(world, listingId);
        adminRepository.audit(world.db, adminId, "remove-listing", listingId, { seller: row.seller_id, itemId: row.item_id });
    });
    return c.body(null, 204);
}

/** Location suggestions, newest first; `?status=` narrows to one status. */
export function listSuggestions(c: Ctx) {
    const status = c.req.query("status");
    if (status !== undefined && !isSuggestionStatus(status)) throw AppError.badRequest("status must be open, accepted or rejected");
    const { db } = c.var.world;
    const body: GeoAdminSuggestionsResponse = {
        suggestions: suggestionsRepository.findSuggestions(db, status ?? null),
        counts: suggestionsRepository.countSuggestions(db),
    };
    return c.json(body, 200);
}

/**
 * Reject or reopen a suggestion. Accepting one means placing it, so it's
 * done only by making its place (POST /geo/admin/places with suggestionId).
 */
export async function reviewSuggestion(c: Ctx) {
    const { status, reviewNote } = (await jsonBody(c)) as Partial<GeoAdminReviewSuggestionRequest>;
    if (!isSuggestionStatus(status)) throw AppError.badRequest("status must be open, accepted or rejected");
    if (status === "accepted") throw AppError.badRequest("Accept a suggestion by creating its place");
    const cleanNote = typeof reviewNote === "string" && reviewNote.trim() ? reviewNote.trim().slice(0, 280) : null;
    const suggestionId = c.req.param("suggestionId") ?? "";
    return asAdmin(c, (db, adminId) => {
        if (!suggestionsRepository.reviewSuggestion(db, suggestionId, status, cleanNote, adminId)) throw AppError.notFound("Suggestion not found");
        adminRepository.audit(db, adminId, "review-suggestion", suggestionId, { status, note: cleanNote });
        return suggestionsRepository.findSuggestion(db, suggestionId);
    });
}

/**
 * Corrects a suggestion: a pin a little off, or the wrong kind. The player's
 * first pin is kept, and the audit has the before and after.
 */
export async function adjustSuggestion(c: Ctx) {
    const { kind, latitude, longitude } = (await jsonBody(c)) as Partial<Record<keyof GeoAdminAdjustSuggestionRequest, unknown>>;
    if (kind !== undefined && !GEO_SUGGESTION_KINDS.includes(kind as GeoSuggestionKind)) {
        throw AppError.badRequest(`kind must be one of ${GEO_SUGGESTION_KINDS.join(", ")}`);
    }
    let point: { latitude: number; longitude: number } | null = null;
    if (latitude !== undefined || longitude !== undefined) {
        const candidate = { latitude, longitude };
        if (!isValidPoint(candidate)) throw AppError.badRequest("Moving needs a valid latitude and longitude together");
        point = candidate;
    }
    if (kind === undefined && !point) throw AppError.badRequest("Nothing to change");
    const suggestionId = c.req.param("suggestionId") ?? "";
    return asAdmin(c, (db, adminId) => {
        const before = suggestionsRepository.findSuggestion(db, suggestionId);
        if (!before) throw AppError.notFound("Suggestion not found");
        suggestionsRepository.adjustSuggestion(db, suggestionId, (kind as GeoSuggestionKind | undefined) ?? null, point);
        adminRepository.audit(db, adminId, "adjust-suggestion", suggestionId, {
            from: { kind: before.kind, latitude: before.latitude, longitude: before.longitude },
            to: { kind: kind ?? before.kind, ...(point ?? { latitude: before.latitude, longitude: before.longitude }) },
        });
        return suggestionsRepository.findSuggestion(db, suggestionId);
    });
}

/** Players' feedback, newest first; `?status=` narrows to one status. */
export function listFeedback(c: Ctx) {
    const status = c.req.query("status");
    if (status !== undefined && !isFeedbackStatus(status)) throw AppError.badRequest(`status must be one of ${GEO_FEEDBACK_STATUSES.join(", ")}`);
    const { db } = c.var.world;
    const body: GeoAdminFeedbackResponse = { feedback: feedbackRepository.findFeedback(db, status ?? null), counts: feedbackRepository.countFeedback(db) };
    return c.json(body, 200);
}

export async function setFeedbackStatus(c: Ctx) {
    const { status } = (await jsonBody(c)) as Partial<GeoAdminFeedbackStatusRequest>;
    if (!isFeedbackStatus(status)) throw AppError.badRequest(`status must be one of ${GEO_FEEDBACK_STATUSES.join(", ")}`);
    const id = c.req.param("feedbackId") ?? "";
    return asAdmin(c, (db, adminId) => {
        if (!feedbackRepository.setStatus(db, id, status, adminId)) throw AppError.notFound("Feedback not found");
        adminRepository.audit(db, adminId, "feedback-status", id, { status });
        return feedbackRepository.findOneFeedback(db, id);
    });
}

/** A reply goes to the player's inbox, titled after their feedback. */
export async function replyToFeedback(c: Ctx) {
    const { body } = (await jsonBody(c)) as Partial<GeoAdminFeedbackReplyRequest>;
    const cleanBody = typeof body === "string" ? body.trim() : "";
    if (!cleanBody) throw AppError.badRequest("Write a reply");
    if (cleanBody.length > GEO_MAIL_BODY_MAX) throw AppError.badRequest(`At most ${GEO_MAIL_BODY_MAX} characters`);
    const id = c.req.param("feedbackId") ?? "";
    const { world } = c.var;
    return asAdmin(c, (db, adminId) => {
        feedbackRepository.reply(world, id, cleanBody, adminId);
        adminRepository.audit(db, adminId, "feedback-reply", id);
        return feedbackRepository.findOneFeedback(db, id);
    });
}

export function listAnnouncements(c: Ctx) {
    const body: GeoAdminAnnouncementsResponse = { announcements: inboxRepository.findAllAnnouncements(c.var.world.db) };
    return c.json(body, 200);
}

/** Sends an announcement to every player's inbox. */
export async function postAnnouncement(c: Ctx) {
    const { kind, title, body, version, expiresInHours } = (await jsonBody(c)) as Partial<Record<keyof GeoAdminAnnouncementRequest, unknown>>;
    if (!GEO_POSTABLE_ANNOUNCEMENT_KINDS.includes(kind as GeoPostableAnnouncementKind)) {
        throw AppError.badRequest(`kind must be one of ${GEO_POSTABLE_ANNOUNCEMENT_KINDS.join(", ")}`);
    }
    const cleanTitle = typeof title === "string" ? title.trim() : "";
    if (!cleanTitle) throw AppError.badRequest("Give it a title");
    if (cleanTitle.length > GEO_MAIL_TITLE_MAX) throw AppError.badRequest(`The title can be at most ${GEO_MAIL_TITLE_MAX} characters`);
    const cleanBody = typeof body === "string" ? body.trim() : "";
    if (cleanBody.length > GEO_MAIL_BODY_MAX) throw AppError.badRequest(`At most ${GEO_MAIL_BODY_MAX} characters`);
    const cleanVersion = typeof version === "string" && version.trim() ? version.trim() : null;
    if (kind === "changelog" && (!cleanVersion || !/^\d+(\.\d+){0,2}$/.test(cleanVersion))) {
        throw AppError.badRequest("A changelog needs the app version it's for, e.g. 1.2.0");
    }
    let expiresAt: Date | null = null;
    if (expiresInHours !== undefined && expiresInHours !== null) {
        if (typeof expiresInHours !== "number" || !(expiresInHours > 0) || expiresInHours > MAX_EXPIRY_HOURS) {
            throw AppError.badRequest(`expiresInHours must be between 0 and ${MAX_EXPIRY_HOURS}`);
        }
        expiresAt = new Date(Math.round(Date.now() + expiresInHours * 3_600_000));
    }
    const { world } = c.var;
    return asAdmin(
        c,
        (db, adminId): GeoAdminAnnouncementsResponse => {
            const id = inboxRepository.insertAnnouncement(world, {
                kind: kind as GeoPostableAnnouncementKind,
                title: cleanTitle,
                body: cleanBody,
                version: kind === "changelog" ? cleanVersion : null,
                postedBy: adminId,
                expiresAt,
            });
            adminRepository.audit(db, adminId, "post-announcement", id, { kind, title: cleanTitle });
            return { announcements: inboxRepository.findAllAnnouncements(db) };
        },
        201,
    );
}

/** Takes an announcement out of every inbox, for good. */
export function deleteAnnouncement(c: Ctx) {
    const id = c.req.param("announcementId") ?? "";
    const { world } = c.var;
    return asAdmin(c, (db, adminId): GeoAdminAnnouncementsResponse => {
        const deleted = inboxRepository.deleteAnnouncement(world, id);
        if (!deleted) throw AppError.notFound("Announcement not found");
        adminRepository.audit(db, adminId, "delete-announcement", id, deleted);
        return { announcements: inboxRepository.findAllAnnouncements(db) };
    });
}

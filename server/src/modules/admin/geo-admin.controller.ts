import type { Request, Response } from "express";
import type {
    GeoAdminAnnouncementRequest,
    GeoAdminAnnouncementsResponse,
    GeoAdminFeedbackReplyRequest,
    GeoAdminFeedbackResponse,
    GeoAdminFeedbackStatusRequest,
    GeoAdminEconomy,
    GeoFeedbackStatus,
    GeoPostableAnnouncementKind,
    GeoAdminBanRequest,
    GeoAdminCoinsRequest,
    GeoAdminGrantItemRequest,
    GeoAdminPlayerDetail,
    GeoAdminAdjustSuggestionRequest,
    GeoAdminReviewSuggestionRequest,
    GeoAdminSeaCreatures,
    GeoAdminSetRoleRequest,
    GeoAdminSuggestionsResponse,
    GeoSuggestionKind,
    GeoSuggestionStatus,
} from "@geo/shared";
import {
    GEO_FEEDBACK_STATUSES,
    GEO_MAIL_BODY_MAX,
    GEO_MAIL_TITLE_MAX,
    GEO_POSTABLE_ANNOUNCEMENT_KINDS,
    GEO_SUGGESTION_KINDS,
    isValidPoint,
} from "@geo/shared";
import { AppError } from "../../http/AppError";
import { CONTENT } from "../../content";
import { withTransaction } from "../../db/transaction";
import { requirePlayerId } from "../../middleware/geo-auth";
import { isUuid } from "../../lib/validate";
import { revokeAllSessions } from "../accounts/geo-accounts.repository";
import * as farmingRepository from "../farming/geo-farming.repository";
import * as feedbackRepository from "../feedback/geo-feedback.repository";
import * as inboxRepository from "../inbox/geo-inbox.repository";
import * as marketRepository from "../market/geo-market.repository";
import * as mayorRepository from "../mayor/geo-mayor.repository";
import * as playerRepository from "../player/geo-player.repository";
import * as suggestionsRepository from "../suggestions/geo-suggestions.repository";
import * as adminRepository from "./geo-admin.repository";
import { LEDGER_LAST_DAY, LEDGER_MISMATCHES, LOCK_PLAYER_COINS, SUM_PURSES } from "./geo-admin.sql";
import { SUM_HELD_ALL, SUM_UNCOLLECTED_ALL } from "../market/geo-market.sql";
import { query } from "../../db";

/** Most coins one grant may move, so a typo can't flood the economy. */
const MAX_COIN_GRANT = 10_000_000;
/** Most of one item one grant may hand out. */
const MAX_ITEM_GRANT = 999;

function targetId(req: Request): string {
    const id = String(req.params.playerId ?? "");
    if (!isUuid(id)) throw AppError.badRequest("Bad player id");
    return id;
}

export async function listPlayers(req: Request, res: Response) {
    const search = typeof req.query.search === "string" && req.query.search.trim() ? req.query.search.trim() : null;
    res.status(200).json(await adminRepository.findPlayers(search));
}

export async function getPlayer(req: Request, res: Response) {
    const playerId = targetId(req);
    const player = await adminRepository.findPlayer(playerId);
    if (!player) throw AppError.notFound("Player not found");
    const [inventory, ledger] = await Promise.all([
        playerRepository.findInventory(playerId),
        adminRepository.findLedger(playerId),
    ]);
    const body: GeoAdminPlayerDetail = { ...player, inventory: inventory.map(playerRepository.toInventoryEntry), ledger };
    res.status(200).json(body);
}

export async function setRole(req: Request, res: Response) {
    const adminId = requirePlayerId(req);
    const playerId = targetId(req);
    const { role } = (req.body ?? {}) as Partial<GeoAdminSetRoleRequest>;
    if (role !== "player" && role !== "admin") throw AppError.badRequest("role must be player or admin");
    // Keeps there always being at least one admin who can undo things.
    if (playerId === adminId && role !== "admin") throw AppError.badRequest("You can't remove your own admin role");

    await withTransaction(async (tx) => {
        if (!(await adminRepository.setRole(tx, playerId, role))) throw AppError.notFound("Player not found");
        await adminRepository.audit(tx, adminId, "set-role", playerId, { role });
    });
    res.status(200).json(await adminRepository.findPlayer(playerId));
}

export async function setBanned(req: Request, res: Response) {
    const adminId = requirePlayerId(req);
    const playerId = targetId(req);
    const { banned } = (req.body ?? {}) as Partial<GeoAdminBanRequest>;
    if (typeof banned !== "boolean") throw AppError.badRequest("banned must be true or false");
    if (playerId === adminId) throw AppError.badRequest("You can't ban yourself");

    await withTransaction(async (tx) => {
        if (!(await adminRepository.setBanned(tx, playerId, banned))) throw AppError.notFound("Player not found");
        if (banned) await revokeAllSessions(tx, playerId);
        await adminRepository.audit(tx, adminId, banned ? "ban" : "unban", playerId);
    });
    res.status(200).json(await adminRepository.findPlayer(playerId));
}

/** Gives coins, or takes them with a negative amount (never below 0). */
export async function grantCoins(req: Request, res: Response) {
    const adminId = requirePlayerId(req);
    const playerId = targetId(req);
    const { amount, note } = (req.body ?? {}) as Partial<GeoAdminCoinsRequest>;
    if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount === 0) {
        throw AppError.badRequest("amount must be a whole number, not 0");
    }
    if (Math.abs(amount) > MAX_COIN_GRANT) throw AppError.badRequest(`At most ${MAX_COIN_GRANT.toLocaleString()} at once`);
    const cleanNote = typeof note === "string" ? note.trim().slice(0, 200) : "";

    await withTransaction(async (tx) => {
        const [locked] = await tx<{ coins: string }>(LOCK_PLAYER_COINS, [playerId]);
        if (!locked) throw AppError.notFound("Player not found");
        const reference = `admin:${adminId}`;
        if (amount > 0) await playerRepository.addCoins(tx, playerId, amount, "admin-grant", reference);
        else await playerRepository.spendCoins(tx, playerId, -amount, "admin-grant", reference);
        await adminRepository.audit(tx, adminId, "grant-coins", playerId, { amount, note: cleanNote || null });
    });
    res.status(200).json(await adminRepository.findPlayer(playerId));
}

export async function grantItem(req: Request, res: Response) {
    const adminId = requirePlayerId(req);
    const playerId = targetId(req);
    const { itemId, quantity } = (req.body ?? {}) as Partial<GeoAdminGrantItemRequest>;
    if (typeof itemId !== "string" || !CONTENT.items[itemId]) throw AppError.badRequest("Unknown item");
    if (typeof quantity !== "number" || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > MAX_ITEM_GRANT) {
        throw AppError.badRequest(`quantity must be 1–${MAX_ITEM_GRANT}`);
    }

    await withTransaction(async (tx) => {
        if (!(await adminRepository.findPlayer(playerId, tx))) throw AppError.notFound("Player not found");
        await playerRepository.grantItems(tx, playerId, [{ itemId, quantity }]);
        await adminRepository.audit(tx, adminId, "grant-item", playerId, { itemId, quantity });
    });
    res.status(200).json(await adminRepository.findPlayer(playerId));
}

export async function getAudit(_req: Request, res: Response) {
    res.status(200).json(await adminRepository.findAudit());
}

export async function getEconomy(_req: Request, res: Response) {
    const [[purses], [held], [uncollected], lastDay, mismatches] = await Promise.all([
        query<{ total: string }>(SUM_PURSES),
        query<{ total: string }>(SUM_HELD_ALL),
        query<{ total: string }>(SUM_UNCOLLECTED_ALL),
        query<{ reason: string; delta: string; count: string }>(LEDGER_LAST_DAY),
        query<{ id: string; display_name: string; coins: string; ledger: string }>(LEDGER_MISMATCHES),
    ]);
    const body: GeoAdminEconomy = {
        coinsInPurses: Number(purses?.total ?? 0),
        coinsInBids: Number(held?.total ?? 0),
        coinsUncollected: Number(uncollected?.total ?? 0),
        lastDay: lastDay.map((row) => ({ reason: row.reason, delta: Number(row.delta), count: Number(row.count) })),
        ledgerMismatches: mismatches.map((row) => ({
            playerId: row.id,
            displayName: row.display_name,
            coins: Number(row.coins),
            ledger: Number(row.ledger),
        })),
    };
    res.status(200).json(body);
}

/** Ends the running election now: its winner takes office and the next opens. */
export async function endElection(req: Request, res: Response) {
    const adminId = requirePlayerId(req);
    await mayorRepository.endElectionNow();
    await withTransaction((tx) => adminRepository.audit(tx, adminId, "end-election", null));
    res.status(200).json(await mayorRepository.findMayor(adminId));
}

/** Moves the running election's end, e.g. to test a close in two minutes. */
export async function setElectionEnd(req: Request, res: Response) {
    const adminId = requirePlayerId(req);
    const { endsAt } = (req.body ?? {}) as { endsAt?: unknown };
    const when = typeof endsAt === "string" ? new Date(endsAt) : null;
    if (!when || Number.isNaN(when.getTime()) || when.getTime() <= Date.now()) {
        throw AppError.badRequest("endsAt must be a time in the future");
    }
    const electionId = await mayorRepository.setElectionEnd(when);
    await withTransaction((tx) => adminRepository.audit(tx, adminId, "set-election-end", electionId, { endsAt: when.toISOString() }));
    res.status(200).json(await mayorRepository.findMayor(adminId));
}

/** The calling admin's "every bite is a sea creature" switch. */
export async function getSeaCreatures(req: Request, res: Response) {
    const always = await adminRepository.findAlwaysSeaCreatures(requirePlayerId(req));
    res.status(200).json({ always } satisfies GeoAdminSeaCreatures);
}

/** Turns it on or off for the calling admin only, e.g. to test sea-creature fights. */
export async function setSeaCreatures(req: Request, res: Response) {
    const adminId = requirePlayerId(req);
    const { always } = (req.body ?? {}) as Partial<GeoAdminSeaCreatures>;
    if (typeof always !== "boolean") throw AppError.badRequest("always must be true or false");
    await withTransaction(async (tx) => {
        await adminRepository.setAlwaysSeaCreatures(tx, adminId, always);
        await adminRepository.audit(tx, adminId, "set-always-sea-creatures", adminId, { always });
    });
    res.status(200).json({ always } satisfies GeoAdminSeaCreatures);
}

/** Playtesting: the calling admin's own farm takes its next cycle now. */
export async function farmNextCycle(req: Request, res: Response) {
    res.status(200).json(await farmingRepository.adminNextCycle(requirePlayerId(req)));
}

/** Takes a listing down, bids or not; everything goes back to whoever it belongs to. */
export async function removeListing(req: Request, res: Response) {
    const adminId = requirePlayerId(req);
    const listingId = String(req.params.listingId ?? "");
    if (!isUuid(listingId)) throw AppError.notFound("That listing is gone");
    await withTransaction(async (tx) => {
        const row = await marketRepository.removeListing(tx, listingId);
        await adminRepository.audit(tx, adminId, "remove-listing", listingId, {
            seller: row.seller_id,
            itemId: row.item_id,
        });
    });
    res.status(204).end();
}

const SUGGESTION_STATUSES: GeoSuggestionStatus[] = ["open", "accepted", "rejected"];

function isSuggestionStatus(status: unknown): status is GeoSuggestionStatus {
    return SUGGESTION_STATUSES.includes(status as GeoSuggestionStatus);
}

/** Location suggestions, newest first; `?status=` narrows to one status. */
export async function listSuggestions(req: Request, res: Response) {
    const status = req.query.status;
    if (status !== undefined && !isSuggestionStatus(status)) {
        throw AppError.badRequest("status must be open, accepted or rejected");
    }
    const [suggestions, counts] = await Promise.all([
        suggestionsRepository.findSuggestions(status ?? null),
        suggestionsRepository.countSuggestions(),
    ]);
    const body: GeoAdminSuggestionsResponse = { suggestions, counts };
    res.status(200).json(body);
}

/**
 * Reject or reopen a suggestion. Accepting one means placing it, so it's
 * done only by making its place (POST /geo/admin/places with suggestionId).
 */
export async function reviewSuggestion(req: Request, res: Response) {
    const adminId = requirePlayerId(req);
    const suggestionId = String(req.params.suggestionId ?? "");
    if (!isUuid(suggestionId)) throw AppError.badRequest("Bad suggestion id");
    const { status, reviewNote } = (req.body ?? {}) as Partial<GeoAdminReviewSuggestionRequest>;
    if (!isSuggestionStatus(status)) throw AppError.badRequest("status must be open, accepted or rejected");
    if (status === "accepted") throw AppError.badRequest("Accept a suggestion by creating its place");
    const cleanNote = typeof reviewNote === "string" && reviewNote.trim() ? reviewNote.trim().slice(0, 280) : null;

    await withTransaction(async (tx) => {
        if (!(await suggestionsRepository.reviewSuggestion(tx, suggestionId, status, cleanNote, adminId))) {
            throw AppError.notFound("Suggestion not found");
        }
        await adminRepository.audit(tx, adminId, "review-suggestion", suggestionId, { status, note: cleanNote });
    });
    res.status(200).json(await suggestionsRepository.findSuggestion(suggestionId));
}

/**
 * Corrects a suggestion: a pin a little off, or the wrong kind. The player's
 * first pin is kept, and the audit has the before and after.
 */
export async function adjustSuggestion(req: Request, res: Response) {
    const adminId = requirePlayerId(req);
    const suggestionId = String(req.params.suggestionId ?? "");
    if (!isUuid(suggestionId)) throw AppError.badRequest("Bad suggestion id");
    const { kind, latitude, longitude } = (req.body ?? {}) as Partial<Record<keyof GeoAdminAdjustSuggestionRequest, unknown>>;
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

    const before = await suggestionsRepository.findSuggestion(suggestionId);
    if (!before) throw AppError.notFound("Suggestion not found");
    await withTransaction(async (tx) => {
        if (!(await suggestionsRepository.adjustSuggestion(tx, suggestionId, (kind as GeoSuggestionKind | undefined) ?? null, point))) {
            throw AppError.notFound("Suggestion not found");
        }
        await adminRepository.audit(tx, adminId, "adjust-suggestion", suggestionId, {
            from: { kind: before.kind, latitude: before.latitude, longitude: before.longitude },
            to: { kind: kind ?? before.kind, ...(point ?? { latitude: before.latitude, longitude: before.longitude }) },
        });
    });
    res.status(200).json(await suggestionsRepository.findSuggestion(suggestionId));
}

function isFeedbackStatus(status: unknown): status is GeoFeedbackStatus {
    return GEO_FEEDBACK_STATUSES.includes(status as GeoFeedbackStatus);
}

function feedbackId(req: Request): string {
    const id = String(req.params.feedbackId ?? "");
    if (!isUuid(id)) throw AppError.notFound("Feedback not found");
    return id;
}

/** Players' feedback, newest first; `?status=` narrows to one status. */
export async function listFeedback(req: Request, res: Response) {
    const status = req.query.status;
    if (status !== undefined && !isFeedbackStatus(status)) {
        throw AppError.badRequest(`status must be one of ${GEO_FEEDBACK_STATUSES.join(", ")}`);
    }
    const [feedback, counts] = await Promise.all([
        feedbackRepository.findFeedback(status ?? null),
        feedbackRepository.countFeedback(),
    ]);
    const body: GeoAdminFeedbackResponse = { feedback, counts };
    res.status(200).json(body);
}

export async function setFeedbackStatus(req: Request, res: Response) {
    const adminId = requirePlayerId(req);
    const id = feedbackId(req);
    const { status } = (req.body ?? {}) as Partial<GeoAdminFeedbackStatusRequest>;
    if (!isFeedbackStatus(status)) throw AppError.badRequest(`status must be one of ${GEO_FEEDBACK_STATUSES.join(", ")}`);

    await withTransaction(async (tx) => {
        if (!(await feedbackRepository.setStatus(tx, id, status, adminId))) throw AppError.notFound("Feedback not found");
        await adminRepository.audit(tx, adminId, "feedback-status", id, { status });
    });
    res.status(200).json(await feedbackRepository.findOneFeedback(id));
}

/** A reply goes to the player's inbox, titled after their feedback. */
export async function replyToFeedback(req: Request, res: Response) {
    const adminId = requirePlayerId(req);
    const id = feedbackId(req);
    const { body } = (req.body ?? {}) as Partial<GeoAdminFeedbackReplyRequest>;
    const cleanBody = typeof body === "string" ? body.trim() : "";
    if (!cleanBody) throw AppError.badRequest("Write a reply");
    if (cleanBody.length > GEO_MAIL_BODY_MAX) throw AppError.badRequest(`At most ${GEO_MAIL_BODY_MAX} characters`);

    await withTransaction(async (tx) => {
        await feedbackRepository.reply(tx, id, cleanBody, adminId);
        await adminRepository.audit(tx, adminId, "feedback-reply", id);
    });
    res.status(200).json(await feedbackRepository.findOneFeedback(id));
}

export async function listAnnouncements(_req: Request, res: Response) {
    const body: GeoAdminAnnouncementsResponse = { announcements: await inboxRepository.findAllAnnouncements() };
    res.status(200).json(body);
}

/** Longest an announcement may stay up before it expires, if it expires at all. */
const MAX_EXPIRY_HOURS = 24 * 365;

/** Sends an announcement to every player's inbox. */
export async function postAnnouncement(req: Request, res: Response) {
    const adminId = requirePlayerId(req);
    const { kind, title, body, version, expiresInHours } = (req.body ?? {}) as Partial<
        Record<keyof GeoAdminAnnouncementRequest, unknown>
    >;
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
        expiresAt = new Date(Date.now() + expiresInHours * 3_600_000);
    }

    await withTransaction(async (tx) => {
        const id = await inboxRepository.insertAnnouncement(tx, {
            kind: kind as GeoPostableAnnouncementKind,
            title: cleanTitle,
            body: cleanBody,
            version: kind === "changelog" ? cleanVersion : null,
            postedBy: adminId,
            expiresAt,
        });
        await adminRepository.audit(tx, adminId, "post-announcement", id, { kind, title: cleanTitle });
    });
    const response: GeoAdminAnnouncementsResponse = { announcements: await inboxRepository.findAllAnnouncements() };
    res.status(201).json(response);
}

/** Takes an announcement out of every inbox, for good. */
export async function deleteAnnouncement(req: Request, res: Response) {
    const adminId = requirePlayerId(req);
    const id = String(req.params.announcementId ?? "");
    if (!isUuid(id)) throw AppError.notFound("Announcement not found");
    await withTransaction(async (tx) => {
        const deleted = await inboxRepository.deleteAnnouncement(tx, id);
        if (!deleted) throw AppError.notFound("Announcement not found");
        await adminRepository.audit(tx, adminId, "delete-announcement", id, deleted);
    });
    const response: GeoAdminAnnouncementsResponse = { announcements: await inboxRepository.findAllAnnouncements() };
    res.status(200).json(response);
}

import { Router } from "express";
import { GEO_API_PATHS } from "@geo/shared";
import { asyncHandler } from "../../http/asyncHandler";
import { geoAdmin, geoAuth } from "../../middleware/geo-auth";
import * as adminController from "./geo-admin.controller";

/**
 * Game-admin tools. Every route needs a geo admin, and
 * every change is audited.
 */
export const geoAdminRouter: Router = Router();

const guard = [geoAuth, geoAdmin];
const paths = GEO_API_PATHS.admin;

geoAdminRouter.get(paths.players, guard, asyncHandler(adminController.listPlayers));
geoAdminRouter.get(paths.player, guard, asyncHandler(adminController.getPlayer));
geoAdminRouter.put(paths.playerRole, guard, asyncHandler(adminController.setRole));
geoAdminRouter.post(paths.playerBan, guard, asyncHandler(adminController.setBanned));
geoAdminRouter.post(paths.playerCoins, guard, asyncHandler(adminController.grantCoins));
geoAdminRouter.post(paths.playerItems, guard, asyncHandler(adminController.grantItem));
geoAdminRouter.get(paths.audit, guard, asyncHandler(adminController.getAudit));
geoAdminRouter.get(paths.economy, guard, asyncHandler(adminController.getEconomy));
geoAdminRouter.post(paths.endElection, guard, asyncHandler(adminController.endElection));
geoAdminRouter.put(paths.electionEndsAt, guard, asyncHandler(adminController.setElectionEnd));
geoAdminRouter.get(paths.seaCreatures, guard, asyncHandler(adminController.getSeaCreatures));
geoAdminRouter.put(paths.seaCreatures, guard, asyncHandler(adminController.setSeaCreatures));
geoAdminRouter.post(paths.farmNextCycle, guard, asyncHandler(adminController.farmNextCycle));
geoAdminRouter.post(paths.removeListing, guard, asyncHandler(adminController.removeListing));
geoAdminRouter.get(paths.suggestions, guard, asyncHandler(adminController.listSuggestions));
geoAdminRouter.put(paths.suggestion, guard, asyncHandler(adminController.reviewSuggestion));
geoAdminRouter.patch(paths.suggestion, guard, asyncHandler(adminController.adjustSuggestion));
geoAdminRouter.get(paths.feedback, guard, asyncHandler(adminController.listFeedback));
geoAdminRouter.patch(paths.feedbackItem, guard, asyncHandler(adminController.setFeedbackStatus));
geoAdminRouter.post(paths.feedbackReplies, guard, asyncHandler(adminController.replyToFeedback));
geoAdminRouter.get(paths.announcements, guard, asyncHandler(adminController.listAnnouncements));
geoAdminRouter.post(paths.announcements, guard, asyncHandler(adminController.postAnnouncement));
geoAdminRouter.delete(paths.announcement, guard, asyncHandler(adminController.deleteAnnouncement));

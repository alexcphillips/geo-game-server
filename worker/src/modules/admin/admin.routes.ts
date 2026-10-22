import { Hono } from "hono";
import { GEO_API_PATHS } from "@geo/shared";
import type { AppEnv } from "../../app";
import { adminOnly, auth } from "../../http/auth";
import * as adminController from "./admin.controller";

/** Game-admin tools. Every route needs a geo admin, and every change is audited. */
export const adminRoutes = new Hono<AppEnv>();

const paths = GEO_API_PATHS.admin;
const guard = [auth, adminOnly] as const;

adminRoutes.get(paths.players, ...guard, adminController.listPlayers);
adminRoutes.get(paths.player, ...guard, adminController.getPlayer);
adminRoutes.put(paths.playerRole, ...guard, adminController.setRole);
adminRoutes.post(paths.playerBan, ...guard, adminController.setBanned);
adminRoutes.post(paths.playerCoins, ...guard, adminController.grantCoins);
adminRoutes.post(paths.playerItems, ...guard, adminController.grantItem);
adminRoutes.get(paths.audit, ...guard, adminController.getAudit);
adminRoutes.get(paths.economy, ...guard, adminController.getEconomy);
adminRoutes.post(paths.endElection, ...guard, adminController.endElection);
adminRoutes.put(paths.electionEndsAt, ...guard, adminController.setElectionEnd);
adminRoutes.get(paths.seaCreatures, ...guard, adminController.getSeaCreatures);
adminRoutes.put(paths.seaCreatures, ...guard, adminController.setSeaCreatures);
adminRoutes.post(paths.farmNextCycle, ...guard, adminController.farmNextCycle);
adminRoutes.post(paths.removeListing, ...guard, adminController.removeListing);
adminRoutes.get(paths.suggestions, ...guard, adminController.listSuggestions);
adminRoutes.put(paths.suggestion, ...guard, adminController.reviewSuggestion);
adminRoutes.patch(paths.suggestion, ...guard, adminController.adjustSuggestion);
adminRoutes.get(paths.feedback, ...guard, adminController.listFeedback);
adminRoutes.patch(paths.feedbackItem, ...guard, adminController.setFeedbackStatus);
adminRoutes.post(paths.feedbackReplies, ...guard, adminController.replyToFeedback);
adminRoutes.get(paths.announcements, ...guard, adminController.listAnnouncements);
adminRoutes.post(paths.announcements, ...guard, adminController.postAnnouncement);
adminRoutes.delete(paths.announcement, ...guard, adminController.deleteAnnouncement);

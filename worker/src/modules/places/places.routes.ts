import { Hono } from "hono";
import { GEO_API_PATHS } from "@geo/shared";
import type { AppEnv } from "../../app";
import { adminOnly, auth } from "../../http/auth";
import * as placesAdmin from "./places.admin";
import * as placesController from "./places.controller";

/** Hand-made places. Players read the active ones near them; game admins make, edit and remove them. */
export const placesRoutes = new Hono<AppEnv>();

const admin = GEO_API_PATHS.admin;

placesRoutes.get(GEO_API_PATHS.places, auth, placesController.listPlacesNear);
placesRoutes.get(admin.places, auth, adminOnly, placesAdmin.listPlaces);
placesRoutes.post(admin.places, auth, adminOnly, placesAdmin.createPlace);
placesRoutes.patch(admin.place, auth, adminOnly, placesAdmin.updatePlace);
placesRoutes.delete(admin.place, auth, adminOnly, placesAdmin.deletePlace);

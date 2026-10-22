import { Hono } from "hono";
import { GEO_API_PATHS } from "@geo/shared";
import type { AppEnv } from "../../app";
import { auth } from "../../http/auth";
import * as vendorsController from "./vendors.controller";

/** NPC vendors: what they sell and buy, and trading with them. */
export const vendorsRoutes = new Hono<AppEnv>();

vendorsRoutes.get(GEO_API_PATHS.vendors.list, auth, vendorsController.listVendors);
vendorsRoutes.post(GEO_API_PATHS.vendors.buy, auth, vendorsController.buy);
vendorsRoutes.post(GEO_API_PATHS.vendors.sell, auth, vendorsController.sell);
vendorsRoutes.post(GEO_API_PATHS.vendors.reforge, auth, vendorsController.reforge);
vendorsRoutes.post(GEO_API_PATHS.vendors.petUpgrade, auth, vendorsController.upgradePet);
vendorsRoutes.post(GEO_API_PATHS.vendors.collectPetUpgrade, auth, vendorsController.collectPetUpgrade);

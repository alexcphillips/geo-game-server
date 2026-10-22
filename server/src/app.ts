import express from "express";
import cors from "cors";
import { ENV } from "./config/env";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import { geoRouter } from "./geo.routes";

/**
 * Express wiring only, in request order: cross-origin check -> body parsing ->
 * routes -> 404 -> errors. Endpoints are all in `geo.routes.ts`.
 */
const app = express();

app.use(cors({ origin: ENV.CORS_ORIGINS, methods: ["GET", "POST", "PUT", "PATCH", "DELETE"] }));
app.use(express.json({ limit: "1mb" }));

app.use(geoRouter);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;

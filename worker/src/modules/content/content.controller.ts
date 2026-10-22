import type { Context } from "hono";
import type { GeoContentResponse } from "@geo/shared";
import { contentBody } from "../../../../server/src/modules/content/geo-content.controller";
import type { AppEnv } from "../../app";

type Ctx = Context<AppEnv>;

/** Built once per World instance: the content only changes with a deploy, which restarts it. */
let content: GeoContentResponse | undefined;

/** Item names, icons and rarities, every recipe, item sources and reforges. Public, no database. */
export function getContent(c: Ctx) {
    content ??= contentBody();
    return c.json(content, 200);
}

export function getHealth(c: Ctx) {
    return c.json({ ok: true }, 200);
}

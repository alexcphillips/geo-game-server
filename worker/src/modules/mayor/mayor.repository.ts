import type { MayorDef } from "../../../../server/src/content/content.types";
import type { StatModifier } from "../../../../server/src/engine/engine.types";
import { mayorModifiers, mayorOf } from "../../../../server/src/world/modifiers";
import type { Db } from "../../db/db";
import { CURRENT_MAYOR } from "./mayor.sql.ts";

/**
 * The mayor in office, or the first mayor when no election has closed. One
 * indexed row read: no cache, so a new mayor counts on the next request.
 */
export function currentMayor(db: Db): MayorDef {
    return mayorOf(db.one<{ winner_id: string }>(CURRENT_MAYOR)?.winner_id);
}

/** Every global modifier now (the mayor's perks), for any rule that reads a stat. */
export function globalModifiers(db: Db): StatModifier[] {
    return mayorModifiers(currentMayor(db));
}

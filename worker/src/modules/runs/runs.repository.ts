import { AppError } from "../../../../server/src/http/AppError";
import type { Db } from "../../db/db";
import { FIND_ACTIVE_RUN } from "./runs.sql.ts";

// TODO(session 3): end Runs left too long first, as the Express server's findLiveRun does.
function findLiveRun(db: Db, playerId: string) {
    return db.one<{ id: string; kind: string }>(FIND_ACTIVE_RUN, playerId);
}

/** Refuses a change to `skill`'s hand while a Run of that skill is going. */
export function assertHandNotInRun(db: Db, playerId: string, skill: string) {
    if (findLiveRun(db, playerId)?.kind === skill) throw AppError.badRequest("You can't change that hand mid-Run");
}

/** Refuses while the player is in any Run, with `message`. Call inside the transaction that does the work. */
export function assertNotInRun(db: Db, playerId: string, message: string) {
    if (findLiveRun(db, playerId)) throw AppError.badRequest(message);
}

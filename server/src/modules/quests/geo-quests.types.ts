import type { QuestProgress } from "./geo-quests.rules";

export type QuestRow = {
    quest_id: string;
    progress: QuestProgress;
    tracked: boolean;
    started_at: Date;
    /** When it was turned in; null while held. */
    claimed_at: Date | null;
};

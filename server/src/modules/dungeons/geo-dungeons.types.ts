export type LobbyRow = {
    id: string;
    dungeon_id: string;
    host_id: string;
    host_name: string;
    required_level: number;
    max_players: number;
    started_at: Date | null;
    closed_at: Date | null;
    player_count: number;
};

export type MemberRow = {
    player_id: string;
    display_name: string;
};

export type LobbyRow = {
    id: string;
    dungeon_id: string;
    host_id: string;
    host_name: string;
    required_level: number;
    max_players: number;
    created_at: number;
    started_at: number | null;
    closed_at: number | null;
    player_count: number;
};

export type MemberRow = {
    player_id: string;
    display_name: string;
};

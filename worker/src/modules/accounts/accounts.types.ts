import type { GeoRole } from "@geo/shared";

/** Rows as SQLite returns them: snake_case, times in ms. */
export type PlayerRow = {
    id: string;
    display_name: string;
    coins: number;
    bank_coins: number;
    role: GeoRole;
    created_at: number;
};

export type CredentialsRow = PlayerRow & { password_hash: string };

export type RefreshTokenRow = {
    token_hash: string;
    player_id: string;
    expires_at: number;
    revoked_at: number | null;
};

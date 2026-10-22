import type { PlayerRow } from "../player/geo-player.types";

export type RefreshTokenRow = {
    id: string;
    player_id: string;
    expires_at: Date;
    revoked_at: Date | null;
};

export type CredentialsRow = PlayerRow & { password_hash: string };

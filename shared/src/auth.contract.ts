/** Claims in a geo-game access token. */
export type GeoTokenPayload = {
    playerId: string;
};

/**
 * What a player may do beyond playing.
 */
export type GeoRole = "player" | "admin";

export type GeoPlayer = {
    id: string;
    displayName: string;
    /** Spendable coins. Coins held by live bids are already taken out. */
    coins: number;
    /** Coins in the bank at camp: safe from death, spendable once withdrawn. */
    bankCoins: number;
    role: GeoRole;
    createdAt: string;
};

/**
 * A signed-in session.
 */
export type GeoSession = {
    accessToken: string;
    /** Opaque, long-lived. Swap it for a new pair at `/geo/auth/refresh`. */
    refreshToken: string;
    player: GeoPlayer;
};

/** `POST /geo/auth/login`. A geo-game account's email and password. */
export type GeoLoginRequest = {
    email: string;
    password: string;
};

/**
 * `POST /geo/auth/register`: makes a geo-game account and its player in one
 * go, then signs in. Rules in the server's `lib/credentials.ts`. `username`
 * becomes the display name, unique ignoring case.
 */
export type GeoRegisterRequest = {
    username: string;
    email: string;
    password: string;
};

export type GeoRefreshRequest = {
    refreshToken: string;
};

/** `POST /geo/auth/logout`: ends the session that refresh token belongs to. */
export type GeoLogoutRequest = {
    refreshToken: string;
};

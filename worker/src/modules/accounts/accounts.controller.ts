import type { Context } from "hono";
import type { GeoLoginRequest, GeoLogoutRequest, GeoRefreshRequest, GeoRegisterRequest, GeoSession } from "@geo/shared";
import { AppError } from "../../../../game/src/http/AppError";
import {
    validateEmail,
    validatePassword,
    validateUsername,
    VALIDATION_MESSAGES,
} from "../../../../game/src/lib/credentials";
import type { AppEnv } from "../../app";
import { jsonBody, readString } from "../../http/body";
import { hashPassword, verifyPassword } from "../../lib/password";
import { hashRefreshToken, newRefreshToken, signAccessToken } from "../../lib/tokens";
import * as accountsRepository from "./accounts.repository";
import type { PlayerRow } from "./accounts.types";

/**
 * Checked when the email has no account, so a wrong email takes as long as a
 * wrong password and the two can't be told apart by timing. Made on first use.
 */
let dummyHash: Promise<string> | undefined;

async function session(c: Context<AppEnv>, player: PlayerRow, refreshToken: string): Promise<GeoSession> {
    return {
        accessToken: await signAccessToken(c.var.world.env.GEO_JWT_SECRET, player.id),
        refreshToken,
        player: accountsRepository.toPlayer(player),
    };
}

/** Signs in with a geo-game account. */
export async function login(c: Context<AppEnv>) {
    const body = await jsonBody(c);
    const email = readString(body, "email" satisfies keyof GeoLoginRequest).trim();
    const password = readString(body, "password" satisfies keyof GeoLoginRequest);
    if (!email || !password) throw AppError.badRequest(VALIDATION_MESSAGES.INVALID_EMAIL_OR_PASSWORD);

    const { db } = c.var.world;
    const account = accountsRepository.findCredentials(db, email);
    dummyHash ??= hashPassword("geo-game timing pad");
    const isValid = await verifyPassword(password, account?.password_hash ?? (await dummyHash));
    if (!account || !isValid) throw AppError.unauthorized(VALIDATION_MESSAGES.INVALID_EMAIL_OR_PASSWORD);

    const refresh = await newRefreshToken();
    accountsRepository.storeRefreshToken(db, account.id, refresh.hash);
    return c.json(await session(c, account, refresh.token), 200);
}

/** Makes a geo-game account and its player, and signs it in. */
export async function register(c: Context<AppEnv>) {
    const body = await jsonBody(c);
    const username = readString(body, "username" satisfies keyof GeoRegisterRequest).trim();
    const email = readString(body, "email" satisfies keyof GeoRegisterRequest).trim();
    const password = readString(body, "password" satisfies keyof GeoRegisterRequest);
    if (!username || !email || !password) throw AppError.badRequest("Missing username, email, or password");

    for (const result of [validateUsername(username), validateEmail(email), validatePassword(password)]) {
        if (!result.isValid) throw AppError.badRequest(result.errorMessage ?? VALIDATION_MESSAGES.INVALID_EMAIL_OR_PASSWORD);
    }

    const refresh = await newRefreshToken();
    const result = accountsRepository.register(c.var.world.db, {
        email,
        passwordHash: await hashPassword(password),
        displayName: username,
        refreshTokenHash: refresh.hash,
    });
    if (!result.ok) {
        if (result.taken === "displayName") throw AppError.badRequest("That username is taken");
        // Same answer as a bad sign-in, so sign-up can't be used to find out
        // which addresses have accounts.
        throw AppError.badRequest(VALIDATION_MESSAGES.INVALID_EMAIL_OR_PASSWORD);
    }
    return c.json(await session(c, result.player, refresh.token), 201);
}

export async function refresh(c: Context<AppEnv>) {
    const token = readString(await jsonBody(c), "refreshToken" satisfies keyof GeoRefreshRequest);
    if (!token) throw AppError.badRequest("Missing refreshToken");

    const next = await newRefreshToken();
    const result = accountsRepository.rotateRefreshToken(c.var.world.db, await hashRefreshToken(token), next.hash);
    // One message for every failure: which one it was is no business of
    // whoever is holding a bad token.
    if (!result.ok) throw AppError.unauthorized("Session expired. Sign in again.");
    return c.json(await session(c, result.player, next.token), 200);
}

export async function logout(c: Context<AppEnv>) {
    const token = readString(await jsonBody(c), "refreshToken" satisfies keyof GeoLogoutRequest);
    if (token) accountsRepository.revokeSession(c.var.world.db, await hashRefreshToken(token));
    return c.body(null, 204);
}

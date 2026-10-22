import type { Request, Response } from "express";
import {
    validateEmail,
    validatePassword,
    validateUsername,
    VALIDATION_MESSAGES,
} from "../../lib/credentials";
import type { GeoLoginRequest, GeoLogoutRequest, GeoRefreshRequest, GeoRegisterRequest } from "@geo/shared";
import { AppError } from "../../http/AppError";
import { comparePassword, hashPassword } from "../../lib/crypto";
import * as accountsRepository from "./geo-accounts.repository";

/**
 * Compared against when the email has no account, so a wrong email takes as
 * long as a wrong password and the two can't be told apart by timing.
 */
const DUMMY_HASH = hashPassword("geo-game timing pad");

function readString(body: unknown, key: string): string {
    const value = (body as Record<string, unknown> | undefined)?.[key];
    return typeof value === "string" ? value : "";
}

/** Signs in with a geo-game account. */
export async function login(req: Request, res: Response) {
    const email = readString(req.body, "email" satisfies keyof GeoLoginRequest).trim();
    const password = readString(req.body, "password" satisfies keyof GeoLoginRequest);
    if (!email || !password) throw AppError.badRequest(VALIDATION_MESSAGES.INVALID_EMAIL_OR_PASSWORD);

    const account = await accountsRepository.findCredentials(email);
    const isValid = await comparePassword(password, account?.password_hash ?? (await DUMMY_HASH));
    if (!account || !isValid) throw AppError.unauthorized(VALIDATION_MESSAGES.INVALID_EMAIL_OR_PASSWORD);

    res.status(200).json(await accountsRepository.signIn(account));
}

/** Makes a geo-game account and its player, with the starter kit, and signs it in. */
export async function register(req: Request, res: Response) {
    const username = readString(req.body, "username" satisfies keyof GeoRegisterRequest).trim();
    const email = readString(req.body, "email" satisfies keyof GeoRegisterRequest).trim();
    const password = readString(req.body, "password" satisfies keyof GeoRegisterRequest);
    if (!username || !email || !password) throw AppError.badRequest("Missing username, email, or password");

    for (const result of [validateUsername(username), validateEmail(email), validatePassword(password)]) {
        if (!result.isValid) {
            throw AppError.badRequest(result.errorMessage ?? VALIDATION_MESSAGES.INVALID_EMAIL_OR_PASSWORD);
        }
    }

    try {
        const session = await accountsRepository.register({
            email,
            passwordHash: await hashPassword(password),
            displayName: username,
        });
        res.status(201).json(session);
    } catch (error) {
        const { code, constraint } = error as { code?: string; constraint?: string };
        if (code !== "23505") throw error;
        if (constraint === "players_display_name_key") throw AppError.badRequest("That username is taken");
        // Same answer as a bad sign-in, so sign-up can't be used to find out
        // which addresses have accounts.
        throw AppError.badRequest(VALIDATION_MESSAGES.INVALID_EMAIL_OR_PASSWORD);
    }
}

export async function refresh(req: Request, res: Response) {
    const refreshToken = readString(req.body, "refreshToken" satisfies keyof GeoRefreshRequest);
    if (!refreshToken) throw AppError.badRequest("Missing refreshToken");

    const result = await accountsRepository.refreshSession(refreshToken);
    // One message for every failure: which one it was is no business of
    // whoever is holding a bad token.
    if (!result.ok) throw AppError.unauthorized("Session expired. Sign in again.");
    res.status(200).json(result.session);
}

export async function logout(req: Request, res: Response) {
    const refreshToken = readString(req.body, "refreshToken" satisfies keyof GeoLogoutRequest);
    if (refreshToken) await accountsRepository.revokeSession(refreshToken);
    res.status(204).end();
}

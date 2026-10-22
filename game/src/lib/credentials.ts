/**
 * Account rules for sign-up and log-in. Copied from cozy-app's shared
 * validation when geo-game moved out; geo-game's own from here on.
 */
export const CREDENTIAL_RULES = {
    PASSWORD_MIN_LENGTH: 8,
    PASSWORD_MAX_LENGTH: 32,
    USERNAME_MIN_LENGTH: 3,
    USERNAME_MAX_LENGTH: 32,
} as const;

export const VALIDATION_MESSAGES = {
    INVALID_PASSWORD_LENGTH: `Password must be between ${CREDENTIAL_RULES.PASSWORD_MIN_LENGTH} and ${CREDENTIAL_RULES.PASSWORD_MAX_LENGTH} characters`,
    INVALID_USERNAME_LENGTH: `Username must be between ${CREDENTIAL_RULES.USERNAME_MIN_LENGTH} and ${CREDENTIAL_RULES.USERNAME_MAX_LENGTH} characters`,
    INVALID_EMAIL: "Email is invalid",
    /** Deliberately vague: never reveal which half of the pair was wrong. */
    INVALID_EMAIL_OR_PASSWORD: "Invalid email or password",
} as const;

export type ValidationResult = {
    isValid: boolean;
    /** Human-readable, safe to show to the user. `null` when `isValid`. */
    errorMessage: string | null;
};

const VALID: ValidationResult = { isValid: true, errorMessage: null };

function invalid(errorMessage: string): ValidationResult {
    return { isValid: false, errorMessage };
}

/**
 * Deliberately conservative: rejects the obviously-malformed rather than trying
 * to be RFC 5322 complete.
 */
export function validateEmail(email: string): ValidationResult {
    const parts = email.trim().split("@");
    const looksLikeEmail = parts.length === 2 && parts.every((part) => part.length > 0);
    return looksLikeEmail ? VALID : invalid(VALIDATION_MESSAGES.INVALID_EMAIL);
}

export function validatePassword(password: string): ValidationResult {
    const tooShort = password.length < CREDENTIAL_RULES.PASSWORD_MIN_LENGTH;
    const tooLong = password.length > CREDENTIAL_RULES.PASSWORD_MAX_LENGTH;
    return tooShort || tooLong ? invalid(VALIDATION_MESSAGES.INVALID_PASSWORD_LENGTH) : VALID;
}

export function validateUsername(username: string): ValidationResult {
    const length = username.trim().length;
    const tooShort = length < CREDENTIAL_RULES.USERNAME_MIN_LENGTH;
    const tooLong = length > CREDENTIAL_RULES.USERNAME_MAX_LENGTH;
    return tooShort || tooLong ? invalid(VALIDATION_MESSAGES.INVALID_USERNAME_LENGTH) : VALID;
}

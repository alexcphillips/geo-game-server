import type { AppError } from "../http/AppError";

/**
 * Request checks shared by the Worker's controllers. Each takes the error to throw,
 * so every endpoint keeps its own wording ("That listing is gone", "Bad lobby id").
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
    return typeof value === "string" && UUID.test(value);
}

/** `value` as a whole number from `min` to `max`, or `error`. */
export function wholeNumber(value: unknown, min: number, max: number, error: AppError): number {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) throw error;
    return value;
}

import type { Context } from "hono";
import { AppError } from "../../../server/src/http/AppError";

/** The JSON body, or `{}` when there is none. A body that isn't JSON is a 400. */
export async function jsonBody(c: Context): Promise<Record<string, unknown>> {
    const text = await c.req.text();
    if (!text) return {};
    try {
        const parsed: unknown = JSON.parse(text);
        return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
        throw AppError.badRequest("Body isn't valid JSON");
    }
}

export function readString(body: Record<string, unknown>, key: string): string {
    const value = body[key];
    return typeof value === "string" ? value : "";
}

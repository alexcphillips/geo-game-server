import type { GeoRole } from "@geo/shared";

export type AdminPlayerRecord = {
    id: string;
    display_name: string;
    email: string;
    role: GeoRole;
    coins: number;
    banned_at: number | null;
    created_at: number;
};

export type LedgerRecord = { delta: number; reason: string; reference: string | null; created_at: number };

/** `details`: JSON, or null. */
export type AuditRecord = { id: number; admin: string; action: string; target: string | null; details: string | null; created_at: number };

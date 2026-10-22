import type { GeoRole } from "@geo/shared";

export type AdminPlayerRow = {
    id: string;
    display_name: string;
    email: string;
    role: GeoRole;
    coins: string;
    banned_at: Date | null;
    created_at: Date;
};

export type LedgerRow = {
    delta: string;
    reason: string;
    reference: string | null;
    created_at: Date;
};

export type AuditRow = {
    id: string;
    admin: string;
    action: string;
    target: string | null;
    details: Record<string, unknown> | null;
    created_at: Date;
};

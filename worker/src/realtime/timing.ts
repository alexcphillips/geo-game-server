import { GEO_SOCKET_PING_SECONDS } from "@geo/shared";

/** The socket's timings, apart from hub.ts so Node scripts (the smoke suites) can import them. */

/** Silent this long (no ping, nothing): the phone is gone without saying so. Two missed pings and a bit. */
export const IDLE_MS = (GEO_SOCKET_PING_SECONDS * 2 + 10) * 1000;
/**
 * A last socket closing waits this long before the player counts as gone,
 * so a reconnect (a fresh token, a blip in signal) isn't an offline and
 * online again for their friends, turn clock and party.
 */
export const OFFLINE_GRACE_MS = 10_000;

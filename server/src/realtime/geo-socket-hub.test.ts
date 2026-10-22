import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import type { GeoSocketServerMessage } from "@geo/shared";
import * as socketHub from "./geo-socket-hub";

function fakeConnection() {
    const sent: GeoSocketServerMessage[] = [];
    const connection: socketHub.GeoSocketConnection = {
        send: (text) => sent.push(JSON.parse(text) as GeoSocketServerMessage),
        close: () => {},
    };
    return { connection, sent };
}

describe("presence", () => {
    beforeEach(() => mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 }));
    afterEach(() => mock.timers.reset());

    it("counts a closed socket as here until the grace runs out, then gone from when it closed", () => {
        const id = randomUUID();
        const offline: string[] = [];
        const stop = socketHub.onOffline((playerId) => offline.push(playerId));
        const { connection } = fakeConnection();
        socketHub.register(id, connection);
        socketHub.unregister(id, connection);
        assert.equal(socketHub.offlineSince(id), null);
        assert.equal(socketHub.isConnected(id), false);

        mock.timers.tick(10_000);
        assert.deepEqual(offline, [id]);
        assert.equal(socketHub.offlineSince(id), 1_000_000);
        stop();
    });

    it("a reconnect within the grace is neither offline nor online", () => {
        const id = randomUUID();
        const events: string[] = [];
        const stopOff = socketHub.onOffline(() => events.push("off"));
        const stopOn = socketHub.onOnline(() => events.push("on"));
        const first = fakeConnection();
        socketHub.register(id, first.connection);
        socketHub.unregister(id, first.connection);
        mock.timers.tick(5_000);
        socketHub.register(id, fakeConnection().connection);
        mock.timers.tick(20_000);
        assert.deepEqual(events, ["on"]);
        assert.equal(socketHub.offlineSince(id), null);
        stopOff();
        stopOn();
    });

    it("a request after the socket closed moves when they count as gone from", () => {
        const id = randomUUID();
        const { connection } = fakeConnection();
        socketHub.register(id, connection);
        socketHub.unregister(id, connection);
        mock.timers.tick(15_000);
        socketHub.heardFrom(id);
        assert.equal(socketHub.offlineSince(id), 1_015_000);
    });
});

describe("pushFresh", () => {
    it("sends reads in order, folding asks made meanwhile into one more read", async () => {
        const id = randomUUID();
        const { connection, sent } = fakeConnection();
        socketHub.register(id, connection);
        let reads = 0;
        const releases: (() => void)[] = [];
        const read = () =>
            new Promise<GeoSocketServerMessage>((resolve) => {
                const n = ++reads;
                releases.push(() => resolve({ type: "changed", topic: n === 1 ? "market" : "mayor" }));
            });

        socketHub.pushFresh(id, "test", read);
        socketHub.pushFresh(id, "test", read);
        socketHub.pushFresh(id, "test", read);
        assert.equal(reads, 1);
        releases[0]!();
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(reads, 2);
        releases[1]!();
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(reads, 2);
        assert.deepEqual(sent, [
            { type: "changed", topic: "market" },
            { type: "changed", topic: "mayor" },
        ]);
    });

    it("reads nothing for a player with no socket", () => {
        let reads = 0;
        socketHub.pushFresh(randomUUID(), "test", () => {
            reads++;
            return Promise.resolve(null);
        });
        assert.equal(reads, 0);
    });
});

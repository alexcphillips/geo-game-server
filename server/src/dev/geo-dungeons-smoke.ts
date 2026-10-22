import assert from "node:assert/strict";
import {
    GEO_API_PATHS,
    GEO_DUNGEON_RECONNECT_SECONDS,
    GEO_RUN_TURN_SECONDS,
    GEO_SOCKET_CLOSE,
    type GeoSocketServerMessage,
    type GeoChestsResponse,
    type GeoDungeonRunResponse,
    type GeoDungeonRunView,
    type GeoDungeonsResponse,
    type GeoRunResponse,
    type GeoStartDungeonLobbyResponse,
} from "@geo/shared";
import { pool } from "../db";
import { withTransaction } from "../db/transaction";
import { addCoins } from "../modules/player/geo-player.repository";
import { OFFLINE_GRACE_MS } from "../realtime/geo-socket-hub";
import { startSmokeServer, step } from "./smoke-kit";

/**
 * End-to-end check of a dungeon map against the local database: the host
 * starts a Slime Pits lobby, walks the rolled map room by room (fights,
 * loot, events, puzzles, the key wing when the layout has one) and loses
 * to Mother Slime with the starter kit, beats her with a Venomfang Dagger
 * and Ragged Pants for the chests, and finally leaves one. Then a party of
 * two shares one map, hearing each other over the geo socket.
 * `npm run smoke:geo-dungeons`.
 */
const { call, registerPlayer, grant, openSocket, stop } = await startSmokeServer();

const HERE = { latitude: 51.5007, longitude: -0.1246 };
const isType =
    <K extends GeoSocketServerMessage["type"]>(type: K) =>
    (m: GeoSocketServerMessage): m is Extract<GeoSocketServerMessage, { type: K }> =>
        m.type === type;
const paths = GEO_API_PATHS.dungeonRuns;
type Err = { error: string };

try {
    const { accessToken: token, player } = await registerPlayer("dungeons");
    await grant(player.id, [{ itemId: "sluice-key", quantity: 1 }]);

    const created = await call<GeoDungeonsResponse>("POST", GEO_API_PATHS.dungeons.lobbies, token, {
        dungeonId: "slime-pits",
        requiredLevel: 0,
        position: HERE,
        place: HERE,
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const lobbyId = created.body.myLobby!.id;
    const started = await call<GeoStartDungeonLobbyResponse>("POST", GEO_API_PATHS.dungeons.start.replace(":lobbyId", lobbyId), token);
    assert.equal(started.status, 200, JSON.stringify(started.body));
    assert.equal(started.body.opened, null);
    let map: GeoDungeonRunView = started.body.dungeonRun!;
    assert.equal(map.status, "active");
    assert.equal(map.health, map.maxHealth);
    assert.ok(
        map.rooms.some((room) => room.kind === "boss" && room.seen === "seen"),
        "the boss room shows from the start",
    );
    assert.ok(map.rooms.every((room) => room.seen === "visited" || map.rooms.some((r) => r.seen === "visited")));
    step(`starting the lobby rolls a map (${map.cols}×${map.rows}), boss in sight, rest under fog`);

    const active = await call<GeoDungeonRunResponse>("GET", paths.active, token);
    assert.equal(active.body.dungeonRun.id, map.id);
    const spawnFight = await call<Err>("POST", GEO_API_PATHS.runs.start, token, {
        kind: "combat",
        enemyId: "green-slime",
    });
    assert.equal(spawnFight.status, 400);
    assert.match(spawnFight.body.error, /in a dungeon/);
    step("the run resumes from GET active, and no other fight can start meanwhile");

    const move = (roomId: number) =>
        call<GeoDungeonRunResponse & Err>("POST", paths.move.replace(":dungeonRunId", map.id), token, { roomId });
    assert.equal((await move(999)).status, 400);
    const boss = map.rooms.find((room) => room.kind === "boss")!;
    const sealed = await move(boss.id);
    assert.equal(sealed.status, 400);
    step(`moves the map doesn't allow are refused ("${sealed.body.error}")`);

    /** Plays the first playable card until the fight ends, eating from the lunchbox at 30 health or less. */
    async function fight(start: GeoRunResponse, by = token): Promise<GeoRunResponse> {
        let current = start;
        for (let turn = 0; turn < 300 && current.run.status === "active"; turn++) {
            const you = current.run.combatants.find((c) => c.side === "player")!;
            const food = current.run.lunchbox[0];
            if (you.health <= 30 && food) {
                const ate = await call<GeoRunResponse>("POST", GEO_API_PATHS.runs.turns.replace(":runId", current.run.id), by, {
                    lunchboxSlot: food.slot,
                });
                assert.equal(ate.status, 200, JSON.stringify(ate.body));
                current = ate.body;
                continue;
            }
            const card = current.run.hand.find((c) => c.playable);
            assert.ok(card, "a playable card");
            const enemy = current.run.combatants.find((c) => c.side === "enemy" && c.health > 0);
            const played = await call<GeoRunResponse>("POST", GEO_API_PATHS.runs.turns.replace(":runId", current.run.id), by, {
                inventoryId: card.inventoryId,
                targetId: enemy?.id,
            });
            assert.equal(played.status, 200, JSON.stringify(played.body));
            current = played.body;
        }
        return current;
    }

    const coinsNow = async () =>
        Number((await pool.query<{ coins: string }>(`SELECT coins FROM geo.players WHERE id = $1`, [player.id])).rows[0]!.coins);
    await withTransaction((tx) => addCoins(tx, player.id, 120, "admin-grant", "dungeons-smoke"));

    /** Walks the map: anything seen and not done, the boss last, every fight played card by card. */
    async function walk() {
        const seenKinds = new Set<string>();
        let fights = 0;
        for (let steps = 0; steps < 60 && map.status === "active"; steps++) {
            const options = map.rooms
                .filter((room) => room.id !== map.currentRoom && !room.done && room.kind !== "entrance")
                .sort(
                    (a, b) =>
                        Number(a.kind === "boss") - Number(b.kind === "boss") ||
                        Number(a.seen === "visited") - Number(b.seen === "visited"),
                );
            let moved: (GeoDungeonRunResponse & Err) | null = null;
            for (const room of options) {
                const tried = await move(room.id);
                if (tried.status === 200) {
                    moved = tried.body;
                    seenKinds.add(room.kind);
                    break;
                }
            }
            assert.ok(moved, `some room can be entered (at ${map.currentRoom})`);
            map = moved.dungeonRun;
            if (moved.fight) {
                assert.equal(moved.fight.run.dungeonRunId, map.id);
                const over = await fight(moved.fight);
                if (process.env.DEBUG_SMOKE) {
                    const foe = (r: GeoRunResponse) => r.run.combatants.find((c) => c.side === "enemy")!;
                    const me = (r: GeoRunResponse) => r.run.combatants.find((c) => c.side === "player")!;
                    const [start, end] = [me(moved.fight), me(over)];
                    console.log(`  ${foe(over).name}: you ${start.health}/${start.maxHealth} → ${over.run.status}, foe left ${foe(over).health}, you ${end.health}`);
                }
                fights += 1;
                assert.notEqual(over.run.status, "active");
                if (over.run.status === "defeat") assert.equal(over.run.coinsLost, 0, "a dungeon death costs no coins");

                const now = (await call<GeoDungeonRunResponse | null>("GET", paths.active, token)).body;
                if (now) map = now.dungeonRun;
                else {
                    // Over: read how it ended.
                    const last = await pool.query<{ status: string }>(`SELECT status FROM geo.dungeon_runs WHERE id = $1`, [map.id]);
                    map = { ...map, status: last.rows[0]!.status as GeoDungeonRunView["status"] };
                }
            }
            if (map.puzzle) {
                const answered = await call<GeoDungeonRunResponse>("POST", paths.puzzle.replace(":dungeonRunId", map.id), token, {
                    answer: 0,
                });
                assert.equal(answered.status, 200);
                assert.ok(!JSON.stringify(answered.body).includes('"answer"'));
                map = answered.body.dungeonRun;
            }
            if (map.status === "active") assert.ok(map.health <= map.maxHealth);
        }
        return { seenKinds, fights };
    }

    const before = await coinsNow();
    const first = await walk();
    assert.equal(map.status, "failed", "Mother Slime beats the starter kit");
    const ended = await call<GeoDungeonRunResponse>("GET", paths.one.replace(":dungeonRunId", map.id), token);
    assert.equal(ended.body.dungeonRun.status, "failed", "a finished run can still be read");
    assert.ok((await coinsNow()) >= before, "room fights drop coins, and dying costs none");
    step(`run 1, starter kit for real: ${[...first.seenKinds].join(", ")} rooms, ${first.fights} fights, died to the boss, purse kept`);

    const startAgain = async () => {
        const lobby = await call<GeoDungeonsResponse>("POST", GEO_API_PATHS.dungeons.lobbies, token, {
            dungeonId: "slime-pits",
            requiredLevel: 0,
            position: HERE,
            place: HERE,
        });
        assert.equal(lobby.status, 201, JSON.stringify(lobby.body));
        const go = await call<GeoStartDungeonLobbyResponse>(
            "POST",
            GEO_API_PATHS.dungeons.start.replace(":lobbyId", lobby.body.myLobby!.id),
            token,
        );
        assert.equal(go.status, 200, JSON.stringify(go.body));
        map = go.body.dungeonRun!;
    };

    // Venomfang and one armor piece: Mother Slime is tuned to lose to this.
    await grant(player.id, [
        { itemId: "venomfang-dagger", quantity: 1 },
        { itemId: "ragged-pants", quantity: 1 },
    ]);
    for (const [slot, itemId] of [
        ["mainHand", "venomfang-dagger"],
        ["legs", "ragged-pants"],
    ] as const) {
        const row = await pool.query<{ id: string }>(`SELECT id FROM geo.inventory WHERE player_id = $1 AND item_id = $2`, [
            player.id,
            itemId,
        ]);
        const equipped = await call("PUT", GEO_API_PATHS.me.equipmentSlot.replace(":slot", slot), token, { inventoryId: row.rows[0]!.id });
        assert.equal(equipped.status, 200, JSON.stringify(equipped.body));
    }
    // Run 1 ate the starter bread; a player would restock at camp first.
    const restock = () =>
        pool.query(
            `INSERT INTO geo.lunchbox (player_id, slot, item_id, quantity) VALUES ($1, 0, 'bread', 5)
             ON CONFLICT (player_id, slot) DO UPDATE SET item_id = 'bread', quantity = 5`,
            [player.id],
        );
    await restock();
    await startAgain();
    const second = await walk();
    assert.equal(map.status, "won", "Venomfang and armor beat Mother Slime");
    step(`run 2, Venomfang + Ragged Pants for real: ${second.fights} fights, beat the boss`);

    assert.equal((await call<GeoDungeonRunResponse | null>("GET", paths.active, token)).body, null);
    const chests = await call<GeoChestsResponse>("GET", GEO_API_PATHS.chests.root, token);
    const selection = chests.body.pending.find((s) => s.source.kind === "dungeon");
    assert.ok(selection, "the dungeon's chests wait in the Chests tab");
    assert.equal(selection.chests[0]!.tier, "plain");
    step(`its chests wait in the Chests tab: ${selection.chests.map((c) => c.tier).join(", ")}`);

    // A last run, left at once: failed, no chests, and the player is free again.
    await startAgain();
    const left = await call<GeoDungeonRunResponse>("POST", paths.leave.replace(":dungeonRunId", map.id), token);
    assert.equal(left.body.dungeonRun.status, "failed");
    assert.equal((await call("GET", paths.active, token)).body, null);
    step("leaving a dungeon fails it and frees the player");

    // ---- A party of two on one map, over the socket.
    const refused = openSocket(null, JSON.stringify({ type: "auth", token: "not-a-token" }));
    assert.equal(await refused.closed, GEO_SOCKET_CLOSE.unauthorized);
    step("the socket refuses a bad token");

    const friend = await registerPlayer("dungeon-friend");
    const hostSocket = openSocket(token);
    const friendSocket = openSocket(friend.accessToken);
    await hostSocket.next(isType("ready"));
    await friendSocket.next(isType("ready"));
    assert.equal((await friendSocket.next(isType("lobby"))).lobby, null, "the snapshot: no lobby yet");
    friendSocket.ping();

    const partyLobby = await call<GeoDungeonsResponse>("POST", GEO_API_PATHS.dungeons.lobbies, token, {
        dungeonId: "slime-pits",
        requiredLevel: 0,
        position: HERE,
        place: HERE,
    });
    assert.equal(partyLobby.status, 201, JSON.stringify(partyLobby.body));
    const partyLobbyId = partyLobby.body.myLobby!.id;
    hostSocket.drain();
    const joined = await call("POST", GEO_API_PATHS.dungeons.join.replace(":lobbyId", partyLobbyId), friend.accessToken, { position: HERE, place: HERE });
    assert.equal(joined.status, 200, JSON.stringify(joined.body));
    const heard = await hostSocket.next((m): m is Extract<GeoSocketServerMessage, { type: "lobby" }> => m.type === "lobby" && m.lobby?.playerCount === 2);
    assert.deepEqual(heard.lobby!.members!.map((m) => m.isYou), [true, false]);
    step("the host hears the friend join their lobby");

    friendSocket.drain();
    const partyStart = await call<GeoStartDungeonLobbyResponse>("POST", GEO_API_PATHS.dungeons.start.replace(":lobbyId", partyLobbyId), token);
    assert.equal(partyStart.status, 200, JSON.stringify(partyStart.body));
    assert.equal(partyStart.body.leftOut.length, 0);
    const shared = partyStart.body.dungeonRun!;
    assert.equal(shared.party.length, 2);
    const friendsView = (await friendSocket.next(isType("dungeonRun"))).dungeonRun;
    assert.equal(friendsView.id, shared.id, "one map for both");
    await friendSocket.next((m): m is Extract<GeoSocketServerMessage, { type: "lobby" }> => m.type === "lobby" && m.lobby === null);
    assert.deepEqual(friendsView.party.map((m) => [m.isYou, m.roomId]), [[false, shared.currentRoom], [true, shared.currentRoom]]);
    step("starting takes the friend in over the socket: one map, both at the entrance");

    // The host walks into the first room that will have them.
    const partyMove = (by: string, roomId: number) =>
        call<GeoDungeonRunResponse & Err>("POST", paths.move.replace(":dungeonRunId", shared.id), by, { roomId });
    let entered: (GeoDungeonRunResponse & Err) | null = null;
    for (const room of shared.rooms.filter((r) => r.kind !== "boss" && r.id !== shared.currentRoom)) {
        const tried = await partyMove(token, room.id);
        if (tried.status === 200) {
            entered = tried.body;
            break;
        }
    }
    assert.ok(entered, "the host can go somewhere");
    const room = entered.dungeonRun.currentRoom;
    const pushed = await friendSocket.next(
        (m): m is Extract<GeoSocketServerMessage, { type: "dungeonRun" }> => m.type === "dungeonRun" && m.dungeonRun.version > friendsView.version,
    );
    assert.equal(pushed.dungeonRun.party.find((m) => !m.isYou)!.roomId, room, "the friend sees where the host went");
    step(`the friend sees the host walk into room ${room} (version ${friendsView.version} → ${pushed.dungeonRun.version})`);

    if (entered.fight) {
        const busy = await partyMove(friend.accessToken, room);
        assert.equal(busy.status, 400);
        assert.match(busy.body.error, /is in there/);
        const over = await fight(entered.fight);
        const after = (await call<GeoDungeonRunResponse>("GET", paths.active, friend.accessToken)).body.dungeonRun;
        if (over.run.status === "victory") {
            assert.ok(after.rooms.find((r) => r.id === room)!.done, "cleared for the friend too");
            const walkIn = await partyMove(friend.accessToken, room);
            assert.equal(walkIn.status, 200, JSON.stringify(walkIn.body));
            assert.equal(walkIn.body.fight, null, "no second fight in a cleared room");
        } else {
            assert.equal(after.party.find((m) => !m.isYou)!.status, "failed");
        }
        step(`a fight holds its room ("${busy.body.error}"); the host's ${over.run.status} counts for both`);
    }

    const friendLeft = await call<GeoDungeonRunResponse>("POST", paths.leave.replace(":dungeonRunId", shared.id), friend.accessToken);
    assert.equal(friendLeft.body.dungeonRun.status, "failed");
    const hostNow = (await call<GeoDungeonRunResponse | null>("GET", paths.active, token)).body;
    if (hostNow) {
        assert.equal(hostNow.dungeonRun.status, "active", "the host plays on after the friend leaves");
        await call("POST", paths.leave.replace(":dungeonRunId", shared.id), token);
    }
    const over = await pool.query<{ status: string }>(`SELECT status FROM geo.dungeon_runs WHERE id = $1`, [shared.id]);
    assert.equal(over.rows[0]!.status, "failed");
    step("one leaving doesn't end it for the other; it's over once both are out");

    // ---- The boss's ready-up.
    type RunPush = Extract<GeoSocketServerMessage, { type: "dungeonRun" }>;
    const runPush = (match: (view: GeoDungeonRunView) => boolean) => (m: GeoSocketServerMessage): m is RunPush =>
        m.type === "dungeonRun" && match(m.dungeonRun);

    /** Host and friend in a fresh party, every star room cleared so the boss room is open. */
    async function partyAtTheDoor(clearStars = true): Promise<GeoDungeonRunView> {
        const lobby = await call<GeoDungeonsResponse>("POST", GEO_API_PATHS.dungeons.lobbies, token, { dungeonId: "slime-pits", requiredLevel: 0, position: HERE, place: HERE });
        assert.equal(lobby.status, 201, JSON.stringify(lobby.body));
        const id = lobby.body.myLobby!.id;
        assert.equal((await call("POST", GEO_API_PATHS.dungeons.join.replace(":lobbyId", id), friend.accessToken, { position: HERE, place: HERE })).status, 200);
        const go = await call<GeoStartDungeonLobbyResponse>("POST", GEO_API_PATHS.dungeons.start.replace(":lobbyId", id), token);
        assert.equal(go.status, 200, JSON.stringify(go.body));
        const view = go.body.dungeonRun!;
        if (clearStars) {
            // Everything explored and every shared room cleared, as if the party had played it.
            const { rows } = await pool.query<{ map: { rooms: { id: number; kind: string; wingOf: number[] }[] }; state: Record<string, unknown> }>(
                `SELECT map, state FROM geo.dungeon_runs WHERE id = $1`,
                [view.id],
            );
            const rooms = rows[0]!.map.rooms.filter((room) => room.wingOf.length === 0);
            const state = {
                ...rows[0]!.state,
                visited: rooms.map((room) => room.id),
                done: rooms.filter((room) => !["boss", "loot", "event", "entrance"].includes(room.kind)).map((room) => room.id),
            };
            await pool.query(`UPDATE geo.dungeon_runs SET state = $2 WHERE id = $1`, [view.id, state]);
        }
        return (await call<GeoDungeonRunResponse>("GET", paths.active, token)).body.dungeonRun;
    }
    const moveIn = (by: string, roomId: number) =>
        call<GeoDungeonRunResponse & Err>("POST", paths.move.replace(":dungeonRunId", door.id), by, { roomId });
    const bossOf = (view: GeoDungeonRunView) => view.rooms.find((room) => room.kind === "boss")!.id;
    const leaveIfIn = async (by: string) => {
        const now = (await call<GeoDungeonRunResponse | null>("GET", paths.active, by)).body;
        if (now) await call("POST", paths.leave.replace(":dungeonRunId", now.dungeonRun.id), by);
    };

    let door = await partyAtTheDoor();
    const hostMove = await moveIn(token, bossOf(door));
    assert.equal(hostMove.status, 200, JSON.stringify(hostMove.body));
    const hostReady = hostMove.body;
    assert.equal(hostReady.fight, null, "the boss waits for the party");
    assert.deepEqual(
        { ...hostReady.dungeonRun.readyUp, yourDeadline: null },
        { ready: 1, total: 2, needed: 1, clockRunning: true, youAreReady: true, yourDeadline: null },
    );
    const onTheClock = await friendSocket.next(runPush((v) => v.id === door.id && v.readyUp?.yourDeadline != null));
    const clockLeft = Date.parse(onTheClock.dungeonRun.readyUp!.yourDeadline!) - Date.now();
    assert.ok(clockLeft > 80_000 && clockLeft <= 90_000, `about 90 s on the friend's clock (${clockLeft} ms)`);
    step("the host in the boss room is ready; half the party ready puts 90 s on the friend");

    // Ninety seconds on: put the friend's clock in the past instead of waiting.
    await pool.query(
        `UPDATE geo.dungeon_run_members SET state = jsonb_set(state, '{onClockSince}', to_jsonb($3::bigint))
         WHERE dungeon_run_id = $1 AND player_id = $2`,
        [door.id, friend.player.id, Date.now() - 91_000],
    );
    const afterClock = (await call<GeoDungeonRunResponse>("GET", paths.active, token)).body.dungeonRun;
    assert.ok(afterClock.bossStarted && afterClock.fightRunId, "the boss starts for the one who was there");
    const friendOut = await friendSocket.next(runPush((v) => v.id === door.id && v.status === "failed"));
    assert.equal(friendOut.dungeonRun.outReason, "missedBoss");
    assert.equal((await moveIn(friend.accessToken, bossOf(door))).status, 400);
    await leaveIfIn(token);
    step("the clock ran out: the friend is out (missedBoss) and the host's boss started");

    door = await partyAtTheDoor();
    await moveIn(token, bossOf(door));
    const lastIn = await moveIn(friend.accessToken, bossOf(door));
    assert.equal(lastIn.status, 200, JSON.stringify(lastIn.body));
    assert.ok(lastIn.body.fight?.run.status === "active", "the last one in gets their boss fight back at once");
    const hostsBoss = await hostSocket.next(runPush((v) => v.id === door.id && v.fightRunId !== null));
    assert.notEqual(hostsBoss.dungeonRun.fightRunId, lastIn.body.fight.run.id, "each their own Run of it");
    const fled = await call("POST", GEO_API_PATHS.runs.flee.replace(":runId", hostsBoss.dungeonRun.fightRunId!), token);
    assert.equal(fled.status, 200, JSON.stringify(fled.body));
    const hostAfter = (await call<GeoDungeonRunResponse>("GET", paths.one.replace(":dungeonRunId", door.id), token)).body.dungeonRun;
    assert.equal(hostAfter.status, "failed");
    assert.equal(hostAfter.outReason, "fledBoss");
    await leaveIfIn(friend.accessToken);
    step("everyone in: the boss starts for both at once (the host heard over the socket); fleeing the boss is out");

    // The reconnect window, for real: the friend drops mid-fight; GEO_DUNGEON_RECONNECT_SECONDS later the room is let go.
    door = await partyAtTheDoor(false);
    let held: (GeoDungeonRunResponse & Err) | null = null;
    for (const room of door.rooms.filter((r) => r.kind === "encounter" || r.kind === "star")) {
        const tried = await moveIn(friend.accessToken, room.id);
        if (tried.status === 200 && tried.body.fight?.run.status === "active") {
            held = tried.body;
            break;
        }
    }
    if (held) {
        const room = held.dungeonRun.currentRoom;
        hostSocket.drain();
        friendSocket.ws.close();
        const released = await hostSocket.next(
            runPush((v) => v.id === door.id && v.party.some((m) => !m.isYou && !m.isFighting && m.roomId !== room)),
            (GEO_DUNGEON_RECONNECT_SECONDS + 10) * 1000,
        );
        const mate = released.dungeonRun.party.find((m) => !m.isYou)!;
        assert.equal(mate.status, "active", "still in, just not holding the room");
        assert.equal(released.dungeonRun.rooms.find((r) => r.id === room)!.busyWith, null);
        step(`the friend went offline mid-fight; after ${GEO_DUNGEON_RECONNECT_SECONDS} s the fight counted as fled and the room was free`);
    } else {
        step("(reconnect window skipped: no fight room open from the entrance on this layout)");
    }
    await leaveIfIn(friend.accessToken);
    await leaveIfIn(token);

    // ---- The shared boss fight. One socket for the friend, so closing it takes them offline.
    friendSocket.ws.close();
    await friendSocket.closed;
    let friendSocket2 = openSocket(friend.accessToken);
    await friendSocket2.next(isType("ready"));
    door = await partyAtTheDoor();
    await moveIn(token, bossOf(door));
    const go = await moveIn(friend.accessToken, bossOf(door));
    assert.equal(go.status, 200, JSON.stringify(go.body));
    const runs = await pool.query<{ player_id: string; battle_id: string | null; combatant_id: string }>(
        `SELECT player_id, battle_id, combatant_id FROM geo.runs WHERE dungeon_run_id = $1 AND dungeon_room = $2`,
        [door.id, bossOf(door)],
    );
    assert.equal(runs.rows.length, 2);
    assert.ok(runs.rows[0]!.battle_id && runs.rows[0]!.battle_id === runs.rows[1]!.battle_id, "one battle for both");
    type RunView = GeoRunResponse["run"];
    type RunMessage = Extract<GeoSocketServerMessage, { type: "run" }>;
    const viewOf = async (by: string) => (await call<GeoRunResponse>("GET", GEO_API_PATHS.runs.active, by)).body.run;
    let hostRun: RunView = await viewOf(token);
    const friendRun: RunView = await viewOf(friend.accessToken);
    assert.notEqual(hostRun.you, friendRun.you);
    assert.equal(hostRun.combatants.filter((c) => c.side === "player").length, 2, "both players in it");
    assert.ok(hostRun.turnDeadline, "a turn clock");
    step(`one shared boss fight: ${hostRun.you} and ${friendRun.you}, turn order ${hostRun.order.join(", ")}`);

    const tokenOf = (you: string) => (you === hostRun.you ? token : friend.accessToken);
    const playFirstCard = async (by: string) => {
        const view = await viewOf(by);
        const card = view.hand.find((c) => c.playable)!;
        const enemy = view.combatants.find((c) => c.side === "enemy" && c.health > 0);
        return call<GeoRunResponse & Err>("POST", GEO_API_PATHS.runs.turns.replace(":runId", view.id), by, { inventoryId: card.inventoryId, targetId: enemy?.id });
    };
    const waiting = hostRun.currentActor === hostRun.you ? friend.accessToken : token;
    const outOfTurn = await playFirstCard(waiting);
    assert.equal(outOfTurn.status, 400);
    assert.match(outOfTurn.body.error, /isn't your turn/);

    const actorToken = tokenOf(hostRun.currentActor!);
    const otherSocket = actorToken === token ? friendSocket2 : hostSocket;
    otherSocket.drain();
    const played = await playFirstCard(actorToken);
    assert.equal(played.status, 200, JSON.stringify(played.body));
    const turnHeard = await otherSocket.next((m): m is RunMessage => m.type === "run" && m.run.log.some((e) => e.type === "cardPlayed"));
    assert.equal(turnHeard.run.run.version, played.body.run.version, "the push is the same step");
    step("only the player whose turn it is can act; the other hears the turn over the socket");

    // The turn clock: run it out in the database rather than wait 30 s.
    hostRun = await viewOf(token);
    if (hostRun.status === "active" && hostRun.currentActor) {
        const late = hostRun.currentActor;
        // The clock counts from the turn's start, so that's what goes back.
        await pool.query(
            `UPDATE geo.runs SET turn_started_at = now() - make_interval(secs => $2), turn_deadline = now() - interval '1 second' WHERE battle_id = $1`,
            [runs.rows[0]!.battle_id, GEO_RUN_TURN_SECONDS + 1],
        );
        const nextUp = tokenOf(late) === token ? friend.accessToken : token;
        const nextUpSocket = nextUp === token ? hostSocket : friendSocket2;
        nextUpSocket.drain();
        const after = await playFirstCard(nextUp);
        // The late player's turn is skipped first; then it's the other's (or the boss's, then theirs).
        assert.ok(after.status === 200 || /isn't your turn/.test(after.body.error), JSON.stringify(after.body));
        await nextUpSocket.next(
            (m): m is RunMessage => m.type === "run" && m.run.log.some((e) => e.type === "turnSkipped" && e.actor === late && e.reason === "timeout"),
        );
        step(`a turn whose clock ran out is skipped (${late}), everyone hears it, and play moves on`);
    }

    // A socket opened mid-fight (the app back from the background) gets the fight as it stands.
    const rejoined = openSocket(token);
    const snapshot = await rejoined.next((m): m is RunMessage => m.type === "run" && m.run.run.id === hostRun.id);
    assert.equal(snapshot.run.log.length, 0, "a snapshot, not a turn");
    rejoined.ws.close();
    step("a socket opened mid-fight is sent the shared fight as it stands");

    // A drop just before your turn shortens it to the reconnect window; coming back gives the full turn again.
    hostRun = await viewOf(token);
    for (let i = 0; i < 10 && hostRun.status === "active" && hostRun.currentActor !== hostRun.you; i++) {
        await playFirstCard(tokenOf(hostRun.currentActor!));
        hostRun = await viewOf(token);
    }
    if (hostRun.status === "active" && hostRun.currentActor === hostRun.you) {
        friendSocket2.ws.close();
        await friendSocket2.closed;
        // Gone once the grace is up (a quick reconnect wouldn't count).
        await new Promise((resolve) => setTimeout(resolve, OFFLINE_GRACE_MS + 1500));
        const handedOver = await playFirstCard(token);
        assert.equal(handedOver.status, 200, JSON.stringify(handedOver.body));
        hostRun = await viewOf(token);
        if (hostRun.status === "active" && hostRun.currentActor === friendRun.you && hostRun.turnDeadline) {
            const shortened = Date.parse(hostRun.turnDeadline);
            hostSocket.drain();
            friendSocket2 = openSocket(friend.accessToken);
            await friendSocket2.next(isType("ready"));
            const restored = await hostSocket.next(
                (m): m is RunMessage => m.type === "run" && m.run.run.turnDeadline !== null && Date.parse(m.run.run.turnDeadline) > shortened,
            );
            assert.ok(Date.parse(restored.run.run.turnDeadline!) - shortened >= 1000, "back to the full turn");
            step("dropped just before their turn, the friend got a shorter one; reconnecting gave the full turn back, and the host heard");
        } else {
            step("(restored turn skipped: the fight didn't hand straight to the friend)");
        }
    }

    /** Plays the fight out: whoever's turn it is plays their first card; the friend may be gone (turns skip). How the host's ended. */
    async function fightItOut(hostRunId: string) {
        for (let turn = 0; turn < 200; turn++) {
            const view = (await call<GeoRunResponse | null>("GET", GEO_API_PATHS.runs.active, token)).body?.run;
            if (!view?.currentActor) break;
            const tried = await playFirstCard(tokenOf(view.currentActor));
            if (tried.status !== 200 && !/isn't your turn/.test(tried.body.error)) assert.fail(JSON.stringify(tried.body));
        }
        const { rows } = await pool.query<{ status: string; rewards: unknown }>(`SELECT status, rewards FROM geo.runs WHERE id = $1`, [hostRunId]);
        return rows[0]!;
    }

    // A real drop: the friend's socket closes on their turn; after the reconnect window their turns skip.
    hostRun = await viewOf(token);
    for (let i = 0; i < 10 && hostRun.status === "active" && hostRun.currentActor === hostRun.you; i++) {
        await playFirstCard(token);
        hostRun = await viewOf(token);
    }
    if (hostRun.status === "active" && hostRun.currentActor !== hostRun.you) {
        hostSocket.drain();
        friendSocket2.ws.close();
        await hostSocket.next(
            (m): m is RunMessage => m.type === "run" && m.run.log.some((e) => e.type === "turnSkipped" && e.reason === "offline"),
            (GEO_DUNGEON_RECONNECT_SECONDS + 10) * 1000,
        );
        step(`the friend dropped on their turn: after ${GEO_DUNGEON_RECONNECT_SECONDS} s it was skipped (offline), and the host heard`);
    }

    const fought = await fightItOut(hostRun.id);
    assert.notEqual(fought.status, "active");
    const dungeonNow = (await call<GeoDungeonRunResponse>("GET", paths.one.replace(":dungeonRunId", door.id), token)).body.dungeonRun;
    if (fought.status === "victory") {
        assert.equal(dungeonNow.status, "won");
        assert.ok(fought.rewards, "the host's own boss rewards");
        assert.ok(dungeonNow.chestSelectionId, "and the party's chests");
    } else {
        assert.equal(dungeonNow.status, "failed");
    }
    step(`the shared fight played out: ${fought.status}; the host's dungeon is ${dungeonNow.status}`);

    // Everyone standing at the end gets their own: boss drops from their own roll, and their own chests.
    const ends = await pool.query<{ player_id: string; status: string; rewards: { coins: number } | null }>(
        `SELECT player_id, status, rewards FROM geo.runs WHERE battle_id = $1`,
        [runs.rows[0]!.battle_id],
    );
    const members = await pool.query<{ player_id: string; status: string; chest: string | null }>(
        `SELECT player_id, status, state->>'chestSelectionId' AS chest FROM geo.dungeon_run_members WHERE dungeon_run_id = $1`,
        [door.id],
    );
    const winners = members.rows.filter((m) => m.status === "won");
    for (const winner of winners) {
        assert.ok(winner.chest, "a winner's own chest selection");
        assert.ok(ends.rows.find((r) => r.player_id === winner.player_id)?.rewards, "and their own boss rewards");
    }
    assert.equal(new Set(winners.map((w) => w.chest)).size, winners.length, "one chest selection each");
    const friendDungeon = (await call<GeoDungeonRunResponse>("GET", paths.one.replace(":dungeonRunId", door.id), friend.accessToken)).body.dungeonRun;
    assert.deepEqual(
        new Set(friendDungeon.party.map((m) => m.status)),
        new Set(members.rows.map((m) => m.status)),
        "the friend's result card sees how everyone ended",
    );
    step(`${winners.length} winner(s), each with their own boss rewards and chest selection`);
    await leaveIfIn(friend.accessToken);
    await leaveIfIn(token);
} finally {
    await stop();
}

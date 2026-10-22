import type { GeoChestTier } from "@geo/shared";

/**
 * Dungeon maps: hand-drawn layouts (`data/dungeon-layouts/`) rolled into
 * the rooms of one run. Pure: no database, no content import.
 *
 * A layout's `map` is ASCII on a grid where rooms sit on every other column
 * and line, and the gaps between them hold doors:
 *
 *     1-a-a   2      a letter  = a room (the same letter touching itself = one room)
 *     |   |   |      a digit   = a slot, filled each run by `place` or the pool
 *     3   c-c-c-W    - and |   = a door between two cells
 *     |   |          a space   = a wall
 *     s-s-E
 *
 * Rolling a layout picks a slot for each `place` rule, fills the leftover
 * slots from the dungeon's pool, and may mirror it left to right (never top
 * to bottom: the entrance stays at the bottom). `layoutProblems` tries every
 * placement combination so a broken roll fails the boot, not a run.
 */

export const DUNGEON_ROOM_KINDS = ["entrance", "encounter", "star", "miniboss", "puzzle", "loot", "event", "boss", "empty"] as const;
export type DungeonRoomKind = (typeof DUNGEON_ROOM_KINDS)[number];

/** Kinds that only `place` rules or the drawing can put down. */
export const NOT_IN_POOL: readonly DungeonRoomKind[] = ["entrance", "star", "miniboss", "boss"];
/** Kinds a key wing can't hold: everyone must be able to reach them, and wing rooms score nothing. */
export const NOT_IN_WING: readonly DungeonRoomKind[] = ["entrance", "star", "miniboss", "boss", "puzzle"];
/** Kinds you can walk through before they're done. */
export const PASSABLE_KINDS: readonly DungeonRoomKind[] = ["entrance", "loot", "event", "empty"];

/** What a room is: its kind, plus optional name, outline style and lock. */
export type DungeonRoomSpecDef = {
    kind: DungeonRoomKind;
    name: string | null;
    /** A `data/room-styles/` id; null = the layout's or dungeon's. */
    style: string | null;
    /** The item id of the key that opens it; null = not locked. */
    lock: string | null;
};

/** A legend entry, place rule or pool entry: a kind, a named room of the dungeon, or a spec. */
export type DungeonRoomRef = string | DungeonRoomSpecDef;

export type DungeonPlaceDef = { room: DungeonRoomRef; at: string[]; chance: number };
export type DungeonPoolEntryDef = { room: DungeonRoomRef; weight: number; max: number | null };

/** What a dungeon contributes to rolling its layouts. */
export type DungeonMapRules = {
    id: string;
    stars: number | null;
    minibosses: number;
    roomStyle: string | null;
    rooms: Record<string, DungeonRoomSpecDef>;
    pool: DungeonPoolEntryDef[];
};

export type MapDoor = { a: [number, number]; b: [number, number]; dir: "h" | "v"; where: string };

/** A layout's drawing, parsed once at boot. */
export type ParsedMap = {
    cols: number;
    rows: number;
    /** `grid[y][x]`: the room character in that cell, or null for none. */
    grid: (string | null)[][];
    doors: MapDoor[];
    /** Misplaced characters; the boot reports these. */
    problems: string[];
};

export type DungeonLayoutDef = {
    id: string;
    dungeon: string;
    map: ParsedMap;
    legend: Record<string, DungeonRoomRef>;
    place: DungeonPlaceDef[];
    roomStyle: string | null;
    /** Whether a run may flip it left to right. */
    mirror: boolean;
};

export type MapRoom = {
    /** Index in `rooms`. */
    id: number;
    /** Its character on the map. */
    key: string;
    /** Its digit, when it's a slot. */
    slot: string | null;
    cells: [number, number][];
    kind: DungeonRoomKind;
    name: string | null;
    /** The resolved room-style id, or null when nothing names one. */
    style: string | null;
    lock: string | null;
    /** The locked rooms whose wing it's in (its own id too, when it's the locked room). */
    wingOf: number[];
    /** How it got its contents. */
    source: "drawn" | "placed" | "pool" | "unfilled";
};

/** One rolled run's map. */
export type DungeonMap = {
    layoutId: string;
    mirrored: boolean;
    cols: number;
    rows: number;
    rooms: MapRoom[];
    /** Doors between different rooms; `rooms` names the two room ids. */
    doors: (MapDoor & { rooms: [number, number] })[];
    /** Room ids each room has a door to. */
    adjacent: number[][];
    entrance: number;
};

/** Chooses one of `count` free slots for a place rule, or -1 to leave it out (only when `canSkip`). */
export type SlotPicker = (rule: number, count: number, canSkip: boolean, chance: number) => number;

const isSlot = (ch: string) => /^[0-9]$/.test(ch);

/** Parses a layout's ASCII drawing. Leading indentation and blank edge lines are ignored. */
export function parseLayoutMap(text: string): ParsedMap {
    const problems: string[] = [];
    let lines = text.replace(/\t/g, "  ").split("\n");
    while (lines.length > 0 && !lines[0]!.trim()) lines.shift();
    while (lines.length > 0 && !lines[lines.length - 1]!.trim()) lines.pop();
    if (lines.length === 0) return { cols: 0, rows: 0, grid: [], doors: [], problems: ["map is empty"] };
    const indent = Math.min(...lines.filter((line) => line.trim()).map((line) => line.match(/^ */)![0].length));
    lines = lines.map((line) => line.slice(indent).trimEnd());
    let width = Math.max(...lines.map((line) => line.length));
    if (width % 2 === 0) width += 1;
    lines = lines.map((line) => line.padEnd(width, " "));
    const cols = (width + 1) / 2;
    const rows = Math.ceil(lines.length / 2);
    const grid: (string | null)[][] = Array.from({ length: rows }, () => Array<string | null>(cols).fill(null));
    const doors: MapDoor[] = [];
    lines.forEach((line, y) => {
        [...line].forEach((ch, x) => {
            if (ch === " ") return;
            const where = `line ${y + 1}, column ${x + 1}`;
            const cellRow = y % 2 === 0;
            const cellCol = x % 2 === 0;
            if (cellRow && cellCol) {
                if (/^[A-Za-z0-9]$/.test(ch)) grid[y / 2]![x / 2] = ch;
                else problems.push(`map ${where}: "${ch}" sits where a room goes; rooms are letters or digits`);
            } else if (cellRow && ch === "-") {
                doors.push({ a: [(x - 1) / 2, y / 2], b: [(x + 1) / 2, y / 2], dir: "h", where });
            } else if (!cellRow && cellCol && ch === "|") {
                doors.push({ a: [x / 2, (y - 1) / 2], b: [x / 2, (y + 1) / 2], dir: "v", where });
            } else {
                problems.push(`map ${where}: "${ch}" is in a gap; rooms sit on every other column and line, and only "-" or "|" go between them`);
            }
        });
    });
    return { cols, rows, grid, doors, problems };
}

/** The same drawing flipped left to right. */
export function mirrorMap(map: ParsedMap): ParsedMap {
    const flip = (x: number) => map.cols - 1 - x;
    return {
        ...map,
        grid: map.grid.map((row) => [...row].reverse()),
        doors: map.doors.map((door) =>
            door.dir === "h"
                ? { ...door, a: [flip(door.b[0]), door.b[1]], b: [flip(door.a[0]), door.a[1]] }
                : { ...door, a: [flip(door.a[0]), door.a[1]], b: [flip(door.b[0]), door.b[1]] },
        ),
    };
}

/** A legend, place or pool entry as a spec; `problem` says why it can't be, if it can't. */
export function resolveRoom(ref: DungeonRoomRef, rules: DungeonMapRules): { spec: DungeonRoomSpecDef; problem?: string } {
    if (typeof ref !== "string") return { spec: ref };
    const named = rules.rooms[ref];
    if (named) return { spec: named };
    if ((DUNGEON_ROOM_KINDS as readonly string[]).includes(ref)) return { spec: { kind: ref as DungeonRoomKind, name: null, style: null, lock: null } };
    return {
        spec: { kind: "empty", name: null, style: null, lock: null },
        problem: `"${ref}" isn't a room kind (${DUNGEON_ROOM_KINDS.join(", ")}) or one of dungeon "${rules.id}"'s rooms`,
    };
}

type Fill = { pick: SlotPicker; next?: () => number; mirror?: boolean };

/**
 * Builds one run's map. `pick` chooses slots for `place` rules and `next`
 * rolls the pool; without `next`, leftover slots stay "unfilled" (the boot
 * check uses that to judge every combination without rolling the pool).
 * `problems` lists what's wrong with this roll.
 */
export function buildMap(rules: DungeonMapRules, layout: DungeonLayoutDef, fill: Fill): { map: DungeonMap; problems: string[] } {
    const problems: string[] = [];
    const parsed = fill.mirror ? mirrorMap(layout.map) : layout.map;
    const { grid, cols, rows } = parsed;

    // Rooms: cells joined to their same-character neighbours.
    const cellRoom: (number | null)[][] = grid.map((row) => row.map(() => null));
    const rooms: MapRoom[] = [];
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            const ch = grid[y]![x];
            if (!ch || cellRoom[y]![x] !== null) continue;
            const room: MapRoom = { id: rooms.length, key: ch, slot: isSlot(ch) ? ch : null, cells: [], kind: "empty", name: null, style: null, lock: null, wingOf: [], source: "unfilled" };
            const stack: [number, number][] = [[x, y]];
            cellRoom[y]![x] = room.id;
            while (stack.length > 0) {
                const [cx, cy] = stack.pop()!;
                room.cells.push([cx, cy]);
                for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
                    const nx = cx + dx;
                    const ny = cy + dy;
                    if (grid[ny]?.[nx] === ch && cellRoom[ny]![nx] === null) {
                        cellRoom[ny]![nx] = room.id;
                        stack.push([nx, ny]);
                    }
                }
            }
            rooms.push(room);
        }
    }

    const apply = (room: MapRoom, ref: DungeonRoomRef, source: MapRoom["source"], where: string) => {
        const { spec, problem } = resolveRoom(ref, rules);
        if (problem) problems.push(`${where}: ${problem}`);
        Object.assign(room, { kind: spec.kind, name: spec.name, style: spec.style, lock: spec.lock, source });
    };

    const slots = new Map<string, MapRoom>();
    for (const room of rooms) {
        if (room.slot) {
            if (slots.has(room.slot)) problems.push(`slot ${room.slot} is drawn in two separate places`);
            else slots.set(room.slot, room);
        } else if (room.key in layout.legend) apply(room, layout.legend[room.key]!, "drawn", `legend "${room.key}"`);
        else problems.push(`"${room.key}" is on the map but not in rooms`);
    }
    for (const key of Object.keys(layout.legend)) {
        if (!rooms.some((room) => room.key === key)) problems.push(`rooms has "${key}", which isn't on the map`);
    }

    layout.place.forEach((rule, index) => {
        const where = `place ${index + 1}`;
        for (const slot of rule.at) if (!slots.has(slot)) problems.push(`${where} names slot ${slot}, which isn't on the map`);
        const free = rule.at.filter((slot) => slots.get(slot)?.source === "unfilled");
        const canSkip = rule.chance < 1;
        if (free.length === 0) {
            if (!canSkip) problems.push(`${where} has no free slot left`);
            return;
        }
        const choice = fill.pick(index, free.length, canSkip, rule.chance);
        if (choice < 0 || choice >= free.length) return;
        apply(slots.get(free[choice]!)!, rule.room, "placed", where);
    });

    const pool = rules.pool.map((entry, index) => {
        const { spec, problem } = resolveRoom(entry.room, rules);
        if (problem) problems.push(`dungeon pool ${index + 1}: ${problem}`);
        return { entry, spec, left: entry.max ?? Infinity };
    });
    if (fill.next) {
        for (const room of slots.values()) {
            if (room.source !== "unfilled") continue;
            const open = pool.filter((option) => option.left > 0 && option.entry.weight > 0 && !NOT_IN_POOL.includes(option.spec.kind));
            const total = open.reduce((sum, option) => sum + option.entry.weight, 0);
            if (total === 0) continue;
            let roll = fill.next() * total;
            const chosen = open.find((option) => (roll -= option.entry.weight) < 0) ?? open[open.length - 1]!;
            chosen.left -= 1;
            Object.assign(room, { kind: chosen.spec.kind, name: chosen.spec.name, style: chosen.spec.style, lock: chosen.spec.lock, source: "pool" });
        }
    }

    for (const room of rooms) room.style = room.style ?? layout.roomStyle ?? rules.roomStyle;

    const adjacent: number[][] = rooms.map(() => []);
    const doors: DungeonMap["doors"] = [];
    for (const door of parsed.doors) {
        const ra = cellRoom[door.a[1]]?.[door.a[0]] ?? null;
        const rb = cellRoom[door.b[1]]?.[door.b[0]] ?? null;
        if (ra === null || rb === null) {
            problems.push(`map ${door.where}: the door leads nowhere`);
            continue;
        }
        if (ra === rb) continue;
        if (!adjacent[ra]!.includes(rb)) {
            adjacent[ra]!.push(rb);
            adjacent[rb]!.push(ra);
        }
        doors.push({ ...door, rooms: [ra, rb] });
    }

    const entrances = rooms.filter((room) => room.kind === "entrance");
    const map: DungeonMap = { layoutId: layout.id, mirrored: !!fill.mirror, cols, rows, rooms, doors, adjacent, entrance: entrances[0]?.id ?? -1 };
    problems.push(...graphProblems(map, rules, entrances.length));
    return { map, problems };
}

function describe(room: MapRoom): string {
    const what = room.name ? `${room.kind} "${room.name}"` : room.kind;
    return room.slot ? `${what} in slot ${room.slot}` : `${what} "${room.key}"`;
}

/** Room ids reachable from the entrance without going through `skip`. */
function reachable(map: DungeonMap, skip = -1): Set<number> {
    const seen = new Set<number>();
    if (map.entrance < 0 || map.entrance === skip) return seen;
    const queue = [map.entrance];
    seen.add(map.entrance);
    while (queue.length > 0) {
        for (const next of map.adjacent[queue.shift()!]!) {
            if (next !== skip && !seen.has(next)) {
                seen.add(next);
                queue.push(next);
            }
        }
    }
    return seen;
}

/** Marks wings on `map` and returns what breaks the dungeon's rules. */
function graphProblems(map: DungeonMap, rules: DungeonMapRules, entranceCount: number): string[] {
    const problems: string[] = [];
    const count = (kind: DungeonRoomKind) => map.rooms.filter((room) => room.kind === kind).length;
    if (entranceCount !== 1) problems.push(`needs exactly one entrance, has ${entranceCount}`);
    const bosses = map.rooms.filter((room) => room.kind === "boss");
    if (bosses.length !== 1) problems.push(`needs exactly one boss room, has ${bosses.length}`);
    for (const boss of bosses) if (boss.cells.length > 1) problems.push(`the boss room must be 1×1, but ${describe(boss)} is ${boss.cells.length} cells`);
    const stars = count("star");
    if (rules.stars !== null && stars !== rules.stars) problems.push(`has ${stars} star room(s); dungeon "${rules.id}" sets stars: ${rules.stars}`);
    const minis = count("miniboss");
    if (minis !== rules.minibosses) problems.push(`has ${minis} gold room(s); dungeon "${rules.id}" sets minibosses: ${rules.minibosses}`);

    const entrance = map.rooms[map.entrance];
    if (entrance) {
        const bottom = Math.max(...map.rooms.flatMap((room) => room.cells.map(([, y]) => y)));
        if (!entrance.cells.some(([, y]) => y === bottom)) problems.push("the entrance must be on the bottom line of the map");
        if (entrance.lock) problems.push("the entrance can't be locked");
    }

    const all = reachable(map);
    if (entrance) for (const room of map.rooms) if (!all.has(room.id)) problems.push(`${describe(room)} can't be reached from the entrance`);

    for (const locked of map.rooms.filter((room) => room.lock && room.kind !== "entrance")) {
        const without = reachable(map, locked.id);
        const wing = map.rooms.filter((room) => all.has(room.id) && !without.has(room.id));
        for (const room of wing) {
            room.wingOf.push(locked.id);
            if (NOT_IN_WING.includes(room.kind)) problems.push(`${describe(room)} is inside the wing behind ${describe(locked)}; wings can't hold an entrance, star, gold room, puzzle or boss`);
        }
    }
    return problems;
}

/** Rolls a layout for a run. `next` is the run's RNG. */
export function rollMap(rules: DungeonMapRules, layout: DungeonLayoutDef, next: () => number): DungeonMap {
    const mirror = layout.mirror && next() < 0.5;
    const pick: SlotPicker = (_rule, count, canSkip, chance) => (canSkip && next() >= chance ? -1 : Math.floor(next() * count));
    return buildMap(rules, layout, { pick, next, mirror }).map;
}

/**
 * Every problem any roll of this layout could have: tries each combination
 * of `place` choices (mirroring changes nothing that's checked). Pool slots
 * are judged by what the pool could put there.
 */
export function layoutProblems(rules: DungeonMapRules, layout: DungeonLayoutDef, cap = 5000): string[] {
    const problems = new Set<string>(layout.map.problems);
    const poolKinds = new Set(rules.pool.map((entry) => resolveRoom(entry.room, rules).spec.kind));
    for (const kind of NOT_IN_POOL) if (poolKinds.has(kind)) problems.add(`dungeon "${rules.id}" pool has a ${kind} room; place those with a place rule`);

    const path: number[] = [];
    for (let combos = 0; combos < cap; combos++) {
        const sizes: number[] = [];
        const { map, problems: found } = buildMap(rules, layout, {
            pick: (rule, count, canSkip) => {
                sizes[rule] = count + (canSkip ? 1 : 0);
                path[rule] ??= 0;
                return path[rule]! >= count ? -1 : path[rule]!;
            },
        });
        found.forEach((problem) => problems.add(problem));
        for (const room of map.rooms) {
            if (room.source !== "unfilled" || room.wingOf.length === 0) continue;
            const risky = [...poolKinds].filter((kind) => NOT_IN_WING.includes(kind));
            if (risky.length > 0) problems.add(`slot ${room.slot} is inside a key wing, and the pool can roll a ${risky.join(" or ")} there`);
        }
        let rule = layout.place.length - 1;
        while (rule >= 0) {
            path[rule] = (path[rule] ?? 0) + 1;
            if (path[rule]! < (sizes[rule] ?? 1)) break;
            path[rule] = 0;
            rule--;
        }
        if (rule < 0) return [...problems];
        path.length = layout.place.length;
    }
    problems.add(`has more than ${cap} placement combinations; not all were checked`);
    return [...problems];
}

/** Points each scoring room is worth; a layout's best score is what all of them add up to. */
export const SCORE_POINTS = { room: 1, puzzle: 2, miniboss: 3 } as const;
const OPTIONAL_KINDS: readonly DungeonRoomKind[] = ["encounter", "loot", "event"];

export type DungeonScoreRules = {
    chestScores: { gold: number; ruby: number; void: number };
    penalties: { failedPuzzle: number; death: number };
};

/** What the party has done, by the server's own record. */
export type DungeonProgress = {
    /** Whether a room counts as done for the party (loot and events: any player). */
    done: (room: MapRoom) => boolean;
    puzzleResult: (room: MapRoom) => "solved" | "failed" | null;
    deaths: number;
};

/** The party's 0–100 score and the chest tiers it offers. Rooms in key wings never count. */
export function dungeonScore(map: DungeonMap, progress: DungeonProgress, rules: DungeonScoreRules) {
    let earned = 0;
    let best = 0;
    let failed = 0;
    for (const room of map.rooms) {
        if (room.wingOf.length > 0) continue;
        if (OPTIONAL_KINDS.includes(room.kind)) {
            best += SCORE_POINTS.room;
            if (progress.done(room)) earned += SCORE_POINTS.room;
        } else if (room.kind === "puzzle") {
            best += SCORE_POINTS.puzzle;
            const result = progress.puzzleResult(room);
            if (result === "solved") earned += SCORE_POINTS.puzzle;
            if (result === "failed") failed += 1;
        } else if (room.kind === "miniboss") {
            best += SCORE_POINTS.miniboss;
            if (progress.done(room)) earned += SCORE_POINTS.miniboss;
        }
    }
    const share = best === 0 ? 100 : Math.round((earned / best) * 100);
    const score = Math.max(0, Math.min(100, share - failed * rules.penalties.failedPuzzle - progress.deaths * rules.penalties.death));
    const { gold, ruby, void: voidScore } = rules.chestScores;
    const chests = [
        "plain",
        ...(score >= gold ? ["gold"] : []),
        ...(score >= ruby ? ["ruby"] : []),
        ...(score >= voidScore && failed === 0 ? ["void"] : []),
    ] as GeoChestTier[];
    return { score, earned, best, failedPuzzles: failed, chests };
}

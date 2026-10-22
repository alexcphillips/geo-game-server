/**
 * Seeded randomness for battles. A battle stores its seed and how many numbers
 * it has drawn, so it resumes the same sequence after a round trip through the
 * database, and any Run can be replayed exactly to debug or test it.
 *
 * mulberry32: tiny, fast, and plenty random for game rolls. Not for secrets.
 */
export type Rng = {
    /** A float in [0, 1). */
    next: () => number;
    /** True with probability `chance` (0–1). */
    chance: (chance: number) => boolean;
    /** How many numbers have been drawn in total, for saving. */
    draws: () => number;
};

function mulberry32(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
    };
}

/** An RNG at `seed`, fast-forwarded past `alreadyDrawn` numbers. */
export function createRng(seed: number, alreadyDrawn = 0): Rng {
    const raw = mulberry32(seed);
    for (let i = 0; i < alreadyDrawn; i++) raw();
    let drawn = alreadyDrawn;

    const next = () => {
        drawn += 1;
        return raw();
    };

    return {
        next,
        // A certain or impossible roll draws nothing, so adding a 100% effect
        // doesn't shift every later roll in a battle.
        chance: (chance) => (chance >= 1 ? true : chance <= 0 ? false : next() < chance),
        draws: () => drawn,
    };
}

/** A fresh 32-bit seed for a new battle. */
export function randomSeed(): number {
    return Math.floor(Math.random() * 4_294_967_296) >>> 0;
}

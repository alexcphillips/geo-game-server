import { describe, expect, it } from "vitest";
import { CONTENT } from "../../game/src/content";

/** The game's content (data/, checked) loads in workerd, with no file system: session 2 needs it. */
describe("content in the Workers runtime", () => {
    it("loads and checks every data file", () => {
        expect(Object.keys(CONTENT.cards).length).toBeGreaterThan(10);
        expect(Object.keys(CONTENT.items).length).toBeGreaterThan(100);
        expect(Object.keys(CONTENT.enemies).length).toBeGreaterThan(10);
    });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CONTENT, sellValueOf } from "./index";
import { compactId } from "./build";

describe("recipes", () => {
    const COMPACT_MATERIALS = Object.values(CONTENT.items).flatMap((item) =>
        item.kind === "material" && item.compactOf ? [item.compactOf] : [],
    );

    it("every compact material has its item and its recipe", () => {
        for (const { itemId, ratio } of COMPACT_MATERIALS) {
            const base = CONTENT.items[itemId];
            const compact = CONTENT.items[compactId(itemId)];
            assert.ok(base && compact, itemId);
            assert.equal(compact.kind, "material");
            const recipe = CONTENT.recipes[compactId(itemId)];
            assert.deepEqual(recipe?.inputs, [{ itemId, quantity: ratio }]);
            assert.deepEqual(recipe?.output, { itemId: compact.id, quantity: 1 });
        }
    });

    it("a compact item is worth exactly what it holds", () => {
        for (const { itemId, ratio } of COMPACT_MATERIALS) {
            const base = CONTENT.items[itemId];
            const compact = CONTENT.items[compactId(itemId)];
            assert.ok(base && compact);
            assert.equal(sellValueOf(compact), sellValueOf(base) * ratio);
        }
    });

    it("Silk Spool ×100 makes a Compact Silk Spool", () => {
        assert.equal(CONTENT.items["compact-silk-spool"]?.name, "Compact Silk Spool");
        assert.deepEqual(CONTENT.recipes["compact-silk-spool"]?.inputs, [{ itemId: "silk-spool", quantity: 100 }]);
    });
});

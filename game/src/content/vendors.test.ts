import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CONTENT, npcBuys, sellValueOf } from "./index";

describe("vendors", () => {
    const farmer = CONTENT.vendors.farmer;

    it("the Farmer sells wheat for 5, with no limit, and buys it back for 1", () => {
        assert.ok(farmer);
        const wheat = farmer.sells.find((offer) => offer.itemId === "wheat");
        assert.equal(wheat?.price, 5);
        assert.equal(wheat?.stock, null);
        const item = CONTENT.items.wheat;
        assert.ok(item && npcBuys(item));
        assert.equal(sellValueOf(item), 1);
    });

    it("vendors buy anything with a sell value that isn't Soulbound", () => {
        for (const item of Object.values(CONTENT.items)) {
            assert.equal(npcBuys(item), !item.soulbound && sellValueOf(item) > 0, item.id);
        }
        assert.ok(CONTENT.items.bones && npcBuys(CONTENT.items.bones), "not only farming materials");
    });

    it("never sell anything for less than a vendor pays back for it", () => {
        for (const vendor of Object.values(CONTENT.vendors)) {
            for (const offer of vendor.sells) {
                const item = CONTENT.items[offer.itemId];
                assert.ok(item);
                if (npcBuys(item)) assert.ok(offer.price >= sellValueOf(item), `${vendor.id} ${offer.itemId}`);
            }
        }
    });
});

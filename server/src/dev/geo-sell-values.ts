import { CONTENT, sellValueOf } from "../content";

/**
 * Lists every item's NPC sell value, and which are still the rarity
 * PLACEHOLDER: `npm run geo:sell-values`. Set one by adding `sellValue` to the
 * item's file in data/. No database needed.
 */
const items = Object.values(CONTENT.items);
const unset = items.filter((item) => item.sellValue === undefined);

console.log(`${items.length - unset.length} of ${items.length} items have a hand-set sell value.\n`);
console.log("Still on the rarity placeholder:");
for (const item of unset.sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id))) {
    console.log(`  ${item.kind.padEnd(10)} ${item.id.padEnd(24)} ${item.rarity.padEnd(10)} ${sellValueOf(item)}`);
}

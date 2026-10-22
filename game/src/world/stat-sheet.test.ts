import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CONTENT, GAME_CONFIG } from "../content";
import { playerCombatant } from "../combat/combatants";
import { statOf } from "../engine/stats";
import type { StatModifier } from "../engine/engine.types";
import { statSheet, type StatSheetInput } from "./stat-sheet";

const NO_PET = { stats: [], abilities: [], heldItem: [] };

const input = (overrides: Partial<StatSheetInput> = {}): StatSheetInput => ({
    worn: [],
    talismans: [],
    pet: NO_PET,
    combatLevel: 1,
    globalModifiers: [],
    ...overrides,
});

const line = (sheet: ReturnType<typeof statSheet>, id: string) => {
    const found = sheet.find((entry) => entry.id === id);
    assert.ok(found, `no ${id} line`);
    return found;
};

const source = (sheet: ReturnType<typeof statSheet>, id: string, label: string) =>
    line(sheet, id).sources.find((row) => row.label === label)?.value;

describe("statSheet", () => {
    it("lists every source of a stat, base first", () => {
        const sheet = statSheet(
            input({
                worn: [{ itemId: "cloth-tunic", reforge: null }],
                pet: { stats: [{ stat: "defense", kind: "flat", value: 1 }], abilities: [{ stat: "defense", kind: "flat", value: 2 }], heldItem: [] },
            }),
        );
        const defense = line(sheet, "defense");
        assert.deepEqual(defense.sources.map((row) => row.label), ["Base", "Equipment", "Pet", "Pet Ability"]);
        assert.equal(defense.value, "4");
    });

    it("counts fists only when no weapon is worn", () => {
        assert.ok(source(statSheet(input()), "attack", "Fists"));
        assert.equal(source(statSheet(input({ worn: [{ itemId: "bronze-dagger", reforge: null }] })), "attack", "Fists"), undefined);
    });

    it("matches the fight's combatant for combat stats", () => {
        const loadout = { worn: [{ itemId: "cloth-tunic", reforge: null }], talismans: ["four-leaf-clover"], combatLevel: 7 };
        const mayor: StatModifier[] = [{ stat: "maxHealth", kind: "percent", value: 0.1 }];
        const sheet = statSheet(input({ ...loadout, globalModifiers: mayor }));
        const fighter = playerCombatant(
            {
                name: "",
                equipment: loadout.worn.map((entry) => entry.itemId),
                talismans: loadout.talismans,
                hand: [],
                combatLevel: loadout.combatLevel,
                globalModifiers: mayor,
            },
            CONTENT,
        );
        const asCombatant = { ...fighter, health: 0, maxHealth: 0, statuses: [], guard: 0 } as never;
        assert.equal(line(sheet, "maxHealth").value, `${Math.round(statOf(asCombatant, "maxHealth", CONTENT) * 100) / 100}`);
        assert.equal(line(sheet, "damageDealt").value, "7%");
    });

    it("shows farming multipliers and fishing chances in their own units", () => {
        const sheet = statSheet(input({ globalModifiers: [{ stat: "pestChance", kind: "percent", value: -0.25 }] }));
        assert.equal(line(sheet, "pestChance").value, "×0.75");
        assert.equal(source(sheet, "pestChance", "Mayor"), "-25%");
        assert.equal(line(sheet, "seaCreatureChance").value, `${GAME_CONFIG.fishing.baseOdds.seaCreatureChance * 100}%`);
        assert.equal(line(sheet, "farmingFortune").value, "0");
    });
});

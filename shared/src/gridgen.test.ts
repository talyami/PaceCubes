import { describe, expect, it } from "vitest";
import {
  DIFFICULTY,
  generateGrid,
  pickTargetCubes,
  sumGrid,
} from "../src/index.js";

describe("generateGrid", () => {
  it("is deterministic for the same seed", () => {
    const a = generateGrid(42, 12, 3);
    const b = generateGrid(42, 12, 3);
    expect(a).toEqual(b);
  });

  it("satisfies invariants across 1000 seeds per difficulty row", () => {
    for (const row of DIFFICULTY) {
      for (let i = 0; i < 1000; i++) {
        const seed = (row.round * 100_000 + i) ^ 0xabc;
        const target = pickTargetCubes(seed, row.minCubes, row.maxCubes);
        const grid = generateGrid(seed, target, row.maxHeight);
        expect(sumGrid(grid)).toBe(target);
        for (const r of grid) {
          for (const h of r) {
            expect(h).toBeGreaterThanOrEqual(0);
            expect(h).toBeLessThanOrEqual(row.maxHeight);
          }
        }
        if (target > 3) {
          const occupied = grid.flat().filter((h) => h > 0).length;
          expect(occupied).toBeGreaterThanOrEqual(2);
        }
      }
    }
  });
});

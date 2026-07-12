import { describe, expect, it } from "vitest";
import {
  ANIME_DIFFICULTY,
  MAX_ANIME_TILES,
  difficultyForRound,
  parseGameLevel,
} from "./constants.js";
import { generateGrid, pickTargetCubes, portraitIndex, sumGrid } from "./gridgen.js";

describe("game levels", () => {
  it("parses level ids", () => {
    expect(parseGameLevel(1)).toBe(1);
    expect(parseGameLevel(2)).toBe(2);
    expect(parseGameLevel(3)).toBeNull();
  });

  it("keeps anime difficulty within one-story map capacity", () => {
    for (const row of ANIME_DIFFICULTY) {
      expect(row.maxHeight).toBe(1);
      expect(row.maxCubes).toBeLessThanOrEqual(MAX_ANIME_TILES);
    }
    expect(difficultyForRound(7, 1).maxCubes).toBeLessThanOrEqual(MAX_ANIME_TILES);
  });

  it("generates binary anime grids deterministically", () => {
    for (let i = 0; i < 200; i++) {
      const diff = difficultyForRound((i % 7) + 1, 1);
      const seed = 10_000 + i;
      const target = pickTargetCubes(seed, diff.minCubes, diff.maxCubes);
      const grid = generateGrid(seed, target, 1);
      expect(sumGrid(grid)).toBe(target);
      for (const row of grid) {
        for (const cell of row) {
          expect(cell === 0 || cell === 1).toBe(true);
        }
      }
      expect(portraitIndex(seed, 2, 3)).toBeGreaterThanOrEqual(0);
      expect(portraitIndex(seed, 2, 3)).toBeLessThan(36);
    }
  });
});

import { describe, expect, it } from "vitest";
import { generateGrid, revealOrder, sumGrid } from "../src/index.js";

describe("revealOrder", () => {
  it("covers every cube exactly once, back-to-front, bottom-up", () => {
    const grid = generateGrid(99, 15, 3);
    const order = revealOrder(grid);
    expect(order.length).toBe(sumGrid(grid));

    const seen = new Set<string>();
    for (const [x, y, layer] of order) {
      const key = `${x},${y},${layer}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
      expect(layer).toBeLessThan(grid[y]![x]!);
      expect(layer).toBeGreaterThanOrEqual(0);
    }

    // back-to-front: non-decreasing x+y; within cell bottom-up
    let lastDiag = -1;
    const cellLayers = new Map<string, number[]>();
    for (const [x, y, layer] of order) {
      const diag = x + y;
      expect(diag).toBeGreaterThanOrEqual(lastDiag);
      lastDiag = diag;
      const k = `${x},${y}`;
      const arr = cellLayers.get(k) ?? [];
      arr.push(layer);
      cellLayers.set(k, arr);
    }
    for (const layers of cellLayers.values()) {
      for (let i = 1; i < layers.length; i++) {
        expect(layers[i]!).toBeGreaterThan(layers[i - 1]!);
      }
    }
  });
});

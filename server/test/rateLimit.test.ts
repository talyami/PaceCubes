import { describe, expect, it } from "vitest";
import { TokenBucket, SlidingWindow } from "../src/rateLimit.js";

describe("TokenBucket", () => {
  it("allows burst then refills", async () => {
    const b = new TokenBucket(25, 40);
    let ok = 0;
    for (let i = 0; i < 50; i++) if (b.tryTake()) ok++;
    expect(ok).toBe(40);
    // After ~200ms at 25/s → ~5 tokens
    await new Promise((r) => setTimeout(r, 220));
    let more = 0;
    for (let i = 0; i < 10; i++) if (b.tryTake()) more++;
    expect(more).toBeGreaterThanOrEqual(4);
  });

  it("silently drops when empty (press semantics)", () => {
    const b = new TokenBucket(25, 2);
    expect(b.tryTake()).toBe(true);
    expect(b.tryTake()).toBe(true);
    expect(b.tryTake()).toBe(false);
  });
});

describe("SlidingWindow", () => {
  it("caps events in window", () => {
    const w = new SlidingWindow(60_000, 3);
    expect(w.tryTake()).toBe(true);
    expect(w.tryTake()).toBe(true);
    expect(w.tryTake()).toBe(true);
    expect(w.tryTake()).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { matchWinner, needsSuddenDeath, scoreRound } from "../src/index.js";

describe("scoreRound", () => {
  it("gives +3 to every exact player", () => {
    const r = scoreRound(10, [
      { playerId: "p1", value: 10, lockAt: 100 },
      { playerId: "p2", value: 10, lockAt: 200 },
      { playerId: "p3", value: 11, lockAt: 50 },
    ]);
    expect(r.find((x) => x.playerId === "p1")!.points).toBe(3);
    expect(r.find((x) => x.playerId === "p2")!.points).toBe(3);
    expect(r.find((x) => x.playerId === "p3")!.points).toBe(0);
  });

  it("gives +1 to unique closest when no exact", () => {
    const r = scoreRound(10, [
      { playerId: "p1", value: 12, lockAt: 100 },
      { playerId: "p2", value: 14, lockAt: 50 },
    ]);
    expect(r.find((x) => x.playerId === "p1")!.points).toBe(1);
    expect(r.find((x) => x.playerId === "p1")!.outcome).toBe("closest");
    expect(r.find((x) => x.playerId === "p2")!.points).toBe(0);
  });

  it("breaks error ties by earliest lockAt", () => {
    const r = scoreRound(10, [
      { playerId: "p1", value: 12, lockAt: 200 },
      { playerId: "p2", value: 8, lockAt: 100 },
    ]);
    expect(r.find((x) => x.playerId === "p2")!.points).toBe(1);
    expect(r.find((x) => x.playerId === "p1")!.points).toBe(0);
  });

  it("breaks same-ms ties by playerId order", () => {
    const r = scoreRound(10, [
      { playerId: "p2", value: 12, lockAt: 100 },
      { playerId: "p1", value: 8, lockAt: 100 },
    ]);
    expect(r.find((x) => x.playerId === "p1")!.points).toBe(1);
  });

  it("scores timeout auto-lock (null lockAt) as late", () => {
    const r = scoreRound(10, [
      { playerId: "p1", value: 11, lockAt: null },
      { playerId: "p2", value: 11, lockAt: 50 },
    ]);
    expect(r.find((x) => x.playerId === "p2")!.points).toBe(1);
    expect(r.find((x) => x.playerId === "p1")!.points).toBe(0);
  });
});

describe("matchWinner", () => {
  it("returns all tied winners", () => {
    expect(
      matchWinner([
        { playerId: "p1", score: 5 },
        { playerId: "p2", score: 5 },
        { playerId: "p3", score: 3 },
      ]),
    ).toEqual(["p1", "p2"]);
    expect(
      needsSuddenDeath([
        { playerId: "p1", score: 5 },
        { playerId: "p2", score: 5 },
      ]),
    ).toBe(true);
  });
});

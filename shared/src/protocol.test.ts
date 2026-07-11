import { describe, expect, it } from "vitest";
import {
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
} from "../src/index.js";

describe("room code contract", () => {
  it("uses exactly two numeric digits", () => {
    expect(ROOM_CODE_LENGTH).toBe(2);
    expect(ROOM_CODE_ALPHABET).toBe("0123456789");
    expect("00").toMatch(/^\d{2}$/);
    expect("99").toMatch(/^\d{2}$/);
    expect("7").not.toMatch(/^\d{2}$/);
    expect("A7").not.toMatch(/^\d{2}$/);
  });
});

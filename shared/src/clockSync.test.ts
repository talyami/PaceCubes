import { describe, expect, it } from "vitest";

/**
 * Latency harness (BRD §8 / §12.2): min-RTT offset estimator keeps
 * scheduled local flash times aligned across skewed clients.
 */
function estimateOffset(
  samples: { t0: number; t1: number; t3: number }[],
): number {
  let bestRtt = Infinity;
  let offset = 0;
  for (const s of samples) {
    const rtt = s.t3 - s.t0;
    const off = s.t1 - (s.t0 + s.t3) / 2;
    if (rtt < bestRtt) {
      bestRtt = rtt;
      offset = off;
    }
  }
  return offset;
}

/** Returns estimated server-clock instant when this client would fire. */
function simulatedServerFireInstant(
  clientSkewMs: number,
  uplinkDelay: number,
  downlinkDelay: number,
  flashAtServer: number,
): number {
  const baseServer = 1_000_000;
  const baseClient = baseServer + clientSkewMs;
  const samples = [];
  for (let i = 0; i < 5; i++) {
    const t0 = baseClient + i * 150;
    const t1 = baseServer + i * 150 + uplinkDelay;
    const t3 = t0 + uplinkDelay + downlinkDelay;
    samples.push({ t0, t1, t3 });
  }
  const offset = estimateOffset(samples);
  const localFlashAt = flashAtServer - offset;
  return localFlashAt - clientSkewMs;
}

describe("clock sync latency harness", () => {
  it("aligns clients with ±700 ms clock skew under symmetric delay", () => {
    const flashAt = 1_700_000;
    const fireA = simulatedServerFireInstant(-700, 80, 80, flashAt);
    const fireB = simulatedServerFireInstant(700, 80, 80, flashAt);
    expect(Math.abs(fireA - fireB)).toBeLessThan(50);
    expect(Math.abs(fireA - flashAt)).toBeLessThan(50);
  });

  it("stays within 50 ms of truth under mild asymmetric delay (+30/+80)", () => {
    const flashAt = 1_700_000;
    const fireA = simulatedServerFireInstant(-700, 30, 80, flashAt);
    const fireB = simulatedServerFireInstant(700, 30, 80, flashAt);
    expect(Math.abs(fireA - flashAt)).toBeLessThan(50);
    expect(Math.abs(fireB - flashAt)).toBeLessThan(50);
    expect(Math.abs(fireA - fireB)).toBeLessThan(50);
  });
});

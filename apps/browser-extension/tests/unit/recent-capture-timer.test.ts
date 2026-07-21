import { describe, expect, it } from "vitest";
import { recentCaptureTimerProgress } from "../../src/ui/recent-capture-timer";

describe("recent capture timer", () => {
  it("fills over eight seconds and reports remaining time", () => {
    expect(recentCaptureTimerProgress({ elapsedMs: 0 })).toEqual({
      elapsedMs: 0,
      remainingMs: 8_000,
      ratio: 0,
      expired: false,
    });
    expect(recentCaptureTimerProgress({ elapsedMs: 4_000 })).toEqual({
      elapsedMs: 4_000,
      remainingMs: 4_000,
      ratio: 0.5,
      expired: false,
    });
    expect(recentCaptureTimerProgress({ elapsedMs: 8_400 })).toEqual({
      elapsedMs: 8_000,
      remainingMs: 0,
      ratio: 1,
      expired: true,
    });
  });

  it("does not alter elapsed time while paused", () => {
    expect(recentCaptureTimerProgress({ elapsedMs: 2_500, paused: true })).toEqual({
      elapsedMs: 2_500,
      remainingMs: 5_500,
      ratio: 0.3125,
      expired: false,
    });
  });
});

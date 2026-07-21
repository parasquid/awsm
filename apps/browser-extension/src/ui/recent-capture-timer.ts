const RECENT_CAPTURE_DURATION_MS = 8_000;

export interface RecentCaptureTimerProgress {
  readonly elapsedMs: number;
  readonly remainingMs: number;
  readonly ratio: number;
  readonly expired: boolean;
}

export function recentCaptureTimerProgress(input: {
  readonly elapsedMs: number;
  readonly paused?: boolean;
}): RecentCaptureTimerProgress {
  const elapsedMs = Math.min(RECENT_CAPTURE_DURATION_MS, Math.max(0, input.elapsedMs));
  const remainingMs = RECENT_CAPTURE_DURATION_MS - elapsedMs;
  return {
    elapsedMs,
    remainingMs,
    ratio: elapsedMs / RECENT_CAPTURE_DURATION_MS,
    expired: remainingMs === 0,
  };
}

export { RECENT_CAPTURE_DURATION_MS };

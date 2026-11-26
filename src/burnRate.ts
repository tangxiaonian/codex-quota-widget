export interface QuotaSample {
  at: number;
  remaining: number;
}

const MAX_SAMPLES = 24;
const WINDOW_HORIZON_SECONDS = 2 * 3600;
const MIN_SPAN_SECONDS = 180;
const MIN_DROP_PERCENT = 2;

/**
 * Append a measured remaining sample for one quota bucket, resetting history
 * if a quota refill occurs so stale pre-reset points cannot skew burn rate.
 */
export function appendSample(
  existing: QuotaSample[],
  remaining: number | null | undefined,
  at: number,
): QuotaSample[] {
  if (remaining == null || !Number.isFinite(remaining)) {
    return existing;
  }
  const recent = existing.filter(
    (s) => at - s.at <= WINDOW_HORIZON_SECONDS && s.at <= at,
  );
  const last = recent.at(-1);
  if (last) {
    if (at <= last.at) return recent;
    // A noticeable jump upward means the window reset or a credit was redeemed.
    if (remaining > last.remaining + 1) {
      return [{ at, remaining }];
    }
  }
  const next = [...recent, { at, remaining }];
  return next.length > MAX_SAMPLES ? next.slice(next.length - MAX_SAMPLES) : next;
}

/**
 * Project when a declining window will reach 0% at the observed pace.
 * Returns a Unix timestamp only when depletion precedes the window reset.
 */
export function estimateDepletion(
  samples: QuotaSample[],
  resetsAt: number | null | undefined,
  now: number,
): number | null {
  if (samples.length < 2 || resetsAt == null || resetsAt <= now) {
    return null;
  }
  const first = samples[0];
  const last = samples[samples.length - 1];
  if (last.remaining <= 0) {
    return null;
  }
  const span = last.at - first.at;
  const drop = first.remaining - last.remaining;
  if (span < MIN_SPAN_SECONDS || drop < MIN_DROP_PERCENT) {
    return null;
  }
  const ratePerSecond = drop / span;
  const secondsLeft = last.remaining / ratePerSecond;
  const eta = Math.round(last.at + secondsLeft);
  if (!Number.isFinite(eta) || eta <= now || eta >= resetsAt) {
    return null;
  }
  return eta;
}

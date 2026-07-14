export interface SmoothingOption {
  label: string;
  windowSeconds: number;
}

export const SMOOTHING_OPTIONS: SmoothingOption[] = [
  { label: "Raw", windowSeconds: 0 },
  { label: "30s", windowSeconds: 30 },
  { label: "2m", windowSeconds: 120 }
];

/**
 * Centered (acausal) moving average over a time window. Streams are indexed by the
 * activity's time stream (seconds), which may be non-uniformly sampled: each output
 * sample averages the finite values whose timestamp falls in [t - w/2, t + w/2].
 * Non-finite samples pass through untouched so nulls stay gaps in charts.
 */
export function smoothStream(timeStream: number[], values: number[], windowSeconds: number): number[] {
  if (!windowSeconds || !timeStream?.length || !values?.length) {
    return values;
  }

  const length = Math.min(timeStream.length, values.length);
  const halfWindow = windowSeconds / 2;
  const smoothed = new Array(length);

  let lo = 0;
  let hi = 0;
  let sum = 0;
  let count = 0;

  for (let i = 0; i < length; i++) {
    while (hi < length && timeStream[hi] <= timeStream[i] + halfWindow) {
      if (Number.isFinite(values[hi])) {
        sum += values[hi];
        count++;
      }
      hi++;
    }
    while (lo < length && timeStream[lo] < timeStream[i] - halfWindow) {
      if (Number.isFinite(values[lo])) {
        sum -= values[lo];
        count--;
      }
      lo++;
    }
    smoothed[i] = Number.isFinite(values[i]) && count > 0 ? sum / count : values[i];
  }

  return smoothed;
}

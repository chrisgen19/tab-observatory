import type { HistoryPoint } from '../../shared/protocol.ts';

export type Series = 'memory' | 'cpu';
export type ChartPoint = { at: number; value: number };
export type Scale = { min: number; max: number; ticks: [number, number, number] };

export function seriesValues(history: HistoryPoint[], series: Series, from: number): ChartPoint[] {
  return history.flatMap(point => {
    if (point.at < from) return [];
    const value = series === 'memory' ? point.rssBytes : point.cpuPercent;
    return value == null ? [] : [{ at: point.at, value }];
  });
}

/** Auto-ranged y scale: 10% padding each side, at least `minSpan` tall, never below zero. */
export function chartScale(values: number[], minSpan: number): Scale {
  if (!values.length) return { min: 0, max: minSpan, ticks: [0, minSpan / 2, minSpan] };
  const low = Math.min(...values), high = Math.max(...values);
  const pad = (high - low) * 0.1;
  let min = low - pad, max = high + pad;
  if (max - min < minSpan) {
    const middle = (low + high) / 2;
    min = middle - minSpan / 2;
    max = middle + minSpan / 2;
  }
  if (min < 0) { max -= min; min = 0; }
  return { min, max, ticks: [min, (min + max) / 2, max] };
}

export function chartPath(
  points: ChartPoint[], scale: { min: number; max: number },
  window: { from: number; to: number }, size: { width: number; height: number },
): string {
  const spanX = Math.max(1, window.to - window.from);
  const spanY = Math.max(Number.EPSILON, scale.max - scale.min);
  return points.map((point, i) => {
    const x = ((point.at - window.from) / spanX) * size.width;
    const y = size.height - ((point.value - scale.min) / spanY) * size.height;
    return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
}

export function nearestPoint<T extends { at: number }>(points: T[], at: number): T | null {
  let best: T | null = null;
  for (const point of points) if (!best || Math.abs(point.at - at) < Math.abs(best.at - at)) best = point;
  return best;
}

/** The latest point in each `stepMs` bucket, in time order (the chart's table view). */
export function sampleEvery<T extends { at: number }>(points: T[], stepMs: number): T[] {
  const buckets = new Map<number, T>();
  for (const point of points) buckets.set(Math.floor(point.at / stepMs), point);
  return [...buckets.values()];
}

/** The last `windowMs`, or from the first sample when there is less history than that. */
export function chartWindow(points: { at: number }[], now: number, windowMs: number): { from: number; to: number } {
  return { from: Math.max(now - windowMs, points[0]?.at ?? now - windowMs), to: now };
}

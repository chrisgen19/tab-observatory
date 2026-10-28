import { chartPath, chartScale, type ChartPoint } from '../lib/chart.ts';

const WIDTH = 120;
const HEIGHT = 32;

/** Decorative trend line; the strip's delta text carries the information. */
export function Sparkline({ points, from, to }: { points: ChartPoint[]; from: number; to: number }) {
  if (points.length < 2) return null;
  const scale = chartScale(points.map(p => p.value), 64 * 1024 ** 2);
  return (
    <svg aria-hidden="true" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" className="h-8 w-28">
      <path
        d={chartPath(points, scale, { from, to }, { width: WIDTH, height: HEIGHT })}
        fill="none" className="stroke-brand-line" strokeWidth={2} vectorEffect="non-scaling-stroke"
        strokeLinejoin="round" strokeLinecap="round"
      />
    </svg>
  );
}

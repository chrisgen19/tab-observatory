import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { chartPath, nearestPoint, type ChartPoint, type Scale } from '../lib/chart.ts';
import { formatSpan } from '../../shared/format.ts';

const HEIGHT = 180;
const PAD = { left: 64, right: 12, top: 10, bottom: 24 };

type Props = {
  points: ChartPoint[];
  scale: Scale;
  from: number;
  to: number;
  format(value: number): string;
  threshold: number | null;
  label: string;
};

/** Line plot drawn at its real pixel width, with a snapping crosshair and tooltip. */
export function ChartPlot({ points, scale, from, to, format, threshold, label }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState<ChartPoint | null>(null);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(200, entry.contentRect.width)));
    if (box.current) observer.observe(box.current);
    return () => observer.disconnect();
  }, []);

  const plotW = width - PAD.left - PAD.right, plotH = HEIGHT - PAD.top - PAD.bottom;
  const x = (at: number) => PAD.left + ((at - from) / Math.max(1, to - from)) * plotW;
  const y = (value: number) => PAD.top + plotH - ((value - scale.min) / (scale.max - scale.min)) * plotH;
  const onMove = (event: PointerEvent<SVGSVGElement>) => {
    const left = event.currentTarget.getBoundingClientRect().left;
    setHover(nearestPoint(points, from + ((event.clientX - left - PAD.left) / plotW) * (to - from)));
  };
  const onKey = (event: KeyboardEvent<SVGSVGElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const index = hover ? points.indexOf(hover) : points.length;
    const next = points[Math.min(points.length - 1, Math.max(0, index + (event.key === 'ArrowLeft' ? -1 : 1)))];
    setHover(next ?? null);
  };
  const path = chartPath(points, scale, { from, to }, { width: plotW, height: plotH });

  return (
    <div ref={box} className="relative">
      <svg
        width={width} height={HEIGHT} role="img" aria-label={label} tabIndex={0}
        onPointerMove={onMove} onPointerLeave={() => setHover(null)} onKeyDown={onKey} onBlur={() => setHover(null)}
        className="block touch-none text-muted outline-none focus-visible:ring-2 focus-visible:ring-brand-line"
      >
        {scale.ticks.map(tick => (
          <g key={tick}>
            <line x1={PAD.left} x2={width - PAD.right} y1={y(tick)} y2={y(tick)} className="stroke-line-soft" />
            <text x={PAD.left - 8} y={y(tick)} dy="0.32em" textAnchor="end" className="fill-current text-[10px] tabular-nums">{format(tick)}</text>
          </g>
        ))}
        <text x={PAD.left} y={HEIGHT - 6} className="fill-current text-[10px]">{formatSpan(to - from)} ago</text>
        <text x={width - PAD.right} y={HEIGHT - 6} textAnchor="end" className="fill-current text-[10px]">now</text>
        {threshold != null && (
          <g>
            <line x1={PAD.left} x2={width - PAD.right} y1={y(threshold)} y2={y(threshold)} strokeDasharray="4 4" className="stroke-amber-bar" />
            <text x={width - PAD.right} y={y(threshold) - 4} textAnchor="end" className="fill-amber text-[10px]">Alert {format(threshold)}</text>
          </g>
        )}
        <path d={path} transform={`translate(${PAD.left} ${PAD.top})`} fill="none" strokeWidth={2}
          strokeLinejoin="round" strokeLinecap="round" className="stroke-brand-line" />
        {hover && (
          <g>
            <line x1={x(hover.at)} x2={x(hover.at)} y1={PAD.top} y2={PAD.top + plotH} className="stroke-muted" />
            <circle cx={x(hover.at)} cy={y(hover.value)} r={4} strokeWidth={2} className="fill-brand-line stroke-paper" />
          </g>
        )}
      </svg>
      {hover && (
        <div
          role="status" className="pointer-events-none absolute top-0 rounded-md border border-line bg-paper px-2 py-1 text-[11px] shadow-sm"
          style={{ left: Math.min(Math.max(0, x(hover.at) - 60), width - 120), width: 120 }}
        >
          <div className="text-muted">{new Date(hover.at).toLocaleTimeString()}</div>
          <div className="font-semibold tabular-nums">{format(hover.value)}</div>
        </div>
      )}
    </div>
  );
}

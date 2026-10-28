import { useState } from 'react';
import type { HistoryPoint } from '../../shared/protocol.ts';
import { formatBytes, formatPercent, formatSpan } from '../../shared/format.ts';
import { chartScale, chartWindow, sampleEvery, seriesValues, type Series } from '../lib/chart.ts';
import { ChartPlot } from './chart-plot.tsx';

const WINDOW_MS = 15 * 60 * 1000;
const MIN_SPAN: Record<Series, number> = { memory: 64 * 1024 ** 2, cpu: 5 };
const FORMAT: Record<Series, (value: number) => string> = { memory: formatBytes, cpu: formatPercent };
const NAME: Record<Series, string> = { memory: 'Chrome resident memory', cpu: 'Chrome CPU' };

type Props = { history: HistoryPoint[]; thresholdMb: number; now: number };

/** One series at a time (Memory or CPU), never two y-axes. */
export function MemoryChart({ history, thresholdMb, now }: Props) {
  const [series, setSeries] = useState<Series>('memory');
  const points = seriesValues(history, series, now - WINDOW_MS);
  const { from } = chartWindow(points, now, WINDOW_MS);
  const format = FORMAT[series];
  const scale = chartScale(points.map(p => p.value), MIN_SPAN[series]);
  const thresholdBytes = thresholdMb * 1024 ** 2;
  const threshold = series === 'memory' && thresholdBytes >= scale.min && thresholdBytes <= scale.max ? thresholdBytes : null;
  const latest = points.at(-1);
  const label = `${NAME[series]} over the last ${formatSpan(now - from)}${latest ? `, now ${format(latest.value)}` : ''}`;

  return (
    <section aria-label="History chart" className="mb-4 rounded-xl border border-line bg-paper px-4 py-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">{NAME[series]}</h2>
        <div role="group" aria-label="Chart series" className="flex gap-1 text-xs">
          {(['memory', 'cpu'] as const).map(option => (
            <button
              key={option} type="button" aria-pressed={series === option} onClick={() => setSeries(option)}
              className={`rounded-md px-2.5 py-1 font-semibold ${series === option ? 'bg-line-soft text-ink' : 'text-muted hover:text-ink'}`}
            >
              {option === 'memory' ? 'Memory' : 'CPU'}
            </button>
          ))}
        </div>
      </div>
      {points.length < 2
        ? <p className="py-10 text-center text-xs text-muted">Collecting samples…</p>
        : <ChartPlot points={points} scale={scale} from={from} to={now} format={format} threshold={threshold} label={label} />}
      {points.length > 0 && (
        <details className="mt-1 text-xs text-muted">
          <summary className="cursor-pointer">View as table</summary>
          <table className="mt-2 w-full max-w-xs text-left tabular-nums">
            <thead><tr><th className="font-semibold">Time</th><th className="font-semibold">{series === 'memory' ? 'Memory' : 'CPU'}</th></tr></thead>
            <tbody>
              {sampleEvery(points, 60000).map(point => (
                <tr key={point.at}><td>{new Date(point.at).toLocaleTimeString()}</td><td>{format(point.value)}</td></tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </section>
  );
}

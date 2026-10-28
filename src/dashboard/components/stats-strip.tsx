import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { DashboardState } from '../../shared/protocol.ts';
import { formatBytes, formatDelta, formatPercent } from '../../shared/format.ts';
import { chartWindow, seriesValues } from '../lib/chart.ts';
import { Sparkline } from './sparkline.tsx';
import { MemoryChart } from './memory-chart.tsx';

const WINDOW_MS = 15 * 60 * 1000;

function Stat({ label, value, large }: { label: string; value: string; large?: boolean }) {
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted">{label}</div>
      <div className={`tabular-nums ${large ? 'text-2xl font-semibold' : 'text-base'}`}>{value}</div>
    </div>
  );
}

export function StatsStrip({ state }: { state: DashboardState }) {
  const [expanded, setExpanded] = useState(false);
  const sampled = !!state.at;
  const now = state.at ?? Date.now();
  const recent = state.history.filter(point => now - point.at < WINDOW_MS);
  const { from } = chartWindow(recent, now, WINDOW_MS);
  return (
    <>
      <section aria-label="Chrome totals" className="mb-4 flex flex-wrap items-end gap-x-7 gap-y-3 rounded-xl border border-line bg-paper px-4 py-3">
        <Stat large label="Chrome total" value={sampled ? formatBytes(state.total.rssBytes) : '—'} />
        <Stat label="Private" value={sampled ? formatBytes(state.total.privateBytes) : '—'} />
        <Stat label="CPU" value={sampled ? formatPercent(state.total.cpuPercent) : '—'} />
        <Stat label="Not in any tab" value={sampled ? formatBytes(state.ranking.notInAnyTabBytes) : '—'} />
        <button
          type="button" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}
          aria-label={expanded ? 'Hide chart' : 'Show chart'}
          className="ml-auto flex items-center gap-2 rounded-md px-2 py-1 text-xs text-muted hover:bg-line-soft"
        >
          {sampled && <Sparkline points={seriesValues(recent, 'memory', from)} from={from} to={now} />}
          <span className="tabular-nums">{sampled ? formatDelta(recent) : ''}</span>
          <ChevronDown size={14} aria-hidden="true" className={expanded ? 'rotate-180' : undefined} />
        </button>
      </section>
      {expanded && <MemoryChart history={state.history} thresholdMb={state.settings.thresholdMb} now={now} />}
    </>
  );
}

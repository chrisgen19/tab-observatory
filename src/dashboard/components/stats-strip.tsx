import type { DashboardState } from '../../shared/protocol.ts';
import { formatBytes, formatDelta, formatPercent } from '../../shared/format.ts';

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
  const sampled = !!state.at;
  const now = state.at ?? Date.now();
  const recent = state.history.filter(point => now - point.at < WINDOW_MS);
  return (
    <section aria-label="Chrome totals" className="mb-4 flex flex-wrap items-end gap-x-7 gap-y-3 rounded-xl border border-line bg-paper px-4 py-3">
      <Stat large label="Chrome total" value={sampled ? formatBytes(state.total.rssBytes) : '—'} />
      <Stat label="Private" value={sampled ? formatBytes(state.total.privateBytes) : '—'} />
      <Stat label="CPU" value={sampled ? formatPercent(state.total.cpuPercent) : '—'} />
      <Stat label="Not in any tab" value={sampled ? formatBytes(state.ranking.notInAnyTabBytes) : '—'} />
      <p className="ml-auto text-xs text-muted tabular-nums">{sampled ? formatDelta(recent) : ''}</p>
    </section>
  );
}

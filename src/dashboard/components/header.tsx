import { Pause, Play, RefreshCw, Settings } from 'lucide-react';
import type { DashboardState } from '../../shared/protocol.ts';

type Props = {
  state: DashboardState | null;
  connected: boolean;
  companionOffline: boolean;
  onToggle(): void;
  onRescan(): void;
  onSettings(): void;
};

function statusText(state: DashboardState | null, connected: boolean, companionOffline: boolean) {
  if (!connected || !state) return 'Connecting…';
  if (!state.running) return 'Paused';
  if (state.at) return '● Live';
  return companionOffline ? 'Companion offline' : 'Connecting…';
}

export function Header({ state, connected, companionOffline, onToggle, onRescan, onSettings }: Props) {
  const running = !!state?.running;
  const live = running && !!state?.at && connected;
  const progress = state?.scanProgress;
  return (
    <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2.5">
        <span aria-hidden="true" className="text-2xl text-brand-line">◉</span>
        <h1 className="text-lg font-semibold tracking-tight">Tab Observatory</h1>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <p role="status" aria-live="polite" className="flex items-center gap-2 text-xs text-muted">
          <span className={live ? 'text-brand-line' : undefined}>{statusText(state, connected, companionOffline)}</span>
          {progress && <span>Mapping {progress.current} of {progress.total}…</span>}
        </p>
        <button
          type="button" onClick={onRescan} disabled={!running || !connected}
          aria-label="Rescan tabs" title="Rescan tabs"
          className="rounded-md p-2 text-muted hover:bg-line-soft hover:text-ink disabled:opacity-40"
        >
          <RefreshCw size={16} aria-hidden="true" />
        </button>
        <button
          type="button" onClick={onSettings} aria-label="Settings" title="Settings"
          className="rounded-md p-2 text-muted hover:bg-line-soft hover:text-ink"
        >
          <Settings size={16} aria-hidden="true" />
        </button>
        <button
          type="button" onClick={onToggle} disabled={!connected || !state}
          className={`flex items-center gap-1.5 rounded-md border px-3 py-2 text-xs font-semibold disabled:opacity-40 ${
            running ? 'border-line bg-paper text-ink hover:bg-line-soft' : 'border-brand bg-brand text-white hover:opacity-90'}`}
        >
          {running ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
          {running ? 'Pause monitoring' : 'Start monitoring'}
        </button>
      </div>
    </header>
  );
}

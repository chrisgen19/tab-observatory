import { useState } from 'react';
import type { CommandInput } from '../shared/protocol.ts';
import { useDashboardPort } from './hooks/use-dashboard-port.ts';
import { useTheme } from './hooks/use-theme.ts';
import { describeHostError } from './lib/host-status.ts';
import { Header } from './components/header.tsx';
import { StatsStrip } from './components/stats-strip.tsx';
import { SetupPanel } from './components/setup-panel.tsx';
import { StatusNotice } from './components/status-notice.tsx';
import { AboutNumbers } from './components/about-numbers.tsx';
import { TabList } from './components/tab-list.tsx';

export function App() {
  const { state, connected, send } = useDashboardPort();
  const [actionError, setActionError] = useState<string | null>(null);
  useTheme(state?.settings.theme);

  const run = async (command: CommandInput) => {
    setActionError(null);
    try { return await send(command); }
    catch (error) { setActionError((error as Error).message); }
  };

  const host = describeHostError(state?.hostError ?? '');
  return (
    <main className="mx-auto max-w-[1200px] px-4 py-6 sm:px-8">
      <Header
        state={state} connected={connected}
        companionOffline={host.kind === 'missing' || host.kind === 'dropped'}
        onToggle={() => run({ type: state?.running ? 'stop' : 'start' })}
        onRescan={() => run({ type: 'rescan' })}
        onSettings={() => {}}
      />
      {state && host.kind === 'missing' && <SetupPanel extensionId={state.extensionId} />}
      <StatusNotice host={host} warnings={state?.warnings ?? []} actionError={actionError} />
      {state && <StatsStrip state={state} />}
      {state?.running ? <TabList state={state} send={send} /> : (
        <section className="rounded-xl border border-line bg-paper px-4 py-10 text-center text-sm text-muted">
          Start monitoring to rank your tabs by the memory closing them would free.
        </section>
      )}
      <AboutNumbers />
    </main>
  );
}

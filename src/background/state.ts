import { associate, totals } from '../shared/model.ts';
import { rankTabs } from '../shared/ranking.ts';
import type { DashboardState } from '../shared/protocol.ts';
import { store } from './store.ts';

/** Companion samples older than this are not shown as live data. */
const FRESH_MS = 12000;

export async function buildState(scanning: boolean): Promise<DashboardState> {
  const { snapshot } = store;
  const fresh = !!snapshot && Date.now() - snapshot.receivedAt < FRESH_MS;
  const processes = fresh ? snapshot!.processes : [];
  const tabs = (await chrome.tabs.query({})).filter(tab => !tab.incognito);
  const associated = associate(tabs, store.mappings, processes);
  return {
    running: store.running, scanning, scanProgress: store.scanProgress, settings: store.settings,
    hostError: !store.running ? '' : store.hostError || (!fresh ? 'Waiting for a fresh companion sample' : ''),
    platform: fresh ? snapshot!.platform : null,
    at: fresh ? snapshot!.at : null,
    warnings: fresh ? snapshot!.warnings : [],
    total: totals(processes), peak: store.peak, history: store.history,
    ...associated,
    ranking: rankTabs(associated.tabs, associated.processes, store.scanningTabId),
    extensionId: chrome.runtime.id,
  };
}

import type { Mapping, ProcessSample } from '../shared/model.ts';
import type { ScanProgress } from './scan-queue.ts';
import type { HistoryPoint } from '../shared/protocol.ts';
import { DEFAULT_SETTINGS, type Settings } from '../shared/settings.ts';

export type Snapshot = { type: 'snapshot'; at: number; platform: string; warnings: string[]; processes: ProcessSample[] };
export type { HistoryPoint } from '../shared/protocol.ts';

export type Store = {
  running: boolean;
  hostError: string;
  snapshot: (Snapshot & { receivedAt: number }) | null;
  mappings: Record<number, Mapping>;
  scanProgress: ScanProgress | null;
  scanningTabId: number | null;
  generation: number;
  history: HistoryPoint[];
  peak: number;
  settings: Settings;
};

const initial = (): Store => ({
  running: false, hostError: 'Companion is not connected', snapshot: null, mappings: {},
  scanProgress: null, scanningTabId: null, generation: 0, history: [], peak: 0, settings: { ...DEFAULT_SETTINGS },
});

/** The background's single mutable state, shared by its modules. */
export const store: Store = initial();

export function resetStore(): void {
  Object.assign(store, initial());
}

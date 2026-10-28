import type { Mapping, ProcessSample } from '../shared/model.ts';

export type Snapshot = { type: 'snapshot'; at: number; platform: string; warnings: string[]; processes: ProcessSample[] };
export type HistoryPoint = { at: number; rssBytes: number; cpuPercent: number | null };
export type Settings = { thresholdMb: number };

export type Store = {
  running: boolean;
  hostError: string;
  snapshot: (Snapshot & { receivedAt: number }) | null;
  mappings: Record<number, Mapping>;
  scanning: boolean;
  scanProgress: string;
  generation: number;
  history: HistoryPoint[];
  peak: number;
  settings: Settings;
};

const initial = (): Store => ({
  running: false, hostError: 'Companion is not connected', snapshot: null, mappings: {},
  scanning: false, scanProgress: '', generation: 0, history: [], peak: 0, settings: { thresholdMb: 1000 },
});

/** The background's single mutable state, shared by its modules. */
export const store: Store = initial();

export function resetStore(): void {
  Object.assign(store, initial());
}

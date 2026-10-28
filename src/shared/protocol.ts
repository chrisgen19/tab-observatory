import { z } from 'zod';
import type { OwnedProcess, TabRow, Totals } from './model.ts';
import type { Ranking } from './ranking.ts';
import { SettingsInputSchema, type Settings } from './settings.ts';

export const PORT_NAME = 'dashboard';

export type HistoryPoint = { at: number; rssBytes: number; cpuPercent: number | null };

export type DashboardState = {
  running: boolean; scanning: boolean; scanProgress: { current: number; total: number } | null;
  settings: Settings; hostError: string; platform: string | null; at: number | null; warnings: string[];
  total: Totals; peak: number; history: HistoryPoint[];
  tabs: TabRow[]; processes: OwnedProcess[]; ranking: Ranking; extensionId: string;
};

const target = { tabId: z.number().int(), url: z.string() };
const command = <T extends string, S extends z.ZodRawShape>(type: T, shape: S) =>
  z.object({ id: z.string(), type: z.literal(type), ...shape });

export const CommandSchema = z.discriminatedUnion('type', [
  command('start', {}),
  command('stop', {}),
  command('rescan', {}),
  command('focus', target),
  command('sleep', target),
  command('close', target),
  command('sleepGroup', { targets: z.array(z.object(target)).min(1) }),
  command('saveSettings', { settings: SettingsInputSchema }),
]);

export type Command = z.infer<typeof CommandSchema>;
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type CommandInput = DistributiveOmit<Command, 'id'>;

export type PortMessage =
  | { kind: 'state'; state: DashboardState }
  | { kind: 'reply'; id: string; ok: true; result?: unknown }
  | { kind: 'reply'; id: string; ok: false; error: string };

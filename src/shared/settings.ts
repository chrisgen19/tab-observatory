import { z } from 'zod';

const THRESHOLD_MESSAGE = 'Threshold must be 100 to 100,000 MB';

const threshold = z.number({ error: THRESHOLD_MESSAGE }).int(THRESHOLD_MESSAGE).min(100, THRESHOLD_MESSAGE).max(100000, THRESHOLD_MESSAGE);
const theme = z.enum(['system', 'light', 'dark']);
const fullRefreshMinutes = z.literal([0, 2, 5, 10]);

/** Strict schema for settings coming from the dashboard. 0 minutes turns the full refresh off. */
export const SettingsInputSchema = z.strictObject({
  thresholdMb: threshold,
  theme,
  fullRefreshMinutes,
  showRestricted: z.boolean(),
});

export type Settings = z.infer<typeof SettingsInputSchema>;

export const DEFAULT_SETTINGS: Settings = { thresholdMb: 1000, theme: 'system', fullRefreshMinutes: 5, showRestricted: false };

const StoredSettingsSchema = z.object({
  thresholdMb: threshold.catch(DEFAULT_SETTINGS.thresholdMb),
  theme: theme.catch(DEFAULT_SETTINGS.theme),
  fullRefreshMinutes: fullRefreshMinutes.catch(DEFAULT_SETTINGS.fullRefreshMinutes),
  showRestricted: z.boolean().catch(DEFAULT_SETTINGS.showRestricted),
});

/** Reads stored settings field by field, so old or damaged values fall back to defaults. */
export function parseSettings(raw: unknown): Settings {
  const source = raw && typeof raw === 'object' ? raw : {};
  return StoredSettingsSchema.parse(source);
}

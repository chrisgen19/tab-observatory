import { useEffect, useId, useRef, useState, type SubmitEvent } from 'react';
import { SettingsInputSchema, type Settings } from '../../shared/settings.ts';

type Props = { open: boolean; settings: Settings; onClose(): void; onSave(settings: Settings): Promise<unknown> };
type Draft = { thresholdMb: string; theme: Settings['theme']; fullRefreshMinutes: string; showRestricted: boolean };

const THEMES: { value: Settings['theme']; label: string }[] = [
  { value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' },
];
const REFRESH = [['2', 'Every 2 min'], ['5', 'Every 5 min'], ['10', 'Every 10 min'], ['0', 'Off']] as const;
const field = 'w-full rounded-md border border-line bg-canvas px-2.5 py-1.5 text-sm';

/** The OS scheme, kept current, so "System" can say what it resolves to right now. */
function useSystemScheme() {
  const [query] = useState(() => matchMedia('(prefers-color-scheme: dark)'));
  const [dark, setDark] = useState(query.matches);
  useEffect(() => {
    const update = (event: MediaQueryListEvent) => setDark(event.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, [query]);
  return dark ? 'dark' : 'light';
}

const toDraft = (s: Settings): Draft => ({ ...s, thresholdMb: String(s.thresholdMb), fullRefreshMinutes: String(s.fullRefreshMinutes) });

export function SettingsDialog({ open, settings, onClose, onSave }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [draft, setDraft] = useState(() => toDraft(settings));
  const [errors, setErrors] = useState<Partial<Record<keyof Settings | 'form', string>>>({});
  const [saving, setSaving] = useState(false);
  const system = useSystemScheme();

  useEffect(() => {
    if (open && !dialog.current?.open) { setDraft(toDraft(settings)); setErrors({}); dialog.current?.showModal(); }
    if (!open && dialog.current?.open) dialog.current.close();
  }, [open, settings]);

  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    if (event.nativeEvent.submitter?.getAttribute('formmethod') === 'dialog') return;
    event.preventDefault();
    const parsed = SettingsInputSchema.safeParse({
      ...draft, thresholdMb: Number(draft.thresholdMb), fullRefreshMinutes: Number(draft.fullRefreshMinutes),
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      setErrors({ [issue.path[0] as keyof Settings]: issue.message });
      return;
    }
    setSaving(true);
    try { await onSave(parsed.data); dialog.current?.close(); }
    catch (error) { setErrors({ form: (error as Error).message }); }
    finally { setSaving(false); }
  };

  return (
    <dialog
      ref={dialog} aria-labelledby={titleId} onClose={onClose}
      className="m-auto w-[min(26rem,calc(100vw-2rem))] rounded-xl border border-line bg-paper p-0 text-ink backdrop:bg-black/40"
    >
      <form method="dialog" noValidate onSubmit={submit} className="flex flex-col gap-4 p-5 text-sm">
        <h2 id={titleId} className="text-base font-semibold">Settings</h2>
        <label className="flex flex-col gap-1">
          <span className="font-semibold">Toolbar alert above</span>
          <span className="flex items-center gap-2">
            <input
              autoFocus type="number" min={100} max={100000} step={100} value={draft.thresholdMb}
              onChange={event => setDraft({ ...draft, thresholdMb: event.target.value })}
              aria-invalid={!!errors.thresholdMb} aria-describedby={errors.thresholdMb ? `${titleId}-threshold` : undefined}
              className={`${field} max-w-32`}
            />
            <span className="text-muted">MB total resident</span>
          </span>
          {errors.thresholdMb && <span id={`${titleId}-threshold`} className="text-xs text-danger">{errors.thresholdMb}</span>}
        </label>
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1 font-semibold">Theme</legend>
          {THEMES.map(theme => (
            <label key={theme.value} className="flex items-center gap-2">
              <input type="radio" name="theme" value={theme.value} checked={draft.theme === theme.value}
                onChange={() => setDraft({ ...draft, theme: theme.value })} />
              {theme.value === 'system' ? `System (currently ${system})` : theme.label}
            </label>
          ))}
        </fieldset>
        <label className="flex flex-col gap-1">
          <span className="font-semibold">Full refresh</span>
          <select value={draft.fullRefreshMinutes} onChange={event => setDraft({ ...draft, fullRefreshMinutes: event.target.value })} className={field}>
            {REFRESH.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <span className="text-xs text-muted">Rescans every tab on this schedule, on top of rescans when tabs open or navigate.</span>
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={draft.showRestricted} onChange={event => setDraft({ ...draft, showRestricted: event.target.checked })} />
          Show restricted tabs
        </label>
        {errors.form && <p role="alert" className="text-xs text-danger">{errors.form}</p>}
        <div className="flex justify-end gap-2">
          <button type="submit" formMethod="dialog" value="cancel" className="rounded-md border border-line px-3 py-1.5 font-semibold hover:bg-line-soft">Cancel</button>
          <button type="submit" disabled={saving} className="rounded-md border border-brand bg-brand px-3 py-1.5 font-semibold text-white hover:opacity-90 disabled:opacity-50">Save</button>
        </div>
      </form>
    </dialog>
  );
}

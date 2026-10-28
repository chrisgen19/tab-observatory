import { useEffect, useRef, useState } from 'react';
import type { CommandInput, DashboardState } from '../../shared/protocol.ts';
import type { RankedEntry, RankedTab } from '../../shared/ranking.ts';
import { filterEntries, groupResultMessage, type GroupSleepResult } from '../lib/list-view.ts';
import { TabRow } from './tab-row.tsx';
import { SharedGroup } from './shared-group.tsx';
import type { TabAction } from './row-actions.tsx';

type Props = { state: DashboardState; send(command: CommandInput): Promise<unknown> };
type Group = Extract<RankedEntry, { kind: 'group' }>;

/** Inline action errors that clear themselves after 5 seconds. */
function useTimedErrors() {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const show = (key: string, message: string) => {
    clearTimeout(timers.current.get(key));
    setErrors(current => ({ ...current, [key]: message }));
    timers.current.set(key, setTimeout(() => setErrors(({ [key]: _, ...rest }) => rest), 5000));
  };
  return { errors, show };
}

const target = (tab: RankedTab) => ({ tabId: tab.id, url: tab.url ?? '' });
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function TabList({ state, send }: Props) {
  const [needle, setNeedle] = useState('');
  const [showRestricted, setShowRestricted] = useState(state.settings.showRestricted);
  useEffect(() => setShowRestricted(state.settings.showRestricted), [state.settings.showRestricted]);
  const { errors, show } = useTimedErrors();
  const { ranking, extensionId } = state;

  const onAction = (action: TabAction, tab: RankedTab) =>
    send({ type: action, ...target(tab) }).catch(error => show(String(tab.id), (error as Error).message));
  const onSleepGroup = async (group: Group) => {
    try {
      const message = groupResultMessage(await send({ type: 'sleepGroup', targets: group.tabs.map(target) }) as GroupSleepResult);
      if (message) show(group.id, message);
    } catch (error) { show(group.id, (error as Error).message); }
  };

  const entries = filterEntries(ranking.entries, needle);
  const restricted = filterEntries(ranking.restricted.map(tab => ({ kind: 'tab', tab }) as RankedEntry), needle);
  const maxFrees = Math.max(0, ...ranking.entries.map(e => (e.kind === 'tab' ? e.tab.freesBytes : e.freesBytes) ?? 0));
  const hasTabs = ranking.entries.length > 0 || ranking.restricted.length > 0;
  const row = (tab: RankedTab) => (
    <TabRow key={tab.id} tab={tab} maxFrees={maxFrees} extensionId={extensionId} error={errors[tab.id]} onAction={onAction} />
  );

  return (
    <section aria-label="Tabs" className="rounded-xl border border-line bg-paper">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <h2 className="flex items-baseline gap-2">
          <span className="text-sm font-semibold">Tabs</span>
          <span className="text-[11px] font-normal text-muted">ranked by memory freed if closed</span>
        </h2>
        <input
          type="search" value={needle} onChange={event => setNeedle(event.target.value)}
          placeholder="Filter by title, URL or PID" aria-label="Filter tabs"
          className="w-full rounded-md border border-line bg-canvas px-2.5 py-1.5 text-xs sm:w-56"
        />
      </div>
      {ranking.unscannedCount > 0 && (
        <p className="border-b border-line-soft px-4 py-2 text-xs text-muted">
          {plural(ranking.unscannedCount, 'tab')} not scanned yet; the ranking may change
        </p>
      )}
      <div className="px-4 py-1 text-[13px]">
        {!hasTabs && <p className="py-8 text-center text-muted">Open a web page to see it here.</p>}
        {hasTabs && !entries.length && !(showRestricted && restricted.length) && (
          <p className="py-8 text-center text-muted">No matching tabs.</p>
        )}
        {entries.map(entry => entry.kind === 'tab' ? row(entry.tab) : (
          <SharedGroup
            key={entry.id} group={entry} maxFrees={maxFrees} extensionId={extensionId}
            errors={errors} onAction={onAction} onSleepGroup={onSleepGroup}
          />
        ))}
        {showRestricted && restricted.map(entry => entry.kind === 'tab' && row(entry.tab))}
      </div>
      {ranking.restricted.length > 0 && (
        <div className="flex gap-1.5 border-t border-line px-4 py-2 text-[11px] text-muted">
          {showRestricted ? plural(ranking.restricted.length, 'restricted or sleeping tab') + ' shown' : `${plural(ranking.restricted.length, 'restricted tab')} hidden`}
          <span aria-hidden="true">·</span>
          <button type="button" onClick={() => setShowRestricted(!showRestricted)} className="font-semibold text-brand-line underline">
            {showRestricted ? 'Hide' : 'Show'}
          </button>
        </div>
      )}
    </section>
  );
}

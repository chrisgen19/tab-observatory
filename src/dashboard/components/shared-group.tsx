import type { RankedEntry, RankedTab } from '../../shared/ranking.ts';
import { formatBytes } from '../../shared/format.ts';
import { groupLabel } from '../lib/list-view.ts';
import { TabRow } from './tab-row.tsx';
import type { TabAction } from './row-actions.tsx';

type Group = Extract<RankedEntry, { kind: 'group' }>;

type Props = {
  group: Group;
  maxFrees: number;
  extensionId: string;
  errors: Record<string, string>;
  onAction(action: TabAction, tab: RankedTab): void;
  onSleepGroup(group: Group): void;
};

/** Tabs sharing a renderer: the shared memory comes back only when all of them sleep or close. */
export function SharedGroup({ group, maxFrees, extensionId, errors, onAction, onSleepGroup }: Props) {
  return (
    <div className="my-1.5 rounded-r-md border-l-[3px] border-amber-bar bg-group px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="rounded bg-amber-soft px-1.5 py-0.5 text-[10px] text-amber">Shared process · {formatBytes(group.sharedBytes)}</span>
          {group.partial && <span className="rounded bg-dim-soft px-1.5 py-0.5 text-[10px] text-dim">Partial</span>}
          <span className="hidden text-[10px] text-muted sm:inline">freed only when every tab in it sleeps or closes</span>
        </div>
        <div className="ml-auto flex items-center gap-2.5">
          <span className="w-20 text-right font-semibold tabular-nums">{group.estimated ? '≈ ' : ''}{formatBytes(group.freesBytes)}</span>
          <button
            type="button" onClick={() => onSleepGroup(group)}
            className="rounded-md border border-amber-bar bg-amber-soft px-2.5 py-1.5 text-[11px] font-semibold text-amber hover:opacity-90"
          >
            {groupLabel(group.tabs.length)}
          </button>
        </div>
      </div>
      {errors[group.id] && <p role="alert" className="mt-1 text-xs text-danger">{errors[group.id]}</p>}
      {group.tabs.map(tab => (
        <TabRow
          key={tab.id} tab={tab} maxFrees={maxFrees} extensionId={extensionId}
          error={errors[tab.id]} onAction={onAction} inGroup
        />
      ))}
    </div>
  );
}

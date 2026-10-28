import { useState } from 'react';
import type { RankedTab } from '../../shared/ranking.ts';
import { formatAgo } from '../../shared/format.ts';
import { barWidths, freesLabel, stateTag } from '../lib/list-view.ts';
import { RowActions, type TabAction } from './row-actions.tsx';

type Props = {
  tab: RankedTab;
  maxFrees: number;
  extensionId: string;
  error?: string;
  inGroup?: boolean;
  onAction(action: TabAction, tab: RankedTab): void;
};

function Favicon({ tab }: { tab: RankedTab }) {
  const [broken, setBroken] = useState(false);
  if (tab.favIconUrl && !broken && /^(https?|data):/.test(tab.favIconUrl)) {
    return <img src={tab.favIconUrl} alt="" onError={() => setBroken(true)} className="size-4 shrink-0 rounded-sm" />;
  }
  return (
    <span aria-hidden="true" className="flex size-4 shrink-0 items-center justify-center rounded-sm bg-dim-soft text-[9px] font-bold uppercase text-dim">
      {tab.title.trim().charAt(0) || '?'}
    </span>
  );
}

export function TabRow({ tab, maxFrees, extensionId, error, inGroup, onAction }: Props) {
  const tag = stateTag(tab);
  const bar = barWidths(tab, maxFrees);
  const label = freesLabel(tab);
  const mapped = tab.state === 'mapped' || tab.state === 'partial';
  return (
    <div
      title={tab.mappedAt ? `scanned ${formatAgo(tab.mappedAt, Date.now())}` : undefined}
      className={`grid grid-cols-[auto_1fr_auto] items-center gap-x-2.5 gap-y-2 py-2.5 sm:grid-cols-[auto_1fr_auto_auto] ${
        inGroup ? '' : 'border-b border-line-soft last:border-b-0'}`}
    >
      <Favicon tab={tab} />
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <span className={`truncate ${inGroup ? '' : 'font-semibold'}`}>{tab.title}</span>
          {tag && (
            <span className={`shrink-0 truncate rounded px-1.5 py-0.5 text-[10px] ${tab.state === 'error' ? 'bg-amber-soft text-amber' : 'bg-dim-soft text-dim'}`}>
              {tag}
            </span>
          )}
        </div>
        {mapped && (
          <div className="mt-1.5 flex h-1.5 overflow-hidden rounded-full bg-track" aria-hidden="true">
            <i className="block h-full bg-brand-line" style={{ width: `${bar.own}%` }} />
            <i className="block h-full bg-amber-bar" style={{ width: `${bar.shared}%` }} />
          </div>
        )}
      </div>
      <div
        className={`w-20 text-right tabular-nums ${inGroup ? '' : 'font-semibold'} ${mapped ? '' : 'text-xs text-muted'}`}
        title={tab.estimated ? 'Private memory unavailable; using resident memory' : undefined}
      >
        {label || (tab.state === 'scanning' || tab.state === 'pending' ? 'pending' : '')}
      </div>
      <div className="col-span-3 justify-self-end sm:col-span-1">
        <RowActions tab={tab} extensionId={extensionId} onAction={onAction} foldOnMobile={inGroup} />
      </div>
      {error && <p role="alert" className="col-span-full text-xs text-danger">{error}</p>}
    </div>
  );
}

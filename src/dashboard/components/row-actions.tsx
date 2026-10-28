import { MoreHorizontal } from 'lucide-react';
import type { RankedTab } from '../../shared/ranking.ts';
import { canAct } from '../lib/list-view.ts';

export type TabAction = 'focus' | 'sleep' | 'close';

type Props = {
  tab: RankedTab;
  extensionId: string;
  onAction(action: TabAction, tab: RankedTab): void;
  /** Inside a group on narrow screens, Focus and Close fold into a menu. */
  foldOnMobile?: boolean;
};

const base = 'rounded-md px-2.5 py-1.5 text-[11px] font-semibold disabled:opacity-40';
const styles: Record<TabAction, string> = {
  focus: `${base} text-muted hover:bg-line-soft hover:text-ink`,
  sleep: `${base} border border-line bg-paper hover:bg-line-soft`,
  close: `${base} border border-line bg-paper text-danger hover:bg-line-soft`,
};
const LABELS: Record<TabAction, string> = { focus: 'Focus', sleep: 'Sleep', close: 'Close' };

export function RowActions({ tab, extensionId, onAction, foldOnMobile }: Props) {
  const allowed = canAct(tab, extensionId);
  const button = (action: TabAction, className = '') => (
    <button
      key={action} type="button" disabled={!allowed[action]} onClick={() => onAction(action, tab)}
      aria-label={`${LABELS[action]} ${tab.title}`} className={`${styles[action]} ${className}`}
    >
      {LABELS[action]}
    </button>
  );
  if (!foldOnMobile) return <div className="flex items-center gap-1.5">{(['focus', 'sleep', 'close'] as const).map(a => button(a))}</div>;
  return (
    <div className="flex items-center gap-1.5">
      {button('focus', 'hidden sm:inline-block')}
      {button('sleep')}
      {button('close', 'hidden sm:inline-block')}
      <details className="relative sm:hidden">
        <summary aria-label={`More actions for ${tab.title}`} className="list-none rounded-md p-1.5 text-muted hover:bg-line-soft [&::-webkit-details-marker]:hidden">
          <MoreHorizontal size={16} aria-hidden="true" />
        </summary>
        <div className="absolute right-0 z-10 mt-1 flex flex-col gap-1 rounded-md border border-line bg-paper p-1 shadow-lg">
          {button('focus')}
          {button('close')}
        </div>
      </details>
    </div>
  );
}

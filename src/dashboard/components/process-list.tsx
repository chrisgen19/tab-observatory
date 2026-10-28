import { useState } from 'react';
import type { OwnedProcess, TabRow } from '../../shared/model.ts';
import { formatBytes, formatPercent } from '../../shared/format.ts';
import { ariaSort, filterProcessView, groupProcesses, type ProcessSort } from '../lib/process-view.ts';

type Props = { processes: OwnedProcess[]; tabs: TabRow[]; needle: string };
type Key = ProcessSort['key'];

const COLUMNS: { key: Key; label: string }[] = [
  { key: 'rssBytes', label: 'Resident' }, { key: 'privateBytes', label: 'Private' }, { key: 'cpuPercent', label: 'CPU' },
];

function Cells({ process }: { process: OwnedProcess }) {
  return (
    <>
      <td className="px-3 py-2 text-right">{formatBytes(process.rssBytes)}</td>
      <td className="px-3 py-2 text-right">{formatBytes(process.privateBytes)}</td>
      <td className="px-3 py-2 text-right">{formatPercent(process.cpuPercent)}</td>
    </>
  );
}

/** Every Chrome process, with the tabs it serves nested under it; each process is measured once. */
export function ProcessList({ processes, tabs, needle }: Props) {
  const [sort, setSort] = useState<ProcessSort>({ key: 'rssBytes', descending: true });
  const view = filterProcessView(groupProcesses(processes, tabs, sort), needle);
  const toggle = (key: Key) => setSort(current => ({ key, descending: current.key === key ? !current.descending : true }));
  if (!processes.length) return <p className="py-8 text-center text-[13px] text-muted">No process samples yet.</p>;
  if (!view.owned.length && !view.unowned.length) return <p className="py-8 text-center text-[13px] text-muted">No matching processes.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[480px] text-[13px] tabular-nums">
        <thead className="text-[10px] uppercase tracking-wider text-muted">
          <tr className="border-b border-line">
            <th scope="col" className="px-3 py-2 text-left font-semibold">Process</th>
            {COLUMNS.map(column => (
              <th key={column.key} scope="col" aria-sort={ariaSort(sort, column.key)} className="px-3 py-2 text-right font-semibold">
                <button type="button" onClick={() => toggle(column.key)} className="uppercase tracking-wider hover:text-ink">
                  {column.label}{sort.key === column.key ? (sort.descending ? ' ↓' : ' ↑') : ''}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {view.owned.map(({ process, tabs: served }) => (
            <tr key={process.pid} className="border-b border-line-soft align-top">
              <td className="px-3 py-2">
                <div className="font-semibold">{process.kind} · PID {process.pid}</div>
                <ul className="mt-0.5 text-[11px] text-muted">
                  {served.map(tab => <li key={tab.id} className="max-w-[28rem] truncate">{tab.title}</li>)}
                </ul>
              </td>
              <Cells process={process} />
            </tr>
          ))}
          {view.unowned.length > 0 && (
            <tr><th scope="rowgroup" colSpan={4} className="px-3 pb-1 pt-4 text-left text-[10px] font-bold uppercase tracking-wider text-muted">Not in any tab</th></tr>
          )}
          {view.unowned.map(process => (
            <tr key={process.pid} className="border-b border-line-soft last:border-b-0">
              <td className="px-3 py-2">{process.kind} · PID {process.pid}</td>
              <Cells process={process} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

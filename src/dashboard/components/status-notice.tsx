import type { HostStatus } from '../lib/host-status.ts';

type Props = { host: HostStatus; warnings: string[]; actionError: string | null };

/** Companion errors, companion warnings and the last failed command, most important first. */
export function StatusNotice({ host, warnings, actionError }: Props) {
  const alert = actionError || (host.kind === 'missing' || host.kind === 'dropped' ? host.message : '');
  return (
    <>
      {alert && (
        <div role="alert" className="mb-4 rounded-lg border border-amber-bar bg-amber-soft px-4 py-3 text-xs leading-relaxed text-amber">
          {alert}
        </div>
      )}
      {warnings.length > 0 && (
        <div className="mb-4 rounded-lg border border-line bg-paper px-4 py-3 text-xs leading-relaxed text-muted">
          {warnings.join(' · ')}
        </div>
      )}
    </>
  );
}

const MB = 1024 ** 2;
const GB = 1024 ** 3;

export const formatBytes = (n: number | null): string =>
  n == null ? '—' : Math.abs(n) >= GB ? `${(n / GB).toFixed(2)} GB` : `${(n / MB).toFixed(1)} MB`;

export const formatPercent = (n: number | null): string => n == null ? '—' : `${n.toFixed(1)}%`;

export const formatAgo = (ms: number, now: number): string => {
  const seconds = Math.round((now - ms) / 1000);
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds} s ago`;
  return `${Math.round(seconds / 60)} min ago`;
};

export const formatSpan = (ms: number): string => {
  const seconds = Math.round(ms / 1000);
  return seconds < 60 ? `${seconds} s` : `${Math.round(seconds / 60)} min`;
};

/** Change in resident memory from the first to the last point, e.g. "+410.0 MB in 15 min". */
export const formatDelta = (points: { at: number; rssBytes: number }[]): string => {
  if (points.length < 2) return '';
  const first = points[0], last = points[points.length - 1];
  const change = last.rssBytes - first.rssBytes;
  return `${change < 0 ? '-' : '+'}${formatBytes(Math.abs(change))} in ${formatSpan(last.at - first.at)}`;
};

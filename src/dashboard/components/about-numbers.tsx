const POINTS = [
  'Frees: private memory (USS) of the processes only that tab uses. That is what closing or sleeping it gives back. A process can also hold frames from incognito tabs, other profiles or unmapped frames, so this is the best available estimate, not a guarantee.',
  'Shared: private memory of processes that several tabs use. It is freed only when every tab in the group sleeps or closes, and it is counted once.',
  '≈ marks an estimate: private memory was unavailable, so resident memory stands in.',
  'Chrome total: resident memory summed over unique Chrome processes (RSS, or working set on Windows). Pages shared between processes can be counted more than once.',
  'Not in any tab: browser, GPU, utility, extension and worker processes.',
  'Numbers can differ from Chrome Task Manager and the macOS Memory column, which use other definitions.',
  'Tabs are mapped with brief debugger sessions when they open or navigate, plus a periodic full refresh. Chrome shows a debugging banner while that happens, and scans can conflict with open DevTools.',
];

export function AboutNumbers() {
  return (
    <details className="mt-6 text-xs text-muted">
      <summary className="cursor-pointer font-semibold text-ink">About these numbers</summary>
      <ul className="mt-2 max-w-3xl list-disc space-y-1.5 pl-5 leading-relaxed">
        {POINTS.map(point => <li key={point}>{point}</li>)}
      </ul>
    </details>
  );
}

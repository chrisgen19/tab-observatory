export type TabsApi = {
  get(id: number): Promise<chrome.tabs.Tab>;
  update(id: number, props: { active: boolean }): Promise<unknown>;
  discard(id: number): Promise<chrome.tabs.Tab | undefined>;
  remove(id: number): Promise<void>;
  focusWindow(windowId: number): Promise<void>;
};

export type ActionTarget = { tabId: number; url: string };
export type ActionResult = { ok: true } | { ok: false; error: string };

const GONE = 'Tab is already closed';
const NAVIGATED = 'This tab navigated since the list was drawn. Try again.';
const REFUSED = 'Chrome would not sleep this tab (it may be the active tab)';

export const createTabsApi = (): TabsApi => ({
  get: id => chrome.tabs.get(id),
  update: (id, props) => chrome.tabs.update(id, props),
  discard: id => chrome.tabs.discard(id),
  remove: id => chrome.tabs.remove(id),
  focusWindow: async windowId => { await chrome.windows.update(windowId, { focused: true }); },
});

/** Re-reads the tab so an action never lands on a page other than the one the row showed. */
async function verify(api: TabsApi, target: ActionTarget): Promise<chrome.tabs.Tab | ActionResult> {
  const tab = await api.get(target.tabId).catch(() => null);
  if (!tab) return { ok: false, error: GONE };
  if (tab.url !== target.url) return { ok: false, error: NAVIGATED };
  return tab;
}

const isResult = (value: chrome.tabs.Tab | ActionResult): value is ActionResult => 'ok' in value;

async function attempt(work: () => Promise<unknown>, fallback?: string): Promise<ActionResult> {
  try {
    await work();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: fallback ?? (error as Error).message };
  }
}

export async function focusTab(api: TabsApi, target: ActionTarget): Promise<ActionResult> {
  const tab = await verify(api, target);
  if (isResult(tab)) return tab;
  return attempt(async () => {
    await api.update(target.tabId, { active: true });
    await api.focusWindow(tab.windowId);
  });
}

export async function sleepTab(api: TabsApi, target: ActionTarget): Promise<ActionResult> {
  const tab = await verify(api, target);
  if (isResult(tab)) return tab;
  return attempt(async () => {
    if (!await api.discard(target.tabId)) throw new Error(REFUSED);
  }, REFUSED);
}

export async function closeTab(api: TabsApi, target: ActionTarget): Promise<ActionResult> {
  const tab = await verify(api, target);
  if (isResult(tab)) return tab;
  return attempt(() => api.remove(target.tabId));
}

/** Targets Chrome actually slept; refused tabs keep their mappings. */
export const sleptTabIds = (targets: ActionTarget[], result: { failures: { tabId: number }[] }): number[] =>
  targets.filter(t => !result.failures.some(f => f.tabId === t.tabId)).map(t => t.tabId);

/** Sleeps every tab in a shared-process group; one refusal does not stop the others. */
export async function sleepGroup(api: TabsApi, targets: ActionTarget[]) {
  const failures: { tabId: number; title: string; error: string }[] = [];
  for (const target of targets) {
    const result = await sleepTab(api, target);
    if (result.ok) continue;
    const tab = await api.get(target.tabId).catch(() => null);
    failures.push({ tabId: target.tabId, title: tab?.title ?? '', error: result.error });
  }
  return { slept: targets.length - failures.length, total: targets.length, failures };
}

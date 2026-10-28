import { test } from 'node:test';
import assert from 'node:assert/strict';
import { closeTab, focusTab, sleepGroup, sleepTab, sleptTabIds, type TabsApi } from '../src/background/tab-actions.ts';

type Tab = { id: number; url: string; title?: string; windowId?: number };

function fakeApi(tabs: Record<number, Tab>, refuse: number[] = []) {
  const calls = { discarded: [] as number[], removed: [] as number[], updated: [] as number[], focused: [] as number[] };
  const api: TabsApi = {
    get: async id => {
      if (!tabs[id]) throw new Error(`No tab with id: ${id}.`);
      return tabs[id] as chrome.tabs.Tab;
    },
    update: async id => { calls.updated.push(id); },
    discard: async id => {
      if (refuse.includes(id)) throw new Error('Cannot discard tab');
      calls.discarded.push(id);
      return tabs[id] as chrome.tabs.Tab;
    },
    remove: async id => { calls.removed.push(id); },
    focusWindow: async id => { calls.focused.push(id); },
  };
  return { ...api, ...calls };
}

test('sleepTab refuses when the URL changed', async () => {
  const api = fakeApi({ 1: { id: 1, url: 'https://new.test' } });
  assert.deepEqual(await sleepTab(api, { tabId: 1, url: 'https://old.test' }),
    { ok: false, error: 'This tab navigated since the list was drawn. Try again.' });
  assert.equal(api.discarded.length, 0);
});

test('sleepTab discards a matching tab and reports a refusal', async () => {
  const api = fakeApi({ 1: { id: 1, url: 'https://a.test' }, 2: { id: 2, url: 'https://b.test' } }, [2]);
  assert.deepEqual(await sleepTab(api, { tabId: 1, url: 'https://a.test' }), { ok: true });
  assert.deepEqual(await sleepTab(api, { tabId: 2, url: 'https://b.test' }),
    { ok: false, error: 'Chrome would not sleep this tab (it may be the active tab)' });
  assert.deepEqual(api.discarded, [1]);
});

test('closeTab reports an already closed tab', async () => {
  assert.deepEqual(await closeTab(fakeApi({}), { tabId: 9, url: 'https://x.test' }), { ok: false, error: 'Tab is already closed' });
});

test('closeTab removes a matching tab', async () => {
  const api = fakeApi({ 4: { id: 4, url: 'https://x.test' } });
  assert.deepEqual(await closeTab(api, { tabId: 4, url: 'https://x.test' }), { ok: true });
  assert.deepEqual(api.removed, [4]);
});

test('focusTab activates the tab and focuses its window', async () => {
  const api = fakeApi({ 1: { id: 1, url: 'https://a.test', windowId: 7 } });
  assert.deepEqual(await focusTab(api, { tabId: 1, url: 'https://a.test' }), { ok: true });
  assert.deepEqual([api.updated, api.focused], [[1], [7]]);
});

test('sleepGroup reports partial success', async () => {
  const u2 = 'https://mail.test', u3 = 'https://calendar.test';
  const api = fakeApi({ 2: { id: 2, url: u2, title: 'Inbox (12) - Gmail' }, 3: { id: 3, url: u3, title: 'Calendar' } }, [2]);
  const r = await sleepGroup(api, [{ tabId: 2, url: u2 }, { tabId: 3, url: u3 }]);
  assert.deepEqual([r.slept, r.total, r.failures.map(f => f.title)], [1, 2, ['Inbox (12) - Gmail']]);
  assert.deepEqual(api.discarded, [3]);
});

test('sleptTabIds leaves out tabs Chrome refused, so their mappings survive', () => {
  const targets = [{ tabId: 2, url: 'https://mail.test' }, { tabId: 3, url: 'https://calendar.test' }];
  const result = { slept: 1, total: 2, failures: [{ tabId: 2, title: 'Inbox', error: 'refused' }] };
  assert.deepEqual(sleptTabIds(targets, result), [3]);
});

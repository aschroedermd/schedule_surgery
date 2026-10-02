// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BoardsTesterPage } from './BoardsTesterAccount';
import Tester from '@surgical-board-simulator/tester-ui';
let root: Root, host: HTMLDivElement;
const click = async (text: string) => {
  const button = Array.from(host.querySelectorAll('button')).find(b => b.textContent === text);
  expect(button).toBeTruthy();
  await act(async () => button!.click());
};
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  Element.prototype.scrollIntoView = vi.fn();
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    let data: unknown = {};
    if (url.endsWith('/access')) return new Response(JSON.stringify({ detail: 'Access expired' }), { status: 401 });
    if (url.endsWith('/scenarios')) data = { scenarios: ['liver_trauma'] };
    if (url.endsWith('/feedback/options')) data = { categories: ['issue'], severities: ['minor'] };
    if (url.endsWith('/session/start')) data = { session_id: 'case-1', examiner_message: 'Opening', scenario_title: 'Practice case' };
    if (url.endsWith('/state')) data = { current_node: 'opening', state: 'main' };
    if (url.endsWith('/feedback')) data = init?.method === 'POST' ? { id: 'comment-1' } : { entries: [] };
    return new Response(JSON.stringify(data), { status: 200 });
  }));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
it('keeps the standalone page password-gated when its grant expires', async () => {
  await act(async () => root.render(<BoardsTesterPage token="account-token" />));
  expect(host.textContent).toContain('Simulator password');
  expect(host.querySelector('textarea')).toBeNull();
  expect(host.querySelector('a')?.getAttribute('href')).toBe('/?section=account');
});
it('opens feedback over the case and preserves an unsaved draft when dismissed', async () => {
  await act(async () => root.render(<Tester apiBase="/api/tester" userName="Test account" />));
  await click('Start case');
  expect(host.querySelector('dialog')?.hasAttribute('open')).toBe(false);
  await click('Comment');
  expect(host.querySelector('dialog')?.hasAttribute('open')).toBe(true);
  const textarea = host.querySelector('dialog textarea') as HTMLTextAreaElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, 'Keep this draft');
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => (host.querySelector('[aria-label="Close feedback"]') as HTMLButtonElement).click());
  expect(host.querySelector('dialog')?.hasAttribute('open')).toBe(false);
  await click('Feedback');
  expect(textarea.value).toBe('Keep this draft');
});
it('dismisses feedback only after a comment saves successfully', async () => {
  await act(async () => root.render(<Tester apiBase="/api/tester" userName="Test account" />));
  await click('Start case'); await click('Comment');
  const textarea = host.querySelector('dialog textarea') as HTMLTextAreaElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, 'Saved feedback');
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await click('Save comment');
  expect(host.querySelector('dialog')?.hasAttribute('open')).toBe(false);
  expect(host.textContent).toContain('Comment saved with this case.');
  expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'POST' && String(init.body).includes('Saved feedback'))).toBe(true);
});

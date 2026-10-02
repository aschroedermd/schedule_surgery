// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi, type Mock } from 'vitest';
import VoiceComment from '@surgical-board-simulator/tester-ui/voice-comment';
let root: Root, host: HTMLDivElement, transcribe: Mock<(audio: Blob, signal: AbortSignal) => Promise<string>>, onText: Mock<(text: string) => void>, stopTrack: ReturnType<typeof vi.fn>;
class Recorder {
  static isTypeSupported = () => true;
  state = 'inactive'; mimeType = 'audio/webm'; ondataavailable?: (event: any) => void; onstop?: () => void;
  start() { this.state = 'recording'; }
  stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['recording'], { type: this.mimeType }) }); this.onstop?.(); }
}
const event = async (kind: string) => { await act(async () => host.querySelector('button')!.dispatchEvent(new MouseEvent(kind, { bubbles: true, button: 0 }))); };
beforeEach(() => {
  vi.useFakeTimers(); (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  stopTrack = vi.fn();
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: stopTrack }] })) } });
  Element.prototype.setPointerCapture = vi.fn();
  vi.stubGlobal('MediaRecorder', Recorder);
  transcribe = vi.fn(async () => 'Dictated comment'); onText = vi.fn();
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
async function render(active = true) { await act(async () => root.render(<VoiceComment active={active} transcribe={transcribe} onText={onText} />)); }
it('tap starts recording and the second tap stops and transcribes once', async () => {
  await render(); await event('pointerdown'); await event('pointerup');
  expect(host.textContent).toContain('Recording'); expect(transcribe).not.toHaveBeenCalled();
  await event('pointerdown'); await event('pointerup');
  expect(transcribe).toHaveBeenCalledTimes(1); expect(onText).toHaveBeenCalledWith('Dictated comment'); expect(stopTrack).toHaveBeenCalled();
});
it('hold records until release, then transcribes once', async () => {
  await render(); await event('pointerdown');
  await act(async () => vi.advanceTimersByTime(600));
  await event('pointerup');
  expect(transcribe).toHaveBeenCalledTimes(1); expect(onText).toHaveBeenCalledWith('Dictated comment');
});
it('closing the drawer cancels recording and releases the microphone', async () => {
  await render(); await event('pointerdown'); await event('pointerup'); await render(false);
  expect(stopTrack).toHaveBeenCalled(); expect(transcribe).not.toHaveBeenCalled(); expect(onText).not.toHaveBeenCalled();
});
it('stops a delayed permission grant after the drawer was closed', async () => {
  let permission: (stream: unknown) => void;
  (navigator.mediaDevices.getUserMedia as any).mockImplementation(() => new Promise(resolve => { permission = resolve; }));
  await render(); await event('pointerdown'); await render(false);
  await act(async () => permission!({ getTracks: () => [{ stop: stopTrack }] }));
  expect(stopTrack).toHaveBeenCalled(); expect(transcribe).not.toHaveBeenCalled();
});

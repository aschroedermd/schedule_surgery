declare module '@surgical-board-simulator/tester-ui' {
  import type { ComponentType } from 'react';
  const Tester: ComponentType<{ apiBase: string; userName: string; backHref?: string; reviewHref?: string; voiceComments?: boolean }>;
  export default Tester;
}

declare module '@surgical-board-simulator/tester-ui/voice-comment' {
  import type { ComponentType } from 'react';
  const VoiceComment: ComponentType<{ active: boolean; transcribe: (audio: Blob, signal: AbortSignal) => Promise<string>; onText: (text: string) => void }>;
  export default VoiceComment;
}

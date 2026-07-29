import { ArrowUp, Bot, Mic, Plus, Sparkles, UserRound } from "lucide-react";
import { Fragment, FormEvent, KeyboardEvent, PointerEvent, useEffect, useRef, useState } from "react";
import {
  ChatConversationMessage,
  ChatQuota,
  fetchChatQuota,
  sendChatMessage,
  transcribeChatAudio
} from "./api";

const WELCOME_MESSAGE =
  "Hi — I can help you make sense of the OR, clinic, call, calendar, and vacation schedules. What would you like to know?";
const MAX_RECORDING_MS = 60_000;

type ChatStatus = "idle" | "thinking" | "requesting-mic" | "recording" | "transcribing";

export function ChatTab({
  token,
  displayName,
  serviceLine
}: {
  token: string;
  displayName: string;
  serviceLine: string;
}) {
  const [messages, setMessages] = useState<ChatConversationMessage[]>([
    { role: "assistant", content: WELCOME_MESSAGE }
  ]);
  const [draft, setDraft] = useState("");
  const [quota, setQuota] = useState<ChatQuota>();
  const [status, setStatus] = useState<ChatStatus>("idle");
  const [error, setError] = useState<string>();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const recorderRef = useRef<MediaRecorder>();
  const streamRef = useRef<MediaStream>();
  const chunksRef = useRef<Blob[]>([]);
  const recordingStartedAtRef = useRef(0);
  const holdActiveRef = useRef(false);
  const recordingTimeoutRef = useRef<number>();

  const isBusy = status !== "idle";
  const quotaExhausted = quota?.remaining === 0;

  useEffect(() => {
    let cancelled = false;
    fetchChatQuota(token)
      .then((nextQuota) => {
        if (!cancelled) setQuota(nextQuota);
      })
      .catch((quotaError) => {
        if (!cancelled) setError(quotaError instanceof Error ? quotaError.message : "Unable to load assistant allowance");
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [messages, status]);

  useEffect(() => {
    return () => {
      window.clearTimeout(recordingTimeoutRef.current);
      if (recorderRef.current?.state === "recording") {
        recorderRef.current.onstop = null;
        recorderRef.current.stop();
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    await sendMessage(draft);
  }

  async function sendMessage(rawText: string) {
    const content = rawText.trim();
    if (!content || isBusy || quotaExhausted) return;
    const userMessage: ChatConversationMessage = { role: "user", content };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setDraft("");
    setError(undefined);
    setStatus("thinking");
    setQuota((current) =>
      current ? { ...current, used: Math.min(current.limit, current.used + 1), remaining: Math.max(0, current.remaining - 1) } : current
    );

    try {
      const response = await sendChatMessage(token, nextMessages, serviceLine);
      setMessages((current) => [...current, { role: "assistant", content: response.message }]);
      setQuota({
        used: response.used,
        remaining: response.remaining,
        limit: response.limit,
        warningThreshold: response.warningThreshold
      });
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "The assistant could not answer");
      void fetchChatQuota(token).then(setQuota).catch(() => undefined);
    } finally {
      setStatus("idle");
    }
  }

  async function beginRecording(event?: PointerEvent<HTMLButtonElement>) {
    event?.preventDefault();
    if (isBusy || quotaExhausted) return;
    holdActiveRef.current = true;
    event?.currentTarget.setPointerCapture(event.pointerId);
    setError(undefined);
    setStatus("requesting-mic");

    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        throw new Error("Voice recording is not supported in this browser");
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!holdActiveRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        setStatus("idle");
        return;
      }
      const options = getRecorderOptions();
      const recorder = new MediaRecorder(stream, options);
      streamRef.current = stream;
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (chunkEvent) => {
        if (chunkEvent.data.size) chunksRef.current.push(chunkEvent.data);
      };
      recorder.onstop = () => {
        void finishRecording(recorder.mimeType);
      };
      recorder.start();
      recordingStartedAtRef.current = Date.now();
      setStatus("recording");
      playUiTone("start");
      recordingTimeoutRef.current = window.setTimeout(() => stopRecording(), MAX_RECORDING_MS);
    } catch (recordingError) {
      holdActiveRef.current = false;
      stopTracks();
      setStatus("idle");
      setError(recordingError instanceof Error ? recordingError.message : "Microphone access failed");
    }
  }

  function stopRecording() {
    holdActiveRef.current = false;
    window.clearTimeout(recordingTimeoutRef.current);
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
    } else if (status === "requesting-mic") {
      setStatus("idle");
    }
  }

  async function finishRecording(mimeType: string) {
    const elapsed = Date.now() - recordingStartedAtRef.current;
    const blob = new Blob(chunksRef.current, { type: mimeType });
    recorderRef.current = undefined;
    chunksRef.current = [];
    stopTracks();

    if (elapsed < 350 || !blob.size) {
      setStatus("idle");
      setError("Hold the microphone a little longer, then release to send");
      return;
    }

    setStatus("transcribing");
    playUiTone("send");
    try {
      const wavBase64 = await audioBlobToWavBase64(blob);
      const { text } = await transcribeChatAudio(token, wavBase64, "wav");
      setStatus("idle");
      await sendMessage(text);
    } catch (transcriptionError) {
      setStatus("idle");
      setError(transcriptionError instanceof Error ? transcriptionError.message : "The recording could not be transcribed");
    }
  }

  function handleRecordKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if ((event.key === " " || event.key === "Enter") && !event.repeat && status === "idle") {
      event.preventDefault();
      void beginRecording();
    }
  }

  function handleRecordKeyUp(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      stopRecording();
    }
  }

  function startNewChat() {
    if (isBusy) return;
    setMessages([{ role: "assistant", content: WELCOME_MESSAGE }]);
    setDraft("");
    setError(undefined);
  }

  return (
    <section className="chat-page" aria-label="Schedule assistant">
      <aside className="chat-context-card">
        <div className="chat-context-icon" aria-hidden="true">
          <Sparkles size={20} />
        </div>
        <div>
          <p className="eyebrow">Live planner context</p>
          <h2>{serviceLine}</h2>
          <p>
            Signed in as <strong>{displayName}</strong>
          </p>
        </div>
        <button className="chat-new-button" type="button" onClick={startNewChat} disabled={isBusy}>
          <Plus size={16} />
          New chat
        </button>
      </aside>

      <div className="chat-surface">
        <div className="chat-thread" aria-live="polite">
          {messages.map((message, index) => (
            <article className={`chat-message ${message.role}`} key={`${message.role}-${index}`}>
              <div className="chat-avatar" aria-hidden="true">
                {message.role === "assistant" ? <Bot size={18} /> : <UserRound size={18} />}
              </div>
              <div className="chat-bubble">
                {message.content.split("\n").map((line, lineIndex) => (
                  <p key={lineIndex}>{renderInlineMarkdown(line || "\u00a0")}</p>
                ))}
              </div>
            </article>
          ))}
          {status === "thinking" && (
            <article className="chat-message assistant">
              <div className="chat-avatar" aria-hidden="true">
                <Bot size={18} />
              </div>
              <div className="chat-bubble chat-thinking" role="status">
                <span />
                <span />
                <span />
                <span className="sr-only">Assistant is checking the schedule</span>
              </div>
            </article>
          )}
          {status === "transcribing" && (
            <div className="chat-processing-pill" role="status">Transcribing your recording…</div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {messages.length === 1 && (
          <div className="chat-suggestions" aria-label="Suggested questions">
            {[
              "What does my next week look like?",
              "Who is on call this weekend?",
              "Show me upcoming vacations",
              "What OR cases are scheduled tomorrow?"
            ].map((suggestion) => (
              <button type="button" key={suggestion} onClick={() => void sendMessage(suggestion)} disabled={isBusy || quotaExhausted}>
                {suggestion}
              </button>
            ))}
          </div>
        )}

        <div className="chat-composer-wrap">
          {error && <p className="chat-error" role="alert">{error}</p>}
          {quota && quota.remaining <= quota.warningThreshold && quota.remaining > 0 && (
            <p className="chat-quota-warning" role="status">
              You have {quota.remaining} assistant {quota.remaining === 1 ? "request" : "requests"} left today.
            </p>
          )}
          {quotaExhausted && (
            <p className="chat-quota-warning exhausted" role="alert">
              Daily limit reached. Your 20 requests reset at midnight Eastern time.
            </p>
          )}
          <form className="chat-composer" onSubmit={submit}>
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void sendMessage(draft);
                }
              }}
              rows={1}
              placeholder="Ask about schedules…"
              aria-label="Message the schedule assistant"
              disabled={isBusy || quotaExhausted}
            />
            <button
              type="button"
              className={`chat-record-button${status === "recording" ? " recording" : ""}`}
              aria-label={status === "recording" ? "Release to send recording" : "Hold to record, release to send"}
              title="Hold to record, release to send"
              disabled={(isBusy && status !== "recording" && status !== "requesting-mic") || quotaExhausted}
              onPointerDown={(event) => void beginRecording(event)}
              onPointerUp={stopRecording}
              onPointerCancel={stopRecording}
              onKeyDown={handleRecordKeyDown}
              onKeyUp={handleRecordKeyUp}
            >
              <Mic size={19} />
              {status === "recording" && <span className="recording-pulse" />}
            </button>
            <button
              type="submit"
              className="chat-send-button"
              aria-label="Send message"
              disabled={!draft.trim() || isBusy || quotaExhausted}
            >
              <ArrowUp size={19} />
            </button>
          </form>
          <div className="chat-composer-meta">
            <span>{status === "recording" ? "Recording — release to send" : "Hold the mic to talk"}</span>
            <span>{quota ? `${quota.remaining} of ${quota.limit} requests left today` : "20 requests per day"}</span>
          </div>
        </div>
      </div>
    </section>
  );

  function stopTracks() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = undefined;
  }
}

function renderInlineMarkdown(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={index}>{part.slice(2, -2)}</strong>
    ) : (
      <Fragment key={index}>{part}</Fragment>
    )
  );
}

function getRecorderOptions(): MediaRecorderOptions | undefined {
  const candidates = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"];
  const mimeType = candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate));
  return mimeType ? { mimeType } : undefined;
}

async function audioBlobToWavBase64(blob: Blob): Promise<string> {
  const AudioContextClass = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) throw new Error("Audio processing is not supported in this browser");
  const context = new AudioContextClass();
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    const wav = encodeMonoWav(decoded, 16_000);
    return arrayBufferToBase64(wav);
  } finally {
    void context.close();
  }
}

function encodeMonoWav(buffer: AudioBuffer, targetRate: number): ArrayBuffer {
  const source = buffer.getChannelData(0);
  const ratio = buffer.sampleRate / targetRate;
  const sampleCount = Math.max(1, Math.floor(source.length / ratio));
  const wav = new ArrayBuffer(44 + sampleCount * 2);
  const view = new DataView(wav);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + sampleCount * 2, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, targetRate, true);
  view.setUint32(28, targetRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, sampleCount * 2, true);

  for (let index = 0; index < sampleCount; index += 1) {
    const sourceIndex = Math.min(source.length - 1, Math.floor(index * ratio));
    const sample = Math.max(-1, Math.min(1, source[sourceIndex]));
    view.setInt16(44 + index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return wav;
}

function writeAscii(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function playUiTone(kind: "start" | "send") {
  const AudioContextClass = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return;
  const context = new AudioContextClass();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const now = context.currentTime;
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(kind === "start" ? 520 : 680, now);
  oscillator.frequency.exponentialRampToValueAtTime(kind === "start" ? 680 : 940, now + 0.11);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.075, now + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(now);
  oscillator.stop(now + 0.15);
  oscillator.addEventListener("ended", () => void context.close(), { once: true });
}

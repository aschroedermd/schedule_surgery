import {
  ArrowUp,
  Bell,
  BellRing,
  Bot,
  CalendarPlus,
  Check,
  Copy,
  ExternalLink,
  Mic,
  Pencil,
  RotateCcw,
  Settings,
  Square,
  ThumbsDown,
  ThumbsUp,
  UserRound,
  Volume2,
  VolumeX,
  X
} from "lucide-react";
import { Fragment, FormEvent, KeyboardEvent, PointerEvent, ReactNode, useEffect, useRef, useState } from "react";
import {
  ChatConversationMessage,
  ChatLookup,
  ChatQuota,
  VoicePreset,
  VoiceQuota,
  fetchChatQuota,
  fetchVoiceQuota,
  refreshChatLookups,
  sendChatFeedback,
  streamChatMessage,
  synthesizeChatSpeech,
  transcribeChatAudio
} from "./api";

const MAX_RECORDING_MS = 60_000;
const RESPONSE_DELAY_MS = 8_000;
const HOLD_TO_SEND_MS = 400;
const COLLAPSED_MESSAGE_LENGTH = 560;
const MAX_VISIBLE_CARDS = 4;
const INPUT_PREFERENCE_KEY = "schedule-chat-input-preference";
const SILENT_AUDIO_DATA_URL = "data:audio/wav;base64,UklGRiUAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQEAAACA";
const VOICE_PRESETS: Array<{ id: VoicePreset; description: string }> = [
  { id: 1, description: "James · ElevenLabs" },
  { id: 2, description: "Voice 2 · ElevenLabs" },
  { id: 3, description: "Voice 3 · ElevenLabs" },
  { id: 4, description: "Fish Audio · OpenRouter" }
];

const WORKING_MESSAGES = [
  "I'll look into that…",
  "On it…",
  "Let me check on that…",
  "Checking the schedule…",
  "I’m pulling that up…",
  "Looking into it…",
  "Give me a moment…",
  "I’m on it…",
  "Let me take a look…",
  "Checking the details…",
  "I’ll find that for you…",
  "Reviewing the schedule…",
  "Working on it…",
  "Let me verify that…"
];

const ALMOST_DONE_MESSAGES = [
  "Almost there…",
  "Okay, almost got it…",
  "Just wrapping that up…",
  "One more moment…",
  "Finishing the check…",
  "Nearly ready…",
  "I’m almost done…",
  "Just a few more seconds…"
];

type ChatStatus = "idle" | "thinking" | "streaming" | "requesting-mic" | "recording" | "transcribing";
type SpeechStatus = "idle" | "generating" | "playing";
type ChatPlannerTab = "board" | "my" | "calendar" | "call";

interface ChatUiMessage extends ChatConversationMessage {
  id: string;
  kind?: "welcome";
  createdAt: string;
  checkedAt?: string;
  dataUpdatedAt?: string;
  stateVersion?: number;
  lookups?: ChatLookup[];
  expanded?: boolean;
  cardsExpanded?: boolean;
  feedback?: "up" | "down";
  copied?: boolean;
  watching?: boolean;
  hasScheduleUpdates?: boolean;
  streaming?: boolean;
}

interface ScheduleCard {
  id: string;
  date?: string;
  title: string;
  subtitle?: string;
  items: string[];
  warnings: string[];
  tab: ChatPlannerTab;
}

export function ChatTab({
  token,
  displayName,
  serviceLine,
  plannerVersion,
  onOpenPlanner
}: {
  token: string;
  displayName: string;
  serviceLine: string;
  plannerVersion: number;
  onOpenPlanner: (tab: ChatPlannerTab, date?: string) => void;
}) {
  const welcomeMessage = `Hi ${getFirstName(displayName)}, how can I help?`;
  const [messages, setMessages] = useState<ChatUiMessage[]>([
    {
      id: createChatMessageId(),
      role: "assistant",
      content: welcomeMessage,
      createdAt: new Date().toISOString(),
      kind: "welcome"
    }
  ]);
  const [draft, setDraft] = useState("");
  const [quota, setQuota] = useState<ChatQuota>();
  const [voiceQuota, setVoiceQuota] = useState<VoiceQuota>();
  const [voiceMode, setVoiceMode] = useState(false);
  const [voicePreset, setVoicePreset] = useState<VoicePreset>(1);
  const [chatSettingsOpen, setChatSettingsOpen] = useState(false);
  const [speechStatus, setSpeechStatus] = useState<SpeechStatus>("idle");
  const [status, setStatus] = useState<ChatStatus>("idle");
  const [error, setError] = useState<string>();
  const [lastFailedQuestion, setLastFailedQuestion] = useState<string>();
  const [responseStatusMessage, setResponseStatusMessage] = useState<string>();
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [voiceTranscriptReady, setVoiceTranscriptReady] = useState(false);
  const [inputPreference, setInputPreference] = useState<"typing" | "voice">(() => getStoredInputPreference());
  const threadRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const chatSettingsRef = useRef<HTMLDivElement>(null);
  const recorderRef = useRef<MediaRecorder>();
  const streamRef = useRef<MediaStream>();
  const chunksRef = useRef<Blob[]>([]);
  const recordingStartedAtRef = useRef(0);
  const holdActiveRef = useRef(false);
  const cancelRecordingRef = useRef(false);
  const recordingTimeoutRef = useRef<number>();
  const recordingIntervalRef = useRef<number>();
  const responseDelayTimeoutRef = useRef<number>();
  const responseAbortRef = useRef<AbortController>();
  const speechAudioRef = useRef<HTMLAudioElement>();
  const speechUrlRef = useRef<string>();
  const speechPlaybackPrimeRef = useRef<Promise<void>>();
  const workingMessageQueueRef = useRef<string[]>([]);
  const almostDoneMessageQueueRef = useRef<string[]>([]);
  const shouldAutoScrollRef = useRef(true);
  const lookupCheckVersionRef = useRef(new Map<string, number>());

  const isAnswering = status === "thinking" || status === "streaming";
  const isVoiceBusy = status === "requesting-mic" || status === "recording" || status === "transcribing";
  const isBusy = status !== "idle";
  const quotaExhausted = quota?.remaining === 0 && !quota.unlimited;
  const voiceQuotaExhausted = voiceQuota?.remaining === 0 && !voiceQuota.unlimited;

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchChatQuota(token), fetchVoiceQuota(token)])
      .then(([nextQuota, nextVoiceQuota]) => {
        if (!cancelled) {
          setQuota(nextQuota);
          setVoiceQuota(nextVoiceQuota);
        }
      })
      .catch((quotaError) => {
        if (!cancelled) setError(quotaError instanceof Error ? quotaError.message : "Unable to load assistant allowance");
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (!shouldAutoScrollRef.current) return;
    messagesEndRef.current?.scrollIntoView({
      block: "nearest",
      behavior: status === "streaming" ? "auto" : "smooth"
    });
  }, [messages, status]);

  useEffect(() => {
    const composer = composerRef.current;
    if (!composer) return;
    composer.style.height = "auto";
    composer.style.height = `${Math.min(composer.scrollHeight, 140)}px`;
  }, [draft]);

  useEffect(() => {
    function handleEscape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape" && responseAbortRef.current) stopResponse();
    }
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("keydown", handleEscape);
      window.clearTimeout(recordingTimeoutRef.current);
      window.clearInterval(recordingIntervalRef.current);
      window.clearTimeout(responseDelayTimeoutRef.current);
      responseAbortRef.current?.abort();
      stopSpeech(true);
      if (recorderRef.current?.state === "recording") {
        recorderRef.current.onstop = null;
        recorderRef.current.stop();
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    if (voiceQuotaExhausted && speechStatus === "idle") setVoiceMode(false);
  }, [speechStatus, voiceQuotaExhausted]);

  useEffect(() => {
    if (!chatSettingsOpen) return;
    function closeChatSettings(event: MouseEvent | globalThis.KeyboardEvent) {
      if (event.type === "keydown" && (event as globalThis.KeyboardEvent).key !== "Escape") return;
      if (event.type === "mousedown" && chatSettingsRef.current?.contains(event.target as Node)) return;
      setChatSettingsOpen(false);
    }
    document.addEventListener("mousedown", closeChatSettings);
    window.addEventListener("keydown", closeChatSettings);
    return () => {
      document.removeEventListener("mousedown", closeChatSettings);
      window.removeEventListener("keydown", closeChatSettings);
    };
  }, [chatSettingsOpen]);

  useEffect(() => {
    if (!plannerVersion) return;
    const watchedMessages = messages.filter(
      (message) =>
        message.role === "assistant" &&
        message.watching &&
        !message.hasScheduleUpdates &&
        message.lookups?.length &&
        message.stateVersion &&
        plannerVersion > message.stateVersion &&
        lookupCheckVersionRef.current.get(message.id) !== plannerVersion
    );
    for (const message of watchedMessages) {
      lookupCheckVersionRef.current.set(message.id, plannerVersion);
      void refreshChatLookups(token, serviceLine, message.lookups!)
        .then((refreshed) => {
          if (serializeLookupResults(refreshed.lookups) === serializeLookupResults(message.lookups!)) {
            setMessages((current) =>
              current.map((candidate) =>
                candidate.id === message.id
                  ? {
                      ...candidate,
                      stateVersion: refreshed.stateVersion,
                      checkedAt: refreshed.checkedAt,
                      dataUpdatedAt: refreshed.dataUpdatedAt
                    }
                  : candidate
              )
            );
            return;
          }
          setMessages((current) =>
            current.map((candidate) =>
              candidate.id === message.id ? { ...candidate, hasScheduleUpdates: true } : candidate
            )
          );
          if (typeof Notification !== "undefined" && Notification.permission === "granted") {
            new Notification("Schedule update", { body: "Schedule information in a watched answer has changed." });
          }
        })
        .catch(() => undefined);
    }
  }, [messages, plannerVersion, serviceLine, token]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    await sendMessage(draft);
  }

  async function sendMessage(
    rawText: string,
    options: { appendUser?: boolean; baseMessages?: ChatUiMessage[] } = {}
  ) {
    const content = rawText.trim();
    if (!content || isBusy || quotaExhausted) return;
    const baseMessages = options.baseMessages ?? messages;
    const userMessage: ChatUiMessage = {
      id: createChatMessageId(),
      role: "user",
      content,
      createdAt: new Date().toISOString()
    };
    const nextMessages = options.appendUser === false ? baseMessages : [...baseMessages, userMessage];
    setMessages(nextMessages);
    setDraft("");
    setVoiceTranscriptReady(false);
    setError(undefined);
    setLastFailedQuestion(undefined);
    shouldAutoScrollRef.current = true;
    setResponseStatusMessage(nextRandomizedMessage(WORKING_MESSAGES, workingMessageQueueRef));
    setStatus("thinking");
    responseDelayTimeoutRef.current = window.setTimeout(() => {
      setResponseStatusMessage(nextRandomizedMessage(ALMOST_DONE_MESSAGES, almostDoneMessageQueueRef));
    }, RESPONSE_DELAY_MS);
    const controller = new AbortController();
    const shouldSpeak = voiceMode && !voiceQuotaExhausted;
    const selectedVoicePreset = voicePreset;
    responseAbortRef.current = controller;
    const requestStartedAt = Date.now();
    let assistantMessageId: string | undefined;
    let streamedContent = "";

    try {
      const response = await streamChatMessage(
        token,
        toConversationMessages(nextMessages),
        serviceLine,
        {
          onMeta: (meta) => {
            setQuota({
              used: meta.used,
              remaining: meta.remaining,
              limit: meta.limit,
              warningThreshold: meta.warningThreshold,
              unlimited: meta.unlimited
            });
          },
          onReset: () => {
            if (assistantMessageId) {
              const provisionalMessageId = assistantMessageId;
              setMessages((current) => current.filter((message) => message.id !== provisionalMessageId));
            }
            assistantMessageId = undefined;
            streamedContent = "";
            window.clearTimeout(responseDelayTimeoutRef.current);
            const elapsed = Date.now() - requestStartedAt;
            if (elapsed >= RESPONSE_DELAY_MS) {
              setResponseStatusMessage(nextRandomizedMessage(ALMOST_DONE_MESSAGES, almostDoneMessageQueueRef));
            } else {
              setResponseStatusMessage(nextRandomizedMessage(WORKING_MESSAGES, workingMessageQueueRef));
              responseDelayTimeoutRef.current = window.setTimeout(() => {
                setResponseStatusMessage(nextRandomizedMessage(ALMOST_DONE_MESSAGES, almostDoneMessageQueueRef));
              }, RESPONSE_DELAY_MS - elapsed);
            }
            setStatus("thinking");
          },
          onDelta: (delta) => {
            if (!assistantMessageId) {
              assistantMessageId = createChatMessageId();
              window.clearTimeout(responseDelayTimeoutRef.current);
              setResponseStatusMessage(undefined);
              setStatus("streaming");
              streamedContent = delta;
              setMessages((current) => [
                ...current,
                {
                  id: assistantMessageId!,
                  role: "assistant",
                  content: delta,
                  createdAt: new Date().toISOString(),
                  streaming: true
                }
              ]);
              return;
            }
            streamedContent += delta;
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantMessageId ? { ...message, content: streamedContent } : message
              )
            );
          }
        },
        controller.signal,
        shouldSpeak
      );
      const completedId = assistantMessageId ?? createChatMessageId();
      setMessages((current) => {
        const completedMessage: ChatUiMessage = {
          id: completedId,
          role: "assistant",
          content: response.message,
          createdAt: new Date().toISOString(),
          checkedAt: response.checkedAt,
          dataUpdatedAt: response.dataUpdatedAt,
          stateVersion: response.stateVersion,
          lookups: response.lookups,
          streaming: false
        };
        return assistantMessageId
          ? current.map((message) => (message.id === assistantMessageId ? { ...message, ...completedMessage } : message))
          : [...current, completedMessage];
      });
      setQuota({
        used: response.used,
        remaining: response.remaining,
        limit: response.limit,
        warningThreshold: response.warningThreshold,
        unlimited: response.unlimited
      });
      if (shouldSpeak) {
        setSpeechStatus("generating");
        try {
          const speech = await synthesizeChatSpeech(token, response.message, selectedVoicePreset);
          setVoiceQuota(speech.quota);
          await playSpeech(speech.audio);
        } catch (speechError) {
          setSpeechStatus("idle");
          setError(
            speechError instanceof Error
              ? `The answer is ready, but it could not be spoken: ${speechError.message}`
              : "The answer is ready, but it could not be spoken"
          );
          void fetchVoiceQuota(token).then(setVoiceQuota).catch(() => undefined);
        }
      }
    } catch (sendError) {
      if (assistantMessageId) {
        setMessages((current) => current.filter((message) => message.id !== assistantMessageId));
      }
      setDraft((current) => current || content);
      setVoiceTranscriptReady(false);
      if (!isAbortError(sendError)) {
        setError(sendError instanceof Error ? sendError.message : "The assistant could not answer");
        setLastFailedQuestion(content);
      }
      void fetchChatQuota(token).then(setQuota).catch(() => undefined);
    } finally {
      responseAbortRef.current = undefined;
      window.clearTimeout(responseDelayTimeoutRef.current);
      setResponseStatusMessage(undefined);
      setStatus("idle");
      window.requestAnimationFrame(() => composerRef.current?.focus());
    }
  }

  function stopResponse() {
    responseAbortRef.current?.abort();
  }

  function toggleVoiceMode() {
    if (voiceQuotaExhausted || isBusy) return;
    if (voiceMode) {
      stopSpeech();
    } else {
      primeSpeechPlayback();
    }
    setVoiceMode((current) => !current);
    setError(undefined);
  }

  function getSpeechAudio(): HTMLAudioElement {
    if (!speechAudioRef.current) {
      speechAudioRef.current = new Audio();
      speechAudioRef.current.preload = "auto";
    }
    return speechAudioRef.current;
  }

  function primeSpeechPlayback() {
    const audio = getSpeechAudio();
    audio.onended = null;
    audio.onerror = null;
    audio.muted = true;
    audio.src = SILENT_AUDIO_DATA_URL;
    speechPlaybackPrimeRef.current = audio.play()
      .then(() => {
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
        audio.muted = false;
      })
      .catch(() => {
        audio.muted = false;
      });
  }

  async function playSpeech(blob: Blob) {
    await speechPlaybackPrimeRef.current;
    stopSpeech();
    const url = URL.createObjectURL(blob);
    const audio = getSpeechAudio();
    audio.src = url;
    audio.muted = false;
    speechUrlRef.current = url;
    audio.onended = () => stopSpeech();
    audio.onerror = () => stopSpeech();
    setSpeechStatus("playing");
    try {
      await audio.play();
    } catch {
      stopSpeech();
      throw new Error("Your browser blocked automatic audio playback");
    }
  }

  function stopSpeech(releaseAudio = false) {
    const audio = speechAudioRef.current;
    if (audio) {
      audio.pause();
      audio.onended = null;
      audio.onerror = null;
      audio.removeAttribute("src");
      audio.load();
      audio.muted = false;
      if (releaseAudio) speechAudioRef.current = undefined;
    }
    if (speechUrlRef.current) {
      URL.revokeObjectURL(speechUrlRef.current);
      speechUrlRef.current = undefined;
    }
    setSpeechStatus("idle");
  }

  async function beginRecording() {
    if (isBusy || quotaExhausted) return;
    rememberInputPreference("voice");
    setInputPreference("voice");
    holdActiveRef.current = true;
    cancelRecordingRef.current = false;
    setError(undefined);
    setVoiceTranscriptReady(false);
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
      setRecordingDuration(0);
      setStatus("recording");
      playUiTone("start");
      recordingIntervalRef.current = window.setInterval(() => {
        setRecordingDuration(Date.now() - recordingStartedAtRef.current);
      }, 200);
      recordingTimeoutRef.current = window.setTimeout(() => stopRecording(false), MAX_RECORDING_MS);
    } catch (recordingError) {
      holdActiveRef.current = false;
      stopTracks();
      setStatus("idle");
      setError(recordingError instanceof Error ? recordingError.message : "Microphone access failed");
    }
  }

  function stopRecording(cancel: boolean) {
    holdActiveRef.current = false;
    cancelRecordingRef.current = cancel;
    window.clearTimeout(recordingTimeoutRef.current);
    window.clearInterval(recordingIntervalRef.current);
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
    if (cancelRecordingRef.current) {
      cancelRecordingRef.current = false;
      setRecordingDuration(0);
      setStatus("idle");
      return;
    }

    if (elapsed < 350 || !blob.size) {
      setStatus("idle");
      setError("Record a little longer, then tap again or release to finish");
      return;
    }

    setStatus("transcribing");
    playUiTone("send");
    try {
      const wavBase64 = await audioBlobToWavBase64(blob);
      const { text } = await transcribeChatAudio(token, wavBase64, "wav");
      setDraft(text);
      setVoiceTranscriptReady(true);
      setStatus("idle");
      window.requestAnimationFrame(() => composerRef.current?.focus());
    } catch (transcriptionError) {
      setStatus("idle");
      setError(transcriptionError instanceof Error ? transcriptionError.message : "The recording could not be transcribed");
    }
  }

  function handleRecordPointerDown(event: PointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    if (recorderRef.current?.state === "recording" || status === "requesting-mic") {
      stopRecording(false);
      return;
    }
    recordingStartedAtRef.current = Date.now();
    void beginRecording();
  }

  function handleRecordPointerUp(event: PointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    if (recorderRef.current?.state !== "recording" && status !== "requesting-mic") return;
    if (Date.now() - recordingStartedAtRef.current >= HOLD_TO_SEND_MS) stopRecording(false);
  }

  function handleRecordKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if ((event.key === " " || event.key === "Enter") && !event.repeat) {
      event.preventDefault();
      if (recorderRef.current?.state === "recording" || status === "requesting-mic") stopRecording(false);
      else void beginRecording();
    }
  }

  function handleThreadScroll() {
    const thread = threadRef.current;
    if (!thread) return;
    shouldAutoScrollRef.current = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 96;
  }

  function retryLastQuestion() {
    const lastUserIndex = findLastUserMessageIndex(messages);
    if (lastUserIndex < 0 || isBusy) return;
    const baseMessages = messages.slice(0, lastUserIndex + 1);
    void sendMessage(messages[lastUserIndex].content, { appendUser: false, baseMessages });
  }

  function regenerateResponse(messageIndex: number) {
    const precedingUserIndex = findLastUserMessageIndex(messages, messageIndex);
    if (precedingUserIndex < 0 || isBusy) return;
    const baseMessages = messages.slice(0, precedingUserIndex + 1);
    void sendMessage(messages[precedingUserIndex].content, { appendUser: false, baseMessages });
  }

  function editQuestion(message: ChatUiMessage) {
    setDraft(message.content);
    setVoiceTranscriptReady(false);
    window.requestAnimationFrame(() => composerRef.current?.focus());
  }

  async function copyResponse(message: ChatUiMessage) {
    await navigator.clipboard.writeText(message.content);
    setMessages((current) =>
      current.map((candidate) => (candidate.id === message.id ? { ...candidate, copied: true } : candidate))
    );
    window.setTimeout(() => {
      setMessages((current) =>
        current.map((candidate) => (candidate.id === message.id ? { ...candidate, copied: false } : candidate))
      );
    }, 1600);
  }

  function rateResponse(message: ChatUiMessage, rating: "up" | "down") {
    setMessages((current) =>
      current.map((candidate) => (candidate.id === message.id ? { ...candidate, feedback: rating } : candidate))
    );
    void sendChatFeedback(token, rating, message.content).catch(() => undefined);
  }

  async function toggleWatching(message: ChatUiMessage) {
    const watching = !message.watching;
    setMessages((current) =>
      current.map((candidate) =>
        candidate.id === message.id ? { ...candidate, watching, hasScheduleUpdates: watching ? candidate.hasScheduleUpdates : false } : candidate
      )
    );
    if (watching && typeof Notification !== "undefined" && Notification.permission === "default") {
      await Notification.requestPermission().catch(() => "denied");
    }
  }

  return (
    <section className="chat-page" aria-label="Schedule assistant">
      <div className="chat-surface">
        <div className="chat-voice-controls" aria-label="Spoken response controls" ref={chatSettingsRef}>
          <button
            type="button"
            className={`chat-voice-mode-button${voiceMode ? " active" : ""}${speechStatus === "playing" ? " speaking" : ""}`}
            aria-label={
              voiceQuotaExhausted
                ? "Daily spoken response limit reached"
                : voiceMode
                  ? "Turn off spoken responses"
                  : "Turn on spoken responses"
            }
            aria-pressed={voiceMode}
            title={voiceModeTitle(voiceMode, voiceQuota, speechStatus, voicePreset)}
            disabled={voiceQuotaExhausted || isBusy}
            onClick={toggleVoiceMode}
          >
            {voiceMode ? <Volume2 size={18} /> : <VolumeX size={18} />}
          </button>
          <button
            type="button"
            className={`chat-settings-button${chatSettingsOpen ? " active" : ""}`}
            aria-label="Chatbot settings"
            aria-haspopup="dialog"
            aria-expanded={chatSettingsOpen}
            aria-controls="chatbot-settings-panel"
            title="Chatbot settings"
            onClick={() => setChatSettingsOpen((open) => !open)}
          >
            <Settings size={17} />
          </button>
          {chatSettingsOpen && (
            <div id="chatbot-settings-panel" className="chat-settings-panel" role="dialog" aria-label="Chatbot settings">
              <strong>Chatbot settings</strong>
              <div className="chat-settings-row">
                <span>Voice</span>
                <div className="chat-voice-presets" role="group" aria-label="Select spoken response voice">
                  {VOICE_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      className={voicePreset === preset.id ? "active" : ""}
                      aria-label={`Select ${preset.description}`}
                      aria-pressed={voicePreset === preset.id}
                      title={preset.description}
                      disabled={voiceQuotaExhausted || isBusy}
                      onClick={() => {
                        setVoicePreset(preset.id);
                        setChatSettingsOpen(false);
                      }}
                    >
                      {preset.id}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="chat-thread" aria-live="polite" ref={threadRef} onScroll={handleThreadScroll}>
          {messages.map((message, index) => (
            <article className={`chat-message ${message.role}${message.streaming ? " streaming" : ""}`} key={message.id}>
              <div className="chat-avatar" aria-hidden="true">
                {message.role === "assistant" ? <Bot size={18} /> : <UserRound size={18} />}
              </div>
              <div className="chat-message-body">
                <div className="chat-bubble">
                  <MessageText message={message} />
                  {isLongMessage(message.content) && !message.streaming && (
                    <button
                      className="chat-inline-action"
                      type="button"
                      onClick={() =>
                        setMessages((current) =>
                          current.map((candidate) =>
                            candidate.id === message.id ? { ...candidate, expanded: !candidate.expanded } : candidate
                          )
                        )
                      }
                    >
                      {message.expanded ? "Show less" : "Show details"}
                    </button>
                  )}
                </div>
                {message.role === "assistant" && message.lookups?.length ? (
                  <ScheduleCards
                    message={message}
                    onToggleExpanded={() =>
                      setMessages((current) =>
                        current.map((candidate) =>
                          candidate.id === message.id ? { ...candidate, cardsExpanded: !candidate.cardsExpanded } : candidate
                        )
                      )
                    }
                    onOpenPlanner={onOpenPlanner}
                  />
                ) : null}
                {message.role === "assistant" && message.kind !== "welcome" && !message.streaming && (
                  <div className="chat-response-footer">
                    <span>
                      Checked {formatCheckedTime(message.checkedAt ?? new Date().toISOString())}
                      {message.dataUpdatedAt && (
                        <span title={`Schedule last updated ${new Date(message.dataUpdatedAt).toLocaleString()}`}>
                          {" · "}data {formatRelativeTimestamp(message.dataUpdatedAt)}
                        </span>
                      )}
                    </span>
                    {message.hasScheduleUpdates && (
                      <button type="button" className="chat-update-alert" onClick={() => regenerateResponse(index)}>
                        Schedule changed — refresh
                      </button>
                    )}
                    <div className="chat-message-actions" aria-label="Response actions">
                      <IconAction
                        label={message.copied ? "Copied" : "Copy response"}
                        onClick={() => void copyResponse(message)}
                      >
                        {message.copied ? <Check size={15} /> : <Copy size={15} />}
                      </IconAction>
                      <IconAction
                        label="Helpful"
                        active={message.feedback === "up"}
                        onClick={() => rateResponse(message, "up")}
                      >
                        <ThumbsUp size={15} />
                      </IconAction>
                      <IconAction
                        label="Not helpful"
                        active={message.feedback === "down"}
                        onClick={() => rateResponse(message, "down")}
                      >
                        <ThumbsDown size={15} />
                      </IconAction>
                      <IconAction label="Try again" onClick={() => regenerateResponse(index)} disabled={isBusy}>
                        <RotateCcw size={15} />
                      </IconAction>
                      {message.lookups?.length ? (
                        <IconAction
                          label={message.watching ? "Stop watching changes" : "Notify me if this schedule changes"}
                          active={message.watching}
                          onClick={() => void toggleWatching(message)}
                        >
                          {message.watching ? <BellRing size={15} /> : <Bell size={15} />}
                        </IconAction>
                      ) : null}
                    </div>
                  </div>
                )}
                {message.role === "user" && (
                  <div className="chat-user-actions">
                    <IconAction label="Edit question" onClick={() => editQuestion(message)} disabled={isBusy}>
                      <Pencil size={14} />
                    </IconAction>
                  </div>
                )}
              </div>
            </article>
          ))}
          {status === "thinking" && responseStatusMessage && (
            <article className="chat-message assistant chat-response-status" role="status">
              <div className="chat-avatar" aria-hidden="true">
                <Bot size={18} />
              </div>
              <div className="chat-response-progress">
                <div className="chat-bubble">{responseStatusMessage}</div>
                <div className="chat-bubble chat-thinking" aria-label="Assistant is checking the schedule">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            </article>
          )}
          {status === "transcribing" && (
            <div className="chat-processing-pill" role="status">Transcribing your recording…</div>
          )}
          {speechStatus === "generating" && (
            <div className="chat-processing-pill" role="status">Preparing spoken response…</div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="chat-composer-wrap">
          {error && (
            <div className="chat-error" role="alert">
              <span>{error}</span>
              {lastFailedQuestion && (
                <button type="button" onClick={retryLastQuestion} disabled={isBusy}>Try again</button>
              )}
            </div>
          )}
          {status === "recording" && (
            <div className="chat-recording-status" role="status">
              <span><span className="chat-recording-dot" />Recording {formatDuration(recordingDuration)}</span>
              <button type="button" onClick={() => stopRecording(true)}>
                <X size={15} /> Cancel
              </button>
            </div>
          )}
          {voiceTranscriptReady && (
            <p className="chat-transcript-status" role="status">Transcript ready — review or edit it before sending.</p>
          )}
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
              ref={composerRef}
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                setVoiceTranscriptReady(false);
                rememberInputPreference("typing");
                setInputPreference("typing");
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void sendMessage(draft);
                  return;
                }
                if (event.key === "ArrowUp" && !draft && event.currentTarget.selectionStart === 0) {
                  const lastUserIndex = findLastUserMessageIndex(messages);
                  if (lastUserIndex >= 0) setDraft(messages[lastUserIndex].content);
                }
              }}
              rows={1}
              placeholder="Ask about scheduling things"
              aria-label="Message the schedule assistant"
              enterKeyHint="send"
              autoCapitalize="sentences"
              autoCorrect="on"
              onFocus={() => {
                shouldAutoScrollRef.current = true;
                window.requestAnimationFrame(() => {
                  const thread = threadRef.current;
                  if (thread) thread.scrollTop = thread.scrollHeight;
                });
              }}
              disabled={isVoiceBusy || quotaExhausted}
            />
            <button
              type="button"
              className={`chat-record-button${status === "recording" ? " recording" : ""}${inputPreference === "voice" ? " preferred" : ""}`}
              aria-label={status === "recording" ? "Stop recording" : "Tap or hold to record"}
              title={status === "recording" ? "Stop recording" : "Tap or hold to record"}
              disabled={(isBusy && status !== "recording" && status !== "requesting-mic") || quotaExhausted}
              onPointerDown={handleRecordPointerDown}
              onPointerUp={handleRecordPointerUp}
              onPointerCancel={() => stopRecording(true)}
              onKeyDown={handleRecordKeyDown}
            >
              {status === "recording" ? <Square size={17} fill="currentColor" /> : <Mic size={19} />}
              {status === "recording" && <span className="recording-pulse" />}
            </button>
            {isAnswering ? (
              <button type="button" className="chat-send-button stop" aria-label="Stop response" onClick={stopResponse}>
                <Square size={16} fill="currentColor" />
              </button>
            ) : (
              <button
                type="submit"
                className="chat-send-button"
                aria-label="Send message"
                disabled={!draft.trim() || isVoiceBusy || quotaExhausted}
              >
                <ArrowUp size={19} />
              </button>
            )}
          </form>
          <div className="chat-composer-meta">
            <span>
              {status === "recording"
                ? "Tap again or release after holding to finish"
                : isAnswering
                  ? "Esc also stops the response"
                  : inputPreference === "voice"
                    ? "Tap or hold the mic to talk"
                    : "Enter sends · tap the mic for voice"}
            </span>
            <span className={quota && quota.remaining > quota.warningThreshold ? "chat-quota-subtle" : ""}>
              {quota?.unlimited
                ? "Unlimited assistant requests"
                : quota
                  ? `${quota.remaining} of ${quota.limit} requests left today`
                  : "20 requests per day"}
            </span>
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

function MessageText({ message }: { message: ChatUiMessage }) {
  const content = message.expanded ? message.content : collapseMessage(message.content);
  return (
    <>
      {content.split("\n").map((line, lineIndex) => (
        <p key={lineIndex}>{renderInlineMarkdown(line || "\u00a0")}</p>
      ))}
      {message.streaming && <span className="chat-streaming-cursor" aria-hidden="true" />}
    </>
  );
}

function IconAction({
  label,
  children,
  onClick,
  active = false,
  disabled = false
}: {
  label: string;
  children: ReactNode;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={`chat-icon-action${active ? " active" : ""}`}
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

function ScheduleCards({
  message,
  onToggleExpanded,
  onOpenPlanner
}: {
  message: ChatUiMessage;
  onToggleExpanded: () => void;
  onOpenPlanner: (tab: ChatPlannerTab, date?: string) => void;
}) {
  const cards = buildScheduleCards(message.lookups ?? []);
  if (!cards.length) return null;
  const visibleCards = message.cardsExpanded ? cards : cards.slice(0, MAX_VISIBLE_CARDS);
  return (
    <section className="chat-schedule-section" aria-label="Schedule details">
      <div className="chat-schedule-heading">
        <strong>Schedule details</strong>
        <button type="button" onClick={() => downloadCardsAsIcs(cards)}>
          <CalendarPlus size={14} /> Add to calendar
        </button>
      </div>
      <div className="chat-schedule-cards">
        {visibleCards.map((card) => (
          <article className="chat-schedule-card" key={card.id}>
            <div className="chat-schedule-card-heading">
              <div>
                {card.date && <time dateTime={card.date}>{formatCardDate(card.date)}</time>}
                <strong>{card.title}</strong>
              </div>
              <button
                type="button"
                aria-label={`Open ${card.date ? `${card.date} in ` : ""}planner`}
                title="Open in planner"
                onClick={() => onOpenPlanner(card.tab, card.date)}
              >
                <ExternalLink size={15} />
              </button>
            </div>
            {card.subtitle && <p className="chat-schedule-subtitle">{card.subtitle}</p>}
            {card.items.length > 0 && (
              <ul>
                {card.items.map((item, index) => <li key={`${card.id}-item-${index}`}>{item}</li>)}
              </ul>
            )}
            {card.warnings.map((warning, index) => (
              <p className="chat-schedule-warning" key={`${card.id}-warning-${index}`}>{warning}</p>
            ))}
          </article>
        ))}
      </div>
      {cards.length > MAX_VISIBLE_CARDS && (
        <button type="button" className="chat-inline-action" onClick={onToggleExpanded}>
          {message.cardsExpanded ? "Show fewer schedule items" : `Show ${cards.length - MAX_VISIBLE_CARDS} more`}
        </button>
      )}
    </section>
  );
}

function buildScheduleCards(lookups: ChatLookup[]): ScheduleCard[] {
  const cards: ScheduleCard[] = [];
  const seen = new Set<string>();

  function addCard(card: Omit<ScheduleCard, "id">) {
    const key = JSON.stringify([card.date, card.title, card.subtitle, card.items]);
    if (seen.has(key)) return;
    seen.add(key);
    cards.push({ ...card, id: `schedule-${cards.length}-${card.date ?? "range"}` });
  }

  for (const lookup of lookups) {
    const result = asRecord(lookup.result);
    if (lookup.tool === "get_or_schedule") {
      for (const dayValue of asArray(result.days)) {
        const day = asRecord(dayValue);
        const date = asString(day.date);
        for (const blockValue of asArray(day.or)) {
          const block = asRecord(blockValue);
          const items = asArray(block.cases).map((caseValue) => {
            const surgeryCase = asRecord(caseValue);
            const residents = asStringArray(surgeryCase.residents);
            return compactJoin([
              asString(surgeryCase.time),
              asString(surgeryCase.procedure),
              residents.length ? residents.join(", ") : "Uncovered"
            ], " · ");
          });
          for (const uncoveredValue of asArray(day.uncovered)) {
            const uncovered = asRecord(uncoveredValue);
            items.push(compactJoin([
              asString(uncovered.time),
              asString(uncovered.procedure),
              "Uncovered"
            ], " · "));
          }
          addCard({
            date,
            title: compactJoin([asString(block.attending), "OR"], " · ") || "OR",
            subtitle: compactJoin(
              [asString(block.service), asString(block.hospital), withLabel(asString(block.firstCase), "first case")],
              " · "
            ),
            items,
            warnings: uniqueStrings([
              ...asStringArray(block.warnings),
              ...asArray(block.cases).flatMap((caseValue) => asStringArray(asRecord(caseValue).warnings))
            ]),
            tab: "board"
          });
        }
        for (const clinicValue of asArray(day.clinics)) {
          const clinic = asRecord(clinicValue);
          const residents = asStringArray(clinic.residents);
          addCard({
            date,
            title: compactJoin([asString(clinic.attending), "Clinic"], " · ") || "Clinic",
            subtitle: compactJoin(
              [asString(clinic.time), asString(clinic.location), asString(clinic.service)],
              " · "
            ),
            items: [residents.length ? residents.join(", ") : "No resident assigned"],
            warnings: asStringArray(clinic.warnings),
            tab: "board"
          });
        }
      }
    }

    if (lookup.tool === "get_call_schedule") {
      for (const shiftValue of asArray(result.shifts)) {
        const shift = asRecord(shiftValue);
        const attending = asRecord(shift.attending);
        const residents = asRecord(shift.residents);
        const attendingText =
          asString(attending.all_day) ||
          compactJoin([
            withLabel(asString(attending.day), "day"),
            withLabel(asString(attending.night), "night")
          ], " · ");
        const residentItems = [
          withLabel(asStringArray(residents.senior).join(", "), "Senior"),
          withLabel(asStringArray(residents.mid_level).join(", "), "Mid-level"),
          withLabel(asStringArray(residents.intern).join(", "), "Intern")
        ].filter((value): value is string => Boolean(value));
        addCard({
          date: asString(shift.date),
          title: compactJoin([asString(shift.weekday), "General Surgery call"], " · "),
          subtitle: attendingText,
          items: residentItems,
          warnings: [],
          tab: "call"
        });
      }
    }

    if (lookup.tool === "get_calendar") {
      addCalendarEntryCards(asArray(result.entries), addCard);
    }

    if (lookup.tool === "get_vacations") {
      for (const vacationValue of asArray(result.vacations)) {
        const vacation = asRecord(vacationValue);
        const startDate = asString(vacation.startDate);
        const endDate = asString(vacation.endDate);
        addCard({
          date: startDate,
          title: `${asString(vacation.resident) || "Resident"} · Vacation`,
          subtitle: endDate && endDate !== startDate ? `Through ${formatCardDate(endDate)}` : undefined,
          items: [],
          warnings: [],
          tab: "calendar"
        });
      }
    }

    if (lookup.tool === "get_my_schedule") {
      for (const assignmentValue of asArray(result.assignments)) {
        const assignment = asRecord(assignmentValue);
        addCard({
          date: asString(assignment.date),
          title: asString(assignment.type) || "Assignment",
          subtitle: compactJoin([asString(assignment.time), asString(assignment.label)], " · "),
          items: [],
          warnings: [],
          tab: "my"
        });
      }
      addCalendarEntryCards(asArray(result.calendar), addCard, "my");
      for (const vacationValue of asArray(result.vacation)) {
        const vacation = asRecord(vacationValue);
        const startDate = asString(vacation.startDate);
        const endDate = asString(vacation.endDate);
        addCard({
          date: startDate,
          title: "Vacation",
          subtitle: endDate && endDate !== startDate ? `Through ${formatCardDate(endDate)}` : undefined,
          items: [],
          warnings: [],
          tab: "my"
        });
      }
    }
  }
  return cards.sort((left, right) => (left.date ?? "").localeCompare(right.date ?? ""));
}

function addCalendarEntryCards(
  entries: unknown[],
  addCard: (card: Omit<ScheduleCard, "id">) => void,
  tab: ChatPlannerTab = "calendar"
) {
  for (const entryValue of entries) {
    const entry = asRecord(entryValue);
    const kind = asString(entry.kind) || "Calendar";
    const attending = compactJoin([
      withLabel(asString(entry.day_attending), "day"),
      withLabel(asString(entry.night_attending), "night")
    ], " · ");
    addCard({
      date: asString(entry.date),
      title: formatScheduleKind(kind),
      subtitle: compactJoin([asString(entry.service), asString(entry.position)], " · "),
      items: uniqueStrings([asString(entry.resident), attending, asString(entry.note)]),
      warnings: [],
      tab
    });
  }
}

function collapseMessage(content: string): string {
  if (!isLongMessage(content)) return content;
  const candidate = content.slice(0, COLLAPSED_MESSAGE_LENGTH);
  const boundary = Math.max(candidate.lastIndexOf("\n"), candidate.lastIndexOf(" "));
  return `${candidate.slice(0, boundary > COLLAPSED_MESSAGE_LENGTH * 0.65 ? boundary : candidate.length).trimEnd()}…`;
}

function isLongMessage(content: string): boolean {
  return content.length > COLLAPSED_MESSAGE_LENGTH || content.split("\n").length > 8;
}

function toConversationMessages(messages: ChatUiMessage[]): ChatConversationMessage[] {
  return messages
    .filter((message) => message.kind !== "welcome" && !message.streaming)
    .map(({ role, content }) => ({ role, content }));
}

function findLastUserMessageIndex(messages: ChatUiMessage[], beforeIndex = messages.length): number {
  for (let index = Math.min(beforeIndex - 1, messages.length - 1); index >= 0; index -= 1) {
    if (messages[index].role === "user") return index;
  }
  return -1;
}

function createChatMessageId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `chat-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function formatCheckedTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "just now";
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatRelativeTimestamp(value: string): string {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "update time unavailable";
  const elapsedMinutes = Math.max(0, Math.round((Date.now() - timestamp) / 60_000));
  if (elapsedMinutes < 1) return "updated just now";
  if (elapsedMinutes < 60) return `updated ${elapsedMinutes}m ago`;
  const elapsedHours = Math.round(elapsedMinutes / 60);
  if (elapsedHours < 24) return `updated ${elapsedHours}h ago`;
  return `updated ${new Date(timestamp).toLocaleDateString([], { month: "short", day: "numeric" })}`;
}

function formatCardDate(value: string): string {
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function voiceModeTitle(
  voiceMode: boolean,
  quota: VoiceQuota | undefined,
  status: SpeechStatus,
  voicePreset: VoicePreset
): string {
  if (quota && quota.remaining === 0 && !quota.unlimited) return "Spoken response limit reached for today";
  if (status === "generating") return "Preparing spoken response";
  if (status === "playing") return "Speaking response — click to stop voice mode";
  const allowance = quota?.unlimited
    ? "unlimited uses"
    : quota
      ? `${quota.remaining} of ${quota.limit} spoken responses left today`
      : "3 spoken responses per day";
  return `${voiceMode ? "Spoken responses on" : "Spoken responses off"} · voice ${voicePreset} · ${allowance}`;
}

function formatScheduleKind(kind: string): string {
  return kind
    .split("-")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function serializeLookupResults(lookups: ChatLookup[]): string {
  return JSON.stringify(lookups.map((lookup) => ({ tool: lookup.tool, result: lookup.result })));
}

function downloadCardsAsIcs(cards: ScheduleCard[]) {
  const events = cards.filter((card) => card.date).map((card, index) => cardToIcsEvent(card, index));
  if (!events.length) return;
  const calendar = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Resident OR Coverage Planner//Schedule Assistant//EN",
    "CALSCALE:GREGORIAN",
    ...events,
    "END:VCALENDAR",
    ""
  ].join("\r\n");
  const url = URL.createObjectURL(new Blob([calendar], { type: "text/calendar;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "schedule-assistant.ics";
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function cardToIcsEvent(card: ScheduleCard, index: number): string {
  const date = card.date!.replaceAll("-", "");
  const timeMatch = card.subtitle?.match(/\b(\d{1,2}):(\d{2})\b/) ?? card.items.join(" ").match(/\b(\d{1,2}):(\d{2})\b/);
  const description = escapeIcs([...card.items, ...card.warnings].join("\\n"));
  const lines = [
    "BEGIN:VEVENT",
    `UID:${escapeIcs(`${card.id}-${index}@schedule-surgery`)}`,
    `DTSTAMP:${formatIcsTimestamp(new Date())}`,
    `SUMMARY:${escapeIcs(card.title)}`,
    `DESCRIPTION:${description}`
  ];
  if (timeMatch) {
    const hour = Number(timeMatch[1]);
    const minute = Number(timeMatch[2]);
    const start = `${date}T${String(hour).padStart(2, "0")}${String(minute).padStart(2, "0")}00`;
    const endMinutes = hour * 60 + minute + 60;
    const end = `${date}T${String(Math.floor(endMinutes / 60) % 24).padStart(2, "0")}${String(endMinutes % 60).padStart(2, "0")}00`;
    lines.push(`DTSTART:${start}`, `DTEND:${end}`);
  } else {
    lines.push(`DTSTART;VALUE=DATE:${date}`, `DTEND;VALUE=DATE:${addOneDayCompact(date)}`);
  }
  lines.push("END:VEVENT");
  return lines.join("\r\n");
}

function formatIcsTimestamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function addOneDayCompact(compactDate: string): string {
  const date = new Date(
    Date.UTC(Number(compactDate.slice(0, 4)), Number(compactDate.slice(4, 6)) - 1, Number(compactDate.slice(6, 8)))
  );
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10).replaceAll("-", "");
}

function escapeIcs(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("\n", "\\n").replaceAll(",", "\\,").replaceAll(";", "\\;");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asStringArray(value: unknown): string[] {
  return asArray(value).flatMap((item) => {
    const text = asString(item);
    return text ? [text] : [];
  });
}

function withLabel(value: string | undefined, label: string): string | undefined {
  return value ? `${label}: ${value}` : undefined;
}

function compactJoin(values: Array<string | undefined>, separator: string): string {
  return values.filter((value): value is string => Boolean(value)).join(separator);
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function getStoredInputPreference(): "typing" | "voice" {
  try {
    return window.localStorage.getItem(INPUT_PREFERENCE_KEY) === "voice" ? "voice" : "typing";
  } catch {
    return "typing";
  }
}

function rememberInputPreference(preference: "typing" | "voice") {
  try {
    window.localStorage.setItem(INPUT_PREFERENCE_KEY, preference);
  } catch {
    // The preference is optional when storage is unavailable.
  }
}

function getFirstName(displayName: string): string {
  const firstName = displayName.trim().split(/\s+/)[0];
  return firstName || "there";
}

function nextRandomizedMessage(messages: readonly string[], queueRef: { current: string[] }): string {
  if (queueRef.current.length === 0) queueRef.current = shuffle(messages);
  return queueRef.current.shift() ?? messages[0];
}

function shuffle(messages: readonly string[]): string[] {
  const shuffled = [...messages];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[index]];
  }
  return shuffled;
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

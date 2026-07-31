import fs from "node:fs/promises";
import path from "node:path";
import { getDefaultUserStorePath } from "./userStore";

export interface ChatModelSettings {
  primaryModel: string;
  fallbackModels: string[];
  transcriptionModel: string;
  voiceModel: string;
  voiceName: string;
  elevenLabsModel: string;
  elevenLabsVoiceIds: [string, string, string];
}

export interface StoredChatModelSettings extends ChatModelSettings {
  updatedAt: string | null;
}

interface ChatSettingsData {
  version: 1;
  settings: StoredChatModelSettings;
}

export interface ChatSettingsStore {
  get(): Promise<StoredChatModelSettings>;
  update(patch: Partial<ChatModelSettings>): Promise<StoredChatModelSettings>;
}

export class ChatSettingsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChatSettingsValidationError";
  }
}

export class FileChatSettingsStore implements ChatSettingsStore {
  constructor(private readonly filePath = getDefaultChatSettingsPath()) {}

  async get(): Promise<StoredChatModelSettings> {
    return (await this.load()).settings;
  }

  async update(patch: Partial<ChatModelSettings>): Promise<StoredChatModelSettings> {
    const current = await this.get();
    const settings = normalizeSettings({
      primaryModel: patch.primaryModel ?? current.primaryModel,
      fallbackModels: patch.fallbackModels ?? current.fallbackModels,
      transcriptionModel: patch.transcriptionModel ?? current.transcriptionModel,
      voiceModel: patch.voiceModel ?? current.voiceModel,
      voiceName: patch.voiceName ?? current.voiceName,
      elevenLabsModel: patch.elevenLabsModel ?? current.elevenLabsModel,
      elevenLabsVoiceIds: patch.elevenLabsVoiceIds ?? current.elevenLabsVoiceIds,
      updatedAt: new Date().toISOString()
    });
    await this.save({ version: 1, settings });
    return settings;
  }

  private async load(): Promise<ChatSettingsData> {
    try {
      const loaded = JSON.parse(await fs.readFile(this.filePath, "utf8")) as ChatSettingsData;
      if (loaded?.version !== 1) throw new ChatSettingsValidationError("Unsupported chat settings file version");
      return { version: 1, settings: normalizeSettings(loaded.settings) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return { version: 1, settings: getDefaultChatModelSettings() };
    }
  }

  private async save(data: ChatSettingsData): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    await fs.writeFile(this.filePath, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
    await fs.chmod(this.filePath, 0o600).catch(() => undefined);
  }
}

export class MemoryChatSettingsStore implements ChatSettingsStore {
  private settings: StoredChatModelSettings;

  constructor(initial: StoredChatModelSettings = getDefaultChatModelSettings()) {
    this.settings = normalizeSettings(initial);
  }

  async get(): Promise<StoredChatModelSettings> {
    return structuredClone(this.settings);
  }

  async update(patch: Partial<ChatModelSettings>): Promise<StoredChatModelSettings> {
    this.settings = normalizeSettings({ ...this.settings, ...patch, updatedAt: new Date().toISOString() });
    return this.get();
  }
}

export function createDefaultChatSettingsStore(): ChatSettingsStore {
  return new FileChatSettingsStore();
}

export function getDefaultChatSettingsPath(): string {
  return process.env.CHAT_SETTINGS_PATH || path.join(path.dirname(getDefaultUserStorePath()), "chat-settings.json");
}

export function getDefaultChatModelSettings(): StoredChatModelSettings {
  return normalizeSettings({
    primaryModel: process.env.OPENROUTER_PRIMARY_MODEL || "deepseek/deepseek-v4-flash",
    fallbackModels: splitFallbackModels(process.env.OPENROUTER_FALLBACK_MODELS) || ["google/gemma-3-27b-it"],
    transcriptionModel: process.env.OPENROUTER_TRANSCRIPTION_MODEL || "nvidia/parakeet-tdt-0.6b-v3",
    voiceModel: process.env.OPENROUTER_VOICE_MODEL || "fish-audio/s2.1-pro-free:free",
    voiceName: process.env.OPENROUTER_VOICE_NAME || "David Attenborough Dramatic",
    elevenLabsModel: process.env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2",
    elevenLabsVoiceIds: readElevenLabsVoiceIds(process.env.ELEVENLABS_VOICE_IDS),
    updatedAt: null
  });
}

function normalizeSettings(input: StoredChatModelSettings): StoredChatModelSettings {
  if (!input || typeof input !== "object") throw new ChatSettingsValidationError("Invalid chat settings");
  const primaryModel = normalizeModelId(input.primaryModel, "primaryModel");
  const fallbackModels = Array.isArray(input.fallbackModels)
    ? [...new Set(input.fallbackModels.map((model, index) => normalizeModelId(model, `fallbackModels[${index}]`)))]
    : invalidFallbackModels();
  if (fallbackModels.length > 5) throw new ChatSettingsValidationError("fallbackModels can contain at most 5 models");
  if (fallbackModels.includes(primaryModel)) {
    throw new ChatSettingsValidationError("fallbackModels cannot include primaryModel");
  }
  return {
    primaryModel,
    fallbackModels,
    transcriptionModel: normalizeModelId(input.transcriptionModel, "transcriptionModel"),
    voiceModel: normalizeModelId(input.voiceModel ?? process.env.OPENROUTER_VOICE_MODEL ?? "fish-audio/s2.1-pro-free:free", "voiceModel"),
    voiceName: normalizeVoiceName(input.voiceName ?? process.env.OPENROUTER_VOICE_NAME ?? "David Attenborough Dramatic"),
    elevenLabsModel: normalizeProviderId(
      input.elevenLabsModel ?? process.env.ELEVENLABS_MODEL_ID ?? "eleven_multilingual_v2",
      "elevenLabsModel"
    ),
    elevenLabsVoiceIds: normalizeElevenLabsVoiceIds(
      input.elevenLabsVoiceIds ?? readElevenLabsVoiceIds(process.env.ELEVENLABS_VOICE_IDS)
    ),
    updatedAt: typeof input.updatedAt === "string" ? input.updatedAt : null
  };
}

function normalizeElevenLabsVoiceIds(value: unknown): [string, string, string] {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new ChatSettingsValidationError("elevenLabsVoiceIds must contain exactly 3 voice ids");
  }
  return value.map((voiceId, index) => normalizeProviderId(voiceId, `elevenLabsVoiceIds[${index}]`)) as [
    string,
    string,
    string
  ];
}

function normalizeProviderId(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new ChatSettingsValidationError(`${field} is required`);
  const id = value.trim();
  if (id.length > 200 || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) {
    throw new ChatSettingsValidationError(`${field} must be a provider model or voice id`);
  }
  return id;
}

function readElevenLabsVoiceIds(value: string | undefined): [string, string, string] {
  if (!value) return ["kSvMZug5ZFM9sKGpLAei", "dWAnId3mzfl4fTszwtOG", "0rEo3eAjssGDUCXHYENf"];
  return value.split(",").map((voiceId) => voiceId.trim()) as [string, string, string];
}

function normalizeVoiceName(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new ChatSettingsValidationError("voiceName is required");
  const voiceName = value.trim();
  if (voiceName.length > 200 || /[\u0000-\u001f\u007f]/.test(voiceName)) {
    throw new ChatSettingsValidationError("voiceName must be a plain voice identifier of 200 characters or fewer");
  }
  return voiceName;
}

function normalizeModelId(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new ChatSettingsValidationError(`${field} is required`);
  const model = value.trim();
  if (model.length > 200 || !/^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(model)) {
    throw new ChatSettingsValidationError(`${field} must be an OpenRouter model id such as provider/model`);
  }
  return model;
}

function splitFallbackModels(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  return value.split(",").map((model) => model.trim()).filter(Boolean);
}

function invalidFallbackModels(): never {
  throw new ChatSettingsValidationError("fallbackModels must be an array of OpenRouter model ids");
}

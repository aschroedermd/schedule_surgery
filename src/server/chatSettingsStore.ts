import fs from "node:fs/promises";
import path from "node:path";
import { getDefaultUserStorePath } from "./userStore";

export type ChatProvider = "openai" | "openrouter";
export type ElevenLabsVoiceIds =
  | [string, string, string]
  | [string, string, string, string, string];

export interface ChatModelSettings {
  chatProvider: ChatProvider;
  primaryModel: string;
  fallbackModels: string[];
  transcriptionModel: string;
  voiceModel: string;
  voiceName: string;
  elevenLabsModel: string;
  elevenLabsVoiceIds: ElevenLabsVoiceIds;
}

export interface StoredChatModelSettings extends ChatModelSettings {
  updatedAt: string | null;
}

interface ChatSettingsData {
  version: 2;
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
    const chatProvider = patch.chatProvider ?? current.chatProvider;
    const providerChanged = patch.chatProvider !== undefined && patch.chatProvider !== current.chatProvider;
    const providerDefaults = getProviderModelDefaults(chatProvider);
    const settings = normalizeSettings({
      chatProvider,
      primaryModel: patch.primaryModel ?? (providerChanged ? providerDefaults.primaryModel : current.primaryModel),
      fallbackModels: patch.fallbackModels ?? (providerChanged ? providerDefaults.fallbackModels : current.fallbackModels),
      transcriptionModel: patch.transcriptionModel ?? current.transcriptionModel,
      voiceModel: patch.voiceModel ?? current.voiceModel,
      voiceName: patch.voiceName ?? current.voiceName,
      elevenLabsModel: patch.elevenLabsModel ?? current.elevenLabsModel,
      elevenLabsVoiceIds: patch.elevenLabsVoiceIds ?? current.elevenLabsVoiceIds,
      updatedAt: new Date().toISOString()
    });
    await this.save({ version: 2, settings });
    return settings;
  }

  private async load(): Promise<ChatSettingsData> {
    try {
      const loaded = JSON.parse(await fs.readFile(this.filePath, "utf8")) as {
        version?: unknown;
        settings?: StoredChatModelSettings;
      };
      if (loaded?.version === 1) {
        return {
          version: 2,
          settings: normalizeSettings({ ...loaded.settings, chatProvider: "openrouter" } as StoredChatModelSettings)
        };
      }
      if (loaded?.version !== 2) throw new ChatSettingsValidationError("Unsupported chat settings file version");
      const settings = normalizeSettings(loaded.settings as StoredChatModelSettings);
      if (!Array.isArray(loaded.settings?.elevenLabsVoiceIds) || loaded.settings.elevenLabsVoiceIds.length !== 5) {
        await this.save({ version: 2, settings });
      }
      return { version: 2, settings };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return { version: 2, settings: getDefaultChatModelSettings() };
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
    const chatProvider = patch.chatProvider ?? this.settings.chatProvider;
    const providerChanged = patch.chatProvider !== undefined && patch.chatProvider !== this.settings.chatProvider;
    const providerDefaults = getProviderModelDefaults(chatProvider);
    this.settings = normalizeSettings({
      ...this.settings,
      ...patch,
      chatProvider,
      primaryModel: patch.primaryModel ?? (providerChanged ? providerDefaults.primaryModel : this.settings.primaryModel),
      fallbackModels: patch.fallbackModels ?? (providerChanged ? providerDefaults.fallbackModels : this.settings.fallbackModels),
      updatedAt: new Date().toISOString()
    });
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
  const chatProvider = normalizeChatProvider(process.env.CHAT_PROVIDER ?? "openai");
  const providerDefaults = getProviderModelDefaults(chatProvider);
  return normalizeSettings({
    chatProvider,
    primaryModel: providerDefaults.primaryModel,
    fallbackModels: providerDefaults.fallbackModels,
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
  const chatProvider = normalizeChatProvider(input.chatProvider);
  const primaryModel = normalizeChatModelId(input.primaryModel, "primaryModel", chatProvider);
  const fallbackModels = Array.isArray(input.fallbackModels)
    ? [
        ...new Set(
          input.fallbackModels.map((model, index) =>
            normalizeChatModelId(model, `fallbackModels[${index}]`, chatProvider)
          )
        )
      ]
    : invalidFallbackModels();
  if (fallbackModels.length > 5) throw new ChatSettingsValidationError("fallbackModels can contain at most 5 models");
  if (fallbackModels.includes(primaryModel)) {
    throw new ChatSettingsValidationError("fallbackModels cannot include primaryModel");
  }
  return {
    chatProvider,
    primaryModel,
    fallbackModels,
    transcriptionModel: normalizeOpenRouterModelId(input.transcriptionModel, "transcriptionModel"),
    voiceModel: normalizeOpenRouterModelId(input.voiceModel ?? process.env.OPENROUTER_VOICE_MODEL ?? "fish-audio/s2.1-pro-free:free", "voiceModel"),
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

function normalizeElevenLabsVoiceIds(value: unknown): [string, string, string, string, string] {
  if (!Array.isArray(value) || (value.length !== 3 && value.length !== 5)) {
    throw new ChatSettingsValidationError("elevenLabsVoiceIds must contain 3 legacy or exactly 5 voice ids");
  }
  const configured = value.map((voiceId, index) => normalizeProviderId(voiceId, `elevenLabsVoiceIds[${index}]`));
  return [
    configured[0],
    configured[1],
    configured[2],
    configured[3] ?? "onwK4e9ZLuTAKqWW03F9",
    configured[4] ?? "ia2hmHnWgMXcUgmY4yVU"
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

function readElevenLabsVoiceIds(value: string | undefined): [string, string, string, string, string] {
  if (!value) return ["kSvMZug5ZFM9sKGpLAei", "dWAnId3mzfl4fTszwtOG", "0rEo3eAjssGDUCXHYENf", "onwK4e9ZLuTAKqWW03F9", "ia2hmHnWgMXcUgmY4yVU"];
  return value.split(",").map((voiceId) => voiceId.trim()) as [string, string, string, string, string];
}

function normalizeVoiceName(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new ChatSettingsValidationError("voiceName is required");
  const voiceName = value.trim();
  if (voiceName.length > 200 || /[\u0000-\u001f\u007f]/.test(voiceName)) {
    throw new ChatSettingsValidationError("voiceName must be a plain voice identifier of 200 characters or fewer");
  }
  return voiceName;
}

function normalizeChatProvider(value: unknown): ChatProvider {
  if (value === "openai" || value === "openrouter") return value;
  throw new ChatSettingsValidationError("chatProvider must be openai or openrouter");
}

function normalizeChatModelId(value: unknown, field: string, provider: ChatProvider): string {
  if (provider === "openrouter") return normalizeOpenRouterModelId(value, field);
  if (typeof value !== "string" || !value.trim()) throw new ChatSettingsValidationError(`${field} is required`);
  const model = value.trim();
  if (model.length > 200 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(model)) {
    throw new ChatSettingsValidationError(`${field} must be an OpenAI model id such as gpt-5.6-luna`);
  }
  return model;
}

function normalizeOpenRouterModelId(value: unknown, field: string): string {
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
  throw new ChatSettingsValidationError("fallbackModels must be an array of model ids");
}

function getProviderModelDefaults(provider: ChatProvider): { primaryModel: string; fallbackModels: string[] } {
  if (provider === "openrouter") {
    return {
      primaryModel: process.env.OPENROUTER_PRIMARY_MODEL || "deepseek/deepseek-v4-flash",
      fallbackModels: splitFallbackModels(process.env.OPENROUTER_FALLBACK_MODELS) || ["google/gemma-3-27b-it"]
    };
  }
  return {
    primaryModel: process.env.OPENAI_PRIMARY_MODEL || "gpt-5.6-luna",
    fallbackModels: splitFallbackModels(process.env.OPENAI_FALLBACK_MODELS) || ["gpt-5.6-terra"]
  };
}

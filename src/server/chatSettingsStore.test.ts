import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FileChatSettingsStore, MemoryChatSettingsStore, getDefaultChatModelSettings } from "./chatSettingsStore";

describe("chat settings store", () => {
  it("defaults fresh settings to OpenAI Luna with Terra fallback", () => {
    const previousProvider = process.env.CHAT_PROVIDER;
    const previousPrimary = process.env.OPENAI_PRIMARY_MODEL;
    const previousFallbacks = process.env.OPENAI_FALLBACK_MODELS;
    try {
      delete process.env.CHAT_PROVIDER;
      delete process.env.OPENAI_PRIMARY_MODEL;
      delete process.env.OPENAI_FALLBACK_MODELS;
      expect(getDefaultChatModelSettings()).toMatchObject({
        chatProvider: "openai",
        primaryModel: "gpt-5.6-luna",
        fallbackModels: ["gpt-5.6-terra"]
      });
    } finally {
      if (previousProvider === undefined) delete process.env.CHAT_PROVIDER;
      else process.env.CHAT_PROVIDER = previousProvider;
      if (previousPrimary === undefined) delete process.env.OPENAI_PRIMARY_MODEL;
      else process.env.OPENAI_PRIMARY_MODEL = previousPrimary;
      if (previousFallbacks === undefined) delete process.env.OPENAI_FALLBACK_MODELS;
      else process.env.OPENAI_FALLBACK_MODELS = previousFallbacks;
    }
  });

  it("persists model changes across store instances", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "planner-chat-settings-"));
    const filePath = path.join(directory, "chat-settings.json");
    try {
      const store = new FileChatSettingsStore(filePath);
      await store.update({
        chatProvider: "openrouter",
        primaryModel: "deepseek/deepseek-v4-flash-0731",
        fallbackModels: ["google/gemma-3-27b-it"],
        transcriptionModel: "nvidia/parakeet-tdt-0.6b-v3",
        voiceModel: "fish-audio/s2-pro",
        voiceName: "Custom Narrator",
        elevenLabsModel: "eleven_flash_v2_5",
        elevenLabsVoiceIds: ["kSvMZug5ZFM9sKGpLAei", "dWAnId3mzfl4fTszwtOG", "0rEo3eAjssGDUCXHYENf"]
      });

      await expect(new FileChatSettingsStore(filePath).get()).resolves.toEqual(
        expect.objectContaining({
          chatProvider: "openrouter",
          primaryModel: "deepseek/deepseek-v4-flash-0731",
          fallbackModels: ["google/gemma-3-27b-it"],
          transcriptionModel: "nvidia/parakeet-tdt-0.6b-v3",
          voiceModel: "fish-audio/s2-pro",
          voiceName: "Custom Narrator",
          elevenLabsModel: "eleven_flash_v2_5",
          elevenLabsVoiceIds: ["kSvMZug5ZFM9sKGpLAei", "dWAnId3mzfl4fTszwtOG", "0rEo3eAjssGDUCXHYENf"],
          updatedAt: expect.any(String)
        })
      );
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it("keeps version 1 persisted settings on OpenRouter", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "planner-chat-settings-v1-"));
    const filePath = path.join(directory, "chat-settings.json");
    try {
      await fs.writeFile(filePath, JSON.stringify({
        version: 1,
        settings: {
          primaryModel: "deepseek/deepseek-v4-flash",
          fallbackModels: ["google/gemma-3-27b-it"],
          transcriptionModel: "nvidia/parakeet-tdt-0.6b-v3",
          voiceModel: "fish-audio/s2.1-pro-free:free",
          voiceName: "David Attenborough Dramatic",
          elevenLabsModel: "eleven_multilingual_v2",
          elevenLabsVoiceIds: ["kSvMZug5ZFM9sKGpLAei", "dWAnId3mzfl4fTszwtOG", "0rEo3eAjssGDUCXHYENf"],
          updatedAt: null
        }
      }));
      await expect(new FileChatSettingsStore(filePath).get()).resolves.toMatchObject({
        chatProvider: "openrouter",
        primaryModel: "deepseek/deepseek-v4-flash"
      });
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it("resets provider-specific model defaults when an admin changes provider", async () => {
    const store = new MemoryChatSettingsStore({
      ...getDefaultChatModelSettings(),
      chatProvider: "openrouter",
      primaryModel: "deepseek/deepseek-v4-flash",
      fallbackModels: ["google/gemma-3-27b-it"]
    });
    await expect(store.update({ chatProvider: "openai" })).resolves.toMatchObject({
      chatProvider: "openai",
      primaryModel: "gpt-5.6-luna",
      fallbackModels: ["gpt-5.6-terra"]
    });
  });
});

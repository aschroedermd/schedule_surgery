import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FileChatSettingsStore } from "./chatSettingsStore";

describe("chat settings store", () => {
  it("persists model changes across store instances", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "planner-chat-settings-"));
    const filePath = path.join(directory, "chat-settings.json");
    try {
      const store = new FileChatSettingsStore(filePath);
      await store.update({
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
});

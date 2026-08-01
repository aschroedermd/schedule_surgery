import { describe, expect, it, vi } from "vitest";
import { tryStartAudioPlayback } from "./ChatTab";

describe("spoken response playback", () => {
  it("reports successful playback", async () => {
    const play = vi.fn().mockResolvedValue(undefined);

    await expect(tryStartAudioPlayback({ play })).resolves.toBe(true);
    expect(play).toHaveBeenCalledOnce();
  });

  it("offers the fallback for any initial browser playback rejection", async () => {
    const play = vi.fn().mockRejectedValue(new DOMException("Playback failed", "NotSupportedError"));

    await expect(tryStartAudioPlayback({ play })).resolves.toBe(false);
    expect(play).toHaveBeenCalledOnce();
  });
});

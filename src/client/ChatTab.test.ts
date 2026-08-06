import { describe, expect, it, vi } from "vitest";
import { buildAuthenticatedWikiHref, tryStartAudioPlayback } from "./ChatTab";

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

describe("wiki reference links", () => {
  it("adds the current session only to protected wiki file links", () => {
    expect(buildAuthenticatedWikiHref("/api/wiki/sources/src-dragon-guide/file", "token value")).toBe(
      "/api/wiki/sources/src-dragon-guide/file?token=token%20value"
    );
    expect(buildAuthenticatedWikiHref("https://example.com/guide.pdf", "secret")).toBe("https://example.com/guide.pdf");
    expect(buildAuthenticatedWikiHref("javascript:alert(1)", "secret")).toBeUndefined();
  });
});

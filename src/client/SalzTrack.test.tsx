// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { SalzTrack } from "./SalzTrack";
import { locateSalz } from "./api";
vi.mock("./api", () => ({ locateSalz: vi.fn() }));
vi.mock("./SalzLiveMap", () => ({ SalzLiveMap: ({ location }: { location: { name: string } }) => <div className="salztrack-live-map">{location.name}</div> }));
let container: HTMLDivElement;
let root: Root;
beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<SalzTrack token="token" onExit={() => {}} />));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.clearAllMocks(); vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); });
async function click(label: string) {
  const button = [...container.querySelectorAll("button")].find(button => button.textContent?.trim() === label)!;
  await act(async () => button.click());
}
async function enter3320() { for (const digit of ["3", "3", "2", "0"]) await click(digit); }
describe("SalzTrack keypad", () => {
  it("requires four digits, supports corrections, and changes frequencies", async () => {
    const submit = container.querySelector<HTMLButtonElement>("button[type=submit]")!;
    expect(submit.disabled).toBe(true);
    expect(container.querySelector("input, textarea, [contenteditable=true]")).toBeNull();
    await enter3320();
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Delete last digit"]')!.click());
    expect(submit.disabled).toBe(true);
    await click("0");
    vi.mocked(locateSalz).mockResolvedValue({ name: "Memorial Hospital", detail: "Main hospital", lat: 37.25, lng: -79.94, mode: "preset", revision: 0, updatedAt: "now" });
    await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(locateSalz).toHaveBeenCalledWith("token", "3320");
    expect(container.querySelector(".salztrack-live-map")?.textContent).toBe("Memorial Hospital");
    await click("New frequency");
    expect(container.querySelector(".salztrack-code-display")?.getAttribute("aria-label")).toBe("0 of 4 passcode digits entered");
  });
  it("allows retry after an invalid code without displaying a map", async () => {
    vi.mocked(locateSalz).mockRejectedValue(new Error("No Salz signal"));
    await enter3320();
    await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(container.querySelector(".salztrack-feedback")!.textContent).toBe("No Salz signal");
    expect(container.querySelector(".salztrack-map")).toBeNull();
    expect(container.querySelector(".salztrack-code-display")?.getAttribute("aria-label")).toBe("0 of 4 passcode digits entered");
  });
});


describe("Salztelite signal", () => {
  it("starts at 82 and drifts gradually within 75–95 without jumping", async () => {
    const meter = container.querySelector('[role="meter"]')!;
    expect(meter.getAttribute("aria-valuenow")).toBe("82");
    let previous = 82;
    for (let step = 0; step < 80; step++) {
      await act(async () => { vi.advanceTimersByTime(2500); });
      const current = Number(meter.getAttribute("aria-valuenow"));
      expect(current).toBeGreaterThanOrEqual(75);
      expect(current).toBeLessThanOrEqual(95);
      expect(Math.abs(current - previous)).toBeLessThanOrEqual(1);
      previous = current;
    }
    expect(container.querySelector('.salztrack-signal-bar > span')?.getAttribute('style')).toContain('background-color');
    await act(async () => root.render(<div />));
    expect(vi.getTimerCount()).toBe(0);
  });
});

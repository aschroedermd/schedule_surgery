// @vitest-environment jsdom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SalzLiveMap } from "./SalzLiveMap";
import { closeSalzEditor, fetchSalzPosition, updateSalzPosition } from "./api";
import type { SalzTrackLocation } from "../shared/salzTrack";
vi.mock("./api", async original => ({ ...await original<typeof import("./api")>(), closeSalzEditor: vi.fn(), fetchSalzPosition: vi.fn(), updateSalzPosition: vi.fn() }));
let root: Root;
let container: HTMLDivElement;
const location: SalzTrackLocation = { lat: 37.25, lng: -79.94, revision: 0, updatedAt: "now", name: "Salzberg", detail: "Shared", mode: "editor", editorToken: "editor-grant" };
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.mocked(fetchSalzPosition).mockResolvedValue(location);
  vi.mocked(closeSalzEditor).mockResolvedValue(new Response(null, { status: 204 }));
  vi.mocked(updateSalzPosition).mockResolvedValue({ ...location, lat: 37.26, revision: 1 });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); await act(async () => vi.advanceTimersByTime(0)); container.remove(); vi.clearAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("live Salz map", () => {
  it("keeps the editor grant through StrictMode replay and closes it on actual exit", async () => {
    await act(async () => root.render(<StrictMode><SalzLiveMap token="session" location={location} /></StrictMode>));
    await act(async () => vi.advanceTimersByTime(0));
    expect(closeSalzEditor).not.toHaveBeenCalled();
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Move Salzberg north"]')!.click());
    expect(updateSalzPosition).toHaveBeenCalledWith("session", "editor-grant", { direction: "north" });
    await act(async () => root.render(<div />));
    await act(async () => vi.advanceTimersByTime(0));
    expect(closeSalzEditor).toHaveBeenCalledOnce();
  });
  it("ignores delayed older snapshots after saving a new position", async () => {
    await act(async () => root.render(<SalzLiveMap token="session" location={location} />));
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Move Salzberg north"]')!.click());
    await act(async () => vi.advanceTimersByTime(400));
    expect(container.querySelector('.salztrack-location p')?.textContent).toContain('37.26000');
  });
});

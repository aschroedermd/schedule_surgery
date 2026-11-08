// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlannerNavigation } from "./PlannerNavigation";
import { getNavigationTabs, type Tab } from "./navigation";

let root: Root;
let container: HTMLDivElement;
const onSelect = vi.fn();
const tabsFor = (isAdmin: boolean) => getNavigationTabs({ isAdmin, canUseRequests: true, pendingCoverageRequestCount: 2 });
function render(isAdmin = true, activeTab: Tab = "board") {
  act(() => root.render(<PlannerNavigation tabs={tabsFor(isAdmin)} activeTab={activeTab} onSelect={onSelect} />));
}
function open() { act(() => container.querySelector<HTMLButtonElement>(".mobile-menu-trigger")!.click()); }
function dialog() { return container.querySelector<HTMLDialogElement>("dialog")!; }

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  // jsdom does not implement native dialog behavior; browser checks cover focus trapping.
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

describe("mobile planner selector", () => {
  it("offers every permitted tab in order through one menu button and selects a tab", () => {
    render(); open();
    const buttons = [...dialog().querySelectorAll<HTMLButtonElement>(".mobile-menu-tile")];
    expect(buttons).toHaveLength(tabsFor(true).length);
    expect(buttons[0].textContent).toBe("OR & Clinic");
    expect(buttons[1].textContent).toBe("Assistant");
    expect(buttons.find(button => button.textContent === "CALL")?.querySelector(".lucide-calendar-clock")).toBeTruthy();
    expect(buttons.find(button => button.textContent === "Contacts")?.querySelector(".lucide-phone")).toBeTruthy();
    expect(buttons[0].getAttribute("aria-current")).toBe("page");
    expect(container.querySelectorAll(".mobile-bottom-nav button")).toHaveLength(1);
    expect(document.body.style.overflow).toBe("hidden");
    act(() => buttons[1].click());
    expect(onSelect).toHaveBeenCalledWith("chat");
    expect(dialog().open).toBe(false);
    expect(document.body.style.overflow).toBe("");
    expect(document.activeElement).toBe(container.querySelector(".mobile-menu-trigger"));
  });

  it("updates available tabs while open when permissions change", () => {
    render(); open(); render(false);
    expect(dialog().open).toBe(true);
    expect(dialog().querySelectorAll(".mobile-menu-tile")).toHaveLength(tabsFor(false).length);
    expect(dialog().textContent).not.toContain("User interactions");
    expect(dialog().textContent).toContain("Requests (2)");
  });

  it("closes without changing tabs and restores the prior page scroll setting", () => {
    document.body.style.overflow = "auto";
    render(); open();
    act(() => container.querySelector<HTMLButtonElement>(".mobile-menu-close")!.click());
    expect(onSelect).not.toHaveBeenCalled();
    expect(dialog().open).toBe(false);
    expect(document.body.style.overflow).toBe("auto");
    document.body.style.overflow = "";
  });

  it("dismisses with Escape's native cancel event and cleans up when unmounted", () => {
    render(); open();
    act(() => dialog().dispatchEvent(new Event("cancel")));
    expect(dialog().open).toBe(false);
    open();
    act(() => root.render(null));
    expect(document.body.style.overflow).toBe("");
  });
});

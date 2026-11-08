import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Activity, BookOpen, CalendarClock, CalendarDays, CalendarRange, Check, ChevronRight, ClipboardList, LayoutGrid, Menu, Phone, Scissors, Send, Settings, Shield, Sparkles, Star, Users, Wrench, X } from "lucide-react";
import { isAdminNavigationTab, type NavigationTab, type Tab } from "./navigation";

// Include landscape phones as well as portrait phones and small tablets.
const MOBILE_QUERY = "(max-width: 760px), (hover: none) and (pointer: coarse) and (max-width: 900px)";
const icons = {
  board: Scissors, chat: Sparkles, my: CalendarDays, contacts: Phone,
  "case-preferences": BookOpen, calendar: CalendarRange, call: CalendarClock,
  "call-builder": Wrench, schedule: LayoutGrid, requests: Send, roster: Users,
  defaults: Settings, users: Shield, interactions: ClipboardList,
  activity: Activity, residents: Star, account: Settings
};

function mobileLabel([tab, label]: NavigationTab) {
  if (tab === "residents") return "Residents & stars";
  return label.replace(/[^\p{L}\p{N}\p{P}\p{Z}&]/gu, "").replace(/\s+/g, " ").trim();
}

export function getMenuColumns(count: number, width: number, height: number): number {
  let best = 1;
  let bestScore = Infinity;
  // Prefer balanced tiles, but keep labels legible and touch targets generous.
  for (let columns = 1; columns <= Math.min(count, 6, Math.max(1, Math.floor((width + 8) / 100))); columns++) {
    const rows = Math.ceil(count / columns);
    const tileWidth = (width - (columns - 1) * 8) / columns;
    const tileHeight = (height - (rows - 1) * 8) / rows;
    const overflow = Math.max(0, 76 - tileHeight) * rows;
    const score = Math.abs(Math.log(tileWidth / Math.max(76, tileHeight) / 1.35)) + overflow / 40 + (rows * columns - count) * 0.04;
    if (score < bestScore) { best = columns; bestScore = score; }
  }
  return best;
}

export function PlannerNavigation({ tabs, activeTab, onSelect }: {
  tabs: NavigationTab[];
  activeTab: Tab;
  onSelect: (tab: Tab) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [columns, setColumns] = useState(2);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const desktopTabs = tabs.filter(([tab]) => !isAdminNavigationTab(tab));
  const adminTabs = tabs.filter(([tab]) => isAdminNavigationTab(tab));
  const adminIndex = desktopTabs.findIndex(([tab]) => tab === "residents");
  const insertIndex = adminIndex < 0 ? desktopTabs.length : adminIndex;
  const remainder = tabs.length % columns;
  const tileSpan = remainder || 1;

  useEffect(() => {
    if (!menuOpen) return;
    const dialog = dialogRef.current!;
    dialog.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const media = window.matchMedia(MOBILE_QUERY);
    const onResize = () => { if (!media.matches) setMenuOpen(false); };
    media.addEventListener("change", onResize);
    return () => {
      media.removeEventListener("change", onResize);
      document.body.style.overflow = previousOverflow;
      dialog.close();
      if (media.matches) triggerRef.current?.focus();
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const grid = gridRef.current!;
    const measure = () => setColumns(getMenuColumns(tabs.length, grid.clientWidth, grid.clientHeight));
    const observer = new ResizeObserver(measure);
    observer.observe(grid);
    measure();
    return () => observer.disconnect();
  }, [menuOpen, tabs.length]);

  function renderTab([tab, label]: NavigationTab) {
    return <button key={tab} type="button" className={activeTab === tab ? "active" : ""}
      aria-current={activeTab === tab ? "page" : undefined}
      onClick={event => {
        onSelect(tab);
        event.currentTarget.closest("nav")?.querySelectorAll("details[open]").forEach(details => details.removeAttribute("open"));
      }}>{label}</button>;
  }

  return <>
    <nav className="tabs desktop-tabs" aria-label="Planner sections">
      {desktopTabs.slice(0, insertIndex).map(renderTab)}
      {adminTabs.length > 0 && <details className={`nav-menu desktop-admin-menu${adminTabs.some(([tab]) => tab === activeTab) ? " active" : ""}`}>
        <summary role="button" aria-label="Open admin sections">Admin <ChevronRight size={14} aria-hidden="true" /></summary>
        <div className="nav-menu-popover">{adminTabs.map(renderTab)}</div>
      </details>}
      {desktopTabs.slice(insertIndex).map(renderTab)}
    </nav>
    <nav className="mobile-bottom-nav" aria-label="Planner menu">
      <button ref={triggerRef} type="button" className="mobile-menu-trigger" aria-haspopup="dialog"
        aria-expanded={menuOpen} aria-controls="planner-menu" onClick={() => setMenuOpen(true)}>
        <Menu size={24} aria-hidden="true" /><span>Menu</span><LayoutGrid size={20} aria-hidden="true" />
      </button>
    </nav>
    <dialog ref={dialogRef} id="planner-menu" className="mobile-menu-dialog" aria-label="Planner menu"
      onCancel={() => setMenuOpen(false)} onClose={() => setMenuOpen(false)}>
      <div className="mobile-menu-header">
        <button type="button" className="mobile-menu-close" onClick={() => setMenuOpen(false)} autoFocus aria-label="Close menu"><X size={22} aria-hidden="true" /></button>
      </div>
      <div ref={gridRef} className="mobile-menu-grid" style={{ "--menu-columns": columns * tileSpan, "--menu-rows": Math.max(1, Math.ceil(tabs.length / columns)) } as CSSProperties}>
        {tabs.map((entry, index) => {
          const [tab] = entry;
          const Icon = icons[tab] ?? LayoutGrid;
          const current = tab === activeTab;
          return <button key={tab} type="button" className={`mobile-menu-tile${current ? " active" : ""}`}
            style={{ gridColumn: `span ${remainder && index >= tabs.length - remainder ? columns : tileSpan}` }}
            aria-current={current ? "page" : undefined} onClick={() => { onSelect(tab); setMenuOpen(false); }}>
            <Icon className="mobile-menu-icon" size={24} aria-hidden="true" />
            <span>{mobileLabel(entry)}</span>
            {current && <Check className="mobile-menu-current" size={15} aria-label="Current tab" />}
          </button>;
        })}
      </div>
    </dialog>
  </>;
}

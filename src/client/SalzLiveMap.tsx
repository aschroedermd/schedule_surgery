import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, LocateFixed, MapPin } from "lucide-react";
import { closeSalzEditor, fetchSalzPosition, updateSalzPosition, UnauthorizedError } from "./api";
import type { SalzDirection, SalzPosition, SalzPositionChange, SalzTrackLocation } from "../shared/salzTrack";
import "leaflet/dist/leaflet.css";

export function SalzLiveMap({ token, location }: { token: string; location: SalzTrackLocation }) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map>();
  const marker = useRef<L.Marker>();
  const latest = useRef<SalzPosition>(location);
  const follow = useRef(true);
  const placing = useRef(false);
  const alive = useRef(true);
  const dragging = useRef(false);
  const moving = useRef<SalzDirection>();
  const saving = useRef(false);
  const pendingDrop = useRef<SalzPositionChange>();
  const holdTimer = useRef<ReturnType<typeof setTimeout>>();
  const closeTimer = useRef<ReturnType<typeof setTimeout>>();
  const [position, setPosition] = useState<SalzPosition>(location);
  const [following, setFollowing] = useState(true);
  const [dropMode, setDropMode] = useState(false);
  const [message, setMessage] = useState("");
  const [syncStatus, setSyncStatus] = useState("Connected");
  const editor = location.mode === "editor";
  const live = location.mode !== "preset";

  function accept(next: SalzPosition) {
    if (!alive.current || next.revision < latest.current.revision) return;
    latest.current = next;
    setPosition(next);
  }
  function stop() {
    moving.current = undefined;
    clearTimeout(holdTimer.current);
  }
  async function save(change: SalzPositionChange) {
    if (!location.editorToken || !alive.current) return;
    if (saving.current) {
      if ("lat" in change) pendingDrop.current = change;
      return;
    }
    saving.current = true;
    try {
      const next = await updateSalzPosition(token, location.editorToken, change);
      accept(next);
      if (alive.current) { setMessage("Position saved · viewers are following"); setSyncStatus("Connected"); }
    } catch (err) {
      stop();
      if (alive.current) setMessage(err instanceof Error ? err.message : "Position could not be saved. Try again.");
      // A failed drag must not leave the marker at an unsaved position.
      marker.current?.setLatLng([latest.current.lat, latest.current.lng]);
    } finally {
      saving.current = false;
      const queued = pendingDrop.current;
      pendingDrop.current = undefined;
      if (queued && alive.current) void save(queued);
    }
  }
  async function steer(direction: SalzDirection) {
    if (moving.current !== direction || !alive.current) return;
    await save({ direction });
    if (moving.current === direction && alive.current) holdTimer.current = setTimeout(() => void steer(direction), 200);
  }
  function start(direction: SalzDirection) { stop(); moving.current = direction; void steer(direction); }
  function recenter() {
    follow.current = true; setFollowing(true);
    map.current?.panTo([latest.current.lat, latest.current.lng]);
  }

  useEffect(() => {
    alive.current = true;
    clearTimeout(closeTimer.current);
    if (!host.current) return;
    const view = L.map(host.current, { center: [location.lat, location.lng], zoom: 18, minZoom: 3, maxZoom: 19 });
    map.current = view;
    const tiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      referrerPolicy: "strict-origin-when-cross-origin"
    }).addTo(view);
    tiles.on("tileerror", () => { if (alive.current) setMessage("Map tiles could not load. Check your connection."); });
    const icon = L.divIcon({ className: "salztrack-live-marker", iconSize: [64, 64], iconAnchor: [32, 32], html: '<span class="salztrack-pulse"></span><span class="salztrack-pulse salztrack-pulse-delayed"></span><span class="salztrack-face-disc"><img src="/salztrack/face.png" alt="Salzberg" /></span>' });
    const face = L.marker([location.lat, location.lng], { icon, draggable: editor, title: "Salzberg", alt: "Salzberg" }).addTo(view);
    marker.current = face;
    view.on("dragstart", () => { follow.current = false; setFollowing(false); });
    face.on("dragstart", () => { dragging.current = true; stop(); face.getElement()?.classList.add("salztrack-dragging"); });
    face.on("dragend", () => {
      dragging.current = false; face.getElement()?.classList.remove("salztrack-dragging");
      const point = face.getLatLng(); void save({ lat: point.lat, lng: point.lng });
    });
    view.on("click", (event: L.LeafletMouseEvent) => {
      if (editor && placing.current) {
        placing.current = false; setDropMode(false);
        void save({ lat: event.latlng.lat, lng: event.latlng.wrap().lng });
      }
    });
    const resize = new ResizeObserver(() => view.invalidateSize());
    resize.observe(host.current);
    const onVisibility = () => { if (document.hidden) stop(); };
    window.addEventListener("blur", stop);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      alive.current = false; stop(); resize.disconnect(); view.remove(); map.current = undefined; marker.current = undefined;
      window.removeEventListener("blur", stop); document.removeEventListener("visibilitychange", onVisibility);
      // StrictMode replays effects before the next task; only close an actual exit.
      if (location.editorToken) closeTimer.current = setTimeout(() => { void closeSalzEditor(token, location.editorToken!).catch(() => undefined); }, 0);
    };
  }, [token, location]);

  useEffect(() => {
    if (dragging.current) return;
    marker.current?.setLatLng([position.lat, position.lng]);
    if (follow.current) map.current?.panTo([position.lat, position.lng], { animate: false });
  }, [position]);

  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const abort = new AbortController();
    async function poll() {
      let delay = 400;
      try {
        const next = await fetchSalzPosition(token, abort.signal);
        if (!cancelled) { accept(next); setSyncStatus("Connected"); }
      } catch (err) {
        if (cancelled) return;
        stop(); delay = 2500; setSyncStatus("Reconnecting…");
        if (err instanceof UnauthorizedError || (err instanceof Error && "status" in err && (err.status === 401 || err.status === 403))) {
          setSyncStatus("Access unavailable"); setMessage(err.message); return;
        }
      }
      if (!cancelled) timer = setTimeout(() => void poll(), delay);
    }
    void poll();
    return () => { cancelled = true; abort.abort(); clearTimeout(timer); };
  }, [token, live]);

  return <>
    <div className="salztrack-map salztrack-live-map-wrap">
      <div ref={host} className="salztrack-live-map" aria-label="Interactive Salzberg map" onKeyDown={event => { if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) { follow.current = false; setFollowing(false); } }} />
      <button className="salztrack-recenter" type="button" onClick={recenter}><LocateFixed size={17} /> {following ? "Following Salzberg" : "Return to Salzberg"}</button>
      <span className="salztrack-map-caption">ACTIVE SALZBERG TRACKING</span>
    </div>
    {editor && <div className="salztrack-editor">
      <div><h2>Salz Control</h2><p>Drag his face or drop him on the map. Hold an arrow to keep him moving.</p><button type="button" className="salztrack-drop" aria-pressed={dropMode} onClick={() => { placing.current = !placing.current; setDropMode(placing.current); stop(); }}><MapPin size={17} /> {dropMode ? "Tap the map to place Salzberg" : "Drop a position"}</button></div>
      <div className="salztrack-dpad" aria-label="Move Salzberg">{([
        ["north", ArrowUp], ["west", ArrowLeft], ["east", ArrowRight], ["south", ArrowDown]
      ] as const).map(([direction, Icon]) => <button type="button" key={direction} className={`salztrack-steer-${direction}`} aria-label={`Move Salzberg ${direction}`} onPointerDown={event => { if (event.button !== 0) return; event.currentTarget.setPointerCapture(event.pointerId); start(direction); }} onPointerUp={stop} onPointerCancel={stop} onLostPointerCapture={stop} onClick={event => { if (event.detail === 0) void save({ direction }); }} onKeyUp={stop}><Icon size={23} /></button>)}<span aria-hidden="true">S</span></div>
    </div>}
    <div className="salztrack-location"><LocateFixed size={25} /><div><h2>{location.name}</h2><p>{live ? `${position.lat.toFixed(5)}, ${position.lng.toFixed(5)} · ${syncStatus}` : location.detail}</p></div><span>Feeling Salzy</span></div>
    {message && <p className="salztrack-map-message" role="status">{message}</p>}
  </>;
}

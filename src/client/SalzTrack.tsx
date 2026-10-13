import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, Delete, LocateFixed, RotateCcw } from "lucide-react";
import { locateSalz } from "./api";
import type { SalzTrackLocation } from "../shared/salzTrack";
import "./SalzTrack.css";

export function SalzTrack({ token, onExit }: { token: string; onExit: () => void }) {
  const [code, setCode] = useState("");
  const [location, setLocation] = useState<SalzTrackLocation>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [signal, setSignal] = useState(82);
  const input = useRef<HTMLInputElement>(null);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => { if (!location) input.current?.focus(); }, [location]);

  useEffect(() => {
    let strength = 82;
    function nextTarget() {
      const target = 75 + Math.random() * 20;
      // Give each drift enough distance to feel like a slowly wandering signal.
      return Math.abs(target - strength) < 3 ? (strength < 85 ? 95 : 75) : target;
    }
    let target = nextTarget();
    const timer = window.setInterval(() => {
      const distance = target - strength;
      strength = Math.max(75, Math.min(95, strength + Math.sign(distance) * Math.min(0.1, Math.abs(distance))));
      setSignal(strength);
      if (Math.abs(target - strength) < 0.01) target = nextTarget();
    }, 250);
    return () => window.clearInterval(timer);
  }, []);
  const signalColor = `hsl(${48 + ((signal - 75) / 20) * 92}, 75%, 65%)`;

  async function locate(event: FormEvent) {
    event.preventDefault();
    if (code.length !== 4 || busy) return;
    setBusy(true); setError("");
    try {
      const next = await locateSalz(token, code);
      if (active.current) { setLocation(next); setCode(""); }
    } catch (err) {
      if (active.current) { setError(err instanceof Error ? err.message : "The Salz signal wandered off. Try again."); setCode(""); }
    } finally { if (active.current) setBusy(false); }
  }

  return <main className="salztrack">
    <header className="salztrack-header">
      <button className="salztrack-back" onClick={onExit}><ArrowLeft size={18} /> Account</button>
      <div className="salztrack-brand"><img src="/salztrack/face.png" alt="" /><span>Salz<span>Track</span><small>THE SALZBURG FINDER</small></span></div>
      <div className="salztrack-signal" role="meter" aria-label="Salztelite signal strength" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(signal)} style={{ color: signalColor }}>
        <span className="salztrack-signal-bar" aria-hidden="true"><span style={{ width: `${signal}%`, backgroundColor: signalColor }} /></span>
        <span>{Math.round(signal)}%</span>
      </div>
    </header>
    <section className="salztrack-body">
      {location ? <section className="salztrack-result" aria-label="Salzberg joke location">
        <div className="salztrack-result-bar"><span><i /> SALZ SIGNAL ACQUIRED</span><button onClick={() => { setLocation(undefined); setError(""); }}><RotateCcw size={16} /> New frequency</button></div>
        <div className="salztrack-map">
          <img className="salztrack-map-image" src={location.map} alt={`Map of ${location.name} in Roanoke`} />
          <div className={`salztrack-marker${location.wideMarker ? " salztrack-marker-wide" : ""}`} style={{ left: `${location.x}%`, top: `${location.y}%` }} aria-label={`Salzberg at ${location.name}`}>
            <span className="salztrack-pulse" /><span className="salztrack-pulse salztrack-pulse-delayed" /><span className="salztrack-face-disc"><img src="/salztrack/face.png" alt="Salzberg" /></span>
          </div>
          <span className="salztrack-map-caption">ACTIVE SALZBURG TRACKING</span>
        </div>
        <div className="salztrack-location"><LocateFixed size={25} /><div><h2>{location.name}</h2><p>{location.detail}</p></div><span>Feeling Salzy</span></div>
      </section> : <form className="salztrack-keypad-card" onSubmit={locate} aria-label="SalzTrack passcode">
        <div className="salztrack-radar"><span /><img src="/salztrack/face.png" alt="Salzberg" /></div>
        <h2>Tune into the Salz-o-sphere</h2><label htmlFor="salztrack-code">Four-digit passcode</label>
        <input ref={input} id="salztrack-code" type="password" inputMode="numeric" autoComplete="off" pattern="[0-9]{4}" maxLength={4} value={code} disabled={busy} onChange={event => { setCode(event.target.value.replace(/\D/g, "").slice(0, 4)); setError(""); }} />
        <div className="salztrack-keypad">{[1,2,3,4,5,6,7,8,9].map(digit => <button type="button" disabled={busy || code.length === 4} key={digit} onClick={() => { setCode(current => current + digit); setError(""); }}>{digit}</button>)}<button type="button" disabled={busy} onClick={() => { setCode(""); setError(""); }}>Clear</button><button type="button" disabled={busy || code.length === 4} onClick={() => { setCode(current => current + "0"); setError(""); }}>0</button><button type="button" disabled={busy} aria-label="Delete last digit" onClick={() => setCode(current => current.slice(0, -1))}><Delete size={22} /></button></div>
        <button className="salztrack-locate" type="submit" disabled={busy || code.length !== 4}><LocateFixed size={19} /> {busy ? "Scanning the Salz-o-sphere…" : "Find my Salz"}</button>
        <div className="salztrack-feedback" role="status">{error}</div>
      </form>}
      <p className="salztrack-disclaimer">based on Salztelite Signal</p>
    </section>
  </main>;
}

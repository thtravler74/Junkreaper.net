import { useEffect, useMemo, useRef, useState } from "react";
import type { AnalysisResult } from "../analysis/types";
import { mmss } from "../describe/format";
import { inferno, sectionColor } from "./colors";

interface Props { result: AnalysisResult; audioUrl: string | null }

/** Waveform + mel spectrogram + section/chord/beat lanes, synced to an <audio> element. */
export function Visualizer({ result, audioUrl }: Props) {
  const specRef = useRef<HTMLCanvasElement>(null);
  const waveRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [time, setTime] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const dur = result.durationSec;
  const pv = result.previews;

  // Spectrogram image (static)
  useEffect(() => {
    const cv = specRef.current;
    if (!cv || !pv) return;
    const { data, columns, rows } = pv.melSpectrogram;
    cv.width = columns; cv.height = rows;
    const ctx = cv.getContext("2d")!;
    const img = ctx.createImageData(columns, rows);
    for (let c = 0; c < columns; c++) for (let r = 0; r < rows; r++) {
      const v = data[c * rows + r]! / 255;
      const [R, G, B] = inferno(v);
      const y = rows - 1 - r;
      const o = (y * columns + c) * 4;
      img.data[o] = R; img.data[o + 1] = G; img.data[o + 2] = B; img.data[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }, [pv]);

  // Waveform with loudness curve and beat ticks (static)
  useEffect(() => {
    const cv = waveRef.current;
    if (!cv || !pv) return;
    const W = 1600, H = 160;
    cv.width = W; cv.height = H;
    const ctx = cv.getContext("2d")!;
    ctx.clearRect(0, 0, W, H);
    const { min, max, columns } = pv.waveform;
    ctx.fillStyle = "rgba(120, 160, 255, 0.55)";
    for (let c = 0; c < columns; c++) {
      const x = (c / columns) * W;
      const y0 = (H / 2) * (1 - max[c]!), y1 = (H / 2) * (1 - min[c]!);
      ctx.fillRect(x, y0, Math.max(1, W / columns), Math.max(1, y1 - y0));
    }
    // beats / downbeats
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    for (const b of result.rhythm.beats) ctx.fillRect((b / dur) * W, H - 10, 1, 10);
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    for (const d of result.rhythm.downbeats) ctx.fillRect((d / dur) * W, H - 18, 1.5, 18);
    // momentary loudness curve
    const m = result.loudness.momentary;
    if (m.length > 1) {
      ctx.strokeStyle = "#f7c948"; ctx.lineWidth = 1.5; ctx.beginPath();
      m.forEach((p, i) => { const x = (p.time / dur) * W, y = H * (1 - Math.max(0, Math.min(1, (p.lufs + 60) / 60))); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
      ctx.stroke();
    }
  }, [pv, result, dur]);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    let raf = 0;
    const tick = (): void => { setTime(a.currentTime); raf = requestAnimationFrame(tick); };
    const onPlay = (): void => { cancelAnimationFrame(raf); tick(); };
    const onPause = (): void => cancelAnimationFrame(raf);
    a.addEventListener("play", onPlay); a.addEventListener("pause", onPause); a.addEventListener("seeked", () => setTime(a.currentTime));
    return () => { cancelAnimationFrame(raf); a.removeEventListener("play", onPlay); a.removeEventListener("pause", onPause); };
  }, [audioUrl]);

  const seek = (frac: number): void => { const a = audioRef.current; if (a && Number.isFinite(a.duration)) { a.currentTime = frac * a.duration; setTime(a.currentTime); } };
  const chords = useMemo(() => result.harmony.chords.filter((c) => c.quality !== "N" && c.end - c.start > dur / 400), [result, dur]);
  const sectionAt = (t: number): string => result.structure.sections.find((s) => t >= s.start && t < s.end)?.name ?? "";
  const chordAt = (t: number): string => result.harmony.chords.find((c) => t >= c.start && t < c.end)?.label ?? "";
  const playX = `${(time / dur) * 100}%`;
  const showT = hover ?? time;

  return (
    <section className="viz" aria-label="Visual overview">
      <div className="viz-lanes" onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); setHover(((e.clientX - r.left) / r.width) * dur); }} onMouseLeave={() => setHover(null)} onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); seek((e.clientX - r.left) / r.width); }}>
        <div className="lane sections" title="Structure">
          {result.structure.sections.map((s) => (
            <div key={s.index} className="section-block" style={{ left: `${(s.start / dur) * 100}%`, width: `${((s.end - s.start) / dur) * 100}%`, background: sectionColor(s.label) }}>
              <span>{s.name}</span>
            </div>
          ))}
        </div>
        <canvas ref={specRef} className="lane spectrogram" title="Mel spectrogram (30 Hz – 10 kHz)" />
        <canvas ref={waveRef} className="lane waveform" title="Waveform, momentary loudness (yellow) and beat grid" />
        <div className="lane chords" title="Chords">
          {chords.map((c, i) => (
            <div key={i} className={`chord-block${c.diatonic ? "" : " borrowed"}`} style={{ left: `${(c.start / dur) * 100}%`, width: `${((c.end - c.start) / dur) * 100}%` }}>
              <span>{c.label}</span>
            </div>
          ))}
        </div>
        <div className="lane keys" title="Key regions">
          {result.harmony.keyTimeline.map((k, i) => (
            <div key={i} className="key-block" style={{ left: `${(k.start / dur) * 100}%`, width: `${((k.end - k.start) / dur) * 100}%` }}><span>{k.key.name}</span></div>
          ))}
        </div>
        <div className="playhead" style={{ left: playX }} />
        {hover !== null && <div className="hoverline" style={{ left: `${(hover / dur) * 100}%` }} />}
      </div>
      <div className="viz-footer">
        <div className="viz-readout">
          <strong>{mmss(showT)}</strong> · {sectionAt(showT) || "—"} · {chordAt(showT) || "—"}
        </div>
        {audioUrl ? <audio ref={audioRef} controls src={audioUrl} preload="metadata" className="player" /> : <span className="muted">Playback unavailable for the synthesized demo.</span>}
      </div>
    </section>
  );
}

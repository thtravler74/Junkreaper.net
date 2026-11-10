import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AnalysisResult } from "../analysis/types";
import { synthArrangement } from "../demo/synth";
import { buildReport, reportToMarkdown } from "../describe";
import { DataView, stripPreviews } from "./DataView";
import { decodeAudio, readFileInfo, runAnalysis } from "./decode";
import { Dropzone } from "./Dropzone";
import { Meters } from "./Meters";
import { ReportView } from "./ReportView";
import { Visualizer } from "./Visualizer";

type Phase = { kind: "idle" } | { kind: "working"; stage: string; fraction: number; name: string } | { kind: "done"; result: AnalysisResult; audioUrl: string | null } | { kind: "error"; message: string };
type Tab = "description" | "visual" | "data";

export function App() {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [tab, setTab] = useState<Tab>("description");
  const [copied, setCopied] = useState(false);
  const urlRef = useRef<string | null>(null);

  const releaseUrl = (): void => { if (urlRef.current) { URL.revokeObjectURL(urlRef.current); urlRef.current = null; } };
  useEffect(() => releaseUrl, []);

  const analyzeFile = useCallback(async (file: File) => {
    releaseUrl();
    setTab("description");
    setPhase({ kind: "working", stage: "Reading tags", fraction: 0, name: file.name });
    try {
      const info = await readFileInfo(file);
      setPhase({ kind: "working", stage: "Decoding audio", fraction: 0.01, name: file.name });
      const audio = await decodeAudio(file, info.sampleRate);
      const result = await runAnalysis(audio, info, (stage, fraction) => setPhase({ kind: "working", stage, fraction: 0.02 + fraction * 0.98, name: file.name }));
      urlRef.current = URL.createObjectURL(file);
      setPhase({ kind: "done", result, audioUrl: urlRef.current });
    } catch (err) {
      setPhase({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }, []);

  const analyzeDemo = useCallback(async () => {
    releaseUrl();
    setTab("description");
    setPhase({ kind: "working", stage: "Synthesizing demo", fraction: 0, name: "demo" });
    await new Promise((r) => setTimeout(r, 30));
    try {
      const a = synthArrangement(112, 44100, true);
      const result = await runAnalysis(a, { name: "synthesized-demo.wav", sizeBytes: a.channels[0]!.length * 4, mimeType: "audio/wav", container: "generated", codec: "PCM (float)", lossless: true, tags: { title: "Synthesized demo", artist: "SongScope", comment: "Chords C–G–Am–F / F–G–C–Am, 112 BPM, with a lead line." }, hasCoverArt: false }, (stage, fraction) => setPhase({ kind: "working", stage, fraction, name: "demo" }));
      setPhase({ kind: "done", result, audioUrl: null });
    } catch (err) {
      setPhase({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }, []);

  const report = useMemo(() => (phase.kind === "done" ? buildReport(phase.result) : null), [phase]);
  const markdown = useMemo(() => (report ? reportToMarkdown(report) : ""), [report]);

  const download = (name: string, text: string, type: string): void => {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const baseName = phase.kind === "done" ? phase.result.file.name.replace(/\.[^.]+$/, "") : "song";

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><span className="logo" aria-hidden>◉</span> SongScope</div>
        <p className="tagline">Upload a song. Get the whole story: tempo, key, chords, structure, loudness, timbre, stereo, mood — measured in your browser.</p>
      </header>

      {phase.kind !== "done" && <Dropzone onFile={analyzeFile} onDemo={analyzeDemo} busy={phase.kind === "working"} />}

      {phase.kind === "working" && (
        <section className="progress" role="status" aria-live="polite">
          <div className="progress-head"><span>{phase.stage}</span><span>{Math.round(phase.fraction * 100)} %</span></div>
          <div className="progress-track"><div className="progress-fill" style={{ width: `${Math.round(phase.fraction * 100)}%` }} /></div>
          <p className="muted">Analysing “{phase.name}”. Longer files take longer; a four-minute song usually finishes in well under a minute.</p>
        </section>
      )}

      {phase.kind === "error" && (
        <section className="error-box" role="alert">
          <h2>Something went wrong</h2>
          <pre>{phase.message}</pre>
          <button type="button" onClick={() => setPhase({ kind: "idle" })}>Try another file</button>
        </section>
      )}

      {phase.kind === "done" && report && (
        <>
          <section className="result-head">
            <div>
              <h1 className="result-title">{report.title}</h1>
              <p className="subtitle">{report.subtitle}</p>
            </div>
            <div className="actions">
              <button type="button" onClick={async () => { await navigator.clipboard.writeText(markdown); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? "Copied!" : "Copy Markdown"}</button>
              <button type="button" onClick={() => download(`${baseName}-description.md`, markdown, "text/markdown")} data-testid="download-md">Download .md</button>
              <button type="button" onClick={() => download(`${baseName}-analysis.json`, JSON.stringify(stripPreviews(phase.result), null, 2), "application/json")}>Download .json</button>
              <button type="button" className="primary" onClick={() => { releaseUrl(); setPhase({ kind: "idle" }); }}>Analyze another</button>
            </div>
          </section>
          <Meters result={phase.result} />
          <Visualizer result={phase.result} audioUrl={phase.audioUrl} />
          <nav className="tabs" role="tablist">
            {(["description", "visual", "data"] as Tab[]).map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "active" : ""} onClick={() => setTab(t)} data-testid={`tab-${t}`}>
                {t === "description" ? "Description" : t === "visual" ? "Timeline tables" : "Raw data"}
              </button>
            ))}
          </nav>
          {tab === "description" && <ReportView report={report} />}
          {tab === "visual" && <TimelineTables result={phase.result} />}
          {tab === "data" && <DataView result={phase.result} />}
        </>
      )}

      <footer className="foot">
        <p>Measurements follow ITU-R BS.1770-4 / EBU R128 for loudness; key, chords, meter and structure are model-based estimates. Nothing is uploaded anywhere.</p>
      </footer>
    </div>
  );
}

function TimelineTables({ result }: { result: AnalysisResult }) {
  const fmt = (t: number): string => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
  const chords = result.harmony.chords.filter((c) => c.quality !== "N");
  return (
    <section className="timeline" data-testid="timeline">
      <h2>Sections</h2>
      <div className="table-wrap"><table>
        <thead><tr><th>Start</th><th>End</th><th>Section</th><th>Material</th><th>Level</th><th>Main chord</th><th>Notes</th></tr></thead>
        <tbody>{result.structure.sections.map((s) => <tr key={s.index}><td>{fmt(s.start)}</td><td>{fmt(s.end)}</td><td>{s.name}</td><td>{s.label}</td><td>{s.levelDb > 0 ? "+" : ""}{s.levelDb.toFixed(1)} dB</td><td>{s.dominantChord ?? "–"}</td><td>{s.notes.join("; ")}</td></tr>)}</tbody>
      </table></div>
      <h2>Chords ({chords.length} events)</h2>
      <div className="table-wrap"><table>
        <thead><tr><th>Start</th><th>End</th><th>Chord</th><th>Roman</th><th>Beats</th><th>In key</th></tr></thead>
        <tbody>{chords.map((c, i) => <tr key={i}><td>{fmt(c.start)}</td><td>{fmt(c.end)}</td><td>{c.label}</td><td>{c.roman}</td><td>{c.beats}</td><td>{c.diatonic ? "yes" : "borrowed"}</td></tr>)}</tbody>
      </table></div>
      <h2>Key regions</h2>
      <div className="table-wrap"><table>
        <thead><tr><th>Start</th><th>End</th><th>Key</th><th>Correlation</th></tr></thead>
        <tbody>{result.harmony.keyTimeline.map((k, i) => <tr key={i}><td>{fmt(k.start)}</td><td>{fmt(k.end)}</td><td>{k.key.name}</td><td>{k.key.clarity.toFixed(2)}</td></tr>)}</tbody>
      </table></div>
      <h2>Local tempo</h2>
      <div className="table-wrap"><table>
        <thead><tr><th>Time</th><th>BPM</th></tr></thead>
        <tbody>{result.rhythm.localTempi.map((t, i) => <tr key={i}><td>{fmt(t.time)}</td><td>{t.bpm.toFixed(1)}</td></tr>)}</tbody>
      </table></div>
      <h2>Energy events</h2>
      <ul>
        {result.energy.buildUps.map((b, i) => <li key={`b${i}`}>Build-up {fmt(b.start)}–{fmt(b.end)} (+{b.riseDb.toFixed(0)} dB)</li>)}
        {result.energy.breakdowns.map((b, i) => <li key={`d${i}`}>Breakdown {fmt(b.start)}–{fmt(b.end)} ({b.depthDb.toFixed(0)} dB down)</li>)}
        {result.rhythm.tempoChanges.map((c, i) => <li key={`t${i}`}>Tempo change at {fmt(c.time)}: {c.fromBpm.toFixed(0)} → {c.toBpm.toFixed(0)} BPM</li>)}
        {!result.energy.buildUps.length && !result.energy.breakdowns.length && !result.rhythm.tempoChanges.length && <li>No build-ups, breakdowns or tempo changes detected.</li>}
      </ul>
    </section>
  );
}

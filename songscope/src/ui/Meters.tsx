import type { AnalysisResult } from "../analysis/types";
import { mmss, num } from "../describe/format";

export function Meters({ result }: { result: AnalysisResult }) {
  const d = result.descriptors;
  const cards: [string, string, string?][] = [
    ["Key", result.harmony.key.name, `${(result.harmony.key.confidence * 100).toFixed(0)} % confidence`],
    ["Tempo", `${num(result.rhythm.bpm, 1)} BPM`, d.tempoMarking],
    ["Meter", result.rhythm.meter.label, `${result.rhythm.barsEstimate} bars`],
    ["Loudness", `${num(result.loudness.integratedLufs, 1)} LUFS`, `LRA ${num(result.loudness.loudnessRangeLu, 1)} LU`],
    ["True peak", `${num(result.loudness.truePeakDbtp, 2)} dBTP`, `PLR ${num(result.loudness.plr, 1)} dB`],
    ["Duration", mmss(result.durationSec), `${result.sampleRate / 1000} kHz · ${result.channels === 2 ? "stereo" : "mono"}`],
    ["Chords", String(result.harmony.progression.distinctChords), result.harmony.progression.topChords.slice(0, 3).map((c) => c.label).join(" · ")],
    ["Sections", String(result.structure.sections.length), result.structure.formString.length > 40 ? `${result.structure.formString.slice(0, 40)}…` : result.structure.formString],
  ];
  const bars: [string, number][] = [
    ["Energy", d.energy], ["Danceability", d.danceability], ["Valence", d.valence], ["Acousticness", d.acousticness],
    ["Aggressiveness", d.aggressiveness], ["Complexity", d.complexity], ["Brightness", d.brightness], ["Instrumentalness", d.instrumentalness],
  ];
  return (
    <section className="meters">
      <div className="cards">
        {cards.map(([l, v, n]) => (
          <div className="card" key={l}><div className="card-label">{l}</div><div className="card-value">{v}</div>{n && <div className="card-note">{n}</div>}</div>
        ))}
      </div>
      <div className="bars">
        {bars.map(([l, v]) => (
          <div className="bar" key={l}><span className="bar-label">{l}</span><div className="bar-track"><div className="bar-fill" style={{ width: `${Math.round(v * 100)}%` }} /></div><span className="bar-value">{Math.round(v * 100)}</span></div>
        ))}
      </div>
      <div className="tags">
        {d.moods.map((m) => <span className="tag" key={m}>{m}</span>)}
        {d.genres.slice(0, 3).map((g) => <span className="tag genre" key={g.name} title={g.reasons.join(", ")}>{g.name} {Math.round(g.score * 100)} %</span>)}
      </div>
    </section>
  );
}

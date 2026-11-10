# SongScope

Upload a song and get the whole story in writing: tempo, meter and swing; key,
scale and tuning; the chord progression in Roman numerals; the section structure;
energy arc and dynamics; BS.1770 loudness and a mastering report; timbre and tonal
balance; the stereo image; melody and vocal cues; and a mood/style estimate.
The description runs to a couple of thousand words, every sentence written from a
number the analysis measured, and comes with the raw figures as JSON.

Everything runs in the browser. The file is decoded with the Web Audio API and
analysed in a Web Worker by a pure-TypeScript DSP library; nothing is uploaded
anywhere. The same library powers a command-line tool that decodes with ffmpeg.

Vite · React 19 · TypeScript · no runtime dependencies beyond React and
[music-metadata](https://github.com/Borewit/music-metadata) (for tags and codec info).

```bash
cd songscope
npm install
npm run dev              # http://localhost:5174 — drop a file, or click "Try a synthesized demo track"
npm test                 # unit tests on synthesized audio with known ground truth
npm run build && npm run test:e2e   # drives the built app in Chromium: upload, report, exports, demo
npm run analyze -- ~/Music/song.mp3 --md report.md --json analysis.json   # CLI (needs ffmpeg)
```

If the Playwright browser download is unavailable, point the e2e run at a system
Chromium with `CHROMIUM_PATH=/path/to/chrome npm run test:e2e`.

---

## What the description covers

| Section | What is measured | How |
|---|---|---|
| At a glance | A three-paragraph summary of everything below | Templated from the results |
| File and format | Container, codec, bit rate, sample rate, bit depth, duration, embedded tags, cover art; tagged BPM/key checked against the measurement | `music-metadata` |
| Tempo, meter and rhythm | BPM with confidence and half/double-time alternatives, tempo marking, stability and drift, tempo changes, meter with alternatives, bar count, downbeats, swing ratio, onset density, off-beat share, beat strength | Onset-strength autocorrelation with a log-normal prior, dynamic-programming beat tracking, phase-variance meter evidence from accents, kick-band accents, chord changes and bass chroma |
| Key, scale and tuning | Key with runner-ups, relative/parallel/dominant/subdominant keys, closest scale template and modal tendencies, pitch-class histogram, tuning offset (A4 in Hz), key regions over time | Albrecht–Shanahan and Krumhansl–Kessler profiles on harmonic chroma; chord-aware refinement between relative keys; windowed estimation with hysteresis |
| Chords and harmony | Beat-synchronous chords (maj, min, dim, aug, 7, m7, maj7, sus4), Roman numerals, diatonic share, harmonic rhythm, most-used chords, recurring progressions matched against a dictionary of well-known loops, borrowed chords, cadence counts, chord colour | Template matching with Viterbi smoothing |
| Structure and arrangement | Sections with start/end, intro/verse/chorus/bridge/outro names, relative level, percussiveness, brightness, dominant chord, climax, repetition score, form string | Self-similarity of MFCC + chroma + level, checkerboard novelty plus level-change novelty, downbeat snapping, agglomerative clustering with diagonal (repetition) similarity |
| Energy and dynamics | Energy arc by thirds, loudest and quietest moments, fades, leading/trailing silence, breakdowns, build-ups, dynamic spread | Half-second RMS envelope |
| Loudness and mastering | Integrated / momentary / short-term LUFS, LRA, sample peak, 4× oversampled true peak, PLR, PSR, crest factor, DR value, RMS, noise floor, clipping, DC offset; gain each streaming platform would apply | ITU-R BS.1770-4 K-weighting and gating, EBU Tech 3342 |
| Timbre and spectrum | Spectral centroid, spread, roll-off, flatness, entropy, zero-crossing rate; seven-band tonal balance; spectral tilt; effective bandwidth with lossy-encoder cliff detection; narrow peaks (hum detection); harmonic/percussive energy split | STFT features at 22.05 kHz, long-term spectrum at native rate, median-filter HPSS |
| Stereo image | Correlation, width, side/mid ratio, L/R balance, low-band mono-ness, phase-cancelling blocks, width over time, dual-mono detection | Mid/side and correlation per one-second block |
| Melody and voice | Predominant-pitch coverage, median pitch and range, note rate, vibrato rate/extent, heuristic vocal likelihood | Harmonic summation with pitch-height weighting and octave correction on the harmonic spectrogram |
| Character, mood and style | Energy, danceability, valence, acousticness, aggressiveness, complexity, brightness, instrumentalness; mood words; style similarity to 16 production styles with reasons | Rule-based composites of the measurements above |
| Method and confidence | What is measured vs. estimated vs. heuristic; per-stage timings | — |

The web app also draws the waveform with the momentary loudness curve and beat
grid, a mel spectrogram, the section/chord/key lanes synced to playback, a set of
headline cards and descriptor bars, timeline tables, and the raw JSON. The report
can be copied as Markdown or downloaded as `.md` and `.json`.

## Layout

```
songscope/
├── index.html, src/main.tsx        Vite entry
├── src/analysis/                   the DSP library (browser + Node, no DOM)
│   ├── pipeline.ts                 orchestrates every stage, reports progress
│   ├── fft.ts  stft.ts  mel.ts     transforms and filterbanks
│   ├── chroma.ts  key.ts  chords.ts   tuning, pitch classes, keys, chords
│   ├── onset.ts  tempo.ts          onsets, tempo, beats, meter, swing
│   ├── hpss.ts  spectral.ts  melody.ts   separation, timbre, predominant pitch
│   ├── loudness.ts  stereo.ts  energy.ts  BS.1770, stereo image, RMS envelope
│   ├── structure.ts  descriptors.ts     sections, mood/style heuristics
│   └── types.ts                    the AnalysisResult shape
├── src/describe/                   turns an AnalysisResult into the written report (+ Markdown)
├── src/worker/                     Web Worker wrapper around the pipeline
├── src/ui/                         React components, canvas visualiser, styles
├── src/cli/analyze.ts              ffmpeg-backed command line
├── src/demo/synth.ts               synthesized test songs with known ground truth
├── tests/                          vitest: FFT, resampler, BS.1770 calibration, key/chords, tempo/meter, structure/report
└── scripts/e2e.ts                  Playwright run against the production build
```

## Accuracy and limits

Loudness, peaks, spectrum, stereo correlation, tempo and tuning are measurements
and are checked against reference signals in the tests (a full-scale 997 Hz sine
reads −3.01 LUFS and 0 dBTP, as the standard requires). Key, chords, meter and
structure are estimates: they are reliable on clearly tonal, beat-driven music and
can be confused by dense distortion, rubato, drones, non-Western tunings or
very sparse arrangements. Mood, style and vocal likelihood are heuristics and are
labelled as such in the report. Half-time and double-time readings of the tempo are
inherently ambiguous; the report always lists the alternative.

Files up to 200 MB are accepted; whatever the browser can decode works (MP3, WAV,
FLAC, OGG/Opus, AAC/M4A, AIFF, WebM; WMA only where the OS provides a decoder).
Analysis of a four-minute song takes a few seconds on a laptop.

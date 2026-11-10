#!/usr/bin/env node
/**
 * Command-line analysis using ffmpeg for decoding:
 *
 *   npm run analyze -- path/to/song.mp3            # Markdown report to stdout
 *   npm run analyze -- song.flac --json out.json   # also write the raw analysis
 *   npm run analyze -- song.wav --md report.md
 */
import { spawnSync } from "node:child_process";
import { statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseFile } from "music-metadata";
import { analyze } from "../analysis";
import { buildReport, reportToMarkdown } from "../describe";
import { fileInfoFromMetadata } from "../shared-metadata";

function decodeWithFfmpeg(file: string): { channels: Float32Array[]; sampleRate: number } {
  const probe = spawnSync("ffprobe", ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=sample_rate,channels", "-of", "json", file], { encoding: "utf8" });
  if (probe.status !== 0) throw new Error(`ffprobe failed: ${probe.stderr || "is ffmpeg installed?"}`);
  const stream = (JSON.parse(probe.stdout) as { streams?: { sample_rate?: string; channels?: number }[] }).streams?.[0];
  const sampleRate = Number(stream?.sample_rate ?? 44100);
  const nCh = Math.min(2, Number(stream?.channels ?? 2));
  const dec = spawnSync("ffmpeg", ["-v", "error", "-i", file, "-vn", "-ac", String(nCh), "-f", "f32le", "-acodec", "pcm_f32le", "-"], { maxBuffer: 1 << 30 });
  if (dec.status !== 0) throw new Error(`ffmpeg failed: ${dec.stderr?.toString() ?? ""}`);
  const buf = dec.stdout as Buffer;
  const interleaved = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
  const frames = Math.floor(interleaved.length / nCh);
  const channels = Array.from({ length: nCh }, () => new Float32Array(frames));
  for (let i = 0; i < frames; i++) for (let c = 0; c < nCh; c++) channels[c]![i] = interleaved[i * nCh + c]!;
  return { channels, sampleRate };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  if (!file) { console.error("usage: analyze <audio file> [--json out.json] [--md out.md] [--quiet]"); process.exit(2); }
  const opt = (name: string): string | undefined => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const quiet = args.includes("--quiet");
  const meta = await parseFile(file).catch(() => null);
  const info = fileInfoFromMetadata(meta, path.basename(file), statSync(file).size, "");
  if (!quiet) console.error(`Decoding ${file} …`);
  const audio = decodeWithFfmpeg(file);
  const result = analyze(audio, info, (stage, fraction) => { if (!quiet) process.stderr.write(`\r${stage.padEnd(40)} ${(fraction * 100).toFixed(0).padStart(3)} %`); });
  if (!quiet) process.stderr.write("\n");
  const report = buildReport(result);
  const md = reportToMarkdown(report);
  const jsonOut = opt("--json"), mdOut = opt("--md");
  const { previews, ...serialisable } = result;
  void previews;
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify(serialisable, null, 2));
  if (mdOut) writeFileSync(mdOut, md);
  if (!mdOut) process.stdout.write(md + "\n");
  if (!quiet) console.error(`${report.wordCount} words; stages: ${result.timings.map((t) => `${t.stage} ${t.ms} ms`).join(", ")}`);
}

main().catch((err) => { console.error(err instanceof Error ? err.message : err); process.exit(1); });


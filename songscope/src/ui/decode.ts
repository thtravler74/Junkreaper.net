import type { AnalysisResult, FileInfo } from "../analysis/types";
import { fileInfoFromMetadata } from "../shared-metadata";
import type { WorkerRequest, WorkerResponse } from "../worker/protocol";

export const ACCEPTED = ".mp3,.wav,.flac,.ogg,.oga,.opus,.m4a,.aac,.mp4,.webm,.aiff,.aif,.wma,audio/*";
export const MAX_BYTES = 200 * 1024 * 1024;

export interface DecodedAudio { channels: Float32Array[]; sampleRate: number; durationSec: number }

/** Read tags/format with music-metadata (loaded lazily; failure is non-fatal). */
export async function readFileInfo(file: File): Promise<FileInfo> {
  try {
    const mm = await import("music-metadata");
    const meta = await mm.parseBlob(file, { duration: false, skipCovers: false });
    return fileInfoFromMetadata(meta, file.name, file.size, file.type);
  } catch {
    return fileInfoFromMetadata(null, file.name, file.size, file.type);
  }
}

/**
 * Decode with the Web Audio API. An OfflineAudioContext at the file's own sample
 * rate avoids the implicit resampling a regular AudioContext would apply.
 */
export async function decodeAudio(file: File, preferredRate?: number): Promise<DecodedAudio> {
  const buf = await file.arrayBuffer();
  const rate = preferredRate && preferredRate >= 8000 && preferredRate <= 192000 ? preferredRate : 44100;
  let audio: AudioBuffer;
  try {
    const ctx = new OfflineAudioContext(1, 1, rate);
    audio = await ctx.decodeAudioData(buf.slice(0));
  } catch (err) {
    // Fall back to a regular context (some browsers restrict OfflineAudioContext decoding).
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    try { audio = await ctx.decodeAudioData(buf.slice(0)); }
    catch { throw new Error(`The browser could not decode this file (${err instanceof Error ? err.message : "unsupported format"}). Try converting it to WAV, FLAC or MP3.`); }
    finally { void ctx.close(); }
  }
  const channels: Float32Array[] = [];
  for (let c = 0; c < Math.min(2, audio.numberOfChannels); c++) channels.push(audio.getChannelData(c).slice());
  return { channels, sampleRate: audio.sampleRate, durationSec: audio.duration };
}

export type ProgressHandler = (stage: string, fraction: number) => void;

let worker: Worker | null = null;
let nextId = 1;

export function runAnalysis(audio: DecodedAudio, file: FileInfo, onProgress: ProgressHandler): Promise<AnalysisResult> {
  worker ??= new Worker(new URL("../worker/analysis.worker.ts", import.meta.url), { type: "module" });
  const w = worker;
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const onMessage = (ev: MessageEvent<WorkerResponse>): void => {
      const m = ev.data;
      if (m.id !== id) return;
      if (m.type === "progress") onProgress(m.stage, m.fraction);
      else if (m.type === "result") { cleanup(); resolve(m.result); }
      else if (m.type === "error") { cleanup(); reject(new Error(m.message)); }
    };
    const onError = (ev: ErrorEvent): void => { cleanup(); worker = null; reject(new Error(ev.message || "The analysis worker crashed.")); };
    const cleanup = (): void => { w.removeEventListener("message", onMessage); w.removeEventListener("error", onError); };
    w.addEventListener("message", onMessage);
    w.addEventListener("error", onError);
    // Copy the channel data so the main thread keeps its own buffers for playback/drawing.
    const copies = audio.channels.map((c) => c.slice());
    const req: WorkerRequest = { type: "analyze", id, channels: copies, sampleRate: audio.sampleRate, file };
    w.postMessage(req, copies.map((c) => c.buffer));
  });
}

import type { AnalysisResult, FileInfo } from "../analysis/types";

export type WorkerRequest = { type: "analyze"; id: number; channels: Float32Array[]; sampleRate: number; file: FileInfo };
export type WorkerResponse =
  | { type: "progress"; id: number; stage: string; fraction: number }
  | { type: "result"; id: number; result: AnalysisResult }
  | { type: "error"; id: number; message: string };

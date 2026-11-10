import type { ChordSegment, ProgressionSummary } from "./chords";
import type { Descriptors } from "./descriptors";
import type { EnergyProfile } from "./energy";
import type { KeyEstimate, KeySegment, ModalFlavour } from "./key";
import type { LoudnessResult } from "./loudness";
import type { MelodyResult } from "./melody";
import type { BandEnergy } from "./spectral";
import type { StereoResult } from "./stereo";
import type { StructureResult } from "./structure";
import type { MeterEstimate } from "./tempo";

export interface FileInfo {
  name: string;
  sizeBytes: number;
  mimeType: string;
  container?: string;
  codec?: string;
  bitrateKbps?: number;
  sampleRate?: number;
  channels?: number;
  bitsPerSample?: number;
  lossless?: boolean;
  durationSec?: number;
  encoder?: string;
  tags: {
    title?: string;
    artist?: string;
    album?: string;
    albumArtist?: string;
    year?: number;
    genre?: string[];
    track?: string;
    bpm?: number;
    key?: string;
    comment?: string;
    composer?: string;
    label?: string;
    isrc?: string;
    replayGainTrackDb?: number;
  };
  hasCoverArt: boolean;
}

export interface RhythmResult {
  bpm: number;
  bpmConfidence: number;
  bpmCandidates: { bpm: number; strength: number }[];
  localTempi: { time: number; bpm: number }[];
  tempoStability: number; // 0..1
  tempoDriftBpm: number; // 95th − 5th percentile of local tempo
  beats: number[];
  /** Onset strength at each beat (normalised to the mean onset strength). */
  beatAccents: number[];
  beatStrength: number; // 0..1
  beatIntervalCv: number;
  meter: MeterEstimate;
  barsEstimate: number;
  downbeats: number[];
  swing: { ratio: number; label: string };
  onsets: number[];
  onsetsPerSecond: number;
  offbeatShare: number; // 0..1 share of onset energy landing off the beat grid
  tempoChanges: { time: number; fromBpm: number; toBpm: number }[];
}

export interface HarmonyResult {
  key: KeyEstimate;
  modalFlavour: ModalFlavour;
  keyTimeline: KeySegment[];
  pitchClassHistogram: { note: string; share: number }[];
  tuning: { deviationCents: number; a4Hz: number; confidence: number };
  chords: ChordSegment[];
  progression: ProgressionSummary;
  harmonicShare: number; // harmonic energy / total
}

export interface TimbreResult {
  meanCentroidHz: number;
  centroidStdHz: number;
  meanBandwidthHz: number;
  meanRolloff85Hz: number;
  meanRolloff95Hz: number;
  meanFlatness: number;
  meanEntropy: number;
  meanZcr: number;
  percussiveShare: number;
  bandEnergies: BandEnergy[];
  longTermSpectrum: { hz: number; db: number }[];
  tiltDbPerOctave: number;
  effectiveBandwidthHz: number;
  bandwidthCliff: boolean;
  nyquistHz: number;
  spectralPeaks: { hz: number; prominenceDb: number }[];
  mfccMeans: number[];
  centroidOverTime: { time: number; hz: number }[];
  descriptors: string[];
}

export interface Previews {
  waveform: { min: Float32Array; max: Float32Array; columns: number };
  melSpectrogram: { data: Uint8Array; columns: number; rows: number; maxHz: number };
  ssm: { size: number; data: Uint8Array };
}

export interface AnalysisResult {
  version: string;
  analyzedAt: string;
  file: FileInfo;
  durationSec: number;
  sampleRate: number;
  channels: number;
  analysisSampleRate: number;
  rhythm: RhythmResult;
  harmony: HarmonyResult;
  loudness: LoudnessResult;
  stereo: StereoResult;
  energy: EnergyProfile;
  timbre: TimbreResult;
  structure: StructureResult;
  melody: MelodyResult;
  descriptors: Descriptors;
  timings: { stage: string; ms: number }[];
  previews?: Previews;
}

export type ProgressFn = (stage: string, fraction: number) => void;

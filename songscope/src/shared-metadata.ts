import type { IAudioMetadata } from "music-metadata";
import type { FileInfo } from "./analysis/types";

/** Map music-metadata output onto our FileInfo shape. */
export function fileInfoFromMetadata(meta: IAudioMetadata | null, name: string, sizeBytes: number, mimeType: string): FileInfo {
  const f = meta?.format, c = meta?.common;
  const rg = c?.replaygain_track_gain?.dB;
  return {
    name,
    sizeBytes,
    mimeType,
    container: f?.container,
    codec: f?.codec ?? f?.codecProfile,
    bitrateKbps: f?.bitrate ? f.bitrate / 1000 : undefined,
    sampleRate: f?.sampleRate,
    channels: f?.numberOfChannels,
    bitsPerSample: f?.bitsPerSample,
    lossless: f?.lossless,
    durationSec: f?.duration,
    encoder: c?.encodedby ?? f?.tool,
    tags: {
      title: c?.title,
      artist: c?.artist ?? c?.artists?.[0],
      album: c?.album,
      albumArtist: c?.albumartist,
      year: c?.year,
      genre: c?.genre,
      track: c?.track?.no ? `${c.track.no}${c.track.of ? ` of ${c.track.of}` : ""}` : undefined,
      bpm: c?.bpm,
      key: c?.key,
      comment: c?.comment?.map((x) => (typeof x === "string" ? x : x.text ?? "")).filter(Boolean).join(" "),
      composer: c?.composer?.join(", "),
      label: c?.label?.join(", "),
      isrc: c?.isrc?.join(", "),
      replayGainTrackDb: typeof rg === "number" ? rg : undefined,
    },
    hasCoverArt: Boolean(c?.picture?.length),
  };
}

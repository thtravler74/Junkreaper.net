"use client";

import { useEffect, useRef, useState } from "react";
import { ApiError, api } from "@/lib/client/api";
import { resizeImage } from "@/lib/client/resizeImage";
import { MAX_PHOTOS } from "@/lib/schemas";
import type { AnalyzeResponse } from "./types";

interface Photo {
  id: string;
  mime: "image/jpeg";
  base64: string;
  previewUrl: string;
}

const PROGRESS = ["Uploading photos…", "Spotting items…", "Measuring the pile…", "Calculating truck space…"];

export function PhotoIntake({ slug, onAnalyzed, onFallback }: {
  slug: string;
  onAnalyzed: (r: AnalyzeResponse) => void;
  onFallback: () => void;
}) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!busy) return;
    setPhase(0);
    const t = setInterval(() => setPhase((p) => Math.min(PROGRESS.length - 1, p + 1)), 2200);
    return () => clearInterval(t);
  }, [busy]);

  async function addFiles(files: FileList | File[]) {
    setError(null);
    const room = MAX_PHOTOS - photos.length;
    const chosen = Array.from(files).filter((f) => f.type.startsWith("image/")).slice(0, room);
    if (Array.from(files).length > room) setError(`Up to ${MAX_PHOTOS} photos. Extra photos were skipped.`);
    try {
      const resized = await Promise.all(chosen.map(async (f) => ({ id: crypto.randomUUID(), ...(await resizeImage(f)) })));
      setPhotos((prev) => [...prev, ...resized].slice(0, MAX_PHOTOS));
    } catch {
      setError("One of those files couldn't be read as a photo. HEIC from older browsers? Try a JPEG or a screenshot.");
    }
  }

  async function analyze() {
    setBusy(true);
    setError(null);
    try {
      const result = await api<AnalyzeResponse>(`/api/t/${slug}/analyze`, {
        body: { images: photos.map(({ mime, base64 }) => ({ mime, base64 })) },
      });
      onAnalyzed(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong analyzing your photos.");
    } finally {
      setBusy(false);
    }
  }

  if (busy) {
    return (
      <div className="flex flex-col items-center gap-4 py-10 text-center" role="status">
        <div className="grid grid-cols-3 gap-2">
          {photos.slice(0, 3).map((p) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={p.id} src={p.previewUrl} alt="" className="h-16 w-16 animate-pulse rounded-lg object-cover" />
          ))}
        </div>
        <div className="h-1.5 w-48 overflow-hidden rounded-full bg-slate-200">
          <div className="h-full bg-brand transition-all duration-[2000ms]" style={{ width: `${((phase + 1) / PROGRESS.length) * 100}%` }} />
        </div>
        <p className="font-medium text-slate-700">{PROGRESS[phase]}</p>
        <p className="text-xs text-slate-500">This usually takes 5–15 seconds.</p>
      </div>
    );
  }

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void addFiles(e.dataTransfer.files);
        }}
        className={`rounded-2xl border-2 border-dashed p-5 text-center transition ${dragging ? "border-brand bg-brand/5" : "border-slate-300"}`}
      >
        {photos.length === 0 ? (
          <>
            <div className="mb-1 text-3xl">📸</div>
            <p className="font-semibold text-slate-800">Snap 1–{MAX_PHOTOS} photos of your junk</p>
            <p className="mb-4 text-sm text-slate-500">Step back so the whole pile is in frame. Different angles help.</p>
          </>
        ) : (
          <div className="mb-4 grid grid-cols-3 gap-2 sm:grid-cols-5">
            {photos.map((p) => (
              <div key={p.id} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.previewUrl} alt="Your upload" className="aspect-square w-full rounded-lg object-cover" />
                <button
                  type="button"
                  aria-label="Remove photo"
                  onClick={() => setPhotos((prev) => prev.filter((x) => x.id !== p.id))}
                  className="absolute -right-1.5 -top-1.5 grid h-6 w-6 place-items-center rounded-full bg-slate-900 text-xs text-white"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
        {photos.length < MAX_PHOTOS && (
          <div className="flex flex-wrap justify-center gap-2">
            <button type="button" onClick={() => cameraRef.current?.click()} className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white">
              Take photo
            </button>
            <button type="button" onClick={() => uploadRef.current?.click()} className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700">
              Upload from device
            </button>
          </div>
        )}
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => e.target.files && void addFiles(e.target.files)} />
        <input
          ref={uploadRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic"
          multiple
          hidden
          data-testid="photo-input"
          onChange={(e) => {
            if (e.target.files) void addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {photos.length > 0 && (
        <button type="button" onClick={analyze} className="mt-4 w-full rounded-xl bg-slate-900 py-3 font-semibold text-white active:scale-[0.99]">
          Estimate from {photos.length} photo{photos.length > 1 ? "s" : ""}
        </button>
      )}
      <button type="button" onClick={onFallback} className="mt-3 w-full text-sm text-slate-500 underline-offset-2 hover:underline">
        Prefer to pick items from a list?
      </button>
    </div>
  );
}

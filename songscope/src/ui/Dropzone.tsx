import { useRef, useState, type DragEvent } from "react";
import { ACCEPTED, MAX_BYTES } from "./decode";

interface Props { onFile: (f: File) => void; onDemo: () => void; busy: boolean }

export function Dropzone({ onFile, onDemo, busy }: Props) {
  const [over, setOver] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const take = (f: File | undefined): void => {
    setErr(null);
    if (!f) return;
    if (f.size > MAX_BYTES) { setErr(`That file is ${(f.size / 1048576).toFixed(0)} MB; the limit is ${MAX_BYTES / 1048576} MB.`); return; }
    onFile(f);
  };
  const onDrop = (e: DragEvent): void => { e.preventDefault(); setOver(false); take(e.dataTransfer.files[0]); };
  return (
    <section className={`dropzone${over ? " over" : ""}${busy ? " busy" : ""}`} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop} aria-busy={busy}>
      <div className="dropzone-inner">
        <div className="dropzone-icon" aria-hidden>♫</div>
        <h2>Drop a song here</h2>
        <p>MP3, WAV, FLAC, OGG/Opus, AAC/M4A, AIFF… anything your browser can decode. The file never leaves your computer: decoding and analysis both run locally.</p>
        <div className="dropzone-actions">
          <button className="primary" type="button" disabled={busy} onClick={() => input.current?.click()}>Choose a file</button>
          <button type="button" disabled={busy} onClick={onDemo} data-testid="demo-button">Try a synthesized demo track</button>
        </div>
        <input ref={input} data-testid="file-input" type="file" accept={ACCEPTED} hidden onChange={(e) => { take(e.target.files?.[0]); e.target.value = ""; }} />
        {err && <p className="error" role="alert">{err}</p>}
      </div>
    </section>
  );
}

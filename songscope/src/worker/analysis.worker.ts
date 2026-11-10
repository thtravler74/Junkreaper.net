import { analyze } from "../analysis";
import type { WorkerRequest, WorkerResponse } from "./protocol";

const post = (m: WorkerResponse): void => { (self as unknown as Worker).postMessage(m); };

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  if (msg.type !== "analyze") return;
  try {
    let lastSent = 0;
    const result = analyze({ channels: msg.channels, sampleRate: msg.sampleRate }, msg.file, (stage, fraction) => {
      const now = Date.now();
      if (fraction >= 1 || now - lastSent > 60) { lastSent = now; post({ type: "progress", id: msg.id, stage, fraction }); }
    });
    post({ type: "result", id: msg.id, result });
  } catch (err) {
    post({ type: "error", id: msg.id, message: err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err) });
  }
};

import { useMemo } from "react";
import type { AnalysisResult } from "../analysis/types";

export function stripPreviews(r: AnalysisResult): Omit<AnalysisResult, "previews"> {
  const { previews, ...rest } = r;
  void previews;
  return rest;
}

export function DataView({ result }: { result: AnalysisResult }) {
  const json = useMemo(() => JSON.stringify(stripPreviews(result), (_k, v) => (typeof v === "number" ? Number(v.toFixed(5)) : v), 2), [result]);
  return (
    <section className="data">
      <p className="muted">The complete analysis as JSON — every number the description was written from. Typed arrays used for drawing are omitted.</p>
      <pre data-testid="json">{json}</pre>
    </section>
  );
}

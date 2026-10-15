export function Stepper({ value, onChange, min = 0, max = 99, step = 1, label }: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label: string;
}) {
  const btn =
    "grid h-9 w-9 place-items-center rounded-full border text-lg font-semibold leading-none transition active:scale-95 disabled:opacity-30";
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        aria-label={`Fewer ${label}`}
        className={`${btn} border-slate-300 bg-white text-slate-700`}
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, round(value - step)))}
      >
        −
      </button>
      <span className="w-8 text-center font-semibold tabular-nums" aria-live="polite">
        {value}
      </span>
      <button
        type="button"
        aria-label={`More ${label}`}
        className={`${btn} border-brand bg-brand text-white`}
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, round(value + step)))}
      >
        +
      </button>
    </div>
  );
}

function round(n: number) {
  return Math.round(n * 100) / 100;
}

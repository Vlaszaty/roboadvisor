interface Props {
  min: number;
  max: number;
  value: number;
  onChange(v: number): void;
  labelledBy: string;
  unit?: string;
}

/** Illustrative yearly growth for the picture only. Not the model's estimate and not a promise. */
export const DEMO_RATE = 0.06;

export function grownValue(years: number, rate = DEMO_RATE, start = 1000): number {
  return start * (1 + rate) ** years;
}

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

/**
 * Volume-style slider for "how many years". One bar per year, getting taller with time, so the
 * picture shows how much longer money has to grow. A transparent range input on top does the
 * dragging, so touch, mouse and keyboard all work.
 */
export function GrowthSlider({ min, max, value, onChange, labelledBy, unit = 'years' }: Props) {
  const years = Array.from({ length: max - min + 1 }, (_, i) => min + i);
  const top = (1 + DEMO_RATE) ** max - 1;
  const height = (y: number) => 10 + 90 * (((1 + DEMO_RATE) ** y - 1) / top);
  return (
    <div className="growth">
      <div className="growth-readout" aria-live="polite">
        <span className="growth-years num">{value}</span>
        <span className="growth-unit">{value === 1 ? 'year' : unit}</span>
      </div>
      <div className="growth-bars-wrap">
        <div className="growth-bars" aria-hidden="true">
          {years.map((y) => (
            <span key={y} className={`growth-bar ${y <= value ? 'is-on' : ''}`} style={{ height: `${height(y)}%` }} />
          ))}
        </div>
        <input
          className="growth-input"
          type="range"
          min={min}
          max={max}
          step={1}
          value={value}
          aria-labelledby={labelledBy}
          aria-valuetext={`${value} ${value === 1 ? 'year' : unit}`}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      </div>
      <div className="growth-scale" aria-hidden="true">
        <span>Soon</span>
        <span>A long time</span>
      </div>
      <p className="growth-sentence">
        <strong className="num">1,000</strong> invested today could grow to about{' '}
        <strong className="num">{fmt(grownValue(value))}</strong> in {value} {value === 1 ? 'year' : unit}.
      </p>
      <p className="field-hint">An example at {Math.round(DEMO_RATE * 100)}% a year. Real results vary and are not promised.</p>
    </div>
  );
}

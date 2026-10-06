import { useId } from 'react';
import { money } from '../components/charts/format';
import { useStore } from '../state/store';
import { NumberInput } from './NumberInput';

type Mode = 'once' | 'monthly' | 'both' | 'later';

const ONCE_PRESETS = [1000, 5000, 10000, 25000];
const MONTHLY_PRESETS = [50, 100, 250, 500];
const DEFAULT_ONCE = 5000;
const DEFAULT_MONTHLY = 100;

const MODES: Array<{ id: Mode; title: string; note: string }> = [
  { id: 'monthly', title: 'Every month', note: 'A fixed amount each month' },
  { id: 'once', title: 'One time', note: 'A lump sum today' },
  { id: 'both', title: 'Both', note: 'Start with a lump sum, then add monthly' },
  { id: 'later', title: 'Not sure yet', note: 'Show the plan without amounts' },
];

export const modeOf = (once: number, monthly: number): Mode =>
  once > 0 && monthly > 0 ? 'both' : once > 0 ? 'once' : monthly > 0 ? 'monthly' : 'later';

const symbol = (currency: string) => (currency === 'USD' ? '$' : '€');

function Presets({ values, current, currency, onPick }: { values: number[]; current: number; currency: string; onPick(v: number): void }) {
  return (
    <div className="amount-presets" role="group" aria-label="Quick amounts">
      {values.map((v) => (
        <button key={v} type="button" className={`amount-chip ${current === v ? 'is-selected' : ''}`} aria-pressed={current === v} onClick={() => onPick(v)}>
          {money(v, currency)}
        </button>
      ))}
    </div>
  );
}

/** One-time and monthly amounts. They do not change which funds you get, only the money figures shown. */
export function AmountCard({ title = 'How much will you invest?' }: { title?: string }) {
  const [{ profile }, dispatch] = useStore();
  const id = useId();
  const once = profile.initial_amount ?? 0;
  const monthly = profile.monthly_amount ?? 0;
  const currency = profile.base_currency;
  const mode = modeOf(once, monthly);
  const set = (patch: { initial_amount?: number; monthly_amount?: number }) => dispatch({ type: 'setProfile', patch });

  const pick = (m: Mode) => {
    if (m === 'later') set({ initial_amount: 0, monthly_amount: 0 });
    if (m === 'once') set({ initial_amount: once > 0 ? once : DEFAULT_ONCE, monthly_amount: 0 });
    if (m === 'monthly') set({ initial_amount: 0, monthly_amount: monthly > 0 ? monthly : DEFAULT_MONTHLY });
    if (m === 'both') set({ initial_amount: once > 0 ? once : DEFAULT_ONCE, monthly_amount: monthly > 0 ? monthly : DEFAULT_MONTHLY });
  };

  return (
    <section className="amount card" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`} className="amount-title">{title}</h2>
      <p className="muted">This does not change which funds you get. It shows what your plan could mean in {currency === 'USD' ? 'dollars' : 'euros'}.</p>

      <div className="amount-modes" role="radiogroup" aria-labelledby={`${id}-h`}>
        {MODES.map((m) => (
          <label key={m.id} className={`amount-mode ${mode === m.id ? 'is-selected' : ''}`}>
            <input type="radio" name={`${id}-mode`} value={m.id} checked={mode === m.id} onChange={() => pick(m.id)} />
            <span className="amount-mode-title">{m.title}</span>
            <span className="amount-mode-note">{m.note}</span>
          </label>
        ))}
      </div>

      {(mode === 'once' || mode === 'both') && (
        <div className="amount-field">
          <label htmlFor={`${id}-once`}>One-time amount</label>
          <div className="amount-input">
            <span aria-hidden="true">{symbol(currency)}</span>
            <NumberInput id={`${id}-once`} value={once} min={0} step={100} isValid={(n) => n >= 0 && n <= 100_000_000} onCommit={(n) => set({ initial_amount: n })} />
          </div>
          <Presets values={ONCE_PRESETS} current={once} currency={currency} onPick={(v) => set({ initial_amount: v })} />
        </div>
      )}

      {(mode === 'monthly' || mode === 'both') && (
        <div className="amount-field">
          <label htmlFor={`${id}-monthly`}>Amount each month</label>
          <div className="amount-input">
            <span aria-hidden="true">{symbol(currency)}</span>
            <NumberInput id={`${id}-monthly`} value={monthly} min={0} step={10} isValid={(n) => n >= 0 && n <= 1_000_000} onCommit={(n) => set({ monthly_amount: n })} />
          </div>
          <Presets values={MONTHLY_PRESETS} current={monthly} currency={currency} onPick={(v) => set({ monthly_amount: v })} />
        </div>
      )}
    </section>
  );
}

import { useRef, useState } from 'react';
import { api, type Schemas } from '../api/client';
import { Field } from './charts/ChartFrame';
import { useRequest } from './charts/hooks';
import { ErrorBox, Loading } from './charts/Status';
import {
  draftFromSettings, patchFromDraft, validateDraft, type SettingsDraft,
} from './charts/settingsDraft';
import { percent } from './charts/format';
import { useStore } from '../state/store';
import { Button } from './ui';
import './charts/results.css';

const MODELS = [
  { value: 'capm_multi_asset', label: 'Multi-asset CAPM (stocks and bonds market)' },
  { value: 'capm_equity', label: 'Equity-only CAPM' },
];
const STRATEGIES = [
  { value: 'target_vol', label: 'Target volatility (default)' },
  { value: 'min_variance', label: 'Minimum variance' },
  { value: 'max_sharpe', label: 'Maximum Sharpe ratio' },
  { value: 'risk_parity', label: 'Risk parity' },
  { value: 'hrp', label: 'Hierarchical risk parity' },
];

/** Nav button + modal <dialog> with the advanced EngineSettings. Applying dispatches `setSettings`. */
export function SettingsDrawer() {
  const [state, dispatch] = useStore();
  const ref = useRef<HTMLDialogElement>(null);
  const { state: defs, reload } = useRequest<Schemas['Defaults']>(
    // openapi-fetch widens the vol_range tuple to number[]; the payload is the Defaults schema.
    async (signal) => {
      const res = await api.GET('/api/defaults', { signal });
      return { data: res.data as Schemas['Defaults'] | undefined, error: res.error };
    },
    'defaults',
  );
  const [edited, setEdited] = useState<SettingsDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const defaults = defs.status === 'ok' ? defs.data : null;
  const draft = edited ?? (defaults ? draftFromSettings(state.settings, defaults) : null);
  const patch = (p: Partial<SettingsDraft>) => draft && setEdited({ ...draft, ...p });
  const modelPremium = defaults?.markets[draft?.model ?? '']?.premium;

  const open = () => {
    setEdited(null);
    setError(null);
    setNotice(null);
    ref.current?.showModal();
  };
  const close = () => ref.current?.close();
  const apply = () => {
    if (!draft) return;
    const problem = validateDraft(draft);
    if (problem) {
      setError(problem);
      return;
    }
    dispatch({ type: 'setSettings', patch: patchFromDraft(draft) });
    close();
  };
  const reset = () => {
    dispatch({ type: 'load', state: { ...state, settings: {} } });
    setEdited(null);
    setError(null);
    setNotice('Settings reset to defaults.');
  };

  return (
    <>
      <Button type="button" onClick={open} aria-haspopup="dialog">Advanced settings</Button>
      <dialog
        ref={ref} className="drawer" aria-labelledby="settings-title"
        onClick={(e) => { if (e.target === e.currentTarget) close(); }}
      >
        <form className="drawer-body" onSubmit={(e) => { e.preventDefault(); apply(); }}>
          <h2 id="settings-title">Advanced settings</h2>
          <p className="muted small" style={{ margin: 0 }}>
            These change how the engine builds and tests portfolios. The defaults suit most people.
          </p>

          {defs.status === 'loading' && <Loading />}
          {defs.status === 'error' && <ErrorBox message={defs.message} onRetry={reload} />}

          {draft && (
            <>
              <Field label="Expected return model">
                <select className="input" value={draft.model} onChange={(e) => patch({ model: e.target.value })}>
                  {MODELS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </Field>
              <Field label="Strategy">
                <select className="input" value={draft.strategy} onChange={(e) => patch({ strategy: e.target.value })}>
                  {STRATEGIES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </Field>
              <Field label="Estimation window (years)" hint="How much history is used to estimate risk.">
                <input className="input" type="number" min="1" max="20" step="1" value={draft.windowYears} onChange={(e) => patch({ windowYears: e.target.value })} />
              </Field>
              <Field
                label="Market premium override (% per year)"
                hint={`Leave blank to use the model default${modelPremium == null ? '' : ` (${percent(modelPremium, 1)})`}.`}
              >
                <input className="input" type="number" min="0" max="20" step="0.1" value={draft.premiumPct} onChange={(e) => patch({ premiumPct: e.target.value })} />
              </Field>
              <div className="form-grid">
                <Field label="Volatility at risk 0 (%)">
                  <input className="input" type="number" min="0.5" max="100" step="0.5" value={draft.volMinPct} onChange={(e) => patch({ volMinPct: e.target.value })} />
                </Field>
                <Field label="Volatility at risk 100 (%)">
                  <input className="input" type="number" min="1" max="100" step="0.5" value={draft.volMaxPct} onChange={(e) => patch({ volMaxPct: e.target.value })} />
                </Field>
              </div>
              <Field label="Monte Carlo paths" hint="More paths are smoother but slower (500 to 100000).">
                <input className="input" type="number" min="500" max="100000" step="500" value={draft.mcPaths} onChange={(e) => patch({ mcPaths: e.target.value })} />
              </Field>
            </>
          )}

          {notice && !error && <div role="status" className="banner">{notice}</div>}
          {error && <div role="alert" className="banner banner-error">{error}</div>}

          <div className="row">
            <Button type="submit" variant="primary" disabled={!draft}>Apply</Button>
            <Button type="button" onClick={reset}>Reset to defaults</Button>
            <Button type="button" onClick={close}>Close</Button>
          </div>
        </form>
      </dialog>
    </>
  );
}

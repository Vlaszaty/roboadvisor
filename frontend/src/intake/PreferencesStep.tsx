import { useState, type FormEvent } from 'react';
import { api, type Schemas } from '../api/client';
import { Button, pct } from '../components/ui';
import { useStore } from '../state/store';
import { ErrorBox, Loading } from './ApiState';
import {
  PREF_DEFAULTS, cryptoAvailable, deriveOptions, labelFor, percentToFraction, regionMode, sectorMode, setRegionMode,
  setSectorMode, validatePreferences, type FundSummary, type RegionMode, type SectorMode,
} from './logic';
import { NumberInput } from './NumberInput';
import { unwrap } from './request';
import { useRequest } from './useRequest';

export interface PreferencesStepProps {
  defaults: Schemas['Defaults'];
  onBack(): void;
  onFinish(): void;
}

const SECTOR_OPTIONS: { value: SectorMode; label: string }[] = [
  { value: 'neutral', label: 'Neutral' },
  { value: 'tilt5', label: 'Tilt toward: at least 5%' },
  { value: 'tilt10', label: 'Tilt toward: at least 10%' },
  { value: 'exclude', label: 'Exclude' },
];
const REGION_OPTIONS: { value: RegionMode; label: string }[] = [
  { value: 'any', label: 'Allowed' },
  { value: 'include', label: 'Focus on' },
  { value: 'exclude', label: 'Exclude' },
];

export function PreferencesStep({ defaults, onBack, onFinish }: PreferencesStepProps) {
  const [state, dispatch] = useStore();
  const prefs = state.profile.preferences ?? {};
  const level = state.profile.risk_level;
  const [errors, setErrors] = useState<string[]>([]);
  const [universe, retryUniverse] = useRequest(() => unwrap<FundSummary[]>(api.GET('/api/universe')), []);

  const set = (patch: Partial<typeof prefs>) => dispatch({ type: 'setPreferences', patch });
  const cryptoOn = cryptoAvailable(level, defaults.crypto_min_risk_level);
  const cryptoMax = prefs.crypto_max ?? PREF_DEFAULTS.crypto_max;
  const terOn = prefs.max_ter != null;
  const distribution = prefs.distribution ?? PREF_DEFAULTS.distribution;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const found = validatePreferences(prefs);
    setErrors(found);
    if (found.length > 0) return;
    if (!cryptoOn && cryptoMax > 0) set({ crypto_max: 0 });
    onFinish();
  };

  const options = universe.status === 'ok' ? deriveOptions(universe.data) : { regions: [], sectors: [] };

  return (
    <form onSubmit={submit} noValidate>
      <p className="wiz-kicker">Step 3 of 3</p>
      <h2>Your preferences</h2>
      <p className="muted">Everything here is optional. The defaults suit most people, and you can change any of it later.</p>

      <fieldset className="field">
        <legend>Base currency</legend>
        <div className="seg" role="radiogroup" aria-label="Base currency">
          {(['EUR', 'USD'] as const).map((c) => (
            <label key={c} className={state.profile.base_currency === c ? 'is-selected' : ''}>
              <input type="radio" name="base_currency" value={c} checked={state.profile.base_currency === c} onChange={() => dispatch({ type: 'setProfile', patch: { base_currency: c } })} />
              {c}
            </label>
          ))}
        </div>
        <p className="field-hint">The currency you spend in. Results are shown in it. EUR investors get UCITS funds by default.</p>
      </fieldset>

      <div className="field">
        <label className="check">
          <input type="checkbox" checked={prefs.hedge_bonds ?? PREF_DEFAULTS.hedge_bonds} onChange={(e) => set({ hedge_bonds: e.target.checked })} />
          <span>
            <strong>Hedge bond currency risk</strong>
            <br />
            <span className="field-hint">Prefers bond funds that remove currency swings, so bonds behave like bonds.</span>
          </span>
        </label>
        <label className="check">
          <input type="checkbox" checked={prefs.esg_only ?? PREF_DEFAULTS.esg_only} onChange={(e) => set({ esg_only: e.target.checked })} />
          <span>
            <strong>Sustainable (ESG) funds only</strong>
            <br />
            <span className="field-hint">Limits the choice of funds, which can slightly raise costs.</span>
          </span>
        </label>
      </div>

      <fieldset className="field">
        <legend>Regions</legend>
        <p className="field-hint">Global funds are always allowed. "Focus on" limits regional funds to the ones you pick.</p>
        {universe.status === 'loading' && <Loading label="Loading regions" />}
        {universe.status === 'error' && <ErrorBox message={universe.message} onRetry={retryUniverse} />}
        {universe.status === 'ok' && (
          <div className="pref-grid">
            {options.regions.map((r) => (
              <label key={r}>
                <span>{labelFor(r)}</span>
                <select aria-label={`${labelFor(r)} region`} value={regionMode(prefs, r)} onChange={(e) => set(setRegionMode(prefs, r, e.target.value as RegionMode))}>
                  {REGION_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        )}
      </fieldset>

      <fieldset className="field">
        <legend>Sectors</legend>
        <p className="field-hint">A tilt reserves at least that share of the portfolio for the sector. Exclude what you do not want to own.</p>
        {universe.status === 'ok' && options.sectors.length === 0 && <p className="field-hint">No sector funds in the current fund list.</p>}
        {universe.status === 'ok' && options.sectors.length > 0 && (
          <div className="pref-grid">
            {options.sectors.map((s) => (
              <label key={s}>
                <span>{labelFor(s)}</span>
                <select aria-label={`${labelFor(s)} sector`} value={sectorMode(prefs, s)} onChange={(e) => set(setSectorMode(prefs, s, e.target.value as SectorMode))}>
                  {SECTOR_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        )}
      </fieldset>

      <fieldset className="field">
        <legend>Crypto</legend>
        {cryptoOn ? (
          <>
            <label className="check">
              <input
                type="checkbox"
                checked={cryptoMax > 0}
                onChange={(e) => set({ crypto_max: e.target.checked ? defaults.crypto_default_cap : 0 })}
              />
              <span>
                <strong>Allow a small crypto position</strong>
                <br />
                <span className="field-hint">Very volatile. It can lose most of its value. Off unless you opt in.</span>
              </span>
            </label>
            {cryptoMax > 0 && (
              <div className="field">
                <label htmlFor="crypto-cap">
                  Maximum crypto share: <span className="num">{pct(cryptoMax, 0)}</span>
                </label>
                <input
                  id="crypto-cap"
                  type="range"
                  min={0.01}
                  max={defaults.crypto_hard_cap}
                  step={0.01}
                  value={cryptoMax}
                  aria-valuetext={pct(cryptoMax, 0)}
                  onChange={(e) => set({ crypto_max: Number(e.target.value) })}
                />
              </div>
            )}
          </>
        ) : (
          <p className="field-hint">
            Crypto is only offered from risk level {defaults.crypto_min_risk_level} upward. Your level is {Math.round(level)}.
          </p>
        )}
      </fieldset>

      <fieldset className="field">
        <legend>Portfolio shape and costs</legend>
        <div className="field-row">
          <label htmlFor="max-etfs">Maximum number of funds</label>
          <NumberInput
            id="max-etfs"
            className="plain"
            min={1}
            max={30}
            step={1}
            style={{ width: '5rem' }}
            value={prefs.max_etfs ?? PREF_DEFAULTS.max_etfs}
            isValid={(n) => Number.isInteger(n) && n >= 1 && n <= 30}
            onCommit={(n) => set({ max_etfs: n })}
          />
        </div>
        <label className="check">
          <input type="checkbox" checked={terOn} onChange={(e) => set({ max_ter: e.target.checked ? 0.005 : null })} />
          <span>Cap the yearly fee (TER) of each fund</span>
        </label>
        {terOn && (
          <div className="field-row">
            <label htmlFor="max-ter">No fund dearer than</label>
            <NumberInput
              id="max-ter"
              className="plain"
              min={0.05}
              max={2}
              step={0.05}
              style={{ width: '6rem' }}
              value={Number(((prefs.max_ter ?? 0.005) * 100).toFixed(2))}
              isValid={(x) => x > 0}
              onCommit={(x) => set({ max_ter: percentToFraction(x) })}
            />
            <span>% per year</span>
          </div>
        )}
      </fieldset>

      <fieldset className="field">
        <legend>Dividends</legend>
        <div className="seg" role="radiogroup" aria-label="Distribution">
          {(
            [
              ['any', 'No preference'],
              ['acc', 'Reinvest (accumulating)'],
              ['dist', 'Pay out (distributing)'],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className={distribution === value ? 'is-selected' : ''}>
              <input type="radio" name="distribution" value={value} checked={distribution === value} onChange={() => set({ distribution: value })} />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      {errors.length > 0 && (
        <div className="form-errors" role="alert">
          {errors.map((m) => (
            <p key={m}>{m}</p>
          ))}
        </div>
      )}

      <div className="wiz-actions">
        <Button type="button" onClick={onBack}>
          Back
        </Button>
        <Button type="submit" variant="primary">
          See my portfolio
        </Button>
      </div>
    </form>
  );
}

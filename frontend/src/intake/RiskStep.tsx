import { useEffect, useState } from 'react';
import { api, type Schemas } from '../api/client';
import { Button, Stat, pct } from '../components/ui';
import { useStore } from '../state/store';
import { ErrorBox, Loading } from './ApiState';
import {
  answersKey, badYear, limitingText, lossProbability, profilePatchFromScore, riskLabel, riskNotice, targetVol,
  type Answers, type IntakeScore,
} from './logic';
import { NumberInput } from './NumberInput';
import { unwrap } from './request';
import { useRequest } from './useRequest';

export interface RiskStepProps {
  answers: Answers;
  defaults: Schemas['Defaults'];
  scoredKey: string | null;
  onScored(key: string): void;
  onBack(): void;
  onNext(): void;
}

function Meter({ label, value, sub }: { label: string; value: number; sub: string }) {
  return (
    <div>
      <div className="meter-label">
        <span>{label}</span>
        <span className="num">{Math.round(value)}</span>
      </div>
      <div className="meter-track" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value)}>
        <div className="meter-fill" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
      <div className="meter-sub">{sub}</div>
    </div>
  );
}

export function RiskStep({ answers, defaults, scoredKey, onScored, onBack, onNext }: RiskStepProps) {
  const [state, dispatch] = useStore();
  const key = answersKey(answers);
  const needsScore = state.score === null || scoredKey !== key;

  const [res, retry] = useRequest<IntakeScore>(
    () => (needsScore ? unwrap<IntakeScore>(api.POST('/api/intake/score', { body: { answers } })) : Promise.resolve(state.score as IntakeScore)),
    [key],
  );

  useEffect(() => {
    if (res.status === 'ok' && needsScore) {
      dispatch({ type: 'setScore', score: res.data });
      dispatch({ type: 'setProfile', patch: profilePatchFromScore(res.data) });
      onScored(key);
    }
    // Run once per successful response.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [res]);

  // Announce a summary only once the slider has rested, not on every tick.
  const liveLevel = state.profile.risk_level;
  const [settled, setSettled] = useState(liveLevel);
  useEffect(() => {
    const t = setTimeout(() => setSettled(liveLevel), 500);
    return () => clearTimeout(t);
  }, [liveLevel]);

  if (res.status === 'loading') return <Loading label="Working out your risk profile" />;
  if (res.status === 'error') {
    return (
      <>
        <ErrorBox message={res.message} onRetry={retry} />
        <div className="wiz-actions">
          <Button type="button" onClick={onBack}>
            Back
          </Button>
          <span />
        </div>
      </>
    );
  }

  const score = res.data;
  const level = state.profile.risk_level;
  const vol = targetVol(level, defaults.vol_range);
  const notice = riskNotice(level, score.suggested_risk_level);
  const suggested = Math.round(score.suggested_risk_level);

  return (
    <div>
      <p className="wiz-kicker">Step 2 of 3</p>
      <h2>Your risk level</h2>
      <p className="muted">
        We measured two different things. How much loss your finances could absorb (capacity) and how much swing you are comfortable with (tolerance).
        The suggestion follows the lower of the two. The final number is yours to set.
      </p>

      <div className="meters">
        <Meter label="What you can afford (capacity)" value={score.capacity} sub="From your horizon, income, savings and need for the money." />
        <Meter label="What you can stomach (tolerance)" value={score.tolerance} sub="From how you react to losses and your investing experience." />
      </div>

      <div className={`callout ${score.mismatch ? 'is-warn' : ''}`}>
        {score.mismatch && <h3>Your answers point in different directions</h3>}
        <p>{score.explanation}</p>
        <p>{limitingText(score.limiting_factor)}</p>
      </div>

      <div className="field">
        <label className="field-label" htmlFor="risk-level">
          Choose your risk level (0 to 100)
        </label>
        <div className="risk-readout">
          <span className="risk-number">{Math.round(level)}</span>
          <span className="risk-name">{riskLabel(level)}</span>
        </div>
        <input
          id="risk-level"
          type="range"
          min={0}
          max={100}
          step={1}
          value={level}
          aria-valuetext={`${Math.round(level)}, ${riskLabel(level)}`}
          onChange={(e) => dispatch({ type: 'setProfile', patch: { risk_level: Number(e.target.value) } })}
        />
        <div className="risk-scale" aria-hidden="true">
          <span>Capital preservation</span>
          <span>Maximum growth</span>
        </div>
        <div className="field-row">
          <span className="field-hint">
            Suggested for you: <span className="num">{suggested}</span>
          </span>
          {Math.round(level) !== suggested && (
            <Button type="button" onClick={() => dispatch({ type: 'setProfile', patch: { risk_level: suggested } })}>
              Use the suggestion
            </Button>
          )}
        </div>
        {notice === 'above' && (
          <p className="wiz-error" role="status">
            This is well above what your answers support. That is allowed, but expect deeper and longer losses than you told us you are comfortable with.
          </p>
        )}
        {notice === 'below' && (
          <p className="field-hint" role="status">
            This is more cautious than your answers suggest. Lower risk usually means lower long-run growth.
          </p>
        )}
      </div>

      <section aria-labelledby="means-h">
        <p className="sr-only" role="status" aria-live="polite">
          {`Risk level ${Math.round(settled)}, ${riskLabel(settled)}. Target volatility ${pct(targetVol(settled, defaults.vol_range))}, a typical bad year ${pct(badYear(targetVol(settled, defaults.vol_range)), 0)}.`}
        </p>
        <h3 id="means-h">What this means</h3>
        <div className="live-grid">
          <Stat
            label="Target volatility"
            value={<span className="num">{pct(vol)}</span>}
            hint={`Typical yearly ups and downs. The scale runs from ${pct(defaults.vol_range[0], 0)} at level 0 to ${pct(defaults.vol_range[1], 0)} at level 100.`}
          />
          <Stat
            label="A typical bad year"
            value={<span className="num neg">{pct(badYear(vol), 0)}</span>}
            hint="Roughly 1.65 times the volatility: about one year in twenty is worse. A rough guide only."
          />
          <Stat
            label="Chance of a −30% year"
            value={<span className="num">{pct(lossProbability(vol, 0.3))}</span>}
            hint="Rough, ignores expected return. Real markets have fatter tails; the full simulation comes with your portfolio."
          />
        </div>
      </section>

      <div className="field" style={{ marginTop: 'var(--space-5)' }}>
        <label className="field-label" htmlFor="horizon">
          Investment horizon (years)
        </label>
        <NumberInput
          id="horizon"
          className="plain"
          min={1}
          max={60}
          step={1}
          value={state.profile.horizon_years}
          style={{ width: '6rem', minHeight: 40 }}
          isValid={(n) => Number.isInteger(n) && n >= 1 && n <= 60}
          onCommit={(n) => dispatch({ type: 'setProfile', patch: { horizon_years: n } })}
        />
        <p className="field-hint">From your answers. Change it if the money will be needed sooner or later.</p>
      </div>

      <div className="wiz-actions">
        <Button type="button" onClick={onBack}>
          Back
        </Button>
        <Button type="button" variant="primary" onClick={onNext}>
          Continue to preferences
        </Button>
      </div>
    </div>
  );
}

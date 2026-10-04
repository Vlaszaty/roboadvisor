import { useEffect, useState } from 'react';
import { api, type Schemas } from '../api/client';
import { Button, Stat, pct } from '../components/ui';
import { useStore } from '../state/store';
import { ErrorBox, Loading } from './ApiState';
import {
  answersKey, badYear, limitingText, lossProbability, profilePatchFromScore, riskNotice, riskTitle, targetVol,
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
        We checked two things: how much loss your finances could handle, and how much ups and downs you are comfortable with.
        We suggest the lower of the two. The final choice is yours.
      </p>

      <div className="meters">
        <Meter label="What you can afford to lose" value={score.capacity} sub="From your horizon, income, savings and need for the money." />
        <Meter label="What you can stomach" value={score.tolerance} sub="From how you react to losses and your investing experience." />
      </div>

      <div className={`callout ${score.mismatch ? 'is-warn' : ''}`}>
        {score.mismatch && <h3>Your answers point in different directions</h3>}
        <p>{score.explanation}</p>
        <p>{limitingText(score.limiting_factor)}</p>
      </div>

      <div className="field">
        <label className="field-label" htmlFor="risk-level">
          Choose your risk level (0 is calm, 100 is bold)
        </label>
        <div className="risk-readout">
          <span className="risk-number">{Math.round(level)}</span>
          <span className="risk-name">{riskTitle(level)}</span>
        </div>
        <input
          id="risk-level"
          type="range"
          min={0}
          max={100}
          step={1}
          value={level}
          aria-valuetext={`${Math.round(level)}, ${riskTitle(level)}`}
          onChange={(e) => dispatch({ type: 'setProfile', patch: { risk_level: Number(e.target.value) } })}
        />
        <div className="risk-scale" aria-hidden="true">
          <span>Calmer: protect what I have</span>
          <span>Bolder: grow the most</span>
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
            This is well above what your answers support. That is allowed, but expect deeper and longer falls than you told us you are comfortable with.
          </p>
        )}
        {notice === 'below' && (
          <p className="field-hint" role="status">
            This is calmer than your answers suggest. A calmer plan usually grows less over the long run.
          </p>
        )}
      </div>

      <section aria-labelledby="means-h">
        <p className="sr-only" role="status" aria-live="polite">
          {`Risk level ${Math.round(settled)}, ${riskTitle(settled)}. Typical ups and downs ${pct(targetVol(settled, defaults.vol_range))}, a typical bad year ${pct(badYear(targetVol(settled, defaults.vol_range)), 0)}.`}
        </p>
        <h3 id="means-h">What this means</h3>
        <div className="live-grid">
          <Stat
            label="Typical ups and downs"
            value={<span className="num">{pct(vol)}</span>}
            hint={`How much your plan usually swings in a year. The scale runs from ${pct(defaults.vol_range[0], 0)} at level 0 to ${pct(defaults.vol_range[1], 0)} at level 100.`}
          />
          <Stat
            label="A typical bad year"
            value={<span className="num neg">{pct(badYear(vol), 0)}</span>}
            hint="About one year in twenty is worse than this. A rough guide only."
          />
          <Stat
            label="Chance of a −30% year"
            value={<span className="num">{pct(lossProbability(vol, 0.3))}</span>}
            hint="A rough guess. Real markets have more extreme years, so the full simulation comes with your plan."
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

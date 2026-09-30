import { useEffect, useState } from 'react';
import { Button } from '../components/ui';
import { riskLabel, riskNotice } from '../intake/logic';
import { useStore } from '../state/store';
import '../intake/intake.css';

/** Risk slider on the results page. Commits to the store once the slider rests, which re-requests the portfolio. */
export function RiskAdjuster() {
  const [{ profile, score }, dispatch] = useStore();
  const [level, setLevel] = useState(profile.risk_level);

  useEffect(() => {
    if (level === profile.risk_level) return;
    const t = setTimeout(() => dispatch({ type: 'setProfile', patch: { risk_level: level } }), 400);
    return () => clearTimeout(t);
  }, [level, profile.risk_level, dispatch]);

  const suggested = score ? Math.round(score.suggested_risk_level) : null;
  const notice = suggested === null ? null : riskNotice(level, suggested);

  return (
    <div className="field">
      <label className="field-label" htmlFor="adjust-risk">
        Adjust your risk level
      </label>
      <div className="field-row">
        <span className="num">{Math.round(level)}</span>
        <span className="muted">{riskLabel(level)}</span>
      </div>
      <input
        id="adjust-risk"
        type="range"
        min={0}
        max={100}
        step={1}
        value={level}
        aria-valuetext={`${Math.round(level)}, ${riskLabel(level)}`}
        onChange={(e) => setLevel(Number(e.target.value))}
      />
      <div className="risk-scale" aria-hidden="true">
        <span>Capital preservation</span>
        <span>Maximum growth</span>
      </div>
      {suggested !== null && (
        <div className="field-row">
          <span className="field-hint">
            Suggested for you: <span className="num">{suggested}</span>
          </span>
          {Math.round(level) !== suggested && (
            <Button type="button" onClick={() => setLevel(suggested)}>
              Use the suggestion
            </Button>
          )}
        </div>
      )}
      {notice === 'above' && (
        <p className="wiz-error" role="status">
          This is well above what your answers support. Expect deeper and longer losses than you told us you are comfortable with.
        </p>
      )}
      {notice === 'below' && (
        <p className="field-hint" role="status">
          This is more cautious than your answers suggest. Lower risk usually means lower long-run growth.
        </p>
      )}
    </div>
  );
}

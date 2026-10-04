import { useEffect, useState } from 'react';
import { Button } from '../components/ui';
import { ExplainButton } from '../explain/Explain';
import { Term } from '../glossary/Term';
import { riskKey, riskLabel, riskNotice, riskTitle } from '../intake/logic';
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
    <section className="adjuster card" aria-labelledby="adjust-h">
      <h2 id="adjust-h" className="adjuster-title">Want it calmer or bolder?</h2>
      <p><ExplainButton id="plan.adjuster" /></p>
      <p className="muted">
        Slide to change how much your plan can go up and down. The whole page updates. This changes the{' '}
        <Term id="risk-level">risk level</Term>: {Math.round(level)} out of 100.
      </p>
      <div className="adjuster-now">
        <span className="key-badge">Key {riskKey(level)}</span>
        <span className="adjuster-caption">{riskLabel(level)}</span>
      </div>
      <input
        id="adjust-risk"
        type="range"
        min={0}
        max={100}
        step={1}
        value={level}
        aria-label="Risk level, calmer on the left, bolder on the right"
        aria-valuetext={`${Math.round(level)}, ${riskTitle(level)}`}
        onChange={(e) => setLevel(Number(e.target.value))}
      />
      <div className="risk-scale" aria-hidden="true">
        <span>Calmer: protect what I have</span>
        <span>Bolder: grow the most</span>
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
          This is well above what your answers support. Expect deeper and longer falls than you told us you are comfortable with.
        </p>
      )}
      {notice === 'below' && (
        <p className="field-hint" role="status">
          This is calmer than your answers suggest. A calmer plan usually grows less over the long run.
        </p>
      )}
    </section>
  );
}

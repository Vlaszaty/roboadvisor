import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type Schemas } from '../api/client';
import { useStore } from '../state/store';
import { ErrorBox, Loading } from './ApiState';
import { answersFor, back, next, stageNumber, START, type AnswerValue, type Nav } from './logic';
import { unwrap } from './request';
import { useRequest } from './useRequest';
import { PreferencesStep } from './PreferencesStep';
import { QuestionStep } from './QuestionStep';
import { RiskStep } from './RiskStep';
import './intake.css';

const STEP_NAMES = ['Your situation', 'Your risk level', 'Your preferences'];

/** The v1 intake channel (spec §8.1): fills the shared store; result pages only read it. */
export function FormWizard() {
  const [state, dispatch] = useStore();
  const navigate = useNavigate();
  const [nav, setNav] = useState<Nav>(START);
  const [scoredKey, setScoredKey] = useState<string | null>(null);

  const [qn, retryQn] = useRequest(() => unwrap<Schemas['Questionnaire']>(api.GET('/api/intake/questionnaire')), []);
  const [defaults, retryDefaults] = useRequest(() => unwrap<Schemas['Defaults']>(api.GET('/api/defaults')), []);

  // Move focus to the new step when the position changes (not on first render).
  const panel = useRef<HTMLDivElement>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    panel.current?.focus();
    window.scrollTo({ top: 0 });
  }, [nav.stage, nav.index]);

  if (qn.status === 'loading' || defaults.status === 'loading') return <Loading label="Loading the questionnaire" />;
  if (qn.status === 'error' || defaults.status === 'error') {
    const message = qn.status === 'error' ? qn.message : defaults.status === 'error' ? defaults.message : '';
    return (
      <ErrorBox
        message={message}
        onRetry={() => {
          retryQn();
          retryDefaults();
        }}
      />
    );
  }

  const questions = qn.data.questions;
  const stage = stageNumber(nav.stage);
  const question = nav.stage === 'questions' ? questions[nav.index] : undefined;
  const fraction = nav.stage === 'questions' ? nav.index / questions.length : 1;

  return (
    <div className="wiz">
      <ol className="wiz-steps" aria-label="Progress">
        {STEP_NAMES.map((name, i) => (
          <li key={name} aria-current={stage === i + 1 ? 'step' : undefined} className={stage > i + 1 ? 'is-done' : ''}>
            {i + 1}. {name}
          </li>
        ))}
      </ol>
      {nav.stage === 'questions' && (
        <div
          className="wiz-progress"
          role="progressbar"
          aria-label="Questions answered"
          aria-valuemin={0}
          aria-valuemax={questions.length}
          aria-valuenow={nav.index}
        >
          <div style={{ width: `${Math.round(fraction * 100)}%` }} />
        </div>
      )}

      <div className="wiz-panel" tabIndex={-1} ref={panel}>
        {question && (
          <QuestionStep
            key={question.id}
            question={question}
            index={nav.index}
            total={questions.length}
            value={state.answers[question.id]}
            onChange={(value: AnswerValue) => dispatch({ type: 'setAnswer', id: question.id, value })}
            onNext={() => setNav(next(nav, questions, state.answers))}
            onBack={nav.index > 0 ? () => setNav(back(nav, questions.length)) : null}
          />
        )}
        {nav.stage === 'risk' && (
          <RiskStep
            answers={answersFor(questions, state.answers)}
            defaults={defaults.data}
            scoredKey={scoredKey}
            onScored={setScoredKey}
            onBack={() => setNav(back(nav, questions.length))}
            onNext={() => setNav(next(nav, questions, state.answers))}
          />
        )}
        {nav.stage === 'preferences' && (
          <PreferencesStep
            defaults={defaults.data}
            onBack={() => setNav(back(nav, questions.length))}
            onFinish={() => navigate('/portfolio')}
          />
        )}
      </div>
    </div>
  );
}

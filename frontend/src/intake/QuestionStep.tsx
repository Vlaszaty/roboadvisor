import { useState, type FormEvent } from 'react';
import { Button } from '../components/ui';
import { validateAnswer, type AnswerValue, type Question } from './logic';

interface Props {
  question: Question;
  index: number;
  total: number;
  value: AnswerValue | undefined;
  onChange(v: AnswerValue): void;
  onNext(): void;
  onBack: (() => void) | null;
}

function NumberField({ question, value, onChange }: { question: Question; value: AnswerValue | undefined; onChange(v: AnswerValue): void }) {
  const [text, setText] = useState(value === undefined ? '' : String(value));
  const hasRange = question.min != null && question.max != null;
  const set = (t: string) => {
    setText(t);
    onChange(t.trim() === '' ? '' : Number(t));
  };
  const sliderValue = Math.min(question.max ?? 0, Math.max(question.min ?? 0, Number(text) || (question.min ?? 0)));
  return (
    <div className="number-q">
      <div className="number-input">
        <input
          id={`in-${question.id}`}
          type="number"
          inputMode="decimal"
          min={question.min ?? undefined}
          max={question.max ?? undefined}
          step="any"
          value={text}
          aria-labelledby={`q-${question.id}`}
          onChange={(e) => set(e.target.value)}
        />
        {question.unit && <span className="unit">{question.unit}</span>}
      </div>
      {hasRange && (
        <>
          {/* Pointer and touch shortcut for the number field; keyboard users use the field above. */}
          <input
            type="range"
            min={question.min ?? 0}
            max={question.max ?? 0}
            step={1}
            value={sliderValue}
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => set(e.target.value)}
          />
          <p className="field-hint">
            Between {question.min} and {question.max}
            {question.unit ? ` ${question.unit}` : ''}. Type a number or drag the slider.
          </p>
        </>
      )}
    </div>
  );
}

export function QuestionStep({ question, index, total, value, onChange, onNext, onBack }: Props) {
  const [showError, setShowError] = useState(false);
  const error = validateAnswer(question, value);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (error) {
      setShowError(true);
      return;
    }
    onNext();
  };

  return (
    <form onSubmit={submit} noValidate>
      <p className="wiz-kicker">
        Question {index + 1} of {total}
      </p>
      <h2 id={`q-${question.id}`}>{question.text}</h2>
      {question.help && <p className="muted">{question.help}</p>}

      {question.type === 'single' ? (
        <div role="radiogroup" aria-labelledby={`q-${question.id}`} className="choices">
          {(question.options ?? []).map((o) => (
            <label key={o.value} className={`choice ${value === o.value ? 'is-selected' : ''}`}>
              <input type="radio" name={question.id} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} />
              <span>{o.label}</span>
            </label>
          ))}
        </div>
      ) : (
        <NumberField question={question} value={value} onChange={onChange} />
      )}

      {showError && error && (
        <p role="alert" className="wiz-error">
          {error}
        </p>
      )}

      <div className="wiz-actions">
        {onBack ? (
          <Button type="button" onClick={onBack}>
            Back
          </Button>
        ) : (
          <span />
        )}
        <Button type="submit" variant="primary">
          {index + 1 === total ? 'See my risk level' : 'Next'}
        </Button>
      </div>
    </form>
  );
}

import { useEffect, useState } from 'react';

interface Props {
  id: string;
  value: number;
  /** Called with a parsed number whenever the text is a valid value; return false to reject it. */
  onCommit(n: number): void;
  isValid(n: number): boolean;
  min?: number;
  max?: number;
  step?: number | 'any';
  className?: string;
  style?: React.CSSProperties;
}

/** Numeric input that keeps its own text so clearing or part-typing does not snap back; resyncs on blur. */
export function NumberInput({ id, value, onCommit, isValid, min, max, step, className, style }: Props) {
  const [text, setText] = useState(String(value));
  useEffect(() => {
    // Follow outside changes, but never overwrite a value that still parses to the same number.
    setText((t) => (t.trim() !== '' && Number(t) === value ? t : String(value)));
  }, [value]);
  return (
    <input
      id={id}
      className={className}
      style={style}
      type="number"
      min={min}
      max={max}
      step={step}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const n = Number(e.target.value);
        if (e.target.value.trim() !== '' && Number.isFinite(n) && isValid(n)) onCommit(n);
      }}
      onBlur={() => setText(String(value))}
    />
  );
}

import type { ReactNode } from 'react';
import { useCafeLanguage } from './language';

export interface SliderOption { name: string; key: ReactNode; keyText: string; detail?: ReactNode; }

/** One choice out of a few presets, as a slider like the time step: a big drawing and label that follow the
 * thumb. Nothing is chosen until the person moves or taps the slider (the thumb starts hidden in the middle). */
export function PresetSlider({ id, label, options, value, onChange, vessel }: {
  id: string; label: string; options: SliderOption[]; value: number | null; onChange: (i: number) => void; vessel: (i: number) => ReactNode;
}) {
  const { t } = useCafeLanguage();
  const last = options.length - 1, shown = value ?? Math.floor(last / 2), opt = options[shown];
  const commit = (raw: string) => onChange(Number(raw));
  const fill = `${shown / last * 100}%`;
  return <div className={`cafe-brew-choice cafe-preset ${value === null ? 'unset' : ''}`}>
    <div className="cafe-preset-art">{vessel(shown)}</div>
    <div className="cafe-brew-controls">
      <p className="cafe-brew-now" aria-hidden="true">{value === null
        ? <><strong>{t('Schuif om te kiezen', 'Slide to choose')}</strong><span>{t(`${options.length} standen`, `${options.length} settings`)}</span></>
        : <><strong>{opt.name}</strong><span>{opt.key}</span></>}</p>
      <label htmlFor={id} className="cafe-sr">{label}</label>
      <input id={id} type="range" min="0" max={last} step="1" value={shown}
        aria-valuetext={value === null ? t('Nog niet gekozen', 'Not chosen yet') : `${opt.name}. ${opt.keyText}`}
        onChange={e => commit(e.target.value)}
        onPointerUp={e => commit(e.currentTarget.value)}
        onKeyUp={e => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown', ' '].includes(e.key)) commit(e.currentTarget.value); }}
        style={{ '--fill': value === null ? '0%' : fill } as React.CSSProperties} />
      <div className="cafe-brew-scale cafe-preset-scale" aria-hidden="true">{options.map((o, i) =>
        <button key={i} type="button" tabIndex={-1} className={i === value ? 'on' : ''} style={{ left: `${i / last * 100}%` }} onClick={() => onChange(i)}>{o.name}</button>)}</div>
      {value !== null && opt.detail && <p className="cafe-preset-detail">{opt.detail}</p>}
    </div>
  </div>;
}

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useCafeLanguage } from './language';
import { nudges, PROFILES, type Order, type Scores } from './recipe';

export interface BoardRow { label: string; value: string | null; meaning: string | null; }

/** The permanent menu board: the order so far, what each answer means, the recipe strength and the actions.
 * A sidebar on wide screens; on phones a folded bar at the top that opens as a sheet. */
export function MenuBoard({ rows, step, reachable, onStep, order, scores, served, children }: {
  rows: BoardRow[]; step: number; reachable: (i: number) => boolean; onStep: (i: number) => void;
  order: Order; scores: Scores | null; served: boolean; children: ReactNode;
}) {
  const { t, profiles } = useCafeLanguage();
  const [open, setOpen] = useState(false);
  const sheetId = useId();
  const toggle = useRef<HTMLButtonElement>(null);
  const done = rows.filter(r => r.value !== null).length;
  const profile = scores ? profiles[scores.profile.id - 1] : null;
  useEffect(() => {
    if (!open) return;
    const close = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); toggle.current?.focus(); } };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [open]);
  const go = (i: number) => { onStep(i); setOpen(false); };
  const flags = nudges(order);

  return <aside className={`cafe-board ${open ? 'open' : ''}`} aria-label={t('Menukaart: je bestelling', 'Menu board: your order')}>
    <div className="cafe-board-bar">
      <div className="cafe-board-chips">
        <p>{served ? t('Je bestelling · klaar', 'Your order · ready') : t(`Je bestelling · ${done} van ${rows.length}`, `Your order · ${done} of ${rows.length}`)}</p>
        <ul>{rows.map((r, i) => <li key={i} className={i === step && !served ? 'current' : r.value ? 'done' : ''}>{r.value ?? '?'}</li>)}</ul>
      </div>
      <button ref={toggle} type="button" className="cafe-board-toggle" aria-expanded={open} aria-controls={sheetId} onClick={() => setOpen(o => !o)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d={open ? 'M6 6l12 12M18 6 6 18' : 'M4 7h16M4 12h16M4 17h10'} /></svg>
        {open ? t('Sluiten', 'Close') : t('Menu', 'Menu')}
      </button>
    </div>

    <div className="cafe-board-sheet" id={sheetId}>
      <p className="cafe-board-eyebrow">{t('Menukaart', 'Menu board')}</p>
      <h2>{t('Je bestelling', 'Your order')}</h2>
      <ol className="cafe-board-rows">{rows.map((r, i) => {
        const current = i === step && !served;
        return <li key={i}><button type="button" aria-current={current ? 'step' : undefined} disabled={!reachable(i)} onClick={() => go(i)} className={current ? 'current' : r.value ? 'done' : ''}>
          <span className="cafe-board-dot" aria-hidden="true">{r.value && !current ? '✓' : i + 1}</span>
          <span className="cafe-board-text"><span className="cafe-board-label">{r.label}</span><span className="cafe-board-value">{r.value ?? t('Nog te kiezen', 'Not chosen yet')}</span>{r.meaning && <span className="cafe-board-meaning">{r.meaning}</span>}</span>
          <span className="cafe-board-tag">{current ? t('Nu', 'Now') : r.value ? t('Wijzig', 'Edit') : ''}</span>
        </button></li>;
      })}</ol>

      <section className="cafe-board-strength" aria-label={t('Sterkte van je recept', 'Strength of your recipe')}>
        <div><p>{t('Sterkte', 'Strength')}</p><p className="cafe-board-profile">{profile ? `${profile.id}/7 · ${profile.name}` : t('Na je laatste keuze', 'After your last choice')}</p></div>
        <div className="cafe-board-meter" aria-hidden="true">{PROFILES.map(p => <i key={p.id} className={scores && p.id <= scores.profile.id ? 'on' : ''} />)}</div>
        <div className="cafe-board-scale" aria-hidden="true"><span>{t('Zacht', 'Mild')}</span><span>{t('Sterk', 'Strong')}</span></div>
        {scores && profile && <p className="cafe-board-why">{profile.plain}. {scores.capped
          ? t('Extra zoet: je wilt geen verlies, dus je krijgt het zachtste recept.', 'Extra sweet: you want no loss, so you get the mildest recipe.')
          : scores.limiting === 'capacity'
            ? t(`Bepaald door wat je financieel kunt dragen (${Math.round(scores.capacity)}/100), lager dan wat je comfortabel vindt (${Math.round(scores.tolerance)}/100).`, `Set by what your finances can carry (${Math.round(scores.capacity)}/100), lower than what you are comfortable with (${Math.round(scores.tolerance)}/100).`)
            : scores.limiting === 'tolerance'
              ? t(`Bepaald door wat je comfortabel vindt (${Math.round(scores.tolerance)}/100), lager dan wat je financieel kunt dragen (${Math.round(scores.capacity)}/100).`, `Set by what you are comfortable with (${Math.round(scores.tolerance)}/100), lower than what your finances can carry (${Math.round(scores.capacity)}/100).`)
              : t(`Wat je kunt dragen en wat je comfortabel vindt wijzen naar hetzelfde (${Math.round(scores.score)}/100).`, `What you can carry and what you are comfortable with point the same way (${Math.round(scores.score)}/100).`)}</p>}
        {scores && Math.abs(scores.capacity - scores.tolerance) > 20 && !scores.capped && <p className="cafe-board-why">{t('Er zit een groot verschil tussen die twee. Denk na welke je wilt laten leiden.', 'There is a big gap between the two. Think about which one should guide you.')}</p>}
      </section>

      {flags.length > 0 && <ul className="cafe-board-nudges">{flags.map(f => <li key={f}>{f === 'buffer'
        ? t('Vul eerst je spaarpot. Komt er een grote rekening tijdens een daling, dan moet je misschien met verlies verkopen.', 'Fill your savings jar first. If a big bill comes during a dip, you might have to sell at a loss.')
        : f === 'debt' ? t('Dure schuld aflossen levert vaak meer op dan beleggen.', 'Paying off costly debt often beats investing.')
          : t('Binnen 2 jaar nodig? Dan past sparen meestal beter dan beleggen.', 'Need it within 2 years? Saving usually fits better than investing.')}</li>)}</ul>}

      {children}

      <Link className="cafe-board-link" to="/cafe/menu">{t('Bekijk de hele menukaart: alle 7 sterktes en hoe ze het deden', 'See the whole menu: all 7 strengths and how they did')}</Link>
      <p className="cafe-board-small">{t('Educatief voorbeeld, geen persoonlijk beleggingsadvies. Je kunt geld verliezen. Melk en suiker beschermen niet.', 'Educational example, not personal investment advice. You can lose money. Milk and sugar do not protect you.')}</p>
    </div>
  </aside>;
}

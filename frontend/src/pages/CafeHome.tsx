import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCafeLanguage } from '../cafe/language';
import { clearHistory, loadHistory, removeFromHistory, type PastRecipe } from '../cafe/history';
import { CAFE_STORAGE_KEY, complete, parseOrder } from '../cafe/recipe';
import '../cafe/cafe.css';
import '../cafe/board.css';

function savedDraft() {
  try { return parseOrder(localStorage.getItem(CAFE_STORAGE_KEY)); } catch { return parseOrder(null); }
}

/** The café entrance: start a new order, continue an unfinished one, or reopen a past recipe. */
export default function CafeHome() {
  const { language, setLanguage, t, eur, pct, years, profiles, drink, locale } = useCafeLanguage();
  const navigate = useNavigate();
  const [history, setHistory] = useState<PastRecipe[]>(loadHistory);
  const draft = savedDraft();
  const started = draft.base !== null && !complete(draft);
  useEffect(() => { document.title = t('Aan de bar · Je beleggingsrecept', 'At the café · Your investment recipe'); }, [t]);
  const when = (iso: string) => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

  return <main className="cafe-page cafe-home" lang={language}>
    <img className="cafe-home-bg" src="/cafe/scene.png" alt="" />
    <nav className="cafe-language" aria-label={t('Taal', 'Language')}>{(['nl', 'en'] as const).map(code => <button key={code} type="button" lang={code} aria-label={code === 'nl' ? 'Nederlands' : 'English'} aria-pressed={language === code} onClick={() => setLanguage(code)}>{code.toUpperCase()}</button>)}</nav>

    <div className="cafe-home-grid">
      <section className="cafe-home-welcome" aria-labelledby="cafe-home-title">
        <p className="cafe-board-eyebrow">{t('Zonnig in Amsterdam', 'Sunny in Amsterdam')}</p>
        <h1 id="cafe-home-title">{t('Welkom aan de bar', 'Welcome to the café')}</h1>
        <p>{t('Zes korte vragen, één beleggingsrecept. Je kiest een basis, je tijd en hoe sterk het mag zijn; wij schenken een van 14 vaste ETF-portefeuilles in.', 'Six short questions, one investment recipe. You pick a base, your time and how strong it may be; we pour one of 14 fixed ETF portfolios.')}</p>
        <div className="cafe-home-actions">
          <button type="button" className="cafe-button" onClick={() => navigate('/cafe/order', { state: { fresh: true } })}>{t('Nieuwe bestelling', 'Start a new order')} <span aria-hidden="true">→</span></button>
          {started && <button type="button" className="cafe-home-secondary" onClick={() => navigate('/cafe/order')}>{t('Ga verder met je bestelling', 'Continue your order')}</button>}
        </div>
        <Link className="cafe-board-link" to="/cafe/textbook">{t('Hoe wordt een recept gemaakt?', 'How is a recipe made?')}</Link>
        <Link className="cafe-board-link" to="/cafe/menu">{t('Bekijk eerst de menukaart: alle 7 sterktes en hoe ze het deden', 'Look at the menu first: all 7 strengths and how they did')}</Link>
        <p className="cafe-home-small">{t('Educatief voorbeeld, geen persoonlijk beleggingsadvies. Je kunt geld verliezen.', 'Educational example, not personal investment advice. You can lose money.')}</p>
      </section>

      <section className="cafe-home-history" aria-labelledby="cafe-history-title">
        <div className="cafe-home-history-head">
          <h2 id="cafe-history-title">{t('Je eerdere bestellingen', 'Your past orders')}</h2>
          {history.length > 0 && <button type="button" className="cafe-home-clear" onClick={() => { clearHistory(); setHistory([]); }}>{t('Alles wissen', 'Clear all')}</button>}
        </div>
        {history.length === 0
          ? <p className="cafe-home-empty">{t('Nog geen bestellingen. Na je eerste bestelling vind je hem hier terug.', 'No orders yet. After your first order you will find it here.')}</p>
          : <ul className="cafe-home-list">{history.map(r => {
            const p = profiles[r.profileId - 1];
            return <li key={r.id} className="cafe-home-receipt">
              <div className="cafe-home-receipt-top">
                <span className={`cafe-home-dot ${r.base}`} aria-hidden="true" />
                <div>
                  <p className="cafe-home-receipt-name">{drink(r.base)} · {p.name} <span>{p.id}/7</span></p>
                  <p className="cafe-home-receipt-meta">{when(r.at)} · {years(r.horizon)} · {p.plain}</p>
                </div>
              </div>
              <dl>
                <div><dt>{t('Inleg', 'Put in')}</dt><dd>{eur(r.paidIn)}</dd></div>
                <div><dt>{t('Middelste geval', 'Middle case')}</dt><dd>{eur(r.middle)}</dd></div>
                <div><dt>{t('Schommeling', 'Swing')}</dt><dd>{pct(r.volatility)}</dd></div>
              </dl>
              <div className="cafe-home-receipt-actions">
                <button type="button" className="cafe-button" onClick={() => navigate('/cafe/order', { state: { replay: r } })}>{t('Bekijk opnieuw', 'View again')}</button>
                <button type="button" className="cafe-home-remove" aria-label={t(`Verwijder ${drink(r.base)} ${p.name} van ${when(r.at)}`, `Remove ${drink(r.base)} ${p.name} from ${when(r.at)}`)} onClick={() => setHistory(removeFromHistory(r.id))}>{t('Verwijder', 'Remove')}</button>
              </div>
            </li>;
          })}</ul>}
        <p className="cafe-home-small">{t('Opgeslagen in deze browser, nergens anders. Bekijk opnieuw rekent met de nieuwste gegevens.', 'Saved in this browser only, nowhere else. View again recalculates with the latest data.')}</p>
      </section>
    </div>
  </main>;
}

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useDebounced, useLastData, useRequest } from '../components/charts/hooks';
import { ErrorBox, Loading } from '../components/charts/Status';
import { textbookRequest, type ReturnModel } from '../components/textbook/textbook';
import { ExplainProvider } from '../explain/Explain';
import { useCafeLanguage } from '../cafe/language';
import { methodPath } from '../cafe/method';
import { PROFILES } from '../cafe/recipe';
import { Steps } from './Textbook';
import '../components/charts/results.css';
import '../components/textbook/textbook.css';
import '../cafe/cafe.css';
import '../cafe/board.css';

/** Engine risk level (0-100) for a café strength: its target volatility on the 2-20% scale. */
const riskLevel = (id: number) => Math.round((PROFILES[id - 1].target_volatility - .02) / .18 * 100);

/** "How a recipe is made": the course's seven textbook steps, in the café's look. */
export default function CafeTextbook() {
  const { language, setLanguage, t, profiles } = useCafeLanguage();
  const [strength, setStrength] = useState(4);
  const [model, setModel] = useState<ReturnModel>('capm');
  const [premium, setPremium] = useState('5');
  useEffect(() => { document.title = t('Zo werkt het recept · Aan de bar', 'How a recipe is made · At the café'); }, [t]);
  const body = textbookRequest('EUR', riskLevel(strength), model, Number(premium));
  const key = useDebounced(JSON.stringify(body), 250);
  const { state, reload } = useRequest((signal) => api.POST('/api/textbook', { body: JSON.parse(key) as typeof body, signal }), key);
  const last = useLastData(state, key);
  const p = profiles[strength - 1];

  return <ExplainProvider face="/cafe/barista-face.jpg" closeLabel={t('Duidelijk', 'Got it')}><main className="cafe-page menu-cafe cafe-textbook" lang={language}>
    <img className="cafe-home-bg" src="/cafe/scene.png" alt="" />
    <Link className="cafe-entrance-top" to="/cafe"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11 12 4l8 7M6 10v10h12V10" /></svg>{t('Ingang', 'Entrance')}</Link>
    <nav className="cafe-language" aria-label={t('Taal', 'Language')}>{(['nl', 'en'] as const).map(code => <button key={code} type="button" lang={code} aria-label={code === 'nl' ? 'Nederlands' : 'English'} aria-pressed={language === code} onClick={() => setLanguage(code)}>{code.toUpperCase()}</button>)}</nav>

    <div className="tbc-wrap">
      <section className="menu-board-big tbc-board" aria-labelledby="tbc-title">
        <p className="cafe-board-eyebrow">{t('Achter de bar', 'Behind the bar')}</p>
        <h1 id="tbc-title">{t('Zo wordt een recept gemaakt', 'How a recipe is made')}</h1>
        <p className="menu-board-intro">{t('De methode uit de cursus in zeven korte stappen, met echte cijfers. Deze les gebruikt zeven vaste fondsen. De recepten aan de bar gebruiken een strengere variant van dezelfde methode, met veel meer fondsen.', 'The course method in seven short steps, with real numbers. This lesson uses seven fixed funds. The recipes at the bar use a stricter variant of the same method, with many more funds.')} <Link to={methodPath('coffee', strength)}>{t('Zie hoe een recept aan de bar is gemaakt.', 'See how a recipe at the bar is made.')}</Link></p>
        {language === 'nl' && <p className="menu-board-note">De stappen hieronder zijn in het Engels.</p>}

        <div className="tbc-controls">
          <fieldset>
            <legend>{t('Sterkte', 'Strength')}: <strong>{p.id}/7 · {p.name}</strong> <span>{p.plain}</span></legend>
            <div className="tbc-strengths">{profiles.map(x => <button key={x.id} type="button" aria-pressed={strength === x.id} aria-label={`${x.id}. ${x.name}`} onClick={() => setStrength(x.id)}>{x.id}</button>)}</div>
          </fieldset>
          <fieldset>
            <legend>{t('Hoe schatten we wat fondsen opleveren?', 'How do we guess what funds will earn?')}</legend>
            <div className="menu-board-tabs">
              <button type="button" aria-pressed={model === 'capm'} onClick={() => setModel('capm')}>{t('Marktregel (CAPM)', 'Market rule (CAPM)')}</button>
              <button type="button" aria-pressed={model === 'historical'} onClick={() => setModel('historical')}>{t('Gemiddelde uit het verleden', 'Past averages')}</button>
            </div>
          </fieldset>
          {model === 'capm' && <fieldset>
            <legend>{t('Extra groei van aandelen boven sparen, per jaar', 'Extra growth shares earn over cash, a year')}</legend>
            <div className="menu-board-tabs">{['3', '5', '7'].map(x => <button key={x} type="button" aria-pressed={premium === x} onClick={() => setPremium(x)}>{x}%</button>)}</div>
          </fieldset>}
        </div>
        <div className="tbc-links">
          <Link className="menu-board-order" to="/cafe/order" state={{ fresh: true }}>{t('Bestel aan de bar', 'Order at the bar')} <span aria-hidden="true">→</span></Link>
          <Link className="cafe-board-link" to="/cafe/menu">{t('Naar de menukaart', 'To the menu')}</Link>
        </div>
      </section>

      <div className="tbc-steps">
        {state.status === 'error' && <ErrorBox message={state.message} onRetry={reload} />}
        {last
          ? <div className={state.status !== 'ok' ? 'textbook-stale' : undefined}><Steps t={last.data} /></div>
          : state.status === 'loading' && <Loading />}
      </div>
    </div>
  </main></ExplainProvider>;
}

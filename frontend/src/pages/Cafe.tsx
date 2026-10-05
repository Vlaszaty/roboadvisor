import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { errorMessage } from '../components/charts/format';
import { amountValue, CAFE_STORAGE_KEY, complete, needsConsent, parseOrder, portfolioRequest, recipeExplanation, riskLevel, type Order } from '../cafe/recipe';
import { Scene, Vessel } from '../cafe/Scene';
import { Results, type CafeResult } from '../cafe/Results';
import { servedSentence } from '../cafe/serving';
import { useCafeLanguage } from '../cafe/language';
import '../cafe/cafe.css';

const IS_FIXED_MOCK = import.meta.env.VITE_USE_MOCKS === '1';
const IS_PREVIEW = import.meta.env.VITE_CAFE_DEMO === '1' || IS_FIXED_MOCK;

function loadOrder(): Order {
  try { return parseOrder(localStorage.getItem(CAFE_STORAGE_KEY)); } catch { return parseOrder(null); }
}
function allowedStep(order: Order): number {
  if (!order.base) return 0;
  if (order.milk === null) return 2;
  return 3;
}

export default function Cafe() {
  const { language, setLanguage, t, years, pct, milk: MILK, sugar: SUGAR } = useCafeLanguage();
  const STEPS = [t('De basis', 'The base'), t('Je tijd', 'Your time'), t('De melk', 'The milk'), t('De suiker', 'The sugar')];
  const QUESTIONS = [
    [t('Waar beginnen we mee?', 'Where shall we start?'), t('Koffie of matcha? De basis bepaalt welke fondsen we mogen gebruiken.', 'Coffee or matcha? Your base determines which funds we can use.')],
    [t('Hoeveel tijd heb je?', 'How much time do you have?'), t('Wanneer verwacht je een groot deel van dit geld nodig te hebben?', 'When do you expect to need a large part of this money?')],
    [t('Hoe zacht mag het zijn?', 'How mellow would you like it?'), t('Hoeveel financiële ruimte denk je te hebben voor schommelingen en verlies?', 'How much financial room do you believe you have for fluctuations and losses?')],
    [t('En hoeveel bitterheid?', 'And how much bitterness?'), t('Welk verlies over één jaar zou voor jou nog acceptabel voelen?', 'What loss over one year would still feel acceptable to you?')],
  ];
  const [order, setOrder] = useState<Order>(loadOrder);
  const [step, setStep] = useState(0);
  const [consent, setConsent] = useState(false);
  const [mockConsent, setMockConsent] = useState(false);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error' | 'ok'>('idle');
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<CafeResult | null>(null);
  const [memoryWarning, setMemoryWarning] = useState(false);
  const requestRef = useRef<AbortController | null>(null);
  const sceneRef = useRef<HTMLDivElement>(null);
  const previousTitle = useRef('');
  const amount = amountValue(order.amount);
  const invalidAmount = order.amount.trim() !== '' && amount === null;
  const risk = riskLevel(order);
  const ready = complete(order) && (!needsConsent(order) || consent) && (!IS_FIXED_MOCK || mockConsent) && !invalidAmount;

  useEffect(() => {
    previousTitle.current = document.title;
    return () => { document.title = previousTitle.current; requestRef.current?.abort(); };
  }, []);
  useEffect(() => { document.title = t('Je beleggingsrecept · Aan de bar', 'Your investment recipe · At the café'); }, [t]);
  useEffect(() => {
    try { localStorage.setItem(CAFE_STORAGE_KEY, JSON.stringify(order)); setMemoryWarning(false); }
    catch { setMemoryWarning(true); }
  }, [order]);
  useEffect(() => {
    if (result) sceneRef.current?.querySelector<HTMLElement>('.cafe-result')?.focus({ preventScroll: true });
  }, [result]);

  function patchOrder(patch: Partial<Order>) {
    requestRef.current?.abort();
    setOrder(o => ({ ...o, ...patch })); setResult(null); setStatus('idle'); setMessage('');
    setConsent(false); setMockConsent(false);
  }
  function editRecipe() {
    setResult(null); setStatus('idle'); setStep(0);
    sceneRef.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  }
  async function serve() {
    if (!ready || status === 'loading') return;
    const snapshot = { ...order }, ctl = new AbortController();
    requestRef.current?.abort(); requestRef.current = ctl;
    setStatus('loading'); setResult(null); setMessage('');
    try {
      const response = await api.POST('/api/portfolio', { body: portfolioRequest(snapshot, consent), signal: ctl.signal });
      if (ctl.signal.aborted) return;
      if (response.error !== undefined || !response.data) throw new Error(errorMessage(response.error));
      const source = IS_FIXED_MOCK ? 'fixed' : response.response.headers.get('X-Cafe-Data') === 'synthetic' ? 'synthetic' : 'live';
      if (IS_PREVIEW && !IS_FIXED_MOCK && source !== 'synthetic') throw new Error('cafe:source');
      if (source !== 'fixed' && response.data.downside.fan.at(-1)?.year !== snapshot.horizon) throw new Error('cafe:horizon');
      setResult({ rec: response.data, source, horizon: source === 'fixed' ? 10 : snapshot.horizon });
      setStatus('ok');
    } catch (error) {
      if (!ctl.signal.aborted) { setMessage(errorMessage(error)); setStatus('error'); }
    }
  }

  const selectedPreset = step === 2 && order.milk !== null ? MILK[order.milk] : step === 3 && order.sugar !== null ? SUGAR[order.sugar] : null;
  const currentValid = step === 0 ? order.base !== null : step === 1 ? Number.isInteger(order.horizon) && order.horizon >= 1 && order.horizon <= 40 : step === 2 ? order.milk !== null : order.sugar !== null;
  const displayedMessage = message === 'cafe:source' ? t('De preview-backend heeft zijn synthetische databron niet bevestigd. Start de café-preview op poort 8741.', 'The preview backend has not confirmed its synthetic data source. Start the café preview on port 8741.')
    : message === 'cafe:horizon' ? t('De berekening heeft een andere looptijd dan je bestelling. Probeer het recept opnieuw.', 'The calculation has a different time horizon from your order. Please try the recipe again.') : message;

  return <main className="cafe-page" lang={language}>
    <a className="cafe-skip" href="#cafe-choices">{t('Naar de keuzes', 'Skip to the choices')}</a>
    <div className={`cafe-scene ${status === 'loading' ? 'preparing' : ''} ${result ? 'served' : ''}`} ref={sceneRef}>
      <div className="cafe-picture">
        <Scene preparing={status === 'loading'} />
        <nav className="cafe-language" aria-label={t('Taal', 'Language')}>{(['nl', 'en'] as const).map(code => <button key={code} type="button" lang={code} aria-label={code === 'nl' ? 'Nederlands' : 'English'} aria-pressed={language === code} onClick={() => setLanguage(code)}>{code.toUpperCase()}</button>)}</nav>
        {!result && <nav className="cafe-steps" aria-label={t('Je bestelling', 'Your order')}>{STEPS.map((name, i) => <button key={i} type="button" className={step === i ? 'current' : ''} aria-current={step === i ? 'step' : undefined} disabled={i > allowedStep(order) || status === 'loading'} onClick={() => setStep(i)}><span>{i + 1}</span><span>{name}</span></button>)}</nav>}
        <div className="cafe-speech" aria-live="polite" aria-atomic="true"><p className="cafe-eyebrow">{result ? t('Vers van de bar', 'Fresh from the bar') : t('Je barista vraagt', 'Your barista asks')}</p><h1>{result ? servedSentence(order, result.source === 'fixed', language) : status === 'loading' ? t('Ik maak je recept.', 'Making your recipe.') : QUESTIONS[step][0]}</h1>{!result && <p>{status === 'loading' ? t('We zoeken een portefeuille bij jouw keuzes. Even roeren…', 'Finding a portfolio for your choices. Just stirring…') : QUESTIONS[step][1]}</p>}<span className="cafe-speech-tail" aria-hidden="true" /></div>
        <span className="cafe-window-label" aria-hidden="true">{t('Zonnig in Amsterdam', 'Sunny in Amsterdam')}</span>
      </div>
      {result ? <Results result={result} order={order} amount={amount} edit={editRecipe} /> : <div className="cafe-counter">
        <section className="cafe-choice-area" id="cafe-choices" aria-label={STEPS[step]}>
          {step === 0 && <fieldset className="cafe-choices base"><legend className="cafe-sr">{t('Kies koffie of matcha', 'Choose coffee or matcha')}</legend>{(['coffee', 'matcha'] as const).map(base => <label className={`cafe-choice ${order.base === base ? 'selected' : ''}`} key={base}>
            <input type="radio" name="cafe-base" value={base} checked={order.base === base} onChange={() => patchOrder({ base })} />
            <Vessel kind="tin" base={base} /><span className="cafe-choice-name">{base === 'coffee' ? t('Koffie', 'Coffee') : 'Matcha'}{order.base === base && <span className="cafe-choice-check" aria-hidden="true">✓</span>}</span><span className="cafe-choice-sub">{base === 'coffee' ? t('Brede fondsselectie', 'Broad fund selection') : t('Alleen ESG-gemarkeerd', 'ESG-labelled only')}</span>
          </label>)}</fieldset>}
          {step === 1 && <div className="cafe-time-choice"><div className="cafe-clock" aria-hidden="true"><span>◷</span><strong>{order.horizon}</strong><small>{t('jaar', order.horizon === 1 ? 'year' : 'years')}</small></div><div><label htmlFor="cafe-horizon">{t('Hoe lang kan dit geld blijven staan?', 'How long can this money stay invested?')}</label><div className="cafe-time-controls"><button type="button" aria-label={t('Eén jaar minder', 'One year less')} disabled={order.horizon <= 1} onClick={() => patchOrder({ horizon: order.horizon - 1 })}>−</button><input id="cafe-horizon" type="number" min="1" max="40" step="1" value={order.horizon} onChange={e => patchOrder({ horizon: Number(e.target.value) })} /><button type="button" aria-label={t('Eén jaar meer', 'One year more')} disabled={order.horizon >= 40} onClick={() => patchOrder({ horizon: order.horizon + 1 })}>+</button></div><span className="cafe-small">{t('1–40 jaar · langer wachten garandeert geen herstel', '1–40 years · waiting longer does not guarantee recovery')}</span></div></div>}
          {(step === 2 || step === 3) && <fieldset className="cafe-choices"><legend className="cafe-sr">{step === 2 ? t('Kies één van vijf melkpresets', 'Choose one of five milk presets') : t('Kies één van vijf suikerpresets', 'Choose one of five sugar presets')}</legend>{(step === 2 ? MILK : SUGAR).map((preset, i) => <label className={`cafe-choice ${(step === 2 ? order.milk : order.sugar) === i ? 'selected' : ''}`} key={i}>
            <input type="radio" name={`cafe-${step === 2 ? 'milk' : 'sugar'}`} value={i} checked={(step === 2 ? order.milk : order.sugar) === i} onChange={() => patchOrder(step === 2 ? { milk: i } : { sugar: i })} aria-label={`${preset.name}. ${preset.description}`} />
            <Vessel kind={step === 2 ? 'milk' : 'sugar'} amount={i} /><span className="cafe-choice-name">{preset.name}{(step === 2 ? order.milk : order.sugar) === i && <span className="cafe-choice-check" aria-hidden="true">✓</span>}</span>
          </label>)}</fieldset>}
          <p className="cafe-choice-caption" aria-live="polite">{selectedPreset ? selectedPreset.description : step === 0 ? order.base === 'matcha' ? t('Een ESG-markering is geen duurzaamheidsgarantie.', 'An ESG label is not a sustainability guarantee.') : order.base === 'coffee' ? t('Zonder ESG-filter; ook ESG-fondsen kunnen in de selectie zitten.', 'No ESG filter; ESG funds may also be included.') : t('Pak het blik dat bij je voorkeur past.', 'Pick the tin that suits your preference.') : step === 1 ? t('Je horizon bepaalt hoe ver we vooruitkijken.', 'Your time horizon determines how far we look ahead.') : t('Kies één van de vijf standen. Er is geen goed of fout antwoord.', 'Choose one of five settings. There is no right or wrong answer.')}</p>
        </section>
        <aside className="cafe-order-receipt" aria-label={t('Je bestelbon', 'Your order receipt')}><p className="cafe-receipt-title">{t('JE BESTELBON', 'YOUR ORDER')}</p><dl>
          <div><dt>{t('Basis', 'Base')}</dt><dd>{order.base === 'matcha' ? 'Matcha' : order.base === 'coffee' ? t('Koffie', 'Coffee') : t('Nog te kiezen', 'Not chosen yet')}</dd></div>
          <div><dt>{t('Tijd', 'Time')}</dt><dd>{years(order.horizon)}</dd></div>
          <div><dt>{t('Melk', 'Milk')}</dt><dd>{order.milk === null ? t('Nog te kiezen', 'Not chosen yet') : MILK[order.milk].name}</dd></div>
          <div><dt>{t('Suiker', 'Sugar')}</dt><dd>{order.sugar === null ? t('Nog te kiezen', 'Not chosen yet') : SUGAR[order.sugar].name}</dd></div>
        </dl>
        {step === 3 && <>
          <p className="cafe-taste-note">{recipeExplanation(order, language)}</p>
          {order.horizon <= 2 && (risk ?? 0) >= 50 && <p className="cafe-warning">{t('Een korte looptijd en een stevig recept kunnen grote verliezen betekenen wanneer je het geld nodig hebt.', 'A short time horizon and a strong recipe can mean large losses when you need the money.')}</p>}
          {needsConsent(order) && <div className="cafe-consent" role="note"><strong>{t('Ook extra zoet kan verlies geven.', 'Even extra sweet can lose money.')}</strong><p>{t('Geen spaarproduct of garantie. Als je geen verlies kunt accepteren, past dit voorbeeld niet bij die wens.', 'Not a savings product or a guarantee. If you cannot accept losses, this example does not match that wish.')}</p><label><input type="checkbox" checked={consent} onChange={e => { setConsent(e.target.checked); if (!e.target.checked) { requestRef.current?.abort(); setResult(null); setStatus('idle'); } }} /> {t('Ik wil alleen een voorbeeld met mogelijk verlies verkennen.', 'I only want to explore an example with possible losses.')}</label></div>}
          {IS_FIXED_MOCK && <div className="cafe-consent"><strong>{t('Alleen een vast demoresultaat.', 'A fixed demo result only.')}</strong><p>{t('Je keuzes worden niet doorgerekend.', 'Your choices are not used in the calculation.')}</p><label><input type="checkbox" checked={mockConsent} onChange={e => setMockConsent(e.target.checked)} /> {t('Toon het vaste voorbeeld: niveau 50, 10 jaar, brede selectie.', 'Show the fixed example: level 50, 10 years, broad selection.')}</label></div>}
          <details className="cafe-order-extra"><summary>{t('Bedrag & uitleg', 'Amount & explanation')} <span>{t('optioneel', 'optional')}</span></summary>
            <div className="cafe-amount"><label htmlFor="cafe-amount">{t('Startbedrag voor het plaatje', 'Starting amount for the illustration')}</label><div><span aria-hidden="true">€</span><input id="cafe-amount" type="text" inputMode="decimal" placeholder={t('Zonder bedrag', 'No amount')} value={order.amount} aria-invalid={invalidAmount} aria-describedby="cafe-amount-help" onChange={e => { requestRef.current?.abort(); setOrder(o => ({ ...o, amount: e.target.value })); if (status === 'loading') setStatus('idle'); }} /></div><p id="cafe-amount-help" className={invalidAmount ? 'cafe-amount-error' : 'cafe-small'}>{invalidAmount ? t('Vul een positief bedrag tot €1 miljard in, of laat het leeg.', 'Enter a positive amount up to €1 billion, or leave it blank.') : t('Alleen voor de weergave. Geen aanbevolen inleg of maandelijkse bijdrage.', 'For display only. Not a recommended investment amount or a monthly contribution.')}</p></div>
            {risk !== null && <p className="cafe-small">{t('Receptniveau', 'Recipe level')} {risk}/100 · {t('doel voor jaarlijkse schommelingen', 'target annual fluctuations')} {pct(.02 + risk / 100 * .18)}. {t('Geen maximaal verlies.', 'Not a maximum loss.')}</p>}
          </details>
        </>}
        <div className="cafe-order-actions">{step < 3 ? <button type="button" className="cafe-button" disabled={!currentValid} onClick={() => setStep(s => s + 1)}>{t('Volgende keuze', 'Next choice')} <span aria-hidden="true">→</span></button> : <button type="button" className="cafe-button" disabled={!ready || status === 'loading'} onClick={serve}>{status === 'loading' ? t('Even roeren…', 'Just stirring…') : t('Maak mijn voorbeeld', 'Make my example')}</button>}
          {step > 0 && <button type="button" className="cafe-back" onClick={() => setStep(s => s - 1)}>← {t('Vorige keuze', 'Previous choice')}</button>}
        </div>
        </aside>
      </div>}
    {status === 'loading' && <p className="cafe-request-status" role="status">{t('De portefeuille wordt berekend. Je recept is nog niet klaar.', 'The portfolio is being calculated. Your recipe is not ready yet.')}</p>}
    {status === 'error' && <section className="cafe-warning cafe-api-error" role="alert"><h2>{t('Dit recept kon nog niet worden gemaakt.', 'We could not make this recipe yet.')}</h2><p>{displayedMessage}</p><p>{t('Je keuzes zijn bewaard. Controleer de backend of pas je recept aan.', 'Your choices have been kept. Check the backend or adjust your recipe.')}</p><button type="button" className="cafe-button" disabled={!ready} onClick={serve}>{t('Opnieuw proberen', 'Try again')}</button></section>}
    {memoryWarning && <p className="cafe-small" role="status">{t('Je browser kan de keuzes niet bewaren. Ze blijven beschikbaar zolang deze pagina openstaat.', 'Your browser cannot save your choices. They remain available while this page is open.')}</p>}
    <footer className="cafe-footer"><span>{t('Educatief voorbeeld · geen persoonlijk beleggingsadvies.', 'Educational example · not personal investment advice.')}</span><span>{t('Je kunt geld verliezen. Melk en suiker beschermen niet.', 'You can lose money. Milk and sugar do not protect you.')}</span></footer>
    </div>
  </main>;
}

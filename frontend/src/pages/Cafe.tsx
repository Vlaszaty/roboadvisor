import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { errorMessage } from '../components/charts/format';
import { amountValue, brewStage, CAFE_STORAGE_KEY, complete, HORIZON_STOPS, nearestStop, MONTHLY_MAX, EMPTY_ORDER, orderRequest, parseOrder, scores as scoreOrder, SUGAR_LOSS, type Order } from '../cafe/recipe';
import { Scene, Vessel } from '../cafe/Scene';
import { moneyPoints, Results, type CafeResult } from '../cafe/Results';
import { addToHistory, type PastRecipe } from '../cafe/history';
import { MenuBoard, type BoardRow } from '../cafe/MenuBoard';
import { PresetSlider } from '../cafe/PresetSlider';
import { servedSentence } from '../cafe/serving';
import { useCafeLanguage } from '../cafe/language';
import '../cafe/cafe.css';
import '../cafe/board.css';

const IS_FIXED_MOCK = import.meta.env.VITE_USE_MOCKS === '1';
const IS_PREVIEW = import.meta.env.VITE_CAFE_DEMO === '1' || IS_FIXED_MOCK;
const LAST = 5;

function loadOrder(): Order {
  try { return parseOrder(localStorage.getItem(CAFE_STORAGE_KEY)); } catch { return parseOrder(null); }
}
/** The first step that still needs an answer: later steps stay locked until then. */
function allowedStep(order: Order): number {
  if (!order.base) return 0;
  if (order.buffer === null) return 2;
  if (order.experience === null) return 3;
  if (order.milk === null) return 4;
  return LAST;
}

export default function Cafe() {
  const c = useCafeLanguage();
  const { language, setLanguage, t, years, eur, pct, milk: MILK, sugar: SUGAR, buffer: BUFFER, experience: EXPERIENCE, drink, brew: BREW } = c;
  const STEPS = [t('De basis', 'The base'), t('Je tijd', 'Your time'), t('Achter de hand', 'Set aside'), t('Je ervaring', 'Your experience'), t('De melk', 'The milk'), t('De suiker', 'The sugar')];
  const QUESTIONS = [
    [t('Waar beginnen we mee?', 'Where shall we start?'), t('Koffie of matcha? Koffie mag uit alle fondsen kiezen, matcha alleen uit fondsen met een ESG-label.', 'Coffee or matcha? Coffee can use every fund, matcha only funds with an ESG label.')],
    [t('Wanneer wil je je koffie?', 'When do you want your coffee?'), t('Hoe lang kan dit geld blijven staan voordat je een groot deel nodig hebt? Hoe langer het mag trekken, hoe meer ruimte voor schommelingen.', 'How long can this money stay put before you need a large part of it? The longer it can steep, the more room for ups and downs.')],
    [t('Heb je iets achter de hand?', 'Do you have something set aside?'), t('Hoeveel maanden vaste lasten heb je opzij, buiten deze belegging?', 'How many months of fixed costs do you have saved, outside this investment?')],
    [t('Ben je hier vaker geweest?', 'Have you been here before?'), t('Hoeveel ervaring heb je met beleggen in aandelen, fondsen of ETF’s?', 'How much experience do you have with investing in shares, funds or ETFs?')],
    [t('Hoe zacht mag het zijn?', 'How mellow would you like it?'), t('Hoeveel financiële ruimte denk je te hebben voor schommelingen en verlies?', 'How much financial room do you believe you have for fluctuations and losses?')],
    [t('En hoeveel bitterheid?', 'And how much bitterness?'), t('Als je geld in één jaar daalt: hoe ver is nog oké?', 'If your money dropped in one year, how far is still OK?')],
  ];
  const location = useLocation();
  const navigate = useNavigate();
  /** From the landing page: start fresh, reopen a past recipe (served again), or continue the saved draft. */
  const entry = (location.state ?? {}) as { fresh?: boolean; replay?: PastRecipe };
  const [order, setOrder] = useState<Order>(() => entry.replay ? { ...entry.replay.order } : entry.fresh ? { ...EMPTY_ORDER } : loadOrder());
  const [step, setStep] = useState(() => entry.replay ? LAST : entry.fresh ? 0 : Math.min(allowedStep(loadOrder()), LAST));
  const [autoServe, setAutoServe] = useState(Boolean(entry.replay));
  const [mockConsent, setMockConsent] = useState(false);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error' | 'ok'>('idle');
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<CafeResult | null>(null);
  const [memoryWarning, setMemoryWarning] = useState(false);
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 901px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 901px)');
    const on = () => setWide(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  const requestRef = useRef<AbortController | null>(null);
  const sceneRef = useRef<HTMLDivElement>(null);
  const previousTitle = useRef('');
  const amount = amountValue(order.amount);
  const monthly = amountValue(order.monthly, MONTHLY_MAX);
  const invalidAmount = order.amount.trim() !== '' && amount === null;
  const invalidMonthly = order.monthly.trim() !== '' && monthly === null;
  const scored = scoreOrder(order);
  const ready = complete(order) && (!IS_FIXED_MOCK || mockConsent) && !invalidAmount && !invalidMonthly;
  const example = amount ?? 500;

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
    setMockConsent(false);
  }
  function patchAmounts(patch: Partial<Order>) {
    requestRef.current?.abort();
    setOrder(o => ({ ...o, ...patch })); setResult(null); if (status === 'loading' || status === 'ok') setStatus('idle');
  }
  function goTo(i: number) {
    setResult(null); setStatus('idle'); setStep(i);
    sceneRef.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  }
  async function serve() {
    if (!ready || status === 'loading') return;
    const snapshot = { ...order }, ctl = new AbortController();
    requestRef.current?.abort(); requestRef.current = ctl;
    setStatus('loading'); setResult(null); setMessage('');
    try {
      const body = orderRequest(snapshot);
      const response = await api.POST('/api/menu/order', { body, signal: ctl.signal });
      if (ctl.signal.aborted) return;
      if (response.error !== undefined || !response.data) throw new Error(errorMessage(response.error));
      const source = IS_FIXED_MOCK ? 'fixed' : response.response.headers.get('X-Cafe-Data') === 'synthetic' ? 'synthetic' : 'live';
      if (IS_PREVIEW && !IS_FIXED_MOCK && source !== 'synthetic') throw new Error('cafe:source');
      if (source !== 'fixed' && response.data.downside.fan.at(-1)?.year !== snapshot.horizon) throw new Error('cafe:horizon');
      setResult({ rec: response.data, source, horizon: source === 'fixed' ? 10 : snapshot.horizon, profileId: body.profile_id, base: body.base, amount: body.initial_amount, monthly: body.monthly_amount });
      setStatus('ok');
      if (source !== 'fixed') {
        const pts = moneyPoints(response.data, body.initial_amount ?? 0, body.monthly_amount ?? 0), end = pts[pts.length - 1];
        addToHistory({ id: `${Date.now()}`, at: new Date().toISOString(), order: snapshot, base: body.base, profileId: body.profile_id, horizon: snapshot.horizon,
          paidIn: end.paid, middle: end.p50, expectedReturn: response.data.summary.expected_return, volatility: response.data.summary.volatility });
      }
    } catch (error) {
      if (!ctl.signal.aborted) { setMessage(errorMessage(error)); setStatus('error'); }
    }
  }

  const caption = step === 0 ? order.base === 'matcha' ? t('Een ESG-label is geen duurzaamheidsgarantie.', 'An ESG label is not a sustainability guarantee.') : order.base === 'coffee' ? t('Zonder ESG-filter; ook ESG-fondsen kunnen erin zitten.', 'No ESG filter; ESG funds may also be included.') : t('Pak het blik dat bij je voorkeur past.', 'Pick the tin that suits your preference.')
    : step === 1 ? (order.horizon <= 2 ? t('Binnen 2 jaar nodig? Dan past sparen meestal beter dan beleggen.', 'Needed within 2 years? Saving usually fits better than investing.') : t('Je tijd telt mee voor wat je financieel kunt dragen: langer geeft meer tijd om te herstellen.', 'Your time counts towards what you can carry: longer gives more time to recover.'))
      : step === 2 ? t('Vaste lasten: huur, rekeningen, boodschappen. Met een buffer hoef je niet te verkopen tijdens een daling. We vragen geen bedragen.', 'Fixed costs: rent, bills, groceries. With a buffer you will not have to sell during a dip. We do not ask for amounts.')
        : step === 3 ? t('Nieuw? Prima. Dan starten we wat voorzichtiger.', 'New? Fine. We simply start a bit more carefully.')
          : step === 4 ? t('Melk telt mee voor wat je financieel kunt dragen, samen met je tijd en wat je achter de hand hebt.', 'Milk counts towards what your finances can carry, together with your time and what you have set aside.')
            : (wide ? t(`Bedragen gelden voor ${eur(example)}. Suiker telt mee voor wat je comfortabel vindt.`, `Amounts shown for ${eur(example)}. Sugar counts towards what you are comfortable with.`) : t(`Bedragen gelden voor ${eur(example)}. Ander bedrag? Tik op Menu.`, `Amounts shown for ${eur(example)}. Another amount? Tap Menu.`));
  const currentValid = [order.base !== null, Number.isInteger(order.horizon) && order.horizon >= 1 && order.horizon <= 40, order.buffer !== null, order.experience !== null, order.milk !== null, order.sugar !== null][step];
  const displayedMessage = message === 'cafe:source' ? t('De preview-backend heeft zijn synthetische databron niet bevestigd. Start de café-preview op poort 8741.', 'The preview backend has not confirmed its synthetic data source. Start the café preview on port 8741.')
    : message === 'cafe:horizon' ? t('De berekening heeft een andere looptijd dan je bestelling. Probeer het recept opnieuw.', 'The calculation has a different time horizon from your order. Please try the recipe again.') : message;

  const rows: BoardRow[] = [
    { label: STEPS[0], value: order.base ? drink(order.base) : null, meaning: order.base === 'matcha' ? t('Alleen fondsen met een ESG-label', 'ESG-labelled funds only') : order.base === 'coffee' ? t('Alle fondsen', 'Every fund') : null },
    { label: STEPS[1], value: allowedStep(order) > 1 || step > 1 ? years(order.horizon) : null, meaning: allowedStep(order) > 1 || step > 1 ? BREW[brewStage(order.horizon)].name : null },
    { label: STEPS[2], value: order.buffer !== null ? BUFFER[order.buffer].name : null, meaning: order.buffer !== null ? BUFFER[order.buffer].key : null },
    { label: STEPS[3], value: order.experience !== null ? EXPERIENCE[order.experience].name : null, meaning: order.experience !== null ? EXPERIENCE[order.experience].description : null },
    { label: STEPS[4], value: order.milk !== null ? MILK[order.milk].name : null, meaning: order.milk !== null ? MILK[order.milk].key : null },
    { label: STEPS[5], value: order.sugar !== null ? SUGAR[order.sugar].name : null, meaning: order.sugar !== null ? [t('Meer dan −30% in één jaar is oké', 'More than −30% in one year is OK'), t('Tot −30% in één jaar', 'Up to −30% in one year'), t('Tot −20% in één jaar', 'Up to −20% in one year'), t('Tot −10% in één jaar', 'Up to −10% in one year'), t('Geen verlies', 'No loss')][order.sugar] : null },
  ];
  useEffect(() => {
    if (!autoServe || !ready) return;
    setAutoServe(false);
    navigate('.', { replace: true, state: null }); // a reload later should not re-run it
    void serve();
  }, [autoServe, ready]); // eslint-disable-line react-hooks/exhaustive-deps
  const amountFields = <>
    <div className="cafe-amounts">
      <div className="cafe-amount"><label htmlFor="cafe-amount">{t('Startbedrag', 'Starting amount')} <span>{t('optioneel', 'optional')}</span></label><div><span aria-hidden="true">€</span><input id="cafe-amount" type="text" inputMode="decimal" placeholder="500" value={order.amount} aria-invalid={invalidAmount} onChange={e => patchAmounts({ amount: e.target.value })} /></div></div>
      <div className="cafe-amount"><label htmlFor="cafe-monthly">{t('Per maand', 'Per month')} <span>{t('optioneel', 'optional')}</span></label><div><span aria-hidden="true">€</span><input id="cafe-monthly" type="text" inputMode="decimal" placeholder="0" value={order.monthly} aria-invalid={invalidMonthly} onChange={e => patchAmounts({ monthly: e.target.value })} /></div></div>
    </div>
    {(invalidAmount || invalidMonthly) && <p className="cafe-amount-error">{t('Vul een positief bedrag in (maandelijks tot €1 miljoen), of laat het leeg.', 'Enter a positive amount (monthly up to €1 million), or leave it blank.')}</p>}
    <p className="cafe-small">{t('Bedragen veranderen alleen de euro’s in het voorbeeld, niet het recept.', 'Amounts only change the euros in the example, not the recipe.')}</p>
  </>;
  const actions = (where: string) => <div className={`cafe-order-actions ${where}`}>
    {step > 0 ? <button type="button" className="cafe-back" onClick={() => setStep(s => s - 1)}>← {t('Vorige keuze', 'Previous choice')}</button> : <span />}
    {step < LAST ? <button type="button" className="cafe-button" disabled={!currentValid} onClick={() => setStep(s => s + 1)}>{t('Volgende keuze', 'Next choice')} <span aria-hidden="true">→</span></button>
      : <button type="button" className="cafe-button" disabled={!ready || status === 'loading'} onClick={serve}>{status === 'loading' ? t('Even roeren…', 'Just stirring…') : t('Maak mijn voorbeeld', 'Make my example')}</button>}
  </div>;
  /** A pointer click or tap on an option moves on to the next step after a short pause, so the choice is seen.
   * Keyboard arrows (detail 0) only select, so keyboard users can still move between options. */
  const advanceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => () => clearTimeout(advanceRef.current), []);
  function advanceFrom(from: number) {
    clearTimeout(advanceRef.current);
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    advanceRef.current = setTimeout(() => {
      setLeaving(true);
      advanceRef.current = setTimeout(() => { setLeaving(false); setStep(s => s === from ? s + 1 : s); }, still ? 0 : 240);
    }, 550);
  }
  const choice = (name: string, i: number, checked: boolean, onChange: () => void, vessel: React.ReactNode, title: string, sub: React.ReactNode, aria?: string, advance = false) =>
    <label className={`cafe-choice ${checked ? 'selected' : ''}`} key={`${name}-${i}`}>
      <input type="radio" name={name} value={i} checked={checked} onChange={onChange} aria-label={aria} onClick={e => { if (advance && e.detail > 0) advanceFrom(step); }} />
      {vessel}<span className="cafe-choice-name">{title}{checked && <span className="cafe-choice-check" aria-hidden="true">✓</span>}</span><span className="cafe-choice-sub">{sub}</span>
    </label>;

  return <main className="cafe-page cafe-with-board" lang={language}>
    <a className="cafe-skip" href="#cafe-choices">{t('Naar de keuzes', 'Skip to the choices')}</a>
    <div className="cafe-layout">
      <MenuBoard rows={rows} step={step} reachable={i => i <= allowedStep(order) && status !== 'loading'} onStep={goTo} order={order} scores={scored} served={result !== null}>
        {!result && <div className="cafe-board-amounts">{amountFields}</div>}
      </MenuBoard>
      <div className={`cafe-scene ${status === 'loading' ? 'preparing' : ''} ${result ? 'served' : ''}`} ref={sceneRef}>
        <div className="cafe-picture">
          <Scene preparing={status === 'loading'} />
          <Link className="cafe-entrance" to="/cafe" aria-label={t('Naar de ingang: eerdere recepten of opnieuw beginnen', 'To the entrance: past recipes or start over')}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11 12 4l8 7M6 10v10h12V10" /></svg>{t('Ingang', 'Entrance')}</Link>
          <nav className="cafe-language" aria-label={t('Taal', 'Language')}>{(['nl', 'en'] as const).map(code => <button key={code} type="button" lang={code} aria-label={code === 'nl' ? 'Nederlands' : 'English'} aria-pressed={language === code} onClick={() => setLanguage(code)}>{code.toUpperCase()}</button>)}</nav>
          {(result || status === 'loading') && <div className="cafe-speech" aria-live="polite" aria-atomic="true"><p className="cafe-eyebrow">{result ? t('Vers van de bar', 'Fresh from the bar') : t('Even geduld', 'One moment')}</p><h1>{result ? servedSentence(result, c) : t('Ik maak je recept.', 'Making your recipe.')}</h1>{!result && <p>{t('We pakken het recept van de menukaart. Even roeren…', 'Taking your recipe from the menu. Just stirring…')}</p>}<span className="cafe-speech-tail" aria-hidden="true" /></div>}
        </div>
        {result ? <Results result={result} edit={() => goTo(LAST)} /> : <div className="cafe-counter">
          <section className={`cafe-choice-area ${leaving ? 'cafe-leaving' : ''}`} id="cafe-choices" aria-labelledby="cafe-question" key={step}>
            <header className="cafe-question">
              <p className="cafe-eyebrow">{t(`Stap ${step + 1} van ${LAST + 1} · ${STEPS[step]}`, `Step ${step + 1} of ${LAST + 1} · ${STEPS[step]}`)}</p>
              <h1 id="cafe-question">{QUESTIONS[step][0]}</h1>
              <p>{QUESTIONS[step][1]}</p>
            </header>
            {step === 0 && <fieldset className="cafe-choices base"><legend className="cafe-sr">{t('Kies koffie of matcha', 'Choose coffee or matcha')}</legend>{(['coffee', 'matcha'] as const).map((base, i) => <div className="cafe-base-option" key={base}>
              {choice('cafe-base', i, order.base === base, () => patchOrder({ base }), <Vessel kind="tin" base={base} />, drink(base), <>{base === 'coffee' ? t('Alle fondsen', 'Every fund') : t('Alleen ESG-gelabeld', 'ESG-labelled only')}<span className="cafe-base-short">{base === 'coffee' ? t('Wereldwijd, de breedste spreiding', 'Worldwide, the widest spread') : t('Milieu, mensen, goed bestuur; iets minder spreiding', 'Environment, people, governance; a bit less spread')}</span></>, undefined, true)}
              <p className="cafe-base-explain" role="tooltip" id={`cafe-base-help-${base}`}>{base === 'coffee'
                ? t('Geen duurzaamheidsfilter: we kiezen uit alle fondsen, wereldwijd, in aandelen, obligaties, vastgoed en geldmarkt. De meeste keuze, dus de breedste spreiding. ESG-fondsen kunnen er ook in zitten.', 'No sustainability filter: we pick from every fund, worldwide, across shares, bonds, real estate and cash. The most choice, so the widest spread. ESG funds can still be included.')
                : t('Alleen fondsen met een ESG-label (milieu, mensen, goed bestuur): ze sluiten bijvoorbeeld wapens of steenkool uit. Minder keuze, dus iets minder spreiding. Het label is geen garantie dat alles duurzaam is.', 'Only funds with an ESG label (environment, people, good governance): they leave out, for example, weapons or coal. Less choice, so a little less spread. The label is no guarantee that everything is sustainable.')}</p>
            </div>)}</fieldset>}
            {step === 1 && <div className="cafe-brew-choice">
              <Vessel kind="brew" amount={brewStage(order.horizon)} />
              <div className="cafe-brew-controls">
                <p className="cafe-brew-now" aria-hidden="true"><strong>{years(order.horizon)}</strong><span>{BREW[brewStage(order.horizon)].name} · {BREW[brewStage(order.horizon)].wait}</span></p>
                <label htmlFor="cafe-horizon" className="cafe-sr">{t('Hoe lang kan dit geld blijven staan?', 'How long can this money stay invested?')}</label>
                <input id="cafe-horizon" type="range" min="0" max={HORIZON_STOPS.length - 1} step="1" value={nearestStop(order.horizon)} aria-valuetext={`${years(order.horizon)}, ${BREW[brewStage(order.horizon)].name}`} onChange={e => patchOrder({ horizon: HORIZON_STOPS[Number(e.target.value)] })} style={{ '--fill': `${nearestStop(order.horizon) / (HORIZON_STOPS.length - 1) * 100}%` } as React.CSSProperties} />
                <div className="cafe-brew-scale" aria-hidden="true">{[1, 5, 10, 20, 40].map(y => <span key={y} style={{ left: `${HORIZON_STOPS.indexOf(y) / (HORIZON_STOPS.length - 1) * 100}%` }}>{y}</span>)}</div>
                <span className="cafe-small">{t('1–40 jaar · langer wachten garandeert geen herstel', '1–40 years · waiting longer does not guarantee recovery')}</span>
              </div>
            </div>}
            {step === 2 && <PresetSlider id="cafe-buffer" label={t('Wat heb je achter de hand?', 'What do you have set aside?')} value={order.buffer} onChange={i => patchOrder({ buffer: i })}
              vessel={i => <Vessel kind="cookies" amount={i} />} options={BUFFER.map(p => ({ name: p.name, key: p.key, keyText: p.key, detail: p.description }))} />}
            {step === 3 && <PresetSlider id="cafe-experience" label={t('Hoeveel ervaring heb je met beleggen?', 'How much investing experience do you have?')} value={order.experience} onChange={i => patchOrder({ experience: i })}
              vessel={i => <Vessel kind="stamps" amount={i} />} options={EXPERIENCE.map(p => ({ name: p.name, key: p.description, keyText: p.description }))} />}
            {step === 4 && <PresetSlider id="cafe-milk" label={t('Hoeveel melk?', 'How much milk?')} value={order.milk} onChange={i => patchOrder({ milk: i })}
              vessel={i => <Vessel kind="milk" amount={i} />} options={MILK.map(p => ({ name: p.name, key: p.key, keyText: p.key, detail: p.description }))} />}
            {step === 5 && <PresetSlider id="cafe-sugar" label={t('Hoeveel suiker?', 'How much sugar?')} value={order.sugar} onChange={i => patchOrder({ sugar: i })}
              vessel={i => <Vessel kind="sugar" amount={i} />} options={SUGAR.map((p, i) => {
                const loss = SUGAR_LOSS[i];
                const key = loss === null ? t('Meer dan −30% in één jaar', 'More than −30% in one year') : loss === 0 ? t('Geen verlies', 'No loss') : t(`Tot −${pct(loss, 0)} in één jaar`, `Up to −${pct(loss, 0)} in one year`);
                const euro = loss === null ? t(`${eur(example)} kan onder ${eur(example * .7)} komen`, `${eur(example)} could fall below ${eur(example * .7)}`)
                  : loss === 0 ? t('Elke belegging kan toch verliezen', 'Any investment can still lose') : t(`${eur(example)} kan dalen naar ${eur(example * (1 - loss))}`, `${eur(example)} could fall to ${eur(example * (1 - loss))}`);
                const detail = loss === 0
                  ? <span className="cafe-preset-warning" role="note"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2 20h20L12 3Z" /><path d="M12 10v4M12 17h.01" /></svg><span><strong>{t('Ook extra zoet kan verlies geven.', 'Even extra sweet can lose money.')}</strong> {t('Geen garantie. Kun je echt geen verlies hebben, dan past sparen beter.', 'No guarantee. If you truly cannot take a loss, saving fits better.')}</span></span>
                  : <strong>{euro}</strong>;
                return { name: p.name, key, keyText: loss === 0 ? `${key}. ${t('Ook extra zoet kan verlies geven.', 'Even extra sweet can lose money.')}` : `${key}. ${euro}`, detail };
              })} />}
            <p className="cafe-choice-caption" aria-live="polite">{caption}</p>
            {step === LAST && (wide ? invalidAmount || invalidMonthly || IS_FIXED_MOCK : IS_FIXED_MOCK) && <div className="cafe-final">
              {IS_FIXED_MOCK && <div className="cafe-consent"><strong>{t('Alleen een vast demoresultaat.', 'A fixed demo result only.')}</strong><p>{t('Je keuzes worden niet doorgerekend.', 'Your choices are not used in the calculation.')}</p><label><input type="checkbox" checked={mockConsent} onChange={e => setMockConsent(e.target.checked)} /> {t('Toon het vaste voorbeeld: koffie, sterkte 4, 10 jaar.', 'Show the fixed example: coffee, strength 4, 10 years.')}</label></div>}
            </div>}
            {wide && actions('cafe-panel-actions')}
          </section>
        </div>}
        {!result && !wide && actions('cafe-panel-actions')}
        {status === 'loading' && <p className="cafe-request-status" role="status">{t('Het recept wordt berekend. Het is nog niet klaar.', 'The recipe is being calculated. It is not ready yet.')}</p>}
        {status === 'error' && <section className="cafe-warning cafe-api-error" role="alert"><h2>{t('Dit recept kon nog niet worden gemaakt.', 'We could not make this recipe yet.')}</h2><p>{displayedMessage}</p><p>{t('Je keuzes zijn bewaard. Controleer de backend of pas je recept aan.', 'Your choices have been kept. Check the backend or adjust your recipe.')}</p><button type="button" className="cafe-button" disabled={!ready} onClick={serve}>{t('Opnieuw proberen', 'Try again')}</button></section>}
        {memoryWarning && <p className="cafe-small" role="status">{t('Je browser kan de keuzes niet bewaren. Ze blijven beschikbaar zolang deze pagina openstaat.', 'Your browser cannot save your choices. They remain available while this page is open.')}</p>}
        <footer className="cafe-footer"><span>{t('Educatief voorbeeld · geen persoonlijk beleggingsadvies.', 'Educational example · not personal investment advice.')}</span><span>{t('Je kunt geld verliezen. Melk en suiker beschermen niet.', 'You can lose money. Milk and sugar do not protect you.')}</span></footer>
      </div>
    </div>
  </main>;
}

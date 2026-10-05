import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { errorMessage } from '../components/charts/format';
import { amountValue, CAFE_STORAGE_KEY, complete, MILK, needsConsent, parseOrder, pct, portfolioRequest, recipeExplanation, riskLevel, SUGAR, type Order } from '../cafe/recipe';
import { Scene, Vessel } from '../cafe/Scene';
import { Results, type CafeResult } from '../cafe/Results';
import '../cafe/cafe.css';

const IS_FIXED_MOCK = import.meta.env.VITE_USE_MOCKS === '1';
const IS_PREVIEW = import.meta.env.VITE_CAFE_DEMO === '1' || IS_FIXED_MOCK;
const STEPS = ['De basis', 'Je tijd', 'De melk', 'De suiker'];
const QUESTIONS = [
  ['Waar beginnen we mee?', 'Koffie of matcha? De basis bepaalt welke fondsen we mogen gebruiken.'],
  ['Hoeveel tijd heb je?', 'Wanneer verwacht je een groot deel van dit geld nodig te hebben?'],
  ['Hoe zacht mag het zijn?', 'Hoeveel financiële ruimte denk je te hebben voor schommelingen en verlies?'],
  ['En hoeveel bitterheid?', 'Welk verlies over één jaar zou voor jou nog acceptabel voelen?'],
];

function loadOrder(): Order {
  try { return parseOrder(localStorage.getItem(CAFE_STORAGE_KEY)); } catch { return parseOrder(null); }
}
function allowedStep(order: Order): number {
  if (!order.base) return 0;
  if (order.milk === null) return 2;
  return 3;
}

export default function Cafe() {
  const [order, setOrder] = useState<Order>(loadOrder);
  const [step, setStep] = useState(0);
  const [consent, setConsent] = useState(false);
  const [mockConsent, setMockConsent] = useState(false);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error' | 'ok'>('idle');
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<CafeResult | null>(null);
  const [memoryWarning, setMemoryWarning] = useState(false);
  const requestRef = useRef<AbortController | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<HTMLDivElement>(null);
  const previousTitle = useRef('');
  const amount = amountValue(order.amount);
  const invalidAmount = order.amount.trim() !== '' && amount === null;
  const risk = riskLevel(order);
  const ready = complete(order) && (!needsConsent(order) || consent) && (!IS_FIXED_MOCK || mockConsent) && !invalidAmount;

  useEffect(() => {
    previousTitle.current = document.title; document.title = 'Je beleggingsrecept · Aan de bar';
    return () => { document.title = previousTitle.current; requestRef.current?.abort(); };
  }, []);
  useEffect(() => {
    try { localStorage.setItem(CAFE_STORAGE_KEY, JSON.stringify(order)); setMemoryWarning(false); }
    catch { setMemoryWarning(true); }
  }, [order]);
  useEffect(() => {
    if (result) resultsRef.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
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
      if (IS_PREVIEW && !IS_FIXED_MOCK && source !== 'synthetic') throw new Error('De preview-backend heeft zijn synthetische databron niet bevestigd. Start de café-preview op poort 8741.');
      if (source !== 'fixed' && response.data.downside.fan.at(-1)?.year !== snapshot.horizon) throw new Error('De berekening heeft een andere looptijd dan je bestelling. Probeer het recept opnieuw.');
      setResult({ rec: response.data, source, horizon: source === 'fixed' ? 10 : snapshot.horizon });
      setStatus('ok');
    } catch (error) {
      if (!ctl.signal.aborted) { setMessage(errorMessage(error)); setStatus('error'); }
    }
  }

  const selectedPreset = step === 2 && order.milk !== null ? MILK[order.milk] : step === 3 && order.sugar !== null ? SUGAR[order.sugar] : null;
  const currentValid = step === 0 ? order.base !== null : step === 1 ? Number.isInteger(order.horizon) && order.horizon >= 1 && order.horizon <= 40 : step === 2 ? order.milk !== null : order.sugar !== null;

  return <main className="cafe-page" lang="nl">
    <a className="cafe-skip" href="#cafe-choices">Naar de keuzes</a>
    <header className="cafe-header"><Link to="/cafe" className="cafe-brand"><span className="cafe-brand-mark" aria-hidden="true">◒</span><span>Aan de bar<small>Een klein begin. Een eigen beleggingsrecept.</small></span></Link>
      <div className="cafe-header-right">{IS_PREVIEW && <span className="cafe-preview-label">Ontwerppreview</span>}<Link to="/" className="cafe-classic-link">Klassieke interface ↗</Link></div>
    </header>
    <div className="cafe-intro"><p>Zet je financiële voorkeuren om in een recept.</p><span>Rustig kiezen, helder begrijpen.</span></div>
    <div className={`cafe-scene ${status === 'loading' ? 'preparing' : ''}`} ref={sceneRef}>
      <div className="cafe-picture">
        <Scene preparing={status === 'loading'} />
        <nav className="cafe-steps" aria-label="Je bestelling">{STEPS.map((name, i) => <button key={name} type="button" className={step === i ? 'current' : ''} aria-current={step === i ? 'step' : undefined} disabled={i > allowedStep(order) || status === 'loading'} onClick={() => setStep(i)}><span>{i + 1}</span><span>{name}</span></button>)}</nav>
        <div className="cafe-speech" aria-live="polite" aria-atomic="true"><p className="cafe-eyebrow">Je barista vraagt</p><h1>{status === 'loading' ? 'Ik maak je recept.' : QUESTIONS[step][0]}</h1><p>{status === 'loading' ? 'We zoeken een portefeuille bij jouw keuzes. Even roeren…' : QUESTIONS[step][1]}</p><span className="cafe-speech-tail" aria-hidden="true" /></div>
        <span className="cafe-window-label" aria-hidden="true">Zonnig in Amsterdam</span>
      </div>
      <div className="cafe-counter">
        <section className="cafe-choice-area" id="cafe-choices" aria-label={STEPS[step]}>
          {step === 0 && <fieldset className="cafe-choices base"><legend className="cafe-sr">Kies koffie of matcha</legend>{(['coffee', 'matcha'] as const).map(base => <label className={`cafe-choice ${order.base === base ? 'selected' : ''}`} key={base}>
            <input type="radio" name="cafe-base" value={base} checked={order.base === base} onChange={() => patchOrder({ base })} />
            <Vessel kind="tin" base={base} /><span className="cafe-choice-name">{base === 'coffee' ? 'Koffie' : 'Matcha'}</span><span className="cafe-choice-sub">{base === 'coffee' ? 'Brede fondsselectie' : 'Alleen ESG-gemarkeerd'}</span>
          </label>)}</fieldset>}
          {step === 1 && <div className="cafe-time-choice"><div className="cafe-clock" aria-hidden="true"><span>◷</span><strong>{order.horizon}</strong><small>jaar</small></div><div><label htmlFor="cafe-horizon">Hoe lang kan dit geld blijven staan?</label><div className="cafe-time-controls"><button type="button" aria-label="Eén jaar minder" disabled={order.horizon <= 1} onClick={() => patchOrder({ horizon: order.horizon - 1 })}>−</button><input id="cafe-horizon" type="number" min="1" max="40" step="1" value={order.horizon} onChange={e => patchOrder({ horizon: Number(e.target.value) })} /><button type="button" aria-label="Eén jaar meer" disabled={order.horizon >= 40} onClick={() => patchOrder({ horizon: order.horizon + 1 })}>+</button></div><span className="cafe-small">1–40 jaar · langer wachten garandeert geen herstel</span></div></div>}
          {(step === 2 || step === 3) && <fieldset className="cafe-choices"><legend className="cafe-sr">{step === 2 ? 'Kies één van vijf melkpresets' : 'Kies één van vijf suikerpresets'}</legend>{(step === 2 ? MILK : SUGAR).map((preset, i) => <label className={`cafe-choice ${(step === 2 ? order.milk : order.sugar) === i ? 'selected' : ''}`} key={i}>
            <input type="radio" name={`cafe-${step === 2 ? 'milk' : 'sugar'}`} value={i} checked={(step === 2 ? order.milk : order.sugar) === i} onChange={() => patchOrder(step === 2 ? { milk: i } : { sugar: i })} aria-label={`${preset.name}. ${preset.description}`} />
            <Vessel kind={step === 2 ? 'milk' : 'sugar'} amount={i} /><span className="cafe-choice-name">{preset.name}</span>
          </label>)}</fieldset>}
          <p className="cafe-choice-caption" aria-live="polite">{selectedPreset ? selectedPreset.description : step === 0 ? order.base === 'matcha' ? 'Een ESG-markering is geen duurzaamheidsgarantie.' : order.base === 'coffee' ? 'Zonder ESG-filter; ook ESG-fondsen kunnen in de selectie zitten.' : 'Pak het blik dat bij je voorkeur past.' : step === 1 ? 'Je horizon bepaalt hoe ver we vooruitkijken.' : 'Kies één van de vijf standen. Er is geen goed of fout antwoord.'}</p>
        </section>
        <aside className="cafe-order-receipt" aria-label="Je bestelbon"><p className="cafe-receipt-title">JE BESTELBON</p><dl>
          <div><dt>Basis</dt><dd>{order.base === 'matcha' ? 'Matcha' : order.base === 'coffee' ? 'Koffie' : 'Nog te kiezen'}</dd></div>
          <div><dt>Tijd</dt><dd>{order.horizon} jaar</dd></div>
          <div><dt>Melk</dt><dd>{order.milk === null ? 'Nog te kiezen' : MILK[order.milk].name}</dd></div>
          <div><dt>Suiker</dt><dd>{order.sugar === null ? 'Nog te kiezen' : SUGAR[order.sugar].name}</dd></div>
        </dl>{step < 3 ? <button type="button" className="cafe-button" disabled={!currentValid} onClick={() => setStep(s => s + 1)}>Volgende keuze <span aria-hidden="true">→</span></button> : <button type="button" className="cafe-button" disabled={!ready || status === 'loading'} onClick={serve}>{status === 'loading' ? 'Even roeren…' : result ? 'Opnieuw bereiden' : 'Maak mijn voorbeeld'}</button>}
          {step > 0 && <button type="button" className="cafe-back" onClick={() => setStep(s => s - 1)}>← Vorige keuze</button>}
        </aside>
      </div>
    </div>
    {step === 3 && <section className="cafe-recipe-note" aria-label="Recept afronden"><div><p className="cafe-eyebrow">Even proeven</p><p>{recipeExplanation(order)}</p>{risk !== null && <p className="cafe-small">Receptniveau {risk}/100 · standaard doel voor jaarlijkse schommelingen {pct(.02 + risk / 100 * .18)}. Geen maximaal verlies.</p>}
      {order.horizon <= 2 && (risk ?? 0) >= 50 && <p className="cafe-warning">Een korte looptijd en een stevig recept kunnen grote verliezen betekenen wanneer je het geld nodig hebt.</p>}
      {needsConsent(order) && <div className="cafe-consent" role="note"><strong>Ook ons zachtste beleggingsrecept kan verlies geven.</strong><p>“Extra zoet” is geen spaarproduct of garantie. Als je geen verlies kunt accepteren, past deze voorbeeldportefeuille niet bij die wens.</p><label><input type="checkbox" checked={consent} onChange={e => { setConsent(e.target.checked); if (!e.target.checked) { requestRef.current?.abort(); setResult(null); setStatus('idle'); } }} /> Ik wil alleen een voorbeeld met mogelijk verlies verkennen.</label><a href="https://www.afm.nl/nl-nl/consumenten/themas/zelf-beleggen/is-beleggen-iets-voor-jou" target="_blank" rel="noreferrer">Lees over sparen en beleggen ↗</a></div>}
      {IS_FIXED_MOCK && <div className="cafe-consent"><strong>Deze mockmodus bevat alleen een vast demoresultaat.</strong><p>Je keuzes worden niet doorgerekend. Voor een interactieve demo: start de café-preview zoals beschreven in de README.</p><label><input type="checkbox" checked={mockConsent} onChange={e => setMockConsent(e.target.checked)} /> Toon het vaste voorbeeld: niveau 50, 10 jaar, brede selectie.</label></div>}
    </div><div className="cafe-amount"><label htmlFor="cafe-amount">Startbedrag voor het plaatje <span>optioneel</span></label><div><span aria-hidden="true">€</span><input id="cafe-amount" type="text" inputMode="decimal" placeholder="Zonder bedrag" value={order.amount} aria-invalid={invalidAmount} aria-describedby="cafe-amount-help" onChange={e => { requestRef.current?.abort(); setOrder(o => ({ ...o, amount: e.target.value })); if (status === 'loading') setStatus('idle'); }} /></div><p id="cafe-amount-help" className={invalidAmount ? 'cafe-amount-error' : 'cafe-small'}>{invalidAmount ? 'Vul een positief bedrag tot €1 miljard in, of laat het leeg.' : 'Alleen voor de weergave. Geen aanbevolen inleg; geen maandelijkse bijdrage.'}</p></div></section>}
    {status === 'loading' && <p className="cafe-request-status" role="status">De portefeuille wordt berekend. Je recept is nog niet klaar.</p>}
    {status === 'error' && <section className="cafe-warning cafe-api-error" role="alert"><h2>Dit recept kon nog niet worden gemaakt.</h2><p>{message}</p><p>Je keuzes zijn bewaard. Controleer de backend of pas je recept aan.</p><button type="button" className="cafe-button" disabled={!ready} onClick={serve}>Opnieuw proberen</button></section>}
    {result && <div ref={resultsRef}><Results result={result} order={order} amount={amount} edit={editRecipe} /></div>}
    {memoryWarning && <p className="cafe-small" role="status">Je browser kan de keuzes niet bewaren. Ze blijven beschikbaar zolang deze pagina openstaat.</p>}
    <footer className="cafe-footer"><span>Een educatief voorbeeld, geen persoonlijk beleggingsadvies.</span><span>Je kunt geld verliezen. Melk en suiker zijn geen bescherming.</span></footer>
  </main>;
}

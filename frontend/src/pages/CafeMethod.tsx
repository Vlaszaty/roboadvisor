import { useEffect, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { useDebounced, useLastData, useRequest } from '../components/charts/hooks';
import { ErrorBox, Loading } from '../components/charts/Status';
import { DataTable, Step } from '../components/textbook/Step';
import { corrShade } from '../components/textbook/textbook';
import { Stat } from '../components/ui';
import { ExplainProvider } from '../explain/Explain';
import { useCafeLanguage } from '../cafe/language';
import {
  buildMethod, chartData, correlationGrid, exampleExpected, exampleFunnel, exampleMix, shrinkageNote, returnsNote, fewFundsNote, chartReading, examplePick, exampleResult, exampleReturns, exampleRules,
  expectedTable, funnelTable, makeFmt, marketText, netReturn, parseMethodParams, rulesTable, shareTable, standInTable, volatilityTable,
  weightsTable, type Base, type MethodData,
} from '../cafe/method';
import { methodSteps, stepLabels } from '../cafe/methodCopy';
import { MethodChart } from '../cafe/MethodChart';
import '../components/charts/results.css';
import '../components/textbook/textbook.css';
import '../cafe/cafe.css';
import '../cafe/board.css';

const HORIZON_YEARS = 10;
const Note = ({ children }: { children: string }) => <p className="small muted">{children}</p>;

/** "How this recipe was made": the seven steps of the engine with the numbers of one café recipe. */
export default function CafeMethod() {
  const { language, setLanguage, t, profiles, drink } = useCafeLanguage();
  const [search, setSearch] = useSearchParams();
  const { base, strength } = parseMethodParams(search);
  const choose = (next: { base?: Base; strength?: number }) =>
    setSearch({ base: next.base ?? base, strength: String(next.strength ?? strength) }, { replace: true });
  useEffect(() => { document.title = t('Zo is dit recept gemaakt · Aan de bar', 'How this recipe was made · At the café'); }, [t]);

  const key = useDebounced(JSON.stringify({ base, profile_id: strength }), 250);
  const recipe = JSON.parse(key) as { base: Base; profile_id: number };
  const order = useRequest((signal) => api.POST('/api/menu/order', { body: { ...recipe, horizon_years: HORIZON_YEARS }, signal }), key);
  const frontier = useRequest((signal) => api.POST('/api/menu/frontier', { body: recipe, signal }), key);
  const lastOrder = useLastData(order.state, key);
  const lastFrontier = useLastData(frontier.state, key);
  // never mix the frontier of another recipe into the page
  const frontierData = lastFrontier && lastFrontier.tag === lastOrder?.tag ? lastFrontier.data : undefined;
  const method = useMemo(() => lastOrder ? buildMethod(lastOrder.data, frontierData) : null, [lastOrder, frontierData]);
  const shown = lastOrder ? JSON.parse(lastOrder.tag) as { base: Base; profile_id: number } : recipe;
  const p = profiles[strength - 1];

  return <ExplainProvider face="/cafe/barista-face.jpg" closeLabel={t('Duidelijk', 'Got it')}><main className="cafe-page menu-cafe cafe-textbook cafe-method" lang={language}>
    <img className="cafe-home-bg" src="/cafe/scene.png" alt="" />
    <Link className="cafe-entrance-top" to="/cafe"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11 12 4l8 7M6 10v10h12V10" /></svg>{t('Ingang', 'Entrance')}</Link>
    <nav className="cafe-language" aria-label={t('Taal', 'Language')}>{(['nl', 'en'] as const).map(code => <button key={code} type="button" lang={code} aria-label={code === 'nl' ? 'Nederlands' : 'English'} aria-pressed={language === code} onClick={() => setLanguage(code)}>{code.toUpperCase()}</button>)}</nav>

    <div className="tbc-wrap">
      <section className="menu-board-big tbc-board" aria-labelledby="tbc-title">
        <p className="cafe-board-eyebrow">{t('Achter de bar', 'Behind the bar')}</p>
        <h1 id="tbc-title">{t('Zo is dit recept gemaakt', 'How this recipe was made')}</h1>
        <p className="menu-board-intro">{t('Zeven korte stappen, met de echte cijfers van het recept dat je kiest. Dit is de methode die aan de bar echt wordt gebruikt. De les met zeven vaste fondsen laat het idee in het klein zien.', 'Seven short steps, with the real numbers of the recipe you pick. This is the method the café really uses. The lesson with seven fixed funds shows the idea in miniature.')}</p>

        <div className="tbc-controls">
          <fieldset>
            <legend>{t('Drankje', 'Drink')}</legend>
            <div className="menu-board-tabs">{(['coffee', 'matcha'] as const).map(b => <button key={b} type="button" aria-pressed={base === b} onClick={() => choose({ base: b })}>{drink(b)}</button>)}</div>
          </fieldset>
          <fieldset>
            <legend>{t('Sterkte', 'Strength')}: <strong>{p.id}/7 · {p.name}</strong> <span>{p.plain}</span></legend>
            <div className="tbc-strengths">{profiles.map(x => <button key={x.id} type="button" aria-pressed={strength === x.id} aria-label={`${x.id}. ${x.name}`} onClick={() => choose({ strength: x.id })}>{x.id}</button>)}</div>
          </fieldset>
        </div>
        <div className="tbc-links">
          <Link className="menu-board-order" to="/cafe/order" state={{ fresh: true }}>{t('Bestel aan de bar', 'Order at the bar')} <span aria-hidden="true">→</span></Link>
          <Link className="cafe-board-link" to="/cafe/menu">{t('Naar de menukaart', 'To the menu')}</Link>
          <Link className="cafe-board-link" to="/cafe/textbook">{t('Naar de les met zeven vaste fondsen', 'To the lesson with seven fixed funds')}</Link>
        </div>
      </section>

      <div className="tbc-steps">
        {order.state.status === 'error' && <ErrorBox message={order.state.message} onRetry={order.reload} />}
        {method
          ? <div className={order.state.status !== 'ok' ? 'textbook-stale' : undefined}>
            <MethodSteps m={method} base={shown.base} strength={profiles[shown.profile_id - 1]} frontierLoading={frontier.state.status === 'loading' && !frontierData} frontierFailed={frontier.state.status === 'error'} retry={frontier.reload} />
          </div>
          : lastOrder
            ? <ErrorBox message={t('Dit antwoord mist onderdelen die deze pagina nodig heeft.', 'This answer is missing parts this page needs.')} onRetry={order.reload} />
            : order.state.status === 'loading' && <Loading />}
      </div>
    </div>
  </main></ExplainProvider>;
}

export function MethodSteps({ m, base, strength, frontierLoading, frontierFailed, retry }: {
  m: MethodData; base: Base; strength: { id: number; name: string }; frontierLoading: boolean; frontierFailed: boolean; retry: () => void;
}) {
  const { language } = useCafeLanguage();
  const f = useMemo(() => makeFmt(language), [language]);
  const { t } = f;
  const copy = useMemo(() => methodSteps(language), [language]);
  const labels = stepLabels(language);
  const warnings = m.order.warnings ?? [];
  const grid = correlationGrid(m);
  const chart = chartData(m, f);
  const net = netReturn(m);
  const tr = m.trace;
  const s = m.order.summary;
  const wait = frontierFailed
    ? <ErrorBox message={t('De grafiek kon niet worden geladen.', 'The chart could not be loaded.')} onRetry={retry} />
    : frontierLoading && <p className="small muted" role="status">{t('De grafiek en de schommeling per fonds worden berekend; de eerste keer kan dat zo’n 15 seconden duren.', 'The chart and the swing per fund are being calculated; the first time can take about 15 seconds.')}</p>;
  const pctPoint = (v: number) => f.pct(v / 100, 2);

  return (
    <div className="textbook-steps">
      {warnings.length > 0 && <div className="banner"><ul>{warnings.map((w) => <li key={w}>{w}</li>)}</ul></div>}

      <Step n={1} copy={copy[1]} example={exampleFunnel(m, f, base)} labels={labels} explain={false}>
        <DataTable table={funnelTable(m, f).table} label={t('Van alle fondsen naar de kandidaten', 'From all funds to the candidates')} text={[0]} />
      </Step>

      <Step n={2} copy={copy[2]} example={exampleReturns(m, f)} labels={labels} explain={false}>
        <DataTable table={standInTable(m, f)} label={t('Wat de fondsen in dit recept deden in de meetperiode', 'What the funds in this recipe did over the measured period')} text={[0, 4]} />
        <Note>{returnsNote(m, f)}</Note>
      </Step>

      <Step n={3} copy={copy[3]} example={exampleMix(m, f)} labels={labels} explain={false}>
        <DataTable table={volatilityTable(m, f)} label={t('Schommeling per fonds', 'Swing per fund')} text={[1]} />
        {grid && <div className="table-scroll" role="region" aria-label={t('Correlatie tussen de fondsen in dit recept', 'Correlation between the funds in this recipe')} tabIndex={0}>
          <table className="table corr">
            <thead><tr><th scope="col" />{grid.head.map((h) => <th key={h} scope="col" className="num">{h}</th>)}</tr></thead>
            <tbody>{grid.rows.map((r) => <tr key={r.label}><th scope="row">{r.label}</th>{r.cells.map((v, k) => <td key={k} className="num" style={{ background: corrShade(v) }}>{f.num(v)}</td>)}</tr>)}</tbody>
          </table>
        </div>}
        {wait}
        <Note>{t(`Gemeten over ${tr.covariance.windowYears} jaar (${tr.covariance.weeksUsed} weken), omgerekend naar een jaar, na Ledoit-Wolf-shrinkage.`, `Measured over ${tr.covariance.windowYears} years (${tr.covariance.weeksUsed} weeks), scaled to a year, after Ledoit-Wolf shrinkage.`)}</Note>
        <Note>{shrinkageNote(m, f)}</Note>
      </Step>

      <Step n={4} copy={copy[4]} example={exampleExpected(m, f)} labels={labels} explain={false}>
        <DataTable table={expectedTable(m, f)} label={t('Beta en verwacht rendement per fonds', 'Beta and expected return per fund')} text={[]} />
        <Note>{t(`Rente zonder risico ${f.pct(tr.expected.rf, 2)} (de laatste korte rente), marktpremie ${f.pct(tr.expected.premium)}. De markt: ${marketText(m, f)}. Beta is gemeten op dezelfde weekrendementen.`, `Risk-free rate ${f.pct(tr.expected.rf, 2)} (the latest short-term rate), market premium ${f.pct(tr.expected.premium)}. The market: ${marketText(m, f)}. Beta is measured on the same weekly returns.`)}</Note>
      </Step>

      <Step n={5} copy={copy[5]} example={exampleRules(m, f, strength)} labels={labels} explain={false}>
        <DataTable table={rulesTable(m, f, strength)} label={t('De huisregels van dit recept', 'The house rules of this recipe')} text={[1]} />
        {base === 'matcha' && <Note>{t('Bij matcha zijn alleen fondsen met een ESG-label kandidaat, plus het geldmarktfonds. Dat heeft geen ESG-label en mag toch mee.', 'For matcha only ESG-labelled funds are candidates, plus the cash fund. It has no ESG label and may join anyway.')}</Note>}
      </Step>

      <Step n={6} copy={copy[6]} example={examplePick(m, f)} labels={labels} explain={false}>
        {chart ? <MethodChart data={chart} f={f} /> : wait || null}
        {chart && <Note>{chartReading(chart, f)}</Note>}
        <DataTable table={weightsTable(m, f)} label={t('De gekozen mix', 'The chosen mix')} text={[]} />
        <Note>{t(`Gekozen: ${tr.optimize.nHoldings} fondsen, schommeling ${f.pct(tr.optimize.achievedVol)} bij een doel van ${f.pct(tr.constraints.targetVol)}.`, `Chosen: ${tr.optimize.nHoldings} funds, swing ${f.pct(tr.optimize.achievedVol)} against a target of ${f.pct(tr.constraints.targetVol)}.`)}</Note>
        <Note>{fewFundsNote(m, f)}</Note>
      </Step>

      <Step n={7} copy={copy[7]} example={exampleResult(m, f)} labels={labels} explain={false}>
        <div className="tb-stats">
          <Stat label={t('Verwacht rendement per jaar', 'Expected return a year')} value={pctPoint(net.gross)} hint={t('vóór fondskosten', 'before fund costs')} />
          <Stat label={t('Fondskosten per jaar', 'Fund costs a year')} value={pctPoint(net.cost)} hint={t(`ongeveer €${f.int(Math.round(s.annual_cost_per_10k))} per €10.000`, `about €${f.int(Math.round(s.annual_cost_per_10k))} per €10,000`)} />
          <Stat label={t('Verwacht na kosten', 'Expected after costs')} value={pctPoint(net.net)} />
          <Stat label={t('Schommeling per jaar', 'Swing a year')} value={f.pct(s.volatility)} />
        </div>
        <DataTable table={shareTable(m, f)} label={t('Aandeel in het geld en in het risico per fonds', 'Share of the money and of the risk per fund')} text={[]} />
      </Step>
    </div>
  );
}

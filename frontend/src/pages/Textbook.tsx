import { useState } from 'react';
import { api } from '../api/client';
import { AssetMixDonut } from '../components/charts/Donut';
import { useDebounced, useLastData, useRequest } from '../components/charts/hooks';
import { ErrorBox, Loading } from '../components/charts/Status';
import { ChapterNav, type ChapterDef } from '../components/Story';
import { PageHeader, Stat } from '../components/ui';
import { stepsCopy } from '../components/textbook/copy';
import { MixDonut } from '../components/textbook/MixDonut';
import { DataTable, Step } from '../components/textbook/Step';
import { RiskReturnChart, SmlChart } from '../components/textbook/TextbookChart';
import {
  corrShade, correlationRows, exampleCorrelation, exampleExpected, exampleFrontier, examplePortfolio, exampleSplit,
  exampleStats, exampleTangent, expectedTable, statsTable, tangentTable, textFmt, textbookRequest, usedColumn, weightSlices,
  weightsTable, type Language, type ReturnModel, type Textbook as TextbookData,
} from '../components/textbook/textbook';
import { Term } from '../glossary/Term';
import { riskKey, riskLabel } from '../intake/logic';
import { useStore } from '../state/store';
import '../components/charts/results.css';
import '../components/textbook/textbook.css';

const Note = ({ children }: { children: string }) => <p className="small muted">{children}</p>;

const CHAPTERS: ChapterDef[] = [
  { id: 'step-1', label: '1 Each fund' },
  { id: 'step-2', label: '2 Together' },
  { id: 'step-3', label: '3 Could earn' },
  { id: 'step-4', label: '4 Best mixes' },
  { id: 'step-5', label: '5 Best risky mix' },
  { id: 'step-6', label: '6 Your split' },
  { id: 'step-7', label: '7 Your plan' },
];

const PREMIUMS = ['3', '5', '7'];

export function Steps({ t, language = 'en' }: { t: TextbookData; language?: Language }) {
  const x = textFmt(language);
  const copy = stepsCopy(language);
  const corr = correlationRows(t, language);
  const capm = t.inputs.return_model === 'capm';
  const usedMarker = x.t(' (gebruikt)', ' (used)');
  return (
    <div className="textbook-steps">
      {(t.warnings ?? []).length > 0 && (
        <div className="banner"><ul>{(t.warnings ?? []).map((w) => <li key={w}>{w}</li>)}</ul></div>
      )}

      <Step n={1} copy={copy.stats} example={exampleStats(t, language)} language={language}>
        <DataTable table={statsTable(t, language)} label={x.t('Gemiddeld rendement en schommeling per fonds', 'Average return and volatility per fund')} text={[1]} />
        <Note>{x.t(
          `Gebaseerd op ${t.inputs.weeks} weekrendementen van ${t.inputs.window.start} tot ${t.inputs.window.end}. De voorbeelden in de cursus gebruiken maandrendementen; weken geven meer waarnemingen met dezelfde methode.`,
          `Based on ${t.inputs.weeks} weekly returns from ${t.inputs.window.start} to ${t.inputs.window.end}. The course’s examples use monthly returns; weekly gives more observations with the same method.`,
        )}</Note>
      </Step>

      <Step n={2} copy={copy.correlation} example={exampleCorrelation(t, language)} language={language}>
        <div className="table-scroll" role="region" aria-label={x.t('Correlatie tussen de fondsen', 'Correlation between the funds')} tabIndex={0}>
          <table className="table corr">
            <thead>
              <tr><th scope="col" />{corr.head.map((h) => <th key={h} scope="col" className="num">{h}</th>)}</tr>
            </thead>
            <tbody>
              {corr.rows.map((r) => (
                <tr key={r.label}>
                  <th scope="row">{r.label}</th>
                  {r.cells.map((v, k) => <td key={k} className="num" style={{ background: corrShade(v) }}>{x.num(v)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Step>

      <Step n={3} copy={copy.expected} example={exampleExpected(t, language)} language={language}>
        <DataTable table={expectedTable(t, language)} label={x.t('Beta en verwacht rendement per fonds', 'Beta and expected return per fund')} highlight={usedColumn(t)} usedMarker={usedMarker} />
        {capm && <SmlChart t={t} language={language} />}
        <Note>{x.t(
          `Rente zonder risico ${x.pct(t.inputs.rf)} (de meest recente korte rente, niet het eigen rendement van het geldmarktfonds in het verleden), marktpremie ${x.pct(t.inputs.premium)}, markt: ${t.inputs.market.name}. Betas komen uit weekrendementen boven de rente zonder risico; de voorbeelden in de cursus gebruiken maandrendementen.`,
          `Risk-free rate ${x.pct(t.inputs.rf)} (the latest short-term rate, not the risk-free fund’s own past return), market premium ${x.pct(t.inputs.premium)}, market: ${t.inputs.market.name}. Betas come from weekly returns in excess of the risk-free rate; the course’s examples use monthly.`,
        )}</Note>
        {!capm && <Note>{x.t(
          'Vijf jaar aan gemiddelden is ruisig. Let op hoe de beste risicovolle mix hieronder zich concentreert in wat recent het best deed.',
          'Five years of averages are noisy. Watch how the best risky mix below concentrates in whatever did best recently.',
        )}</Note>}
      </Step>

      <Step n={4} copy={copy.frontier} example={exampleFrontier(t, language)} language={language}>
        <RiskReturnChart t={t} layer="frontier" title={x.t('De zeven fondsen en hun beste mixen', 'The seven funds and their best mixes')} language={language} />
      </Step>

      <Step n={5} copy={copy.tangent} example={exampleTangent(t, language)} language={language}>
        <RiskReturnChart t={t} layer="tangent" title={x.t('De lijn van het veilige fonds naar de beste risicovolle mix', 'The line from the safe fund to the best risky mix')} language={language} />
        {t.tangent && <DataTable table={tangentTable(t, language)} label={x.t('Gewichten van de beste risicovolle mix', 'Weights of the best risky mix')} />}
      </Step>

      <Step n={6} copy={copy.split} example={exampleSplit(t, language)} language={language}>
        <div className="tb-stats">
          <Stat label={x.t('Hoe voorzichtig je bent (A)', 'How cautious you are (A)')} value={x.num(t.split.risk_aversion, 1)} hint={x.t('10 is heel voorzichtig, 2 is heel gedurfd', '10 is very cautious, 2 is very bold')} />
          <Stat label={x.t('Aandeel uit de formule', 'Share from the formula')} value={x.pct(t.split.risky_share_uncapped, 0)} />
          <Stat label={x.t('Gebruikt aandeel', 'Share used')} value={x.pct(t.split.risky_share, 0)} hint={x.t('tussen 0% en 100%', 'between 0% and 100%')} />
        </div>
        <RiskReturnChart t={t} layer="split" title={x.t('Jouw plan op de lijn', 'Your plan on the line')} language={language} />
        <Note>{x.t(
          'De schaal voor A (10 voor de voorzichtigste belegger, 2 voor de gedurfdste) is een aanname van deze tool; de dia’s geven geen getallen.',
          'The scale for A (10 for the most cautious investor, 2 for the most adventurous) is this tool’s assumption; the slides give no numbers.',
        )}</Note>
        <Note>{x.t(
          'Wat zonder risico is, hangt af van de horizon. Over één periode is het een schatkistbewijs (T-bill); voor een doel over tien jaar komt een tienjarige staatsobligatie die je tot het einde aanhoudt dichterbij. Dit model kijkt naar één periode.',
          'What counts as risk-free depends on the horizon. Over a single period it is a T-bill; for a ten-year goal a ten-year government bond held to maturity is closer. This model takes the one-period view.',
        )}</Note>
      </Step>

      <Step n={7} copy={copy.portfolio} example={examplePortfolio(t, language)} language={language}>
        <div className="tb-stats">
          <Stat label={x.t('Waarschijnlijke groei per jaar', 'Likely yearly growth')} value={x.pct(t.portfolio.expected_return)} />
          <Stat label={x.t('Typische schommeling', 'Typical ups and downs')} value={x.pct(t.portfolio.volatility)} />
          <Stat label={x.t('Beloning voor het risico', 'Reward for the risk')} value={x.num(t.portfolio.sharpe)} />
        </div>
        {language === 'en' ? <AssetMixDonut slices={weightSlices(t)} /> : <MixDonut slices={weightSlices(t, language)} fmt={x} />}
        <DataTable table={weightsTable(t, language)} label={x.t('Gewichten van jouw plan uit het leerboek', 'Weights of your textbook plan')} text={[1]} />
        <Note>{x.t(
          `Het geldmarktfonds (${t.risk_free_fund.name}) schommelde ${x.pct(t.risk_free_fund.volatility, 2)} over de periode; het model telt dat als nul.`,
          `The risk-free fund (${t.risk_free_fund.name}) had a volatility of ${x.pct(t.risk_free_fund.volatility, 2)} over the window; the model treats it as zero.`,
        )}</Note>
      </Step>
    </div>
  );
}

export default function Textbook() {
  const [{ profile }] = useStore();
  const [risk, setRisk] = useState(profile.risk_level);
  const [model, setModel] = useState<ReturnModel>('capm');
  const [premium, setPremium] = useState('5');
  const body = textbookRequest(profile.base_currency, risk, model, premium.trim() === '' ? Number.NaN : Number(premium));
  const key = useDebounced(JSON.stringify(body), 300);
  const { state, reload } = useRequest(
    (signal) => api.POST('/api/textbook', { body: JSON.parse(key) as typeof body, signal }),
    key,
  );
  const last = useLastData(state, key);

  return (
    <>
      <PageHeader
        title="How it works"
        lead="The method behind your plan, in seven short steps. Each step has a plain explanation, an example with real numbers, and the formula for anyone who wants it."
      />
      <div className="stack">
        <section className="card tb-controls" aria-labelledby="tb-h">
          <h2 id="tb-h" style={{ fontSize: '1.4rem', margin: 0 }}>Try it yourself</h2>
          <p className="muted" style={{ margin: 0 }}>Change anything below and every step updates. This textbook version uses seven fixed funds and ignores your preferences.</p>

          <fieldset className="tb-group">
            <legend>How much risk?</legend>
            <div className="tb-risk">
              <span className="key-badge">Key {riskKey(risk)}</span>
              <strong>{riskLabel(risk)}</strong>
              <span className="muted">score {Math.round(risk)} of 100</span>
            </div>
            <input
              type="range" min={0} max={100} step={1} value={risk}
              aria-label="Risk level, calmer on the left, bolder on the right"
              onChange={(e) => setRisk(Number(e.target.value))}
            />
            <div className="risk-scale" aria-hidden="true"><span>Calmer</span><span>Bolder</span></div>
          </fieldset>

          <fieldset className="tb-group">
            <legend>How do we guess what funds will earn?</legend>
            <div className="tb-modes" role="radiogroup" aria-label="Expected returns">
              <label className={`tb-mode ${model === 'capm' ? 'is-selected' : ''}`}>
                <input type="radio" name="model" checked={model === 'capm'} onChange={() => setModel('capm')} />
                <span className="tb-mode-title">A market rule (<Term id="capm">CAPM</Term>)</span>
                <span className="tb-mode-note">The more a fund follows the market, the more it should earn. Steady and sensible.</span>
              </label>
              <label className={`tb-mode ${model === 'historical' ? 'is-selected' : ''}`}>
                <input type="radio" name="model" checked={model === 'historical'} onChange={() => setModel('historical')} />
                <span className="tb-mode-title">Past averages</span>
                <span className="tb-mode-note">Assume the last five years repeat. Simple, but it swings a lot.</span>
              </label>
            </div>
          </fieldset>

          {model === 'capm' && (
            <fieldset className="tb-group">
              <legend><Term id="market-premium">Extra growth shares earn over cash</Term> (% a year)</legend>
              <div className="tb-premium">
                {PREMIUMS.map((p) => (
                  <button key={p} type="button" className={`tb-chip ${premium === p ? 'is-selected' : ''}`} aria-pressed={premium === p} onClick={() => setPremium(p)}>{p}%</button>
                ))}
                <input type="number" min={0} max={15} step={0.5} value={premium} aria-label="Market premium in percent" onChange={(e) => setPremium(e.target.value)} />
              </div>
              <span className="small muted">Between 0 and 15. The slides give 5 to 7% looking back and 3 to 5% in practice.</span>
            </fieldset>
          )}
        </section>

        <ChapterNav chapters={CHAPTERS} />
        <Note>Figures are rounded. Recomputing a worked example from the rounded figures can differ in the last digit. Slide numbers are positions in the deck; the number printed on a slide is one lower.</Note>
        {state.status === 'error' && <ErrorBox message={state.message} onRetry={reload} />}
        {last
          ? <div className={state.status !== 'ok' ? 'textbook-stale' : undefined}><Steps t={last.data} /></div>
          : state.status === 'loading' && <Loading />}
      </div>
    </>
  );
}

import { useId } from 'react';
import type { Schemas } from '../api/client';
import { ASSET_COLORS, type Order } from './recipe';
import { tastePosition } from './serving';
import { useCafeLanguage } from './language';

export type CafeResult = {
  rec: Schemas['Recommendation'];
  source: 'live' | 'synthetic' | 'fixed';
  horizon: number;
};

function FutureChart({ fan, amount }: { fan: Schemas['FanPoint'][]; amount: number | null }) {
  const { t, years, locale, eur } = useCafeLanguage();
  const titleId = useId(), descriptionId = useId();
  if (fan.length < 2 || fan.some(p => [p.year, p.p5, p.p50, p.p95].some(v => !Number.isFinite(v)))) {
    return <p>{t('Voor dit recept is geen bruikbare toekomstgrafiek beschikbaar.', 'No usable future chart is available for this recipe.')}</p>;
  }
  const width = 720, height = 265, left = 72, right = 24, top = 20, bottom = 40;
  const end = Math.max(1, ...fan.map(p => p.year));
  const max = Math.max(1, ...fan.map(p => p.p95)) * 1.08;
  const x = (year: number) => left + year / end * (width - left - right);
  const y = (value: number) => height - bottom - value / max * (height - top - bottom);
  const points = (key: 'p5' | 'p50' | 'p95', reverse = false) => (reverse ? [...fan].reverse() : fan).map(p => `${x(p.year)},${y(p[key])}`).join(' ');
  const format = (factor: number) => amount ? eur(amount * factor) : `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(factor)}×`;
  const axisFormat = (factor: number) => amount ? new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR', notation: 'compact', maximumFractionDigits: 1 }).format(amount * factor) : format(factor);
  const endpoint = fan[fan.length - 1];
  return <>
    <svg className="cafe-fan" viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={`${titleId} ${descriptionId}`}>
      <title id={titleId}>{t('Mogelijke ontwikkeling over', 'Possible development over')} {years(end)}</title>
      <desc id={descriptionId}>{t('De lijn is de mediaan. De band bevat de middelste 90% van de gesimuleerde uitkomsten. Na', 'The line is the median. The band contains the central 90% of simulated outcomes. After')} {years(end)}: {t('5e percentiel', '5th percentile')} {format(endpoint.p5)}, {t('mediaan', 'median')} {format(endpoint.p50)}, {t('95e percentiel', '95th percentile')} {format(endpoint.p95)}. {t('Uitkomsten buiten de band zijn mogelijk.', 'Outcomes outside the band are possible.')}</desc>
      {[0, 1, 2, 3, 4].map(i => { const value = max * i / 4; return <g key={i}>
        <line x1={left} x2={width - right} y1={y(value)} y2={y(value)} stroke="#d4c6ab" strokeDasharray="3 5" />
        <text x={left - 10} y={y(value) + 4} textAnchor="end">{axisFormat(value)}</text>
      </g>; })}
      <polygon points={`${points('p95')} ${points('p5', true)}`} fill="#87966b" opacity=".25" />
      <line x1={left} x2={width - right} y1={y(1)} y2={y(1)} stroke="#a17a56" strokeDasharray="5 4" />
      <polyline points={points('p50')} fill="none" stroke="#496143" strokeWidth="3" strokeLinejoin="round" />
      {[0, Math.round(end / 2), end].filter((v, i, a) => a.indexOf(v) === i).map(year => <text key={year} x={x(year)} y={height - 12} textAnchor="middle">{year === 0 ? t('Nu', 'Now') : years(year)}</text>)}
    </svg>
    <div className="cafe-chart-legend"><span><i className="median" /> {t('Mediaan', 'Median')}</span><span><i className="band" /> {t('Middelste 90% van scenario’s', 'Central 90% of scenarios')}</span><span><i className="start" /> {t('Startinleg', 'Initial investment')}</span></div>
    <details className="cafe-details"><summary>{t('Bekijk de grafiekwaarden', 'View the chart values')}</summary><div className="cafe-table-scroll"><table>
      <thead><tr><th>{t('Jaar', 'Year')}</th><th>{t('5e percentiel', '5th percentile')}</th><th>{t('Mediaan', 'Median')}</th><th>{t('95e percentiel', '95th percentile')}</th></tr></thead>
      <tbody>{fan.map(p => <tr key={p.year}><th>{p.year}</th><td>{format(p.p5)}</td><td>{format(p.p50)}</td><td>{format(p.p95)}</td></tr>)}</tbody>
    </table></div></details>
  </>;
}

export function Results({ result, order, amount, edit }: { result: CafeResult; order: Order; amount: number | null; edit: () => void }) {
  const { t, years, locale, eur, pct, assetName } = useCafeLanguage();
  const { rec, source, horizon } = result;
  const last = rec.downside.fan[rec.downside.fan.length - 1];
  const display = (factor: number) => amount ? eur(factor * amount) : `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(factor)}×`;
  const mix = Object.entries(rec.summary.mix).filter(([, weight]) => weight > 0.0001);
  const base = source === 'fixed' ? 'coffee' : order.base ?? 'matcha';
  const groups = [...new Set(rec.holdings.map(h => h.asset_class))];
  const attention = rec.summary.volatility > rec.summary.target_volatility + .000001
    ? t('Dit recept schommelt naar schatting meer dan beoogd. Bekijk de uitleg.', 'This recipe is estimated to fluctuate more than intended. See the explanation.')
    : rec.warnings.some(w => w.startsWith('target volatility'))
      ? t('Dit recept valt milder uit dan beoogd. Bekijk de uitleg.', 'This recipe is milder than intended. See the explanation.')
      : t('Dit voorbeeld heeft aandachtspunten. Bekijk de uitleg.', 'This example has points to consider. See the explanation.');
  return <section className="cafe-result" id="cafe-choices" tabIndex={-1} aria-labelledby="cafe-result-title">
    <h2 id="cafe-result-title" className="cafe-sr">{t('Dit is jouw beleggingsrecept.', 'This is your investment recipe.')}</h2>
    <figure className="cafe-served-drink"><div className="cafe-steam" aria-hidden="true"><i /><i /><i /></div><img src={`/cafe/drink-${base}.png`} alt={t(`Geserveerde ${base === 'matcha' ? 'matcha' : 'koffie'} in een gespikkeld keramieken kopje. Een sfeerillustratie, geen weergave van fondsgewichten.`, `Served ${base === 'matcha' ? 'matcha' : 'coffee'} in a speckled ceramic cup. A mood illustration, not a representation of fund weights.`)} /><figcaption><span>{source === 'fixed' ? t('Een voorbeeldrecept', 'An example recipe') : base === 'matcha' ? t('Jouw matcha', 'Your matcha') : t('Jouw koffie', 'Your coffee')}</span><span className="cafe-serving-time"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 6v6l4 2" /></svg><span>{years(horizon)}</span></span></figcaption></figure>
    <div className="cafe-served-receipt">
      <p className="cafe-receipt-title">{t('JE RECEPT OP DE BON', 'YOUR RECIPE RECEIPT')}</p>
      {source !== 'live' && <p className="cafe-source-note" role="note">{source === 'synthetic' ? t('Demorecept · fictieve marktprijzen', 'Demo recipe · fictional market prices') : t('Vast demoresultaat · niet berekend voor jouw keuzes', 'Fixed demo result · not calculated for your choices')}</p>}
      <div className="cafe-receipt-funds" aria-label={t('Geselecteerde fondsen', 'Selected funds')}>
        {groups.map(group => <div className="cafe-fund-group" key={group}>
          <h3>{group === 'equity' ? t('Aandelenfondsen', 'Equity funds') : group === 'bond' ? t('Obligatiefondsen', 'Bond funds') : assetName(group)}</h3>
          <ul>{rec.holdings.filter(h => h.asset_class === group).map(h => <li key={h.isin}><span>{h.name}</span><strong>{pct(h.weight)}</strong></li>)}</ul>
        </div>)}
      </div>
      <div className="cafe-flavour" role="img" aria-label={t(`Zoet–bitterwijzer: ${pct(rec.summary.volatility)} geschatte schommelingen per jaar, op een visuele schaal van 2 tot 20 procent. Geen verliesgrens.`, `Sweet–bitter gauge: ${pct(rec.summary.volatility)} estimated annual fluctuations, on a visual scale from 2 to 20 percent. Not a loss limit.`)}>
        <div className="cafe-flavour-labels" aria-hidden="true"><span>{t('Zoet · milder', 'Sweet · milder')}</span><span>{t('Bitter · sterker', 'Bitter · stronger')}</span></div>
        <div className="cafe-flavour-track" aria-hidden="true"><i style={{ left: `${tastePosition(rec.summary.volatility) * 100}%` }} /></div>
      </div>
      <dl className="cafe-tasting-numbers">
        <div><dt>{t('Verwacht rendement / jaar', 'Expected return / year')}</dt><dd>{pct(rec.summary.expected_return)}</dd></div>
        <div><dt>{t('Schommelingen / jaar', 'Fluctuations / year')}</dt><dd>{pct(rec.summary.volatility)}</dd></div>
        <div className="cafe-tasting-loss"><dt>{t('Kans op minder dan je startinleg na', 'Chance of ending below your initial investment after')} {years(horizon)}</dt><dd>{pct(rec.downside.p_below_invested)}</dd></div>
      </dl>
      <p className="cafe-tasting-note">{t('Modelschattingen, geen belofte. Schommelingen zijn geen verliesgrens. Rendement vóór fondskosten, belasting en inflatie.', 'Model estimates, not promises. Fluctuations are not a loss limit. Returns before fund costs, tax and inflation.')}</p>
      {rec.warnings.length > 0 && <p className="cafe-warning cafe-warning-compact" role="note">{attention}</p>}
      <details className="cafe-calculation">
        <summary>{t('Bekijk de berekening en scenario’s', 'View the calculation and scenarios')}</summary>
        <div className="cafe-calculation-body">
        <h3>{t('De berekening achter je recept', 'The calculation behind your recipe')}</h3>
        {source !== 'live' && <p className="cafe-source-note">{source === 'synthetic' ? t('Echt berekend voor je keuzes, met fictieve marktprijzen en illustratieve ESG-labels. Geen actuele fondsen of marktrendementen.', 'Calculated for your choices using fictional market prices and illustrative ESG labels. Not actual funds or market returns.') : t('Vast voorbeeld: risiconiveau 50, 10 jaar, brede fondsselectie. Je keuzes zijn niet doorgerekend.', 'Fixed example: risk level 50, 10 years, broad fund selection. Your choices have not been used in the calculation.')}</p>}
        {rec.warnings.length > 0 && <aside className="cafe-warning" aria-label={t('Waarschuwingen bij de berekening', 'Calculation warnings')}><strong>{t('Aandachtspunten', 'Points to consider')}</strong><ul>{rec.warnings.map(w => <li key={w} lang="en">{w}</li>)}</ul></aside>}
        <ul className="cafe-mix">{mix.map(([key, weight]) => <li key={key}><span><i style={{ background: ASSET_COLORS[key] ?? '#8a7b66' }} />{assetName(key)}</span><strong>{pct(weight)}</strong></li>)}</ul>
        <div className="cafe-result-receipt">
        <p className="cafe-receipt-title">{t('HET BELEGGINGSRECEPT', 'THE INVESTMENT RECIPE')}</p><p className="cafe-small">{source === 'fixed' ? t('Brede selectie', 'Broad selection') : order.base === 'matcha' ? t('Alleen ESG-gemarkeerde fondsen', 'ESG-labelled funds only') : t('Brede selectie', 'Broad selection')} · {years(horizon)} · EUR</p>
        <dl className="cafe-metrics">
          <div><dt>{t('Modelrendement / jaar', 'Model return / year')}</dt><dd>{pct(rec.summary.expected_return)}</dd></div>
          <div><dt>{t('Geschatte schommelingen / jaar', 'Estimated fluctuations / year')}</dt><dd>{pct(rec.summary.volatility)}</dd></div>
          <div><dt>{t('Doel voor schommelingen', 'Target fluctuations')}</dt><dd>{pct(rec.summary.target_volatility)}</dd></div>
          <div><dt>{t('Jaarlijkse fondskosten', 'Annual fund costs')}</dt><dd>{pct(rec.summary.weighted_ter, 2)}</dd></div>
          <div><dt>{t('Kosten bij', 'Costs for')} {eur(amount ?? 10_000)}</dt><dd>{eur((amount ?? 10_000) * rec.summary.weighted_ter)} / {t('jaar', 'year')}</dd></div>
          <div className="cafe-loss-metric"><dt>{t('Modelkans op minder dan de startinleg na', 'Model probability of ending below the initial investment after')} {years(horizon)}</dt><dd>{pct(rec.downside.p_below_invested)}</dd></div>
        </dl>
        <p className="cafe-small">{t('Een vereenvoudigd voorbeeld op basis van voorkeuren. Geen volledige beoordeling van draagkracht of geschiktheid. Ook een zacht recept kan verlies geven.', 'A simplified example based on preferences. Not a full assessment of financial capacity or suitability. Even a mild recipe can lose money.')}</p>
      </div>
    <div className="cafe-placemat">
      <p className="cafe-eyebrow">{t('Een blik vooruit', 'A look ahead')}</p><h3>{t('Er is niet één mogelijke toekomst.', 'There is more than one possible future.')}</h3>
      <p>{t('Dit zijn modelscenario’s over', 'These are model scenarios over')} {years(horizon)}{amount ? t(` bij een eenmalige startinleg van ${eur(amount)}`, ` with a one-off initial investment of ${eur(amount)}`) : t(', uitgedrukt als groeifactor van de startinleg', ', expressed as a growth multiple of the initial investment')}. {t('Geen maandelijkse inleg.', 'No monthly contributions.')}</p>
      {last && <dl className="cafe-outcomes"><div><dt>{t('5e percentiel', '5th percentile')}</dt><dd>{display(last.p5)}</dd></div><div><dt>{t('Mediaan', 'Median')}</dt><dd>{display(last.p50)}</dd></div><div><dt>{t('95e percentiel', '95th percentile')}</dt><dd>{display(last.p95)}</dd></div></dl>}
      <FutureChart fan={rec.downside.fan} amount={amount} />
      <p className="cafe-small">{t('De band bevat 90% van de gesimuleerde uitkomsten, niet alle mogelijke uitkomsten. De mediaan is geen beloofd eindbedrag. Fondskosten zijn niet expliciet van dit modelrendement afgetrokken; belasting en inflatie zijn niet verwerkt.', 'The band contains 90% of simulated outcomes, not all possible outcomes. The median is not a promised final amount. Fund costs are not explicitly deducted from this model return; tax and inflation are not included.')}</p>
      <details className="cafe-details"><summary>{t('En als het bitter wordt?', 'And if it turns bitter?')}</summary>
        <p>{t('Modelkans op een daling vanaf een eerdere piek gedurende de hele looptijd:', 'Model probability of a decline from an earlier peak during the entire time horizon:')}</p><ul>{rec.downside.drawdown_probs.map(p => <li key={p.threshold}>{t('Minstens', 'At least')} {pct(p.threshold, 0)} {t('daling:', 'decline:')} {pct(p.probability)} {t('modelkans.', 'model probability.')}</li>)}</ul>
        <p>{t('Dit is iets anders dan verlies ten opzichte van de startinleg. Je suikerkeuze begrenst mogelijke verliezen niet.', 'This is different from a loss relative to the initial investment. Your sugar choice does not limit possible losses.')}</p>
      </details>
      <details className="cafe-details"><summary>{t('Open het receptboek · fondsen en gewichten', 'Open the recipe book · funds and weights')}</summary><div className="cafe-table-scroll"><table>
        <thead><tr><th>{t('Fonds', 'Fund')}</th><th>{t('Ingrediënt', 'Ingredient')}</th><th>{t('Gewicht', 'Weight')}</th><th>{t('Fondskosten', 'Fund costs')}</th></tr></thead>
        <tbody>{rec.holdings.map(h => <tr key={h.isin}><th>{h.name}<small>{h.isin}</small></th><td>{assetName(h.asset_class)}</td><td>{pct(h.weight)}</td><td>{h.ter === null ? t('Onbekend', 'Unknown') : pct(h.ter, 2)}</td></tr>)}</tbody>
      </table></div></details>
      <details className="cafe-details"><summary>{t('Waarom dit recept?', 'Why this recipe?')}</summary><p>{t('De laagste preset bepaalt het receptniveau. De hoofdengine zoekt daarmee een portefeuille bij een doelvolatiliteit, met de gekozen fondsselectie en bestaande fonds- en kostengrenzen.', 'The lower preset score sets the recipe level. The main engine finds a portfolio for a target volatility, using the chosen fund selection and existing fund and cost constraints.')}</p>
        <p>{t('De zoet–bitterwijzer toont de geschatte jaarlijkse schommelingen op de 2–20%-referentieschaal van de engine. Buiten die schaal blijft de wijzer aan de rand; het percentage op de bon blijft de berekende waarde. Dit is geen volledige risicomaatstaf of maximale verliesgrens.', 'The sweet–bitter gauge shows estimated annual fluctuations on the engine’s 2–20% reference scale. Outside that scale the pointer stays at the edge; the receipt still shows the calculated percentage. This is not a complete risk measure or a maximum loss limit.')}</p>
        <p>{t('Uitgangspunten: EUR, UCITS-filter, valuta-afdekking voor obligaties waar beschikbaar, maximaal 10 fondsen, posities 3–40%, crypto uit, geen regio- of sectorfilter.', 'Assumptions: EUR, UCITS filter, currency hedging for bonds where available, at most 10 funds, positions of 3–40%, no crypto, no region or sector filter.')}</p>
        <ol lang="en">{rec.trace.map((step, i) => <li key={`${step.step}-${i}`}>{step.step}{(step.notes ?? []).length > 0 && <ul>{step.notes?.map(note => <li key={note}>{note}</li>)}</ul>}</li>)}</ol>
      </details>
    </div>
        </div>
      </details>
      <button type="button" className="cafe-button secondary" onClick={edit}>{t('Pas mijn recept aan', 'Adjust my recipe')}</button>
    </div>
  </section>;
}

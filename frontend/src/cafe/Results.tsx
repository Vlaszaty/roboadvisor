import { useId } from 'react';
import type { Schemas } from '../api/client';
import { ASSET_COLORS, ASSET_NAMES, eur, MILK, pct, SUGAR, type Order } from './recipe';

export type CafeResult = {
  rec: Schemas['Recommendation'];
  source: 'live' | 'synthetic' | 'fixed';
  horizon: number;
};

function FutureChart({ fan, amount }: { fan: Schemas['FanPoint'][]; amount: number | null }) {
  const titleId = useId(), descriptionId = useId();
  if (fan.length < 2 || fan.some(p => [p.year, p.p5, p.p50, p.p95].some(v => !Number.isFinite(v)))) {
    return <p>Voor dit recept is geen bruikbare toekomstgrafiek beschikbaar.</p>;
  }
  const width = 720, height = 265, left = 72, right = 24, top = 20, bottom = 40;
  const end = Math.max(1, ...fan.map(p => p.year));
  const max = Math.max(1, ...fan.map(p => p.p95)) * 1.08;
  const x = (year: number) => left + year / end * (width - left - right);
  const y = (value: number) => height - bottom - value / max * (height - top - bottom);
  const points = (key: 'p5' | 'p50' | 'p95', reverse = false) => (reverse ? [...fan].reverse() : fan).map(p => `${x(p.year)},${y(p[key])}`).join(' ');
  const format = (factor: number) => amount ? eur(amount * factor) : `${new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 1 }).format(factor)}×`;
  const axisFormat = (factor: number) => amount ? new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR', notation: 'compact', maximumFractionDigits: 1 }).format(amount * factor) : format(factor);
  const endpoint = fan[fan.length - 1];
  return <>
    <svg className="cafe-fan" viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={`${titleId} ${descriptionId}`}>
      <title id={titleId}>Mogelijke ontwikkeling over {end} jaar</title>
      <desc id={descriptionId}>De lijn is de mediaan. De band bevat de middelste 90% van de gesimuleerde uitkomsten. Na {end} jaar: 5e percentiel {format(endpoint.p5)}, mediaan {format(endpoint.p50)}, 95e percentiel {format(endpoint.p95)}. Uitkomsten buiten de band zijn mogelijk.</desc>
      {[0, 1, 2, 3, 4].map(i => { const value = max * i / 4; return <g key={i}>
        <line x1={left} x2={width - right} y1={y(value)} y2={y(value)} stroke="#d4c6ab" strokeDasharray="3 5" />
        <text x={left - 10} y={y(value) + 4} textAnchor="end">{axisFormat(value)}</text>
      </g>; })}
      <polygon points={`${points('p95')} ${points('p5', true)}`} fill="#87966b" opacity=".25" />
      <line x1={left} x2={width - right} y1={y(1)} y2={y(1)} stroke="#a17a56" strokeDasharray="5 4" />
      <polyline points={points('p50')} fill="none" stroke="#496143" strokeWidth="3" strokeLinejoin="round" />
      {[0, Math.round(end / 2), end].filter((v, i, a) => a.indexOf(v) === i).map(year => <text key={year} x={x(year)} y={height - 12} textAnchor="middle">{year === 0 ? 'Nu' : `${year} jaar`}</text>)}
    </svg>
    <div className="cafe-chart-legend"><span><i className="median" /> Mediaan</span><span><i className="band" /> Middelste 90% van scenario’s</span><span><i className="start" /> Startinleg</span></div>
    <details className="cafe-details"><summary>Bekijk de grafiekwaarden</summary><div className="cafe-table-scroll"><table>
      <thead><tr><th>Jaar</th><th>5e percentiel</th><th>Mediaan</th><th>95e percentiel</th></tr></thead>
      <tbody>{fan.map(p => <tr key={p.year}><th>{p.year}</th><td>{format(p.p5)}</td><td>{format(p.p50)}</td><td>{format(p.p95)}</td></tr>)}</tbody>
    </table></div></details>
  </>;
}

export function Results({ result, order, amount, edit }: { result: CafeResult; order: Order; amount: number | null; edit: () => void }) {
  const { rec, source, horizon } = result;
  const last = rec.downside.fan[rec.downside.fan.length - 1];
  const display = (factor: number) => amount ? eur(factor * amount) : `${new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 2 }).format(factor)}×`;
  const mix = Object.entries(rec.summary.mix).filter(([, weight]) => weight > 0.0001);
  const base = source === 'fixed' ? 'coffee' : order.base ?? 'matcha';
  const attention = rec.summary.volatility > rec.summary.target_volatility + .000001
    ? 'Dit recept schommelt naar schatting meer dan beoogd. Bekijk de uitleg.'
    : rec.warnings.some(w => w.startsWith('target volatility'))
      ? 'Dit recept valt milder uit dan beoogd. Bekijk de uitleg.'
      : 'Dit voorbeeld heeft aandachtspunten. Bekijk de uitleg.';
  return <section className="cafe-result" id="cafe-choices" tabIndex={-1} aria-labelledby="cafe-result-title">
    <h2 id="cafe-result-title" className="cafe-sr">Dit is jouw beleggingsrecept.</h2>
    <figure className="cafe-served-drink"><div className="cafe-steam" aria-hidden="true"><i /><i /><i /></div><img src={`/cafe/drink-${base}.png`} alt={`Geserveerde ${base === 'matcha' ? 'matcha' : 'koffie'} in een gespikkeld keramieken kopje. Een sfeerillustratie, geen weergave van fondsgewichten.`} /><figcaption>{source === 'fixed' ? 'Een voorbeeldrecept' : base === 'matcha' ? 'Jouw matcha' : 'Jouw koffie'}</figcaption></figure>
    <div className="cafe-served-receipt">
      <p className="cafe-receipt-title">MET LIEFDE BEREID</p>
      <h3>{source === 'fixed' ? 'Een vast voorbeeld' : 'Jouw ingrediënten'}</h3>
      <ul className="cafe-taste-ingredients">
        <li><span>De basis</span><strong>{base === 'matcha' ? 'Matcha' : 'Koffie'}</strong></li>
        {source !== 'fixed' && <><li><span>Melk</span><strong>{order.milk === null ? '—' : MILK[order.milk].name}</strong></li><li><span>Suiker</span><strong>{order.sugar === null ? '—' : SUGAR[order.sugar].name}</strong></li></>}
        <li><span>De tijd</span><strong>{horizon} jaar</strong></li>
      </ul>
      <p className="cafe-ingredient-description">Een portefeuille met {mix.map(([key]) => (ASSET_NAMES[key] ?? key).toLowerCase()).join(' en ')}.</p>
      {source !== 'live' && <p className="cafe-source-note" role="note">{source === 'synthetic' ? 'Demorecept · fictieve marktprijzen' : 'Vast demoresultaat · niet berekend voor jouw keuzes'}</p>}
      {rec.warnings.length > 0 && <p className="cafe-warning cafe-warning-compact" role="note">{attention}</p>}
      <details className="cafe-calculation">
        <summary>Bekijk de cijfers en scenario’s</summary>
        <div className="cafe-calculation-body">
        <h3>De berekening achter je recept</h3>
        {source !== 'live' && <p className="cafe-source-note">{source === 'synthetic' ? 'Echt berekend voor je keuzes, met fictieve marktprijzen en illustratieve ESG-labels. Geen actuele fondsen of marktrendementen.' : 'Vast voorbeeld: risiconiveau 50, 10 jaar, brede fondsselectie. Je keuzes zijn niet doorgerekend.'}</p>}
        {rec.warnings.length > 0 && <aside className="cafe-warning" aria-label="Waarschuwingen bij de berekening"><strong>Aandachtspunten</strong><ul>{rec.warnings.map(w => <li key={w}>{w}</li>)}</ul></aside>}
        <ul className="cafe-mix">{mix.map(([key, weight]) => <li key={key}><span><i style={{ background: ASSET_COLORS[key] ?? '#8a7b66' }} />{ASSET_NAMES[key] ?? key}</span><strong>{pct(weight)}</strong></li>)}</ul>
        <div className="cafe-result-receipt">
        <p className="cafe-receipt-title">HET BELEGGINGSRECEPT</p><p className="cafe-small">{source === 'fixed' ? 'Brede selectie' : order.base === 'matcha' ? 'Alleen ESG-gemarkeerde fondsen' : 'Brede selectie'} · {horizon} jaar · EUR</p>
        <dl className="cafe-metrics">
          <div><dt>Modelrendement / jaar</dt><dd>{pct(rec.summary.expected_return)}</dd></div>
          <div><dt>Geschatte schommelingen / jaar</dt><dd>{pct(rec.summary.volatility)}</dd></div>
          <div><dt>Doel voor schommelingen</dt><dd>{pct(rec.summary.target_volatility)}</dd></div>
          <div><dt>Jaarlijkse fondskosten</dt><dd>{pct(rec.summary.weighted_ter, 2)}</dd></div>
          <div><dt>Kosten bij {eur(amount ?? 10_000)}</dt><dd>{eur((amount ?? 10_000) * rec.summary.weighted_ter)} / jaar</dd></div>
          <div className="cafe-loss-metric"><dt>Modelkans op minder dan de startinleg na {horizon} jaar</dt><dd>{pct(rec.downside.p_below_invested)}</dd></div>
        </dl>
        <p className="cafe-small">Een vereenvoudigd voorbeeld op basis van voorkeuren. Geen volledige beoordeling van draagkracht of geschiktheid. Ook een zacht recept kan verlies geven.</p>
      </div>
    <div className="cafe-placemat">
      <p className="cafe-eyebrow">Een blik vooruit</p><h3>Er is niet één mogelijke toekomst.</h3>
      <p>Dit zijn modelscenario’s over {horizon} jaar{amount ? ` bij een eenmalige startinleg van ${eur(amount)}` : ', uitgedrukt als groeifactor van de startinleg'}. Geen maandelijkse inleg.</p>
      {last && <dl className="cafe-outcomes"><div><dt>5e percentiel</dt><dd>{display(last.p5)}</dd></div><div><dt>Mediaan</dt><dd>{display(last.p50)}</dd></div><div><dt>95e percentiel</dt><dd>{display(last.p95)}</dd></div></dl>}
      <FutureChart fan={rec.downside.fan} amount={amount} />
      <p className="cafe-small">De band bevat 90% van de gesimuleerde uitkomsten, niet alle mogelijke uitkomsten. De mediaan is geen beloofd eindbedrag. Fondskosten zijn niet expliciet van dit modelrendement afgetrokken; belasting en inflatie zijn niet verwerkt.</p>
      <details className="cafe-details"><summary>En als het bitter wordt?</summary>
        <p>Modelkans op een daling vanaf een eerdere piek gedurende de hele looptijd:</p><ul>{rec.downside.drawdown_probs.map(p => <li key={p.threshold}>Minstens {pct(p.threshold, 0)} daling: {pct(p.probability)} modelkans.</li>)}</ul>
        <p>Dit is iets anders dan verlies ten opzichte van de startinleg. Je suikerkeuze begrenst mogelijke verliezen niet.</p>
      </details>
      <details className="cafe-details"><summary>Open het receptboek · fondsen en gewichten</summary><div className="cafe-table-scroll"><table>
        <thead><tr><th>Fonds</th><th>Ingrediënt</th><th>Gewicht</th><th>Fondskosten</th></tr></thead>
        <tbody>{rec.holdings.map(h => <tr key={h.isin}><th>{h.name}<small>{h.isin}</small></th><td>{ASSET_NAMES[h.asset_class] ?? h.asset_class}</td><td>{pct(h.weight)}</td><td>{h.ter === null ? 'Onbekend' : pct(h.ter, 2)}</td></tr>)}</tbody>
      </table></div></details>
      <details className="cafe-details"><summary>Waarom dit recept?</summary><p>De laagste preset bepaalt het receptniveau. De hoofdengine zoekt daarmee een portefeuille bij een doelvolatiliteit, met de gekozen fondsselectie en bestaande fonds- en kostengrenzen.</p>
        <p>Uitgangspunten: EUR, UCITS-filter, valuta-afdekking voor obligaties waar beschikbaar, maximaal 10 fondsen, posities 3–40%, crypto uit, geen regio- of sectorfilter.</p>
        <ol>{rec.trace.map((step, i) => <li key={`${step.step}-${i}`}>{step.step}{(step.notes ?? []).length > 0 && <ul>{step.notes?.map(note => <li key={note}>{note}</li>)}</ul>}</li>)}</ol>
      </details>
    </div>
        </div>
      </details>
      <button type="button" className="cafe-button secondary" onClick={edit}>Pas mijn recept aan</button>
    </div>
  </section>;
}

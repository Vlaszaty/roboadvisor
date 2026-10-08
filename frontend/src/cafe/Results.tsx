import { useEffect, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Schemas } from '../api/client';
import { ASSET_COLORS } from './recipe';
import { useCafeLanguage } from './language';

export type CafeResult = {
  rec: Schemas['Recommendation'];
  source: 'live' | 'synthetic' | 'fixed';
  horizon: number;
  profileId: number;
  base: 'coffee' | 'matcha';
  amount: number; // one-off, 0 if none given
  monthly: number;
};
type Point = { year: number; p5: number; p50: number; p95: number; paid: number };
const EXAMPLE = 500;

/** Scenario points in euros: the money fan when the person gave amounts, else growth of a €500 example. */
export function moneyPoints(rec: Schemas['Recommendation'], amount: number, monthly: number): Point[] {
  if ((amount > 0 || monthly > 0) && rec.downside.fan_money?.length) {
    return rec.downside.fan_money.map(p => ({ year: p.year, p5: p.p5, p50: p.p50, p95: p.p95, paid: p.paid_in }));
  }
  return rec.downside.fan.map(p => ({ year: p.year, p5: p.p5 * EXAMPLE, p50: p.p50 * EXAMPLE, p95: p.p95 * EXAMPLE, paid: EXAMPLE }));
}

function FutureChart({ points }: { points: Point[] }) {
  const { t, years, locale, eur } = useCafeLanguage();
  const titleId = useId(), descriptionId = useId();
  const [hover, setHover] = useState<number | null>(null);
  if (points.length < 2 || points.some(p => [p.year, p.p5, p.p50, p.p95].some(v => !Number.isFinite(v)))) {
    return <p>{t('Voor dit recept is geen bruikbare toekomstgrafiek beschikbaar.', 'No usable future chart is available for this recipe.')}</p>;
  }
  const width = 720, height = 265, left = 72, right = 24, top = 20, bottom = 40;
  const end = Math.max(1, ...points.map(p => p.year));
  const max = Math.max(1, ...points.map(p => p.p95)) * 1.08;
  const x = (year: number) => left + year / end * (width - left - right);
  const y = (value: number) => height - bottom - value / max * (height - top - bottom);
  const line = (key: 'p5' | 'p50' | 'p95' | 'paid', reverse = false) => (reverse ? [...points].reverse() : points).map(p => `${x(p.year)},${y(p[key])}`).join(' ');
  const axis = (v: number) => new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR', notation: 'compact', maximumFractionDigits: 1 }).format(v);
  const last = points[points.length - 1];
  /** Pointer (mouse, pen or finger) picks the nearest year; a tap works as well as a drag. */
  const pick = (e: React.PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const year = Math.round(((e.clientX - box.left) / box.width * width - left) / (width - left - right) * end);
    const i = points.findIndex(p => p.year === Math.max(0, Math.min(end, year)));
    if (i >= 0) setHover(i);
  };
  const h = hover === null ? null : points[hover];
  return <>
    <div className="cafe-fan-box">
    <svg className="cafe-fan" viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={`${titleId} ${descriptionId}`} onPointerDown={pick} onPointerMove={pick} onPointerLeave={e => { if (e.pointerType === 'mouse') setHover(null); }}>
      <title id={titleId}>{t('Mogelijke ontwikkeling over', 'Possible development over')} {years(end)}</title>
      <desc id={descriptionId}>{t('De lijn is de mediaan, de band de middelste 90% van de scenario’s. Na', 'The line is the median, the band the central 90% of scenarios. After')} {years(end)}: {eur(last.p5)}, {eur(last.p50)}, {eur(last.p95)}.</desc>
      {[0, 1, 2, 3, 4].map(i => { const v = max * i / 4; return <g key={i}><line x1={left} x2={width - right} y1={y(v)} y2={y(v)} stroke="#d4c6ab" strokeDasharray="3 5" /><text x={left - 10} y={y(v) + 4} textAnchor="end">{axis(v)}</text></g>; })}
      <polygon points={`${line('p95')} ${line('p5', true)}`} fill="#87966b" opacity=".25" />
      <polyline points={line('paid')} fill="none" stroke="#a17a56" strokeDasharray="5 4" strokeWidth="2" />
      <polyline points={line('p50')} fill="none" stroke="#496143" strokeWidth="3" strokeLinejoin="round" />
      {[0, Math.round(end / 2), end].filter((v, i, a) => a.indexOf(v) === i).map(yr => <text key={yr} x={x(yr)} y={height - 12} textAnchor="middle">{yr === 0 ? t('Nu', 'Now') : years(yr)}</text>)}
      {h && <g className="cafe-fan-hover"><line x1={x(h.year)} x2={x(h.year)} y1={top} y2={height - bottom} stroke="#5a5a46" strokeDasharray="3 3" /><circle cx={x(h.year)} cy={y(h.p50)} r="6" fill="#496143" stroke="#fff4dc" strokeWidth="2" /></g>}
    </svg>
    {h && <div className="cafe-fan-tip" style={{ left: `${Math.min(Math.max(x(h.year) / width * 100, 18), 82)}%` }} role="status">
      <strong>{h.year === 0 ? t('Nu', 'Now') : years(h.year)}</strong>
      <span>{t('Goed', 'Good')}: {eur(h.p95)}</span><span className="mid">{t('Midden', 'Middle')}: {eur(h.p50)}</span><span>{t('Slecht', 'Bad')}: {eur(h.p5)}</span><span>{t('Ingelegd', 'Put in')}: {eur(h.paid)}</span>
    </div>}
    </div>
    <div className="cafe-chart-legend"><span><i className="median" /> {t('Mediaan', 'Median')}</span><span><i className="band" /> {t('Middelste 90%', 'Central 90%')}</span><span><i className="start" /> {t('Wat je inlegt', 'What you put in')}</span></div>
  </>;
}

function Sparkline({ growth }: { growth: Schemas['GrowthPoint'][] }) {
  if (growth.length < 2) return null;
  const w = 220, h = 54, vals = growth.map(g => g.value), lo = Math.min(...vals, 1), hi = Math.max(...vals, 1);
  const x = (i: number) => i / (growth.length - 1) * w, y = (v: number) => h - 4 - (v - lo) / (hi - lo || 1) * (h - 8);
  return <svg className="cafe-spark" viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
    <line x1="0" x2={w} y1={y(1)} y2={y(1)} stroke="#a17a56" strokeDasharray="4 4" />
    <polyline points={growth.map((g, i) => `${x(i)},${y(g.value)}`).join(' ')} fill="none" stroke="#496143" strokeWidth="2" />
  </svg>;
}

export function Results({ result, edit }: { result: CafeResult; edit: () => void }) {
  const { t, years, eur, pct, assetName, profiles, drink, locale } = useCafeLanguage();
  const { rec, source, horizon, base, amount, monthly } = result;
  const profile = profiles[result.profileId - 1];
  const [item, setItem] = useState<Schemas['MenuItem'] | null>(null);
  const [menuFailed, setMenuFailed] = useState(false);
  useEffect(() => {
    let live = true;
    api.GET('/api/menu').then(r => {
      if (!live) return;
      const found = r.data?.items.find(i => i.base === base && i.profile_id === result.profileId);
      if (found) setItem(found); else setMenuFailed(true);
    }).catch(() => { if (live) setMenuFailed(true); });
    return () => { live = false; };
  }, [base, result.profileId]);

  const points = moneyPoints(rec, amount, monthly);
  const last = points[points.length - 1];
  const ownMoney = amount > 0 || monthly > 0;
  const money = ownMoney ? eur(last.paid) : eur(EXAMPLE);
  const mix = Object.entries(rec.summary.mix).filter(([, w]) => w > .0001).sort((a, b) => b[1] - a[1]);
  const below = ownMoney && rec.downside.p_below_paid_in != null ? rec.downside.p_below_paid_in : rec.downside.p_below_invested;
  const dip = [...rec.downside.drawdown_probs].sort((a, b) => Math.abs(a.threshold - .3) - Math.abs(b.threshold - .3))[0];
  const regions = rec.holdings.reduce<Record<string, number>>((acc, h) => { const r = h.region ?? 'other'; acc[r] = (acc[r] ?? 0) + h.weight; return acc; }, {});
  const [topRegion, topWeight] = Object.entries(regions).filter(([r]) => r !== 'global').sort((a, b) => b[1] - a[1])[0] ?? ['', 0];
  const regionName = (r: string) => ({ us: t('VS', 'US'), eurozone: t('eurozone', 'eurozone'), europe: t('Europa', 'Europe'), em: t('opkomende markten', 'emerging markets'), global: t('wereld', 'world') } as Record<string, string>)[r] ?? r;
  const varOf = (level: number, method: string) => rec.downside.var_monthly?.find(v => v.level === level && v.method === method)?.loss;
  const compact = (v: number) => new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR', notation: 'compact', maximumFractionDigits: 1 }).format(v);
  const in100 = (p: number) => t(`${Math.round(p * 100)} op 100`, `${Math.round(p * 100)} in 100`);
  const yearlyCost = (amount || EXAMPLE) * rec.summary.weighted_ter;

  return <section className="cafe-result" id="cafe-choices" tabIndex={-1} aria-labelledby="cafe-result-title">
    <h2 id="cafe-result-title" className="cafe-sr">{t('Dit is jouw beleggingsrecept.', 'This is your investment recipe.')}</h2>
    <figure className="cafe-served-drink"><div className="cafe-steam" aria-hidden="true"><i /><i /><i /></div><img src={`/cafe/drink-${base}.png`} alt={t('Geserveerd kopje. Een sfeerillustratie, geen weergave van je fondsen.', 'Served cup. A mood illustration, not a picture of your funds.')} /><figcaption><span>{drink(base)} · {profile.name}</span><span className="cafe-serving-time"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 6v6l4 2" /></svg><span>{years(horizon)}</span></span></figcaption></figure>
    <div className="cafe-served-receipt">
      <header className="cafe-receipt-head">
      <p className="cafe-receipt-title">{t('JE RECEPT OP DE BON', 'YOUR RECIPE RECEIPT')}</p>
      <p className="cafe-receipt-sub">{drink(base)} · {t('sterkte', 'strength')} {profile.id}/7 {profile.name} · {profile.plain} · {years(horizon)}</p>
      </header>
      {source !== 'live' && <p className="cafe-source-note" role="note">{source === 'synthetic' ? t('Demorecept · fictieve marktprijzen en ESG-labels', 'Demo recipe · fictional market prices and ESG labels') : t('Vast demoresultaat · niet berekend voor jouw keuzes', 'Fixed demo result · not calculated for your choices')}</p>}

      <section className="cafe-outlook">
        <h3>{ownMoney ? t(`Wat je inleg van ${money} kan worden in ${years(horizon)}`, `What your ${money} could become in ${years(horizon)}`) : t(`Wat ${money} kan worden in ${years(horizon)}`, `What ${money} could become in ${years(horizon)}`)}</h3>
        <dl className="cafe-cases">
          <div className="middle"><dt>{t('Middelste geval', 'Middle case')}</dt><dd>{eur(last.p50)}</dd><dd className="cafe-case-note">{t('Helft eindigt hoger, helft lager', 'Half end higher, half lower')}</dd></div>
          <div><dt>{t('Slecht geval', 'Bad case')}</dt><dd className="bad">{eur(last.p5)}</dd><dd className="cafe-case-note">{t('1 op 20 eindigt lager', '1 in 20 end lower')}</dd></div>
          <div><dt>{t('Goed geval', 'Good case')}</dt><dd>{eur(last.p95)}</dd><dd className="cafe-case-note">{t('1 op 20 eindigt hoger', '1 in 20 end higher')}</dd></div>
        </dl>
        <p className="cafe-small">{t('Kans dat je eindigt onder wat je inlegt:', 'Chance of ending below what you put in:')} <strong>{in100(below)}</strong>{monthly > 0 && <> · {t(`inclusief ${eur(monthly)} per maand`, `including ${eur(monthly)} a month`)}</>}</p>
      </section>

      {dip && <div className="cafe-dip" role="note"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2 20h20L12 3Z" /><path d="M12 10v4M12 17h.01" /></svg><p><strong>{t('Reken op een flinke dip onderweg.', 'Expect a big dip on the way.')}</strong> {t(`In ${in100(dip.probability)} modelpaden daalt de waarde ergens in ${years(horizon)} ${pct(dip.threshold, 0)} of meer vanaf een eerdere top. Voelt dat nog goed?`, `In ${in100(dip.probability)} model paths the value falls ${pct(dip.threshold, 0)} or more from an earlier high at some point in ${years(horizon)}. Does that still feel right?`)}</p></div>}

      <section>
        <h3 className="cafe-receipt-h">{t('Wat zit er in je kopje', 'What is in your cup')}</h3>
        <div className="cafe-mixbar" aria-hidden="true">{mix.map(([k, w]) => <i key={k} style={{ width: `${w * 100}%`, background: ASSET_COLORS[k] ?? '#8a7b66' }} />)}</div>
        <p className="cafe-small">{mix.map(([k, w]) => `${assetName(k)} ${pct(w, 0)}`).join(' · ')}</p>
        <ul className="cafe-fund-list">{rec.holdings.map(h => <li key={h.isin}>
          <span className="cafe-fund-name">{h.name}<small>{[regionName(h.region ?? ''), h.fund_size_eur ? t(`fonds ${compact(h.fund_size_eur)}`, `fund ${compact(h.fund_size_eur)}`) : null, h.daily_value_eur ? t(`${compact(h.daily_value_eur)} per dag verhandeld`, `${compact(h.daily_value_eur)} traded a day`) : null].filter(Boolean).join(' · ')}</small></span>
          <strong>{pct(h.weight)}</strong>
        </li>)}</ul>
        {topWeight >= .5 && <p className="cafe-small">{t(`Let op: ${pct(topWeight, 0)} zit in fondsen voor alleen ${regionName(topRegion)}. Dat is minder gespreid dan één wereldfonds.`, `Note: ${pct(topWeight, 0)} sits in ${regionName(topRegion)}-only funds. That is less spread than one world fund.`)}</p>}
      </section>

      <dl className="cafe-numbers">
        <div><dt>{t('Modelrendement', 'Model return')}</dt><dd>{pct(rec.summary.expected_return)} / {t('jaar', 'year')}</dd><dd className="cafe-case-note">{t('vóór kosten, belasting, inflatie', 'before costs, tax, inflation')}</dd></div>
        <div><dt>{t('Gewone schommeling', 'Typical swing')}</dt><dd>{pct(rec.summary.volatility)} / {t('jaar', 'year')}</dd><dd className="cafe-case-note">{t('geen verliesgrens', 'not a loss limit')}</dd></div>
        <div><dt>{t('Fondskosten', 'Fund costs')}</dt><dd>{eur(yearlyCost)} / {t('jaar', 'year')}</dd><dd className="cafe-case-note">{pct(rec.summary.weighted_ter, 2)} {t('van', 'of')} {eur(amount || EXAMPLE)}</dd></div>
      </dl>

      {varOf(.95, 'historical') !== undefined && <section className="cafe-var">
        <h3 className="cafe-receipt-h">{t('Slechte maanden (Value at Risk)', 'Bad months (Value at Risk)')}</h3>
        <table><thead><tr><th scope="col">{t('Hoe vaak', 'How often')}</th><th scope="col">{t('Uit het verleden', 'From history')}</th><th scope="col">{t('Normale verdeling', 'Normal curve')}</th></tr></thead><tbody>
          {[.95, .99].map(level => <tr key={level}><th scope="row">{level === .95 ? t('1 op 20 maanden', '1 in 20 months') : t('1 op 100 maanden', '1 in 100 months')}</th><td>{pct(varOf(level, 'historical') ?? 0)}</td><td>{pct(varOf(level, 'normal') ?? 0)}</td></tr>)}
        </tbody></table>
        <p className="cafe-small">{t(`Verlies in één maand dat zo vaak of erger voorkwam, over ${rec.downside.var_months} maanden historie (95% en 99% VaR). Op ${eur(amount || EXAMPLE)} is 1 op 20 maanden ${eur(Math.abs((varOf(.95, 'historical') ?? 0) * (amount || EXAMPLE)))} of meer.`, `A one-month loss this bad or worse, over ${rec.downside.var_months} months of history (95% and 99% VaR). On ${eur(amount || EXAMPLE)}, 1 in 20 months loses ${eur(Math.abs((varOf(.95, 'historical') ?? 0) * (amount || EXAMPLE)))} or more.`)}</p>
      </section>}

      <section className="cafe-past">
        <h3 className="cafe-receipt-h">{t('Hoe dit recept het deed', 'How this recipe did')}</h3>
        {item ? <>
          <div className="cafe-past-row">{item.performance.map(p => <dl key={p.years}><dt>{t(`Laatste ${p.years} jaar`, `Last ${p.years} years`)}</dt><dd>{pct(p.annual_return)} / {t('jaar', 'year')}</dd><dd className="cafe-case-note">{t('diepste daling', 'deepest fall')} {pct(p.max_drawdown)}</dd></dl>)}<Sparkline growth={item.growth} /></div>
          <p className="cafe-small">{t('Walk-forward: elk kwartaal opnieuw berekend met alleen de gegevens van dat moment, dus zonder voorkennis. Na fondskosten (die zitten in de koers), vóór belasting en inflatie. Het verleden is geen belofte.', 'Walk-forward: re-estimated every quarter with only the data known at that time, so no hindsight. After fund costs (they are in the price), before tax and inflation. The past is no promise.')}</p>
        </> : <p className="cafe-small">{menuFailed ? t('De menukaart is nu niet beschikbaar.', 'The menu is not available right now.') : t('De menukaart wordt geladen…', 'Loading the menu…')}</p>}
      </section>

      <details className="cafe-calculation">
        <summary>{t('Bekijk de berekening en scenario’s', 'View the calculation and scenarios')}</summary>
        <div className="cafe-calculation-body">
          <FutureChart points={points} />
          <h4>{t('Kans op een daling vanaf een eerdere top', 'Chance of a fall from an earlier high')}</h4>
          <ul>{rec.downside.drawdown_probs.map(p => <li key={p.threshold}>{pct(p.threshold, 0)} {t('of meer:', 'or more:')} {in100(p.probability)}</li>)}</ul>
          <div className="cafe-table-scroll"><table>
            <thead><tr><th>{t('Fonds', 'Fund')}</th><th>{t('Soort', 'Type')}</th><th>{t('Gewicht', 'Weight')}</th><th>{t('Kosten', 'Costs')}</th><th>{t('Fondsgrootte', 'Fund size')}</th><th>{t('Per dag verhandeld', 'Traded a day')}</th></tr></thead>
            <tbody>{rec.holdings.map(h => <tr key={h.isin}><th>{h.name}<small>{h.isin}</small></th><td>{assetName(h.asset_class)}</td><td>{pct(h.weight)}</td><td>{h.ter == null ? t('Onbekend', 'Unknown') : pct(h.ter, 2)}</td><td>{h.fund_size_eur ? compact(h.fund_size_eur) : t('Onbekend', 'Unknown')}</td><td>{h.daily_value_eur ? compact(h.daily_value_eur) : t('Onbekend', 'Unknown')}</td></tr>)}</tbody>
          </table></div>
          <h4>{t('Zo maakten we dit recept', 'How we made this recipe')}</h4>
          <ol className="cafe-how">
            <li>{base === 'matcha'
              ? t('We begonnen met zo’n 320 ETF’s en hielden alleen ETF’s met een ESG-label over die in Europa verkocht mogen worden, van minstens €100 miljoen. Geen crypto. Het geldmarktfonds, het veilige deel, mag ook mee: dat heeft geen ESG-label.', 'We started from about 320 ETFs and kept only ESG-labelled ETFs sold in Europe, of at least €100 million. No crypto. The cash fund, the safe part, is also allowed: it has no ESG label.')
              : t('We begonnen met zo’n 320 ETF’s en hielden alleen ETF’s over die in Europa verkocht mogen worden, van minstens €100 miljoen. Geen crypto.', 'We started from about 320 ETFs and kept only ETFs sold in Europe, of at least €100 million. No crypto.')}</li>
            <li>{t('Volgen meerdere fondsen dezelfde index, dan hielden we het goedkoopste.', 'Where several funds follow the same index, we kept the cheapest.')}</li>
            <li>{t('Met de weekkoersen van de laatste 5 jaar schatten we hoeveel elk fonds kan opleveren en hoe fondsen samen bewegen.', 'From the last 5 years of weekly prices we estimated what each fund may return and how funds move together.')}</li>
            <li>{t(`Daarna kozen we de mix met het hoogste verwachte rendement bij jouw sterkte: zo’n ${pct(rec.summary.target_volatility)} schommeling per jaar. Maximaal 10 fondsen, elk 3–40%; alleen het geldmarktfonds mag meer zijn.`, `Then we picked the mix with the highest expected return for your strength: about ${pct(rec.summary.target_volatility)} swing a year. At most 10 funds, each 3–40%; only the cash fund may be more.`)}</li>
          </ol>
          {rec.warnings.some(w => w.startsWith('target volatility')) && <p className="cafe-small">{t('De fondsen konden je doel niet precies halen; dit is de dichtstbijzijnde mix.', 'The funds could not hit your target exactly; this is the closest mix.')}</p>}
          <p className="cafe-small"><Link to="/cafe/textbook">{t('Meer weten over hoe zo’n mix wordt berekend?', 'Want to know how such a mix is calculated?')}</Link> {t('Gegevens: Yahoo Finance.', 'Data: Yahoo Finance.')}</p>
        </div>
      </details>
      <div className="cafe-result-actions">
        <button type="button" className="cafe-button secondary" onClick={edit}>{t('Pas mijn recept aan', 'Adjust my recipe')}</button>
        <Link className="cafe-button secondary" to="/cafe/menu">{t('Vergelijk alle 7 sterktes', 'Compare all 7 strengths')}</Link>
      </div>
    </div>
  </section>;
}

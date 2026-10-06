import { useEffect, useId, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Schemas } from '../api/client';
import { errorMessage } from '../components/charts/format';
import { useCafeLanguage } from '../cafe/language';
import { ASSET_COLORS } from '../cafe/recipe';
import '../cafe/cafe.css';
import '../cafe/board.css';

type Item = Schemas['MenuItem'];
const EXAMPLE = 10_000;

/** Growth of all seven strengths over the same window: the chosen one in green, the others recessive. */
function GrowthChart({ items, selected, onSelect }: { items: Item[]; selected: number; onSelect: (id: number) => void }) {
  const { t, locale, pct } = useCafeLanguage();
  const titleId = useId();
  const [hover, setHover] = useState<number | null>(null);
  const series = items.filter(i => i.growth.length > 1);
  if (!series.length) return null;
  const dates = series[0].growth.map(g => g.date);
  const all = series.flatMap(i => i.growth.map(g => g.value));
  const lo = Math.min(...all, 1) * .97, hi = Math.max(...all, 1) * 1.02;
  const width = 760, height = 300, left = 52, right = 48, top = 16, bottom = 34;
  const x = (i: number) => left + i / (dates.length - 1) * (width - left - right);
  const y = (v: number) => top + (hi - v) / (hi - lo) * (height - top - bottom);
  const ticks = [0, .25, .5, .75, 1].map(f => lo + (hi - lo) * f);
  const yearIdx = dates.map((d, i) => [d, i] as const).filter(([d], i) => i === 0 || d.slice(0, 4) !== dates[i - 1].slice(0, 4));
  const fmtDate = (d: string) => new Intl.DateTimeFormat(locale, { month: 'short', year: 'numeric' }).format(new Date(d));
  const chosen = series.find(s => s.profile_id === selected) ?? series[0];
  const ordered = [...series.filter(s => s.profile_id !== chosen.profile_id), chosen];
  function move(e: React.PointerEvent<SVGSVGElement>) {
    const box = e.currentTarget.getBoundingClientRect();
    const px = (e.clientX - box.left) / box.width * width;
    setHover(Math.max(0, Math.min(dates.length - 1, Math.round((px - left) / (width - left - right) * (dates.length - 1)))));
  }
  return <figure className="menu-chart">
    <figcaption id={titleId}>{t('Groei van €1 per sterkte, laatste 5 jaar (walk-forward)', 'Growth of €1 per strength, last 5 years (walk-forward)')}</figcaption>
    <div className="menu-chart-box">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={titleId} onPointerMove={move} onPointerLeave={() => setHover(null)}>
        {ticks.map(v => <g key={v}><line x1={left} x2={width - right} y1={y(v)} y2={y(v)} className="grid" /><text x={left - 8} y={y(v) + 4} textAnchor="end">€{v.toFixed(2)}</text></g>)}
        <line x1={left} x2={width - right} y1={y(1)} y2={y(1)} className="start" />
        {yearIdx.map(([d, i]) => <text key={d} x={x(i)} y={height - 10} textAnchor="middle">{d.slice(0, 4)}</text>)}
        {ordered.map(s => {
          const on = s.profile_id === chosen.profile_id;
          const end = s.growth[s.growth.length - 1];
          return <g key={s.profile_id} className={on ? 'line on' : 'line'} onClick={() => onSelect(s.profile_id)}>
            <polyline points={s.growth.map((g, i) => `${x(i)},${y(g.value)}`).join(' ')} />
            <text x={width - right + 6} y={y(end.value) + 4}>{s.profile_id}</text>
          </g>;
        })}
        {hover !== null && <g className="hover">
          <line x1={x(hover)} x2={x(hover)} y1={top} y2={height - bottom} />
          <circle cx={x(hover)} cy={y(chosen.growth[hover].value)} r="5" />
        </g>}
      </svg>
      {hover !== null && <div className="menu-tooltip" style={{ left: `${x(hover) / width * 100}%` }}>
        <strong>{fmtDate(dates[hover])}</strong>
        {[...series].sort((a, b) => b.profile_id - a.profile_id).map(s => <span key={s.profile_id} className={s.profile_id === chosen.profile_id ? 'on' : ''}>{s.profile_id}: €{s.growth[hover].value.toFixed(2)} ({pct(s.growth[hover].value - 1)})</span>)}
      </div>}
    </div>
    <p className="cafe-small">{t('Groene lijn: de gekozen sterkte. Grijze lijnen: de andere zes, met hun nummer aan het eind. Klik een lijn of een rij in de tabel om te kiezen.', 'Green line: the chosen strength. Grey lines: the other six, with their number at the end. Click a line or a table row to choose.')}</p>
  </figure>;
}

export default function CafeMenu() {
  const { language, setLanguage, t, pct, eur, assetName, profiles, drink, locale } = useCafeLanguage();
  const [menu, setMenu] = useState<Schemas['Menu'] | null>(null);
  const [error, setError] = useState('');
  const [base, setBase] = useState<'coffee' | 'matcha'>('coffee');
  const [selected, setSelected] = useState(4);
  useEffect(() => { document.title = t('De menukaart · Aan de bar', 'The menu · At the café'); }, [t]);
  useEffect(() => {
    let live = true;
    api.GET('/api/menu').then(r => {
      if (!live) return;
      if (r.error !== undefined || !r.data) setError(errorMessage(r.error)); else setMenu(r.data);
    }).catch(e => { if (live) setError(errorMessage(e)); });
    return () => { live = false; };
  }, []);
  const items = useMemo(() => (menu?.items ?? []).filter(i => i.base === base).sort((a, b) => a.profile_id - b.profile_id), [menu, base]);
  const item = items.find(i => i.profile_id === selected);
  const varOf = (i: Item, level: number) => i.var_monthly.find(v => v.level === level && v.method === 'historical')?.loss;
  const perf = (i: Item, years: number) => i.performance.find(p => p.years === years);
  const compact = (v: number) => new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR', notation: 'compact', maximumFractionDigits: 1 }).format(v);

  return <main className="cafe-page menu-page" lang={language}>
    <header className="menu-head">
      <div>
        <p className="cafe-board-eyebrow">{t('Aan de bar', 'At the café')}</p>
        <h1>{t('De menukaart', 'The menu')}</h1>
        <p>{t('Zeven sterktes, twee bases: 14 vaste portefeuilles. Je antwoorden kiezen er één; iedereen met hetzelfde recept krijgt dezelfde fondsen en gewichten.', 'Seven strengths, two bases: 14 fixed portfolios. Your answers pick one; everyone on the same recipe gets the same funds and weights.')}</p>
      </div>
      <div className="menu-head-actions">
        <nav className="cafe-language" aria-label={t('Taal', 'Language')}>{(['nl', 'en'] as const).map(code => <button key={code} type="button" lang={code} aria-label={code === 'nl' ? 'Nederlands' : 'English'} aria-pressed={language === code} onClick={() => setLanguage(code)}>{code.toUpperCase()}</button>)}</nav>
        <Link className="cafe-button" to="/cafe">{t('Naar de bar: bestel je recept', 'To the bar: order your recipe')}</Link>
      </div>
    </header>

    <div className="menu-base" role="group" aria-label={t('Basis', 'Base')}>
      {(['coffee', 'matcha'] as const).map(b => <button key={b} type="button" aria-pressed={base === b} onClick={() => setBase(b)}>{drink(b)}<small>{b === 'coffee' ? t('alle fondsen', 'every fund') : t('alleen ESG-gelabeld', 'ESG-labelled only')}</small></button>)}
    </div>

    {error ? <p className="cafe-warning" role="alert">{t('De menukaart kon niet laden:', 'The menu could not load:')} {error}</p>
      : !menu ? <p role="status">{t('De menukaart wordt geschreven… (de eerste keer duurt dit even)', 'Writing the menu… (the first time takes a little while)')}</p>
        : <>
          <GrowthChart items={items} selected={selected} onSelect={setSelected} />

          <div className="cafe-table-scroll menu-table-box"><table className="menu-table">
            <caption>{t(`${drink(base)}: alle sterktes naast elkaar. Verleden: walk-forward, na fondskosten. Vooruit: model, ${menu.horizon_years} jaar, ${eur(EXAMPLE)} eenmalig.`, `${drink(base)}: every strength side by side. Past: walk-forward, after fund costs. Ahead: model, ${menu.horizon_years} years, ${eur(EXAMPLE)} once.`)}</caption>
            <thead><tr>
              <th scope="col">{t('Sterkte', 'Strength')}</th><th scope="col">{t('Aandelen / obligaties en geldmarkt', 'Shares / bonds and cash')}</th>
              <th scope="col">{t('3 jaar, per jaar', '3 years, a year')}</th><th scope="col">{t('5 jaar, per jaar', '5 years, a year')}</th>
              <th scope="col">{t('Diepste daling (5 jaar)', 'Deepest fall (5 years)')}</th><th scope="col">{t('Slechtste maand', 'Worst month')}</th>
              <th scope="col">VaR 95% {t('maand', 'month')}</th><th scope="col">VaR 99% {t('maand', 'month')}</th>
              <th scope="col">{t('Schommeling', 'Swing')}</th><th scope="col">{t('Modelrendement', 'Model return')}</th>
              <th scope="col">{t(`${eur(EXAMPLE)} na ${menu.horizon_years} jaar (midden)`, `${eur(EXAMPLE)} after ${menu.horizon_years} years (middle)`)}</th>
              <th scope="col">{t('Kans onder inleg', 'Chance below start')}</th>
            </tr></thead>
            <tbody>{items.map(i => {
              const p = profiles[i.profile_id - 1], mix = i.summary.mix, five = perf(i, 5), three = perf(i, 3);
              const shares = (mix.equity ?? 0) + (mix.real_estate ?? 0);
              return <tr key={i.profile_id} className={i.profile_id === selected ? 'on' : ''} onClick={() => setSelected(i.profile_id)}>
                <th scope="row"><button type="button" aria-pressed={i.profile_id === selected} onClick={() => setSelected(i.profile_id)}>{p.id} · {p.name}<small>{p.plain}</small></button></th>
                <td>{pct(shares, 0)} / {pct(Math.max(0, 1 - shares), 0)}</td>
                <td>{three ? pct(three.annual_return) : '–'}</td><td>{five ? pct(five.annual_return) : '–'}</td>
                <td>{five ? pct(five.max_drawdown) : '–'}</td><td>{five ? pct(five.worst_month) : '–'}</td>
                <td>{pct(varOf(i, .95) ?? 0)}</td><td>{pct(varOf(i, .99) ?? 0)}</td>
                <td>{pct(i.summary.volatility)}</td><td>{pct(i.summary.expected_return)}</td>
                <td>{eur(i.outcome.p50 * EXAMPLE)}</td><td>{pct(i.p_below_invested, 0)}</td>
              </tr>;
            })}</tbody>
          </table></div>
          <p className="cafe-small">{t('VaR 95%: in 1 op 20 maanden was het verlies zo groot of groter (historische methode, over de hele beschikbare historie). Schommeling en modelrendement zijn schattingen vooruit, vóór kosten, belasting en inflatie.', 'VaR 95%: in 1 in 20 months the loss was this big or bigger (historical method, over all available history). Swing and model return are estimates ahead, before costs, tax and inflation.')}</p>

          {item && <section className="menu-detail" aria-labelledby="menu-detail-title">
            <h2 id="menu-detail-title">{drink(base)} · {profiles[item.profile_id - 1].name} <small>({item.profile_id}/7 · {profiles[item.profile_id - 1].plain})</small></h2>
            <div className="cafe-mixbar" aria-hidden="true">{Object.entries(item.summary.mix).filter(([, w]) => w > .0001).sort((a, b) => b[1] - a[1]).map(([k, w]) => <i key={k} style={{ width: `${w * 100}%`, background: ASSET_COLORS[k] ?? '#8a7b66' }} />)}</div>
            <p className="cafe-small">{Object.entries(item.summary.mix).filter(([, w]) => w > .0001).sort((a, b) => b[1] - a[1]).map(([k, w]) => `${assetName(k)} ${pct(w, 0)}`).join(' · ')}</p>
            <ul className="cafe-fund-list">{item.holdings.map(h => <li key={h.isin}><span className="cafe-fund-name">{h.name}<small>{[h.isin, h.ter != null ? `TER ${pct(h.ter, 2)}` : null, h.fund_size_eur ? t(`fonds ${compact(h.fund_size_eur)}`, `fund ${compact(h.fund_size_eur)}`) : null, h.daily_value_eur ? t(`${compact(h.daily_value_eur)}/dag`, `${compact(h.daily_value_eur)}/day`) : null].filter(Boolean).join(' · ')}</small></span><strong>{pct(h.weight)}</strong></li>)}</ul>
            {item.warnings.length > 0 && <p className="cafe-small" lang="en">{item.warnings.join(' ')}</p>}
          </section>}
          <p className="cafe-small">{t(`Alleen UCITS-ETF’s, fondsen van minstens ${compact(menu.min_fund_size_eur)} (onbekende grootte telt mee). Gegevens tot ${menu.data_as_of ?? 'onbekend'}. Educatief voorbeeld, geen persoonlijk beleggingsadvies.`, `UCITS ETFs only, funds of at least ${compact(menu.min_fund_size_eur)} (unknown size still counts). Data up to ${menu.data_as_of ?? 'unknown'}. Educational example, not personal investment advice.`)}</p>
        </>}
  </main>;
}

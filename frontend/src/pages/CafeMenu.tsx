import { useEffect, useId, useMemo, useState } from 'react';
import { methodPath } from '../cafe/method';
import { Link } from 'react-router-dom';
import { api, type Schemas } from '../api/client';
import { errorMessage } from '../components/charts/format';
import { useCafeLanguage } from '../cafe/language';
import { ASSET_COLORS } from '../cafe/recipe';
import '../cafe/cafe.css';
import '../cafe/board.css';

type Item = Schemas['MenuItem'];
const EXAMPLE = 500;

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
    <figcaption id={titleId}>{t('Wat €500 werd per sterkte, de laatste 5 jaar', 'What €500 became per strength, the last 5 years')}</figcaption>
    <div className="menu-chart-box">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={titleId} onPointerDown={move} onPointerMove={move} onPointerLeave={e => { if (e.pointerType === 'mouse') setHover(null); }}>
        {ticks.map(v => <g key={v}><line x1={left} x2={width - right} y1={y(v)} y2={y(v)} className="grid" /><text x={left - 8} y={y(v) + 4} textAnchor="end">€{Math.round(v * EXAMPLE)}</text></g>)}
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
        {[...series].sort((a, b) => b.profile_id - a.profile_id).map(s => <span key={s.profile_id} className={s.profile_id === chosen.profile_id ? 'on' : ''}>{s.profile_id}: €{Math.round(s.growth[hover].value * EXAMPLE)} ({pct(s.growth[hover].value - 1)})</span>)}
      </div>}
    </div>
    <p className="cafe-small">{t('Groen: de gekozen sterkte. Grijs: de andere zes, met hun nummer aan het eind. Elk kwartaal opnieuw berekend met alleen de gegevens van dat moment.', 'Green: the chosen strength. Grey: the other six, with their number at the end. Re-estimated every quarter with only the data known at the time.')}</p>
  </figure>;
}

/** Strength shown as filled beans, like a café menu shows how strong a drink is. */
function Beans({ n }: { n: number }) {
  return <span className="menu-beans" aria-hidden="true">{Array.from({ length: 7 }, (_, i) => <i key={i} className={i < n ? 'on' : ''} />)}</span>;
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
  const shares = (i: Item) => (i.summary.mix.equity ?? 0) + (i.summary.mix.real_estate ?? 0);
  const compact = (v: number) => new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR', notation: 'compact', maximumFractionDigits: 1 }).format(v);
  const p = item ? profiles[item.profile_id - 1] : null;

  return <main className="cafe-page menu-cafe" lang={language}>
    <img className="cafe-home-bg" src="/cafe/scene.png" alt="" />
    <Link className="cafe-entrance-top" to="/cafe"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11 12 4l8 7M6 10v10h12V10" /></svg>{t('Ingang', 'Entrance')}</Link>
    <nav className="cafe-language" aria-label={t('Taal', 'Language')}>{(['nl', 'en'] as const).map(code => <button key={code} type="button" lang={code} aria-label={code === 'nl' ? 'Nederlands' : 'English'} aria-pressed={language === code} onClick={() => setLanguage(code)}>{code.toUpperCase()}</button>)}</nav>

    <div className="menu-cafe-grid">
      <section className="menu-board-big" aria-labelledby="menu-title">
        <p className="cafe-board-eyebrow">{t('Aan de bar', 'At the café')}</p>
        <h1 id="menu-title">{t('De menukaart', 'The menu')}</h1>
        <p className="menu-board-intro">{t('Zeven sterktes, in koffie of matcha: 14 vaste recepten. Je antwoorden aan de bar kiezen er één.', 'Seven strengths, in coffee or matcha: 14 fixed recipes. Your answers at the bar pick one.')}</p>
        <div className="menu-board-tabs" role="group" aria-label={t('Basis', 'Base')}>
          {(['coffee', 'matcha'] as const).map(b => <button key={b} type="button" aria-pressed={base === b} onClick={() => setBase(b)}>
            <span className={`cafe-home-dot ${b}`} aria-hidden="true" />{drink(b)}<small>{b === 'coffee' ? t('alle fondsen', 'every fund') : t('alleen ESG', 'ESG only')}</small>
          </button>)}
        </div>
        {error ? <p className="menu-board-note" role="alert">{t('De menukaart kon niet laden:', 'The menu could not load:')} {error}</p>
          : !menu ? <p className="menu-board-note" role="status">{t('De menukaart wordt geschreven…', 'Writing the menu…')}</p>
            : <>
              <div className="menu-board-head" aria-hidden="true"><span>{t('Recept', 'Recipe')}</span><span>{t('Aandelen', 'Shares')}</span><span>{t('Per jaar, 5 jaar', 'A year, 5 yrs')}</span><span>{t('Diepste daling', 'Deepest fall')}</span></div>
              <ul className="menu-board-list">{items.map(i => {
                const pr = profiles[i.profile_id - 1], five = perf(i, 5), on = i.profile_id === selected;
                return <li key={i.profile_id}><button type="button" aria-pressed={on} className={on ? 'on' : ''} onClick={() => setSelected(i.profile_id)}>
                  <span className="menu-board-name"><strong>{pr.id} · {pr.name}</strong><span><Beans n={pr.id} /> {pr.plain}</span></span>
                  <span>{pct(shares(i), 0)}</span>
                  <span>{five ? `${five.annual_return >= 0 ? '+' : ''}${pct(five.annual_return)}` : '–'}</span>
                  <span>{five ? pct(five.max_drawdown) : '–'}</span>
                </button></li>;
              })}</ul>
              <p className="menu-board-note">{t('Verleden is geen belofte. Na fondskosten, vóór belasting en inflatie.', 'The past is no promise. After fund costs, before tax and inflation.')}</p>
            </>}
        <div className="tbc-links"><Link className="menu-board-order" to="/cafe/order" state={{ fresh: true }}>{t('Bestel aan de bar', 'Order at the bar')} <span aria-hidden="true">→</span></Link>
        <Link className="cafe-board-link" to={methodPath(base, selected)}>{t('Zo wordt een recept gemaakt', 'How a recipe is made')}</Link></div>
      </section>

      {menu && item && p && <section className="menu-paper" aria-labelledby="menu-detail-title">
        <p className="cafe-receipt-title">{t('DIT RECEPT', 'THIS RECIPE')}</p>
        <h2 id="menu-detail-title">{drink(base)} · {p.name} <small>{p.id}/7 · {p.plain}</small></h2>
        <div className="cafe-mixbar" aria-hidden="true">{Object.entries(item.summary.mix).filter(([, w]) => w > .0001).sort((a, b) => b[1] - a[1]).map(([k, w]) => <i key={k} style={{ width: `${w * 100}%`, background: ASSET_COLORS[k] ?? '#8a7b66' }} />)}</div>
        <p className="cafe-small">{Object.entries(item.summary.mix).filter(([, w]) => w > .0001).sort((a, b) => b[1] - a[1]).map(([k, w]) => `${assetName(k)} ${pct(w, 0)}`).join(' · ')}</p>
        <dl className="menu-paper-stats">
          <div><dt>{t(`${eur(EXAMPLE)} na ${menu.horizon_years} jaar`, `${eur(EXAMPLE)} after ${menu.horizon_years} years`)}</dt><dd>{eur(item.outcome.p50 * EXAMPLE)}</dd><dd className="cafe-case-note">{t('middelste geval', 'middle case')}</dd></div>
          <div><dt>{t('Slechte maand', 'Bad month')}</dt><dd>{pct(varOf(item, .95) ?? 0)}</dd><dd className="cafe-case-note">{t('1 op 20 maanden', '1 in 20 months')}</dd></div>
          <div><dt>{t('Kans onder inleg', 'Chance below start')}</dt><dd>{pct(item.p_below_invested, 0)}</dd><dd className="cafe-case-note">{t(`na ${menu.horizon_years} jaar`, `after ${menu.horizon_years} years`)}</dd></div>
        </dl>
        <GrowthChart items={items} selected={selected} onSelect={setSelected} />
        <details className="menu-paper-funds"><summary>{t(`De ${item.holdings.length} fondsen in dit recept`, `The ${item.holdings.length} funds in this recipe`)}</summary>
          <ul className="cafe-fund-list">{item.holdings.map(h => <li key={h.isin}><span className="cafe-fund-name">{h.name}<small>{[h.ter != null ? t(`kosten ${pct(h.ter, 2)}`, `costs ${pct(h.ter, 2)}`) : null, h.fund_size_eur ? t(`fonds ${compact(h.fund_size_eur)}`, `fund ${compact(h.fund_size_eur)}`) : null].filter(Boolean).join(' · ')}</small></span><strong>{pct(h.weight)}</strong></li>)}</ul>
        </details>
        <details className="menu-paper-funds"><summary>{t('Alle 7 sterktes in één tabel', 'All 7 strengths in one table')}</summary>
          <div className="cafe-table-scroll"><table className="menu-table">
            <thead><tr><th scope="col">{t('Sterkte', 'Strength')}</th><th scope="col">{t('3 jaar', '3 yrs')}</th><th scope="col">{t('5 jaar', '5 yrs')}</th><th scope="col">{t('Slechtste maand', 'Worst month')}</th><th scope="col">VaR 95%</th><th scope="col">VaR 99%</th><th scope="col">{t('Schommeling', 'Swing')}</th></tr></thead>
            <tbody>{items.map(i => <tr key={i.profile_id} className={i.profile_id === selected ? 'on' : ''}><th scope="row">{i.profile_id} · {profiles[i.profile_id - 1].name}</th>
              <td>{perf(i, 3) ? pct(perf(i, 3)!.annual_return) : '–'}</td><td>{perf(i, 5) ? pct(perf(i, 5)!.annual_return) : '–'}</td>
              <td>{perf(i, 5) ? pct(perf(i, 5)!.worst_month) : '–'}</td><td>{pct(varOf(i, .95) ?? 0)}</td><td>{pct(varOf(i, .99) ?? 0)}</td><td>{pct(i.summary.volatility)}</td></tr>)}</tbody>
          </table></div>
          <p className="cafe-small">{t('Per jaar, walk-forward. VaR: verlies in één maand dat 1 op 20 (95%) of 1 op 100 (99%) maanden voorkwam.', 'A year, walk-forward. VaR: a one-month loss seen in 1 in 20 (95%) or 1 in 100 (99%) months.')}</p>
        </details>
        <p className="cafe-small">{t(`Alleen UCITS-ETF’s van minstens ${compact(menu.min_fund_size_eur)}. Gegevens tot ${menu.data_as_of ?? 'onbekend'}. Educatief voorbeeld, geen persoonlijk beleggingsadvies.`, `UCITS ETFs of at least ${compact(menu.min_fund_size_eur)} only. Data up to ${menu.data_as_of ?? 'unknown'}. Educational example, not personal investment advice.`)}</p>
      </section>}
    </div>
  </main>;
}

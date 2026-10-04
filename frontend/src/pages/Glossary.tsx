import { useMemo, useState } from 'react';
import { PageHeader } from '../components/ui';
import { TERMS } from '../glossary/terms';
import './Glossary.css';

export default function Glossary() {
  const [q, setQ] = useState('');
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = [...TERMS].sort((a, b) => a.plain.localeCompare(b.plain));
    if (!needle) return list;
    return list.filter((t) => `${t.plain} ${t.technical} ${t.meaning}`.toLowerCase().includes(needle));
  }, [q]);

  return (
    <>
      <PageHeader
        title="Words explained"
        lead="Every technical word in this app, in plain English. Words with a dotted underline on other pages link here."
      />
      <div className="field gloss-search">
        <label htmlFor="gloss-q">Search for a word</label>
        <input id="gloss-q" type="search" className="input" value={q} placeholder="For example: fee, risk, fall" onChange={(e) => setQ(e.target.value)} />
      </div>
      {shown.length === 0 && <p className="muted">No match. Try another word.</p>}
      <dl className="gloss-list">
        {shown.map((t) => (
          <div key={t.id} id={t.id} className="gloss-item card">
            <dt>
              <span className="gloss-plain">{t.plain}</span>
              <span className="gloss-tech">Also called: {t.technical}</span>
            </dt>
            <dd>
              <p>{t.meaning}</p>
              {t.example && <p className="gloss-example"><strong>Example:</strong> {t.example}</p>}
            </dd>
          </div>
        ))}
      </dl>
    </>
  );
}

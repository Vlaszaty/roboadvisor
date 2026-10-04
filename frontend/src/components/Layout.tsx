import { Suspense, useEffect, useState } from 'react';
import { NavLink, Outlet, Link, useLocation } from 'react-router-dom';
import { LookSwitcher } from './LookSwitcher';
import { SettingsDrawer } from './SettingsDrawer';
import { Button } from './ui';

const LINKS = [
  { to: '/start', label: 'Build my plan' },
  { to: '/portfolio', label: 'My plan' },
  { to: '/backtest', label: 'How it did' },
  { to: '/textbook', label: 'How it works' },
  { to: '/universe', label: 'Funds' },
  { to: '/glossary', label: 'Words explained' },
];

export function Layout() {
  const [open, setOpen] = useState(false);
  const { pathname, hash } = useLocation();
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!hash) window.scrollTo(0, 0);
  }, [pathname, hash]);
  return (
    <>
      <header className="site-header">
        <nav className="container" aria-label="Main">
          <Link to="/" className="brand">Ballast</Link>
          <Button
            className="nav-toggle"
            aria-expanded={open}
            aria-controls="nav-links"
            onClick={() => setOpen((o) => !o)}
          >
            {open ? 'Close' : 'Menu'}
          </Button>
          <div id="nav-links" className={`nav-links ${open ? 'is-open' : ''}`}>
            {LINKS.map((l) => <NavLink key={l.to} to={l.to}>{l.label}</NavLink>)}
            <LookSwitcher />
            <SettingsDrawer />
          </div>
        </nav>
      </header>
      <main className="container">
        <Suspense fallback={<p role="status">Loading…</p>}>
          <Outlet />
        </Suspense>
      </main>
      <footer className="site-footer">
        <div className="container">
          Educational tool, not personal financial advice. Past performance is no guarantee of future results.
          Simulations and replays of the past are based on history and modelling assumptions. Unsure about a word?
          Look it up in <Link to="/glossary">Words explained</Link>.
        </div>
      </footer>
    </>
  );
}

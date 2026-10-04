import { Suspense } from 'react';
import { NavLink, Outlet, Link } from 'react-router-dom';
import { SettingsDrawer } from './SettingsDrawer';

export function Layout() {
  return (
    <>
      <header className="site-header">
        <nav className="container" aria-label="Main">
          <Link to="/" className="brand">Ballast</Link>
          <NavLink to="/start">Start</NavLink>
          <NavLink to="/portfolio">Portfolio</NavLink>
          <NavLink to="/backtest">Backtest</NavLink>
          <NavLink to="/textbook">Textbook</NavLink>
          <NavLink to="/universe">ETFs</NavLink>
          <SettingsDrawer />
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
          Simulations and backtests are based on historical data and modelling assumptions.
        </div>
      </footer>
    </>
  );
}

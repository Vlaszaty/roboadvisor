import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import Landing from './pages/Landing';
import Start from './pages/Start';
import { CafeLanguageProvider, CafeOpening } from './cafe/language';
const Cafe = lazy(() => import('./pages/Cafe'));
const Portfolio = lazy(() => import('./pages/Portfolio'));
const Backtest = lazy(() => import('./pages/Backtest'));
const Textbook = lazy(() => import('./pages/Textbook'));
const Universe = lazy(() => import('./pages/Universe'));
const UniverseFund = lazy(() => import('./pages/UniverseFund'));
const Glossary = lazy(() => import('./pages/Glossary'));

export default function App() {
  return (
    <Routes>
      <Route path="cafe" element={<CafeLanguageProvider><Suspense fallback={<CafeOpening />}><Cafe /></Suspense></CafeLanguageProvider>} />
      <Route element={<Layout />}>
        <Route index element={<Landing />} />
        <Route path="start" element={<Start />} />
        <Route path="portfolio" element={<Portfolio />} />
        <Route path="backtest" element={<Backtest />} />
        <Route path="textbook" element={<Textbook />} />
        <Route path="universe" element={<Universe />} />
        <Route path="universe/:isin" element={<UniverseFund />} />
        <Route path="glossary" element={<Glossary />} />
      </Route>
    </Routes>
  );
}

import { Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import Landing from './pages/Landing';
import Start from './pages/Start';
import Portfolio from './pages/Portfolio';
import Backtest from './pages/Backtest';
import Universe from './pages/Universe';
import UniverseFund from './pages/UniverseFund';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Landing />} />
        <Route path="start" element={<Start />} />
        <Route path="portfolio" element={<Portfolio />} />
        <Route path="backtest" element={<Backtest />} />
        <Route path="universe" element={<Universe />} />
        <Route path="universe/:isin" element={<UniverseFund />} />
      </Route>
    </Routes>
  );
}

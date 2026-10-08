import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { CafeLanguageProvider, CafeOpening } from './cafe/language';
const Cafe = lazy(() => import('./pages/Cafe'));
const CafeMenu = lazy(() => import('./pages/CafeMenu'));
const CafeHome = lazy(() => import('./pages/CafeHome'));
const CafeTextbook = lazy(() => import('./pages/CafeTextbook'));
const CafeMethod = lazy(() => import('./pages/CafeMethod'));

export default function App() {
  return (
    <Routes>
      <Route path="cafe" element={<CafeLanguageProvider><Suspense fallback={<CafeOpening />}><CafeHome /></Suspense></CafeLanguageProvider>} />
      <Route path="cafe/order" element={<CafeLanguageProvider><Suspense fallback={<CafeOpening />}><Cafe /></Suspense></CafeLanguageProvider>} />
      <Route path="cafe/textbook" element={<CafeLanguageProvider><Suspense fallback={<CafeOpening />}><CafeTextbook /></Suspense></CafeLanguageProvider>} />
      <Route path="cafe/method" element={<CafeLanguageProvider><Suspense fallback={<CafeOpening />}><CafeMethod /></Suspense></CafeLanguageProvider>} />
      <Route path="cafe/menu" element={<CafeLanguageProvider><Suspense fallback={<CafeOpening />}><CafeMenu /></Suspense></CafeLanguageProvider>} />
      <Route path="*" element={<Navigate to="/cafe" replace />} />
    </Routes>
  );
}

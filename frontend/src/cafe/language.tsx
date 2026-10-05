import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { ASSET_NAMES, MILK, SUGAR } from './recipe';

export type CafeLanguage = 'nl' | 'en';
export const CAFE_LANGUAGE_KEY = 'roboadvisor.cafe.language.v1';
export const parseLanguage = (raw: string | null): CafeLanguage => raw === 'en' ? 'en' : 'nl';

const EN_MILK = [
  ['No milk', 'I believe I can financially withstand large fluctuations and losses.'],
  ['A splash', 'I believe I can financially withstand substantial fluctuations and losses.'],
  ['Half milk', 'I have some financial room for losses, but want to stay cautious.'],
  ['Lots of milk', 'My financial room for losses is limited.'],
  ['Extra milk', 'I want a very cautious example; I have little financial room for losses.'],
] as const;
const EN_SUGAR = [
  ['No sugar', 'I could accept a loss of more than 30% over one year.'],
  ['One spoon', 'I could accept a loss of up to 30% over one year.'],
  ['Two spoons', 'I could accept a loss of up to 20% over one year.'],
  ['Three spoons', 'I could accept a loss of up to 10% over one year.'],
  ['Extra sweet', 'I do not want to accept any loss. Even a mild investment recipe can lose money.'],
] as const;
const EN_ASSETS: Record<string, string> = { equity: 'Equities', bond: 'Bonds', cash: 'Money market', commodity: 'Commodities', real_estate: 'Real estate', crypto: 'Crypto' };

/** Copy and formatting only. Preset scores and engine request fields stay unchanged. */
export function cafeCopy(language: CafeLanguage) {
  const locale = language === 'en' ? 'en-GB' : 'nl-NL';
  const t = (nl: string, en: string) => language === 'en' ? en : nl;
  return {
    language, locale, t,
    years: (n: number) => `${n} ${t('jaar', n === 1 ? 'year' : 'years')}`,
    eur: (value: number) => new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value),
    pct: (value: number, digits = 1) => `${new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value * 100)}%`,
    assetName: (key: string) => (language === 'en' ? EN_ASSETS : ASSET_NAMES)[key] ?? key,
    milk: MILK.map((p, i) => ({ ...p, name: t(p.name, EN_MILK[i][0]), description: t(p.description, EN_MILK[i][1]) })),
    sugar: SUGAR.map((p, i) => ({ ...p, name: t(p.name, EN_SUGAR[i][0]), description: t(p.description, EN_SUGAR[i][1]) })),
  };
}

const LanguageContext = createContext({ ...cafeCopy('nl'), setLanguage: (_language: CafeLanguage) => {} });
export function CafeLanguageProvider({ children }: { children: ReactNode }) {
  const [language, updateLanguage] = useState<CafeLanguage>(() => {
    try { return parseLanguage(localStorage.getItem(CAFE_LANGUAGE_KEY)); } catch { return 'nl'; }
  });
  const value = useMemo(() => ({ ...cafeCopy(language), setLanguage: (next: CafeLanguage) => {
    updateLanguage(next);
    try { localStorage.setItem(CAFE_LANGUAGE_KEY, next); } catch { /* Switching still works without storage. */ }
  } }), [language]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}
export const useCafeLanguage = () => useContext(LanguageContext);
export function CafeOpening() {
  const { language, t } = useCafeLanguage();
  return <p role="status" lang={language}>{t('De bar gaat open…', 'The café is opening…')}</p>;
}

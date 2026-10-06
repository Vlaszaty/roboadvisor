import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { ASSET_NAMES, BUFFER, EXPERIENCE, MILK, PROFILES, SUGAR } from './recipe';

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
const EN_BUFFER = [
  ['Plenty', 'A surprise bill is easy to pay.'],
  ['A little', 'Doable, but then my buffer is about gone.'],
  ['Nothing', 'I would have to sell or borrow.'],
] as const;
/** What each set-aside option means in months of fixed costs (rent, bills, groceries), shown in bold. */
const BUFFER_KEY = [
  ['6 maanden of meer vaste lasten opzij', '6 months or more of fixed costs saved'],
  ['1 tot 6 maanden vaste lasten opzij', '1 to 6 months of fixed costs saved'],
  ['Minder dan 1 maand vaste lasten opzij', 'Less than 1 month of fixed costs saved'],
] as const;
/** The point of each milk setting in a few words, shown in bold before choosing. */
const MILK_KEY = [
  ['Grote dalingen kan ik dragen', 'I can carry big falls'],
  ['Flinke dalingen kan ik dragen', 'I can carry sizeable falls'],
  ['Wat ruimte, liever voorzichtig', 'Some room, but careful'],
  ['Weinig ruimte voor verlies', 'Little room for losses'],
  ['Bijna geen ruimte voor verlies', 'Almost no room for losses'],
] as const;
const BREW = [
  ['Espresso', 'Espresso', 'meteen klaar', 'ready right away'],
  ['Filterkoffie', 'Filter coffee', 'even wachten', 'a short wait'],
  ['Slow pour-over', 'Slow pour-over', 'rustig zetten', 'brewed slowly'],
  ['Cold brew', 'Cold brew', 'een nacht laten trekken', 'steeped overnight'],
  ['Eigen koffieplant', 'Home-grown coffee', 'jaren geduld', 'years of patience'],
] as const;
const EN_EXPERIENCE = [
  ['First visit', 'I have never invested.'],
  ['A few times', 'Less than 3 years of experience with shares, funds or ETFs.'],
  ['Regular', '3 to 10 years of experience.'],
  ['Old regular', 'More than 10 years of experience, including bad years.'],
] as const;
/** Menu names: brew strength (works for coffee and matcha) plus a plain meaning. */
const PROFILE_COPY: Record<string, [string, string, string, string]> = {
  very_mild: ['Heel zacht', 'Very mild', 'Heel voorzichtig', 'Very careful'],
  mild: ['Zacht', 'Mild', 'Voorzichtig', 'Careful'],
  smooth: ['Rond', 'Smooth', 'Redelijk voorzichtig', 'Fairly careful'],
  balanced: ['In balans', 'Balanced', 'Gemengd', 'Balanced mix'],
  rich: ['Vol', 'Rich', 'Redelijk gedurfd', 'Fairly bold'],
  strong: ['Sterk', 'Strong', 'Gedurfd', 'Bold'],
  extra_strong: ['Extra sterk', 'Extra strong', 'Heel gedurfd', 'Very bold'],
};
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
    milk: MILK.map((p, i) => ({ ...p, name: t(p.name, EN_MILK[i][0]), description: t(p.description, EN_MILK[i][1]), key: t(MILK_KEY[i][0], MILK_KEY[i][1]) })),
    brew: BREW.map(b => ({ name: t(b[0], b[1]), wait: t(b[2], b[3]) })),
    sugar: SUGAR.map((p, i) => ({ ...p, name: t(p.name, EN_SUGAR[i][0]), description: t(p.description, EN_SUGAR[i][1]) })),
    buffer: BUFFER.map((p, i) => ({ ...p, name: t(p.name, EN_BUFFER[i][0]), description: t(p.description, EN_BUFFER[i][1]), key: t(BUFFER_KEY[i][0], BUFFER_KEY[i][1]) })),
    experience: EXPERIENCE.map((p, i) => ({ ...p, name: t(p.name, EN_EXPERIENCE[i][0]), description: t(p.description, EN_EXPERIENCE[i][1]) })),
    profiles: PROFILES.map(p => ({ ...p, name: t(PROFILE_COPY[p.key][0], PROFILE_COPY[p.key][1]), plain: t(PROFILE_COPY[p.key][2], PROFILE_COPY[p.key][3]) })),
    drink: (base: 'coffee' | 'matcha' | null) => base === 'matcha' ? 'Matcha' : base === 'coffee' ? t('Koffie', 'Coffee') : '',
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

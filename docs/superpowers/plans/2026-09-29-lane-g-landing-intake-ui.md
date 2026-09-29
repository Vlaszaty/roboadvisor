# Lane G — Landing Page and Intake Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the marketing landing page (`/`) and the three-stage intake wizard (`/start`: questionnaire, risk level, preferences) that fills the shared `InvestorProfile` store and hands over to `/portfolio`.

**Architecture:** Pure logic (answer validation, step navigation, risk-to-volatility mapping, preference helpers, API error formatting) lives in `src/intake/logic.ts` and `src/intake/request.ts` and is unit-tested with vitest. Thin React components (`FormWizard` orchestrating `QuestionStep`, `RiskStep`, `PreferencesStep`, plus `ExamplePreview` for the landing page) render that logic and talk to the API only through the Phase 0 `api` client and the Phase 0 store. Every API call goes through one `useRequest` hook that gives uniform loading, error (with the server's `detail`) and retry states.

**Tech Stack:** React 19, TypeScript, react-router-dom, openapi-fetch (Phase 0 client with mock mode), vitest, plain CSS using only the Phase 0 tokens.

**Spec:** `docs/superpowers/specs/2026-09-29-roboadvisor-design.md` (§6 intake, §7 API, §8.1 intake channels, §8.2 pages, §8.3 mock mode). Builds on `docs/superpowers/plans/2026-09-29-phase0-contracts.md` as merged (tag `phase0-contracts`).

## Global Constraints

Copied from Phase 0:

- Python tooling is **uv** only: `uv sync`, `uv add`, `uv run pytest`, `uv run python -m ...`. Python pinned to **3.12**. Never use pip or a hand-made venv. (This lane does not touch Python.)
- Backend port **8740**, frontend port **5740** with Vite `strictPort: true`; Vite proxies `/api` → `http://localhost:8740`.
- All API routes live under `/api`. The API is stateless.
- Engine modules (`app/engine/*`) never import FastAPI, sqlite3 or `app.data`.
- All engine return series are **weekly (W-FRI)**, simple returns, base currency, columns = ISIN. Annualisation factor 52.
- Base currencies: `EUR`, `USD`.
- Drawdowns and losses are **negative numbers** (−0.35 = −35%). Thresholds are positive (0.3 means "−30% or worse").
- No network access in tests.
- Only Phase 0 adds Python/npm dependencies. Lanes that need one must escalate.
- Contract files (`config.py` structure, `engine/types.py`, `engine/errors.py`, `api/schemas.py`, `data/schema.sql`, route signatures, stub signatures) are frozen; changes go through the integrator.

Lane G specific:

- Frontend commands run from `frontend/`: `npm test`, `npm run typecheck`, `npm run dev:mock` (port 5740).
- **Only touch files you own:** `frontend/src/pages/Landing.tsx`, `frontend/src/pages/Landing.css`, `frontend/src/pages/Start.tsx`, and everything under `frontend/src/intake/**`. Never edit `tokens.css`, `base.css`, `ui.tsx`, `Layout.tsx`, `store.tsx`, `client.ts` or mocks; if one is wrong, stop and escalate to the integrator.
- Use only CSS custom properties from `src/styles/tokens.css` for colours, fonts, radii, spacing and shadows. No new npm dependencies. Component tests are out of scope (no `@testing-library/react`/`jsdom`); see Notes.
- Every `<Button>` inside a `<form>` gets an explicit `type` (the Phase 0 `Button` does not default it).
- Placeholder brand "Ballast" appears only in the Layout header; page copy says "we" so a rename costs nothing.

## Design direction (applies to all UI tasks)

Calm, unhurried, financial-editorial: warm paper background, Fraunces for headlines and the big risk number, IBM Plex Mono for every figure (`.num` class), brass `--accent` used sparingly (primary buttons, the selected state, the slider fill), generous whitespace, thin `--line` rules rather than heavy boxes. No gradients, no stock illustration. Downside is shown as plainly as upside: loss figures use `--neg`. Responsive from 360px: single column by default, `auto-fit` grids with `min(100%, Npx)` minimums, tap targets at least 44px.

## File structure

| File | Responsibility |
|---|---|
| `frontend/src/intake/logic.ts` | Pure functions and constants: validation, navigation, risk math, preference helpers, error formatting, mix rows, demo profile |
| `frontend/src/intake/logic.test.ts` | vitest tests for `logic.ts` |
| `frontend/src/intake/request.ts` | `ApiError`, `unwrap()` (turns an openapi-fetch result into data or a readable error) |
| `frontend/src/intake/request.test.ts` | vitest tests for `unwrap` |
| `frontend/src/intake/useRequest.ts` | `useRequest` hook: loading / error / ok + retry |
| `frontend/src/intake/ApiState.tsx` | `Loading` and `ErrorBox` components |
| `frontend/src/intake/FormWizard.tsx` | The intake channel: loads questionnaire + defaults, holds wizard position, renders steps |
| `frontend/src/intake/QuestionStep.tsx` | One question per screen (radio cards / number + range) |
| `frontend/src/intake/RiskStep.tsx` | Scores answers, sub-scores, mismatch, slider, live "what this means" |
| `frontend/src/intake/PreferencesStep.tsx` | Preferences form |
| `frontend/src/intake/ExamplePreview.tsx` | Landing page example portfolio card (real API call) |
| `frontend/src/intake/intake.css` | Wizard styles |
| `frontend/src/pages/Start.tsx` | Route component, header + `<FormWizard />` |
| `frontend/src/pages/Landing.tsx`, `Landing.css` | Landing page |

## Phase 0 shapes this plan relies on

(From Task 7 and Task 6 of the Phase 0 plan; types come from generated `src/api/schema.d.ts` via `Schemas['...']`.)

- `api.GET('/api/intake/questionnaire')` → `Questionnaire { version, questions: Question[] }`; `Question { id, text, help?, type: 'single'|'number', feeds, options?: {label, value, points}[], min?, max?, unit? }`. Because Phase 0 sets `separate_input_output_schemas=False`, every field with a Python default is **optional in TypeScript** (`options`, `help`, `min`, `max`, `unit`, `preferences`, all `Preferences` fields, `warnings`, `trace`). Code below always uses `?? default`.
- `api.POST('/api/intake/score', { body: { answers } })` → `IntakeScore { capacity, tolerance, suggested_risk_level, limiting_factor: 'capacity'|'tolerance'|'none', mismatch, explanation, horizon_years }`.
- `api.GET('/api/defaults')` → `Defaults` (uses `vol_range: [number, number]`, `crypto_min_risk_level`, `crypto_default_cap`, `crypto_hard_cap`, `mismatch_gap`).
- `api.GET('/api/universe')` → `FundSummary[]` (used only to derive the region and sector option lists; there is no dedicated endpoint).
- `api.POST('/api/portfolio', { body: { profile, settings } })` → `Recommendation` (`summary.mix`, `summary.expected_return`, `summary.volatility`, `summary.annual_cost_per_10k`, `downside.drawdown_probs: {threshold, probability}[]`).
- Store: `useStore(): [State, Dispatch<Action>]`; actions `setAnswer {id, value}`, `setScore {score}`, `setProfile {patch}`, `setPreferences {patch}`; `State { profile, settings, answers, score }`.
- UI: `Button` (props of `<button>` + `variant?: 'default'|'primary'`), `LinkButton {to, children, variant?}`, `Card {title?, children}` (title is a string, rendered as `<h3>`), `Stat {label, value, hint?}`, `PageHeader {title, lead?}`, `pct(x, digits=1)`. CSS classes `.btn`, `.card`, `.num`, `.muted`, `.stat-label`, `.stat-value`, `.container`.
- Layout already renders `<main class="container">` and the disclaimer footer.
- Mock mode (`npm run dev:mock`) delays 200 ms per call, returns a fixed score regardless of answers, and a fixed portfolio regardless of profile.

---

### Task 1: Intake logic module with tests

**Files:**
- Create: `frontend/src/intake/logic.ts`
- Test: `frontend/src/intake/logic.test.ts`
- Delete: `frontend/src/intake/.gitkeep` (if present)

**Interfaces:**
- Consumes: `Schemas` from `../api/client`.
- Produces (all exported from `logic.ts`):
  - Types: `Question`, `Preferences`, `IntakeScore`, `FundSummary`, `InvestorProfile`, `AnswerValue = string | number`, `Answers = Record<string, AnswerValue>`, `Stage = 'questions' | 'risk' | 'preferences'`, `Nav { stage: Stage; index: number }`, `RegionMode = 'any' | 'include' | 'exclude'`, `SectorMode = 'neutral' | 'tilt5' | 'tilt10' | 'exclude'`.
  - `validateAnswer(q: Question, value: AnswerValue | undefined): string | null`
  - `START: Nav`, `next(nav, questions, answers): Nav`, `back(nav, questionCount): Nav`, `stageNumber(stage): 1 | 2 | 3`
  - `answersFor(questions: Question[], answers: Answers): Answers`, `answersKey(answers: Answers): string`
  - `targetVol(level: number, volRange: readonly [number, number]): number`, `badYear(vol: number): number`, `normalCdf(x: number): number`, `lossProbability(vol: number, threshold: number): number`, `riskLabel(level: number): string`, `riskNotice(level: number, suggested: number): 'above' | 'below' | null`, `limitingText(factor: IntakeScore['limiting_factor']): string`, `profilePatchFromScore(score: IntakeScore): { risk_level: number; horizon_years: number }`
  - Preferences: `PREF_DEFAULTS`, `regionMode`, `setRegionMode`, `sectorMode`, `setSectorMode`, `deriveOptions(funds: FundSummary[]): { regions: string[]; sectors: string[] }`, `labelFor(key: string): string`, `cryptoAvailable(level, minLevel): boolean`, `validatePreferences(p: Preferences): string[]`, `percentToFraction(x: number): number`
  - `errorMessage(error: unknown, status?: number): string`
  - `mixRows(mix: Record<string, number>): { key: string; label: string; weight: number }[]`, `thresholdLabel(t: number): string`
  - `DEMO_PROFILE: InvestorProfile`

- [ ] **Step 1: Write the failing tests**

`frontend/src/intake/logic.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  answersFor, answersKey, back, badYear, cryptoAvailable, deriveOptions, errorMessage, labelFor, limitingText,
  lossProbability, mixRows, next, normalCdf, percentToFraction, profilePatchFromScore, regionMode, riskLabel,
  riskNotice, sectorMode, setRegionMode, setSectorMode, stageNumber, START, targetVol, thresholdLabel,
  validateAnswer, validatePreferences, type FundSummary, type Question,
} from './logic';

const single: Question = {
  id: 'drop', text: 'Drop?', type: 'single', feeds: 'tolerance',
  options: [{ label: 'Sell', value: 'sell', points: 0 }, { label: 'Hold', value: 'hold', points: 60 }],
};
const num: Question = { id: 'horizon', text: 'When?', type: 'number', feeds: 'horizon', min: 1, max: 40 };
const qs = [num, single];

describe('validateAnswer', () => {
  it('requires an answer', () => {
    expect(validateAnswer(single, undefined)).toMatch(/choose/i);
    expect(validateAnswer(num, '')).toMatch(/choose|enter/i);
  });
  it('accepts a listed option and rejects an unknown one', () => {
    expect(validateAnswer(single, 'hold')).toBeNull();
    expect(validateAnswer(single, 'nope')).not.toBeNull();
  });
  it('checks number bounds', () => {
    expect(validateAnswer(num, 10)).toBeNull();
    expect(validateAnswer(num, 0)).toMatch(/1 or more/);
    expect(validateAnswer(num, 41)).toMatch(/40 or less/);
    expect(validateAnswer(num, Number.NaN)).toMatch(/number/i);
  });
});

describe('navigation', () => {
  it('stays put when the current answer is invalid', () => {
    expect(next(START, qs, {})).toEqual(START);
  });
  it('walks questions then risk then preferences', () => {
    let nav = next(START, qs, { horizon: 10 });
    expect(nav).toEqual({ stage: 'questions', index: 1 });
    nav = next(nav, qs, { horizon: 10, drop: 'hold' });
    expect(nav).toEqual({ stage: 'risk', index: 0 });
    nav = next(nav, qs, {});
    expect(nav).toEqual({ stage: 'preferences', index: 0 });
    expect(next(nav, qs, {})).toEqual(nav);
  });
  it('walks back the same way', () => {
    expect(back({ stage: 'preferences', index: 0 }, 2)).toEqual({ stage: 'risk', index: 0 });
    expect(back({ stage: 'risk', index: 0 }, 2)).toEqual({ stage: 'questions', index: 1 });
    expect(back({ stage: 'questions', index: 1 }, 2)).toEqual({ stage: 'questions', index: 0 });
    expect(back(START, 2)).toEqual(START);
  });
  it('numbers the stages', () => {
    expect([stageNumber('questions'), stageNumber('risk'), stageNumber('preferences')]).toEqual([1, 2, 3]);
  });
});

describe('answers', () => {
  it('keeps only answers to known questions', () => {
    expect(answersFor(qs, { horizon: 5, stray: 'x' })).toEqual({ horizon: 5 });
  });
  it('builds an order-independent key', () => {
    expect(answersKey({ a: 1, b: 'x' })).toBe(answersKey({ b: 'x', a: 1 }));
    expect(answersKey({ a: 1 })).not.toBe(answersKey({ a: 2 }));
  });
});

describe('risk maths (same formula as the engine)', () => {
  const range: [number, number] = [0.02, 0.2];
  it('maps level linearly onto the volatility range', () => {
    expect(targetVol(0, range)).toBeCloseTo(0.02, 10);
    expect(targetVol(50, range)).toBeCloseTo(0.11, 10);
    expect(targetVol(100, range)).toBeCloseTo(0.2, 10);
    expect(targetVol(150, range)).toBeCloseTo(0.2, 10);
    expect(targetVol(-5, range)).toBeCloseTo(0.02, 10);
  });
  it('estimates a bad year as -1.65 volatilities', () => {
    expect(badYear(0.1)).toBeCloseTo(-0.165, 10);
  });
  it('has a sane normal CDF', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normalCdf(-1.5)).toBeCloseTo(0.0668, 3);
  });
  it('gives a rough chance of a loss of a given size', () => {
    expect(lossProbability(0.2, 0.3)).toBeCloseTo(0.0668, 3);
    expect(lossProbability(0, 0.3)).toBe(0);
  });
  it('labels levels', () => {
    expect([0, 25, 50, 70, 95].map(riskLabel)).toEqual(['Very cautious', 'Cautious', 'Balanced', 'Growth', 'Aggressive']);
  });
  it('flags a level far from the suggestion', () => {
    expect(riskNotice(70, 48)).toBe('above');
    expect(riskNotice(30, 48)).toBe('below');
    expect(riskNotice(52, 48)).toBeNull();
  });
  it('explains the limiting factor', () => {
    expect(limitingText('capacity')).toMatch(/finances/i);
    expect(limitingText('tolerance')).toMatch(/comfort/i);
    expect(limitingText('none')).toMatch(/agree/i);
  });
  it('turns a score into a profile patch', () => {
    const score = { capacity: 72, tolerance: 48.4, suggested_risk_level: 48.4, limiting_factor: 'tolerance', mismatch: true, explanation: '', horizon_years: 0 } as const;
    expect(profilePatchFromScore(score)).toEqual({ risk_level: 48, horizon_years: 1 });
  });
});

describe('preference helpers', () => {
  it('reads and writes region modes', () => {
    const p = { regions_include: ['us'], regions_exclude: ['japan'] };
    expect(regionMode(p, 'us')).toBe('include');
    expect(regionMode(p, 'japan')).toBe('exclude');
    expect(regionMode(p, 'em')).toBe('any');
    expect(setRegionMode(p, 'em', 'include')).toEqual({ regions_include: ['us', 'em'], regions_exclude: ['japan'] });
    expect(setRegionMode(p, 'us', 'exclude')).toEqual({ regions_include: [], regions_exclude: ['japan', 'us'] });
    expect(setRegionMode(p, 'japan', 'any')).toEqual({ regions_include: ['us'], regions_exclude: [] });
  });
  it('reads and writes sector modes', () => {
    const p = { sector_tilts: { technology: 0.1, healthcare: 0.05 }, sectors_exclude: ['energy'] };
    expect(sectorMode(p, 'technology')).toBe('tilt10');
    expect(sectorMode(p, 'healthcare')).toBe('tilt5');
    expect(sectorMode(p, 'energy')).toBe('exclude');
    expect(sectorMode(p, 'utilities')).toBe('neutral');
    expect(setSectorMode(p, 'energy', 'tilt5')).toEqual({
      sector_tilts: { technology: 0.1, healthcare: 0.05, energy: 0.05 }, sectors_exclude: [],
    });
    expect(setSectorMode(p, 'technology', 'exclude')).toEqual({
      sector_tilts: { healthcare: 0.05 }, sectors_exclude: ['energy', 'technology'],
    });
    expect(setSectorMode(p, 'healthcare', 'neutral').sector_tilts).toEqual({ technology: 0.1 });
  });
  it('derives options from the universe, leaving out global', () => {
    const funds = [
      { region: 'us', sector: null }, { region: 'global', sector: null }, { region: 'em', sector: 'healthcare' },
      { region: 'us', sector: 'technology' }, { region: null, sector: null },
    ] as unknown as FundSummary[];
    expect(deriveOptions(funds)).toEqual({ regions: ['em', 'us'], sectors: ['healthcare', 'technology'] });
  });
  it('labels keys', () => {
    expect(labelFor('pacific_ex_japan')).toBe('Pacific ex-Japan');
    expect(labelFor('us')).toBe('United States');
    expect(labelFor('real_estate')).toBe('Real estate');
    expect(labelFor('healthcare')).toBe('Healthcare');
  });
  it('gates crypto on the risk level', () => {
    expect(cryptoAvailable(40, 40)).toBe(true);
    expect(cryptoAvailable(39, 40)).toBe(false);
  });
  it('validates preferences', () => {
    expect(validatePreferences({})).toEqual([]);
    expect(validatePreferences({ max_etfs: 2, sector_tilts: { a: 0.05, b: 0.05, c: 0.05 } })[0]).toMatch(/3 sectors/);
    expect(validatePreferences({ sector_tilts: { a: 0.3, b: 0.3 } })[0]).toMatch(/60%/);
    expect(validatePreferences({ max_ter: 0.0001 })[0]).toMatch(/fee cap/i);
  });
  it('converts percent input to a fraction', () => {
    expect(percentToFraction(0.35)).toBe(0.0035);
    expect(percentToFraction(1)).toBe(0.01);
  });
});

describe('errorMessage', () => {
  it('prefers a string detail', () => {
    expect(errorMessage({ error: 'NoData', detail: 'run the ingest' }, 503)).toBe('run the ingest');
  });
  it('flattens FastAPI validation errors', () => {
    const err = { detail: [{ loc: ['body', 'profile', 'risk_level'], msg: 'must be <= 100' }] };
    expect(errorMessage(err, 422)).toBe('profile.risk_level: must be <= 100');
  });
  it('falls back to the status', () => {
    expect(errorMessage('', 500)).toBe('The request failed (HTTP 500).');
    expect(errorMessage(undefined)).toBe('The request failed.');
    expect(errorMessage('boom')).toBe('boom');
  });
});

describe('landing helpers', () => {
  it('sorts mix rows and drops zeros', () => {
    expect(mixRows({ bond: 0.4, equity: 0.55, cash: 0, real_estate: 0.05 })).toEqual([
      { key: 'equity', label: 'Equities', weight: 0.55 },
      { key: 'bond', label: 'Bonds', weight: 0.4 },
      { key: 'real_estate', label: 'Real estate', weight: 0.05 },
    ]);
  });
  it('formats thresholds with a true minus', () => {
    expect(thresholdLabel(0.3)).toBe('−30% or worse');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npm test`
Expected: FAIL — `Failed to resolve import "./logic"`.

- [ ] **Step 3: Write `src/intake/logic.ts`**

```ts
import type { Schemas } from '../api/client';

export type Question = Schemas['Question'];
export type Preferences = Schemas['Preferences'];
export type IntakeScore = Schemas['IntakeScore'];
export type FundSummary = Schemas['FundSummary'];
export type InvestorProfile = Schemas['InvestorProfile'];

export type AnswerValue = string | number;
export type Answers = Record<string, AnswerValue>;

// ---------- questionnaire validation and navigation ----------

export function validateAnswer(q: Question, value: AnswerValue | undefined): string | null {
  if (value === undefined || value === '') {
    return q.type === 'single' ? 'Please choose an answer to continue.' : 'Please enter a number to continue.';
  }
  if (q.type === 'single') {
    return (q.options ?? []).some((o) => o.value === value) ? null : 'Please choose one of the options.';
  }
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 'Enter a number.';
  if (q.min != null && n < q.min) return `Enter ${q.min} or more.`;
  if (q.max != null && n > q.max) return `Enter ${q.max} or less.`;
  return null;
}

export type Stage = 'questions' | 'risk' | 'preferences';
export interface Nav {
  stage: Stage;
  index: number;
}

export const START: Nav = { stage: 'questions', index: 0 };

export function next(nav: Nav, questions: Question[], answers: Answers): Nav {
  if (nav.stage === 'questions') {
    const q = questions[nav.index];
    if (!q || validateAnswer(q, answers[q.id]) !== null) return nav;
    return nav.index + 1 < questions.length ? { stage: 'questions', index: nav.index + 1 } : { stage: 'risk', index: 0 };
  }
  if (nav.stage === 'risk') return { stage: 'preferences', index: 0 };
  return nav;
}

export function back(nav: Nav, questionCount: number): Nav {
  if (nav.stage === 'preferences') return { stage: 'risk', index: 0 };
  if (nav.stage === 'risk') return { stage: 'questions', index: Math.max(0, questionCount - 1) };
  return nav.index > 0 ? { stage: 'questions', index: nav.index - 1 } : nav;
}

export function stageNumber(stage: Stage): 1 | 2 | 3 {
  return stage === 'questions' ? 1 : stage === 'risk' ? 2 : 3;
}

export function answersFor(questions: Question[], answers: Answers): Answers {
  const out: Answers = {};
  for (const q of questions) if (answers[q.id] !== undefined) out[q.id] = answers[q.id];
  return out;
}

export function answersKey(answers: Answers): string {
  return JSON.stringify(Object.entries(answers).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

// ---------- risk maths ----------

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Same formula as the engine (spec §5.5): vmin + level/100 * (vmax - vmin). */
export function targetVol(level: number, volRange: readonly [number, number]): number {
  const [vmin, vmax] = volRange;
  return vmin + (clamp(level, 0, 100) / 100) * (vmax - vmin);
}

/** Rough "typical bad year": about a 1-in-20 outcome for a normal distribution (1.65 sigma). Ignores expected return. */
export const BAD_YEAR_Z = 1.65;
export const badYear = (vol: number): number => -BAD_YEAR_Z * vol;

/** Standard normal CDF, Abramowitz and Stegun 26.2.17 (error below 1e-7). */
export function normalCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

/** Rough chance that one calendar year loses `threshold` or more (0.3 = 30%), zero drift, normal returns. */
export function lossProbability(vol: number, threshold: number): number {
  return vol <= 0 ? 0 : normalCdf(-threshold / vol);
}

export function riskLabel(level: number): string {
  if (level < 20) return 'Very cautious';
  if (level < 40) return 'Cautious';
  if (level < 60) return 'Balanced';
  if (level < 80) return 'Growth';
  return 'Aggressive';
}

const NOTICE_GAP = 10;
export function riskNotice(level: number, suggested: number): 'above' | 'below' | null {
  if (level - suggested >= NOTICE_GAP) return 'above';
  if (suggested - level >= NOTICE_GAP) return 'below';
  return null;
}

export function limitingText(factor: IntakeScore['limiting_factor']): string {
  switch (factor) {
    case 'capacity':
      return 'Your finances are the limit here, so the suggestion follows what you can afford to lose.';
    case 'tolerance':
      return 'Your comfort with losses is the limit here, so the suggestion follows how much swing you can stomach.';
    default:
      return 'What you can afford and what you are comfortable with agree.';
  }
}

export function profilePatchFromScore(score: IntakeScore): { risk_level: number; horizon_years: number } {
  return {
    risk_level: Math.round(clamp(score.suggested_risk_level, 0, 100)),
    horizon_years: Math.max(1, Math.round(score.horizon_years)),
  };
}

// ---------- preferences ----------

export const PREF_DEFAULTS = {
  hedge_bonds: true,
  esg_only: false,
  max_etfs: 10,
  distribution: 'any' as 'acc' | 'dist' | 'any',
  crypto_max: 0,
};

export type RegionMode = 'any' | 'include' | 'exclude';
type RegionPrefs = Pick<Preferences, 'regions_include' | 'regions_exclude'>;

export function regionMode(p: RegionPrefs, region: string): RegionMode {
  if ((p.regions_include ?? []).includes(region)) return 'include';
  if ((p.regions_exclude ?? []).includes(region)) return 'exclude';
  return 'any';
}

export function setRegionMode(p: RegionPrefs, region: string, mode: RegionMode): Required<RegionPrefs> {
  const inc = (p.regions_include ?? []).filter((r) => r !== region);
  const exc = (p.regions_exclude ?? []).filter((r) => r !== region);
  if (mode === 'include') inc.push(region);
  if (mode === 'exclude') exc.push(region);
  return { regions_include: inc, regions_exclude: exc };
}

export type SectorMode = 'neutral' | 'tilt5' | 'tilt10' | 'exclude';
type SectorPrefs = Pick<Preferences, 'sector_tilts' | 'sectors_exclude'>;
const TILT_WEIGHT = { tilt5: 0.05, tilt10: 0.1 } as const;

export function sectorMode(p: SectorPrefs, sector: string): SectorMode {
  if ((p.sectors_exclude ?? []).includes(sector)) return 'exclude';
  const w = (p.sector_tilts ?? {})[sector];
  if (w === undefined) return 'neutral';
  return w >= 0.075 ? 'tilt10' : 'tilt5';
}

export function setSectorMode(p: SectorPrefs, sector: string, mode: SectorMode): Required<SectorPrefs> {
  const tilts = { ...(p.sector_tilts ?? {}) };
  delete tilts[sector];
  const exc = (p.sectors_exclude ?? []).filter((s) => s !== sector);
  if (mode === 'tilt5' || mode === 'tilt10') tilts[sector] = TILT_WEIGHT[mode];
  if (mode === 'exclude') exc.push(sector);
  return { sector_tilts: tilts, sectors_exclude: exc };
}

export function deriveOptions(funds: FundSummary[]): { regions: string[]; sectors: string[] } {
  const regions = new Set<string>();
  const sectors = new Set<string>();
  for (const f of funds) {
    if (f.region && f.region !== 'global') regions.add(f.region);
    if (f.sector) sectors.add(f.sector);
  }
  return { regions: [...regions].sort(), sectors: [...sectors].sort() };
}

const LABELS: Record<string, string> = {
  us: 'United States', uk: 'United Kingdom', em: 'Emerging markets', europe: 'Europe', japan: 'Japan',
  pacific_ex_japan: 'Pacific ex-Japan', equity: 'Equities', bond: 'Bonds', commodity: 'Commodities',
  real_estate: 'Real estate', cash: 'Cash', crypto: 'Crypto',
};

export function labelFor(key: string): string {
  if (LABELS[key]) return LABELS[key];
  const s = key.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const cryptoAvailable = (level: number, minLevel: number): boolean => level >= minLevel;

export function validatePreferences(p: Preferences): string[] {
  const errors: string[] = [];
  const tilts = Object.values(p.sector_tilts ?? {});
  const maxEtfs = p.max_etfs ?? PREF_DEFAULTS.max_etfs;
  if (tilts.length > maxEtfs) {
    errors.push(`You tilt toward ${tilts.length} sectors but allow only ${maxEtfs} funds. Raise the fund limit or remove a tilt.`);
  }
  const total = tilts.reduce((a, b) => a + b, 0);
  if (total > 0.5) {
    errors.push(`Sector tilts add up to ${Math.round(total * 100)}%, which leaves too little for the rest of the portfolio. Keep them at or below 50%.`);
  }
  if (p.max_ter != null && p.max_ter < 0.0005) {
    errors.push('The fee cap is below 0.05%, which almost no fund meets. Raise it or turn it off.');
  }
  return errors;
}

/** The form shows fees in percent (0.35), the API wants a fraction (0.0035). */
export const percentToFraction = (x: number): number => Math.round(x * 1e6) / 1e8;

// ---------- API errors ----------

export function errorMessage(error: unknown, status?: number): string {
  if (typeof error === 'string' && error.trim()) return error.trim();
  if (error && typeof error === 'object' && 'detail' in error) {
    const detail = (error as { detail: unknown }).detail;
    if (typeof detail === 'string' && detail) return detail;
    if (Array.isArray(detail)) {
      const parts = detail.map((d) => {
        if (d && typeof d === 'object' && 'msg' in d) {
          const loc = (d as { loc?: unknown }).loc;
          const where = Array.isArray(loc) ? loc.filter((x) => x !== 'body').join('.') : '';
          const msg = String((d as { msg: unknown }).msg);
          return where ? `${where}: ${msg}` : msg;
        }
        return String(d);
      });
      if (parts.length) return parts.join('; ');
    }
  }
  return status ? `The request failed (HTTP ${status}).` : 'The request failed.';
}

// ---------- landing page ----------

export function mixRows(mix: Record<string, number>): { key: string; label: string; weight: number }[] {
  return Object.entries(mix)
    .filter(([, w]) => w > 0)
    .map(([key, weight]) => ({ key, label: labelFor(key), weight }))
    .sort((a, b) => b.weight - a.weight);
}

export const thresholdLabel = (t: number): string => `−${Math.round(t * 100)}% or worse`;

/** Profile behind the landing page example (a balanced ten-year investor). */
export const DEMO_PROFILE: InvestorProfile = {
  risk_level: 50,
  horizon_years: 10,
  base_currency: 'EUR',
  preferences: {},
};
```

- [ ] **Step 4: Run tests and typecheck**

Run: `cd frontend && npm test && npm run typecheck`
Expected: all tests PASS (Phase 0's 2 plus the new ones); no type errors.

If `validatePreferences({ sector_tilts: { a: 0.3, b: 0.3 } })` fails the `/60%/` assertion, recheck: 0.3 + 0.3 = 0.6 (floating-point sum is 0.6, `Math.round(60.0…)` is 60). It passes.

- [ ] **Step 5: Commit**

```bash
cd .. && git rm -f --ignore-unmatch frontend/src/intake/.gitkeep
git add frontend/src/intake/logic.ts frontend/src/intake/logic.test.ts
git commit -m "feat(intake): pure logic for validation, navigation, risk maths and preferences"
```

---

### Task 2: Request plumbing (unwrap, useRequest, Loading/ErrorBox)

**Files:**
- Create: `frontend/src/intake/request.ts`, `frontend/src/intake/useRequest.ts`, `frontend/src/intake/ApiState.tsx`
- Test: `frontend/src/intake/request.test.ts`

**Interfaces:**
- Consumes: `errorMessage` from `./logic`; `Button` from `../components/ui`.
- Produces:
  - `class ApiError extends Error`
  - `unwrap<T>(request: Promise<{ data?: T; error?: unknown; response: Response }>): Promise<T>` — resolves with `data`, rejects with `ApiError` carrying a readable message (server `detail` when present, network failures explained).
  - `type RequestState<T> = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ok'; data: T }`
  - `useRequest<T>(load: () => Promise<T>, deps: readonly unknown[]): [RequestState<T>, () => void]` (second element retries)
  - `<Loading label?: string />` (role `status`), `<ErrorBox message: string; onRetry?: () => void />` (role `alert`)

- [ ] **Step 1: Write the failing test**

`frontend/src/intake/request.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ApiError, unwrap } from './request';

const res = (status: number) => new Response(null, { status });

describe('unwrap', () => {
  it('returns data on success', async () => {
    await expect(unwrap(Promise.resolve({ data: { a: 1 }, response: res(200) }))).resolves.toEqual({ a: 1 });
  });
  it('rejects with the server detail', async () => {
    const p = unwrap(Promise.resolve({ error: { error: 'NoEligibleFunds', detail: 'nothing left after filters' }, response: res(422) }));
    await expect(p).rejects.toThrow('nothing left after filters');
    await expect(p).rejects.toBeInstanceOf(ApiError);
  });
  it('rejects with the status when the body is empty', async () => {
    await expect(unwrap(Promise.resolve({ error: '', response: res(500) }))).rejects.toThrow('HTTP 500');
  });
  it('explains network failures', async () => {
    await expect(unwrap(Promise.reject(new TypeError('Failed to fetch')))).rejects.toThrow(/could not reach the server/i);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npm test -- request`
Expected: FAIL — `Failed to resolve import "./request"`.

- [ ] **Step 3: Write `request.ts`**

```ts
import { errorMessage } from './logic';

export class ApiError extends Error {}

interface Result<T> {
  data?: T;
  error?: unknown;
  response: Response;
}

/** Turn an openapi-fetch result into its data, or throw an ApiError with a message fit to show a person. */
export async function unwrap<T>(request: Promise<Result<T>>): Promise<T> {
  let result: Result<T>;
  try {
    result = await request;
  } catch (e) {
    const why = e instanceof Error ? e.message : 'network error';
    throw new ApiError(`Could not reach the server (${why}). Is the backend running on port 8740?`);
  }
  if (result.error !== undefined || result.data === undefined) {
    throw new ApiError(errorMessage(result.error, result.response.status));
  }
  return result.data;
}
```

- [ ] **Step 4: Write `useRequest.ts`**

```ts
import { useEffect, useState } from 'react';

export type RequestState<T> = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ok'; data: T };

/** Runs `load` on mount and whenever `deps` change. The second return value retries. */
export function useRequest<T>(load: () => Promise<T>, deps: readonly unknown[]): [RequestState<T>, () => void] {
  const [state, setState] = useState<RequestState<T>>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setState({ status: 'loading' });
    load().then(
      (data) => alive && setState({ status: 'ok', data }),
      (e) => alive && setState({ status: 'error', message: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      alive = false;
    };
    // `load` is intentionally not a dependency: callers list what should trigger a reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, attempt]);

  return [state, () => setAttempt((a) => a + 1)];
}
```

- [ ] **Step 5: Write `ApiState.tsx`**

```tsx
import { Button } from '../components/ui';

export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <p role="status" className="api-loading">
      <span className="api-spinner" aria-hidden="true" />
      {label}…
    </p>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="api-error">
      <strong>Something went wrong.</strong>
      <p>{message}</p>
      {onRetry && (
        <Button type="button" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}
```

(Styles for `.api-loading`, `.api-spinner`, `.api-error` are added in Task 3's `intake.css`; Landing imports it too, see Task 6.)

- [ ] **Step 6: Run tests and typecheck**

Run: `cd frontend && npm test && npm run typecheck`
Expected: PASS, no type errors. If `unwrap<T>` inference complains at a call site later, pass the type explicitly (`unwrap<Schemas['Defaults']>(...)`); all call sites in this plan already do.

- [ ] **Step 7: Commit**

```bash
cd .. && git add frontend/src/intake/request.ts frontend/src/intake/request.test.ts frontend/src/intake/useRequest.ts frontend/src/intake/ApiState.tsx
git commit -m "feat(intake): request helpers with readable API errors and loading states"
```

---

### Task 3: Wizard shell, question step and Start page

**Files:**
- Create: `frontend/src/intake/intake.css`, `frontend/src/intake/FormWizard.tsx`, `frontend/src/intake/QuestionStep.tsx`
- Create placeholders (replaced in Tasks 4 and 5): `frontend/src/intake/RiskStep.tsx`, `frontend/src/intake/PreferencesStep.tsx`
- Modify (overwrite Phase 0 stub): `frontend/src/pages/Start.tsx`

**Interfaces:**
- Consumes: Task 1 and 2 exports; store (`useStore`); `api`, `Schemas` from `../api/client`; `PageHeader`, `Button` from `../components/ui`.
- Produces:
  - `FormWizard(): JSX.Element` — the intake channel.
  - `QuestionStep` props: `{ question: Question; index: number; total: number; value: AnswerValue | undefined; onChange(v: AnswerValue): void; onNext(): void; onBack: (() => void) | null }`.
  - `RiskStep` props (final signature, placeholder for now): `{ answers: Answers; defaults: Schemas['Defaults']; scoredKey: string | null; onScored(key: string): void; onBack(): void; onNext(): void }`.
  - `PreferencesStep` props (final): `{ defaults: Schemas['Defaults']; onBack(): void; onFinish(): void }`.
  - CSS classes used by later tasks: `.wiz`, `.wiz-steps`, `.wiz-panel`, `.wiz-kicker`, `.wiz-actions`, `.wiz-error`, `.choices`, `.choice`, `.field`, `.field-row`, `.callout`, `.meter`, `.api-*`.

- [ ] **Step 1: Write `intake.css`** (uses tokens only)

```css
/* ---------- shared API states ---------- */
.api-loading { display: flex; align-items: center; gap: var(--space-3); color: var(--ink-2); margin: var(--space-5) 0; }
.api-spinner { width: 16px; height: 16px; border-radius: 50%; border: 2px solid var(--line); border-top-color: var(--accent); animation: api-spin 0.8s linear infinite; }
@keyframes api-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .api-spinner { animation-duration: 3s; } }
.api-error { border: 1px solid var(--neg); border-left-width: 4px; border-radius: var(--radius-sm); background: var(--surface); padding: var(--space-4); margin: var(--space-4) 0; }
.api-error p { margin: var(--space-2) 0 var(--space-3); color: var(--ink-2); overflow-wrap: anywhere; }

/* ---------- wizard frame ---------- */
.wiz { max-width: 720px; margin: 0 auto; }
.wiz-steps { display: flex; gap: var(--space-2); list-style: none; padding: 0; margin: 0 0 var(--space-5); }
.wiz-steps li { flex: 1; font-size: 13px; color: var(--ink-3); border-top: 3px solid var(--line); padding-top: var(--space-2); }
.wiz-steps li[aria-current='step'] { color: var(--ink); border-top-color: var(--accent); font-weight: 600; }
.wiz-steps li.is-done { color: var(--ink-2); border-top-color: var(--ink-2); }
.wiz-progress { height: 4px; background: var(--surface-2); border-radius: 2px; margin: 0 0 var(--space-5); overflow: hidden; }
.wiz-progress > div { height: 100%; background: var(--accent); transition: width 0.25s ease; }
.wiz-panel { outline: none; }
.wiz-panel:focus-visible { outline: none; }
.wiz-kicker { font-size: 13px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--ink-3); margin: 0 0 var(--space-2); }
.wiz h2 { margin-bottom: var(--space-4); }
.wiz-actions { display: flex; justify-content: space-between; align-items: center; gap: var(--space-3); margin-top: var(--space-5); flex-wrap: wrap; }
.wiz-actions .btn { min-height: 44px; }
.wiz-error { color: var(--neg); margin: var(--space-3) 0 0; font-weight: 500; }

/* ---------- radio cards ---------- */
.choices { display: grid; gap: var(--space-3); }
.choice { display: flex; align-items: center; gap: var(--space-3); min-height: 56px; padding: var(--space-3) var(--space-4); background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); cursor: pointer; transition: border-color 0.15s, background 0.15s; }
.choice:hover { border-color: var(--ink-3); }
.choice input { accent-color: var(--accent); width: 20px; height: 20px; flex: none; margin: 0; }
.choice.is-selected { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 10%, var(--surface)); }
.choice:has(input:focus-visible) { outline: 2px solid var(--focus); outline-offset: 2px; }

/* ---------- number question ---------- */
.number-q { display: grid; gap: var(--space-4); }
.number-q .number-input { display: flex; align-items: baseline; gap: var(--space-3); }
.number-q input[type='number'] { width: 7.5rem; font: 500 2rem var(--font-mono); font-variant-numeric: tabular-nums; padding: var(--space-2) var(--space-3); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface); color: var(--ink); }
.number-q .unit { color: var(--ink-2); }
input[type='range'] { width: 100%; accent-color: var(--accent); min-height: 32px; }

/* ---------- generic form fields ---------- */
.field { display: grid; gap: var(--space-2); margin: 0 0 var(--space-5); padding: 0; border: 0; min-width: 0; }
.field > legend, .field > .field-label { font-weight: 600; padding: 0; margin-bottom: var(--space-2); }
.field-hint { font-size: 14px; color: var(--ink-2); margin: 0; }
.field-row { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
.check { display: flex; align-items: flex-start; gap: var(--space-3); min-height: 32px; cursor: pointer; }
.check input { accent-color: var(--accent); width: 20px; height: 20px; margin: 2px 0 0; flex: none; }
.wiz select, .wiz input[type='number'].plain { min-height: 40px; padding: var(--space-1) var(--space-3); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface); color: var(--ink); font: 15px var(--font-sans); }
.seg { display: inline-flex; border: 1px solid var(--line); border-radius: var(--radius-sm); overflow: hidden; background: var(--surface); }
.seg label { padding: var(--space-2) var(--space-4); min-height: 44px; display: flex; align-items: center; cursor: pointer; }
.seg input { position: absolute; opacity: 0; pointer-events: none; }
.seg label.is-selected { background: var(--ink); color: var(--bg); }
.seg label:has(input:focus-visible) { outline: 2px solid var(--focus); outline-offset: -2px; }
.pref-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 240px), 1fr)); gap: var(--space-2) var(--space-4); }
.pref-grid label { display: flex; justify-content: space-between; align-items: center; gap: var(--space-3); padding: var(--space-1) 0; border-bottom: 1px solid var(--line); }
.form-errors { border: 1px solid var(--warn); border-left-width: 4px; border-radius: var(--radius-sm); padding: var(--space-3) var(--space-4); margin: 0 0 var(--space-4); background: var(--surface); }
.form-errors p { margin: var(--space-1) 0; }

/* ---------- risk step ---------- */
.callout { border-left: 4px solid var(--accent); background: var(--surface); border-radius: var(--radius-sm); padding: var(--space-4); margin: var(--space-4) 0; }
.callout.is-warn { border-left-color: var(--warn); }
.callout h3 { margin-bottom: var(--space-2); font-size: 1.05rem; }
.callout p { margin: var(--space-1) 0; color: var(--ink-2); }
.meters { display: grid; gap: var(--space-4); grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr)); margin: var(--space-4) 0; }
.meter-label { display: flex; justify-content: space-between; font-size: 14px; margin-bottom: var(--space-1); }
.meter-track { height: 10px; border-radius: 5px; background: var(--surface-2); overflow: hidden; }
.meter-fill { height: 100%; background: var(--series-1); }
.meter-sub { font-size: 13px; color: var(--ink-3); margin-top: var(--space-1); }
.risk-readout { display: flex; align-items: baseline; gap: var(--space-3); flex-wrap: wrap; margin-bottom: var(--space-2); }
.risk-number { font: 600 clamp(3rem, 12vw, 4.5rem) var(--font-display); line-height: 1; font-variant-numeric: tabular-nums; }
.risk-name { font: 400 1.5rem var(--font-display); color: var(--ink-2); }
.risk-scale { display: flex; justify-content: space-between; font-size: 12px; color: var(--ink-3); }
.live-grid { display: grid; gap: var(--space-4); grid-template-columns: repeat(auto-fit, minmax(min(100%, 200px), 1fr)); margin-top: var(--space-4); }
.live-grid .neg { color: var(--neg); }
.fineprint { font-size: 13px; color: var(--ink-3); margin: var(--space-3) 0 0; }

@media (max-width: 480px) {
  .wiz-steps li { font-size: 12px; }
  .wiz-actions { flex-direction: column-reverse; align-items: stretch; }
  .wiz-actions .btn { justify-content: center; }
}
```

- [ ] **Step 2: Write `QuestionStep.tsx`**

```tsx
import { useState, type FormEvent } from 'react';
import { Button } from '../components/ui';
import { validateAnswer, type AnswerValue, type Question } from './logic';

interface Props {
  question: Question;
  index: number;
  total: number;
  value: AnswerValue | undefined;
  onChange(v: AnswerValue): void;
  onNext(): void;
  onBack: (() => void) | null;
}

function NumberField({ question, value, onChange }: { question: Question; value: AnswerValue | undefined; onChange(v: AnswerValue): void }) {
  const [text, setText] = useState(value === undefined ? '' : String(value));
  const hasRange = question.min != null && question.max != null;
  const set = (t: string) => {
    setText(t);
    onChange(t.trim() === '' ? '' : Number(t));
  };
  const sliderValue = Math.min(question.max ?? 0, Math.max(question.min ?? 0, Number(text) || (question.min ?? 0)));
  return (
    <div className="number-q">
      <div className="number-input">
        <input
          id={`in-${question.id}`}
          type="number"
          inputMode="decimal"
          min={question.min ?? undefined}
          max={question.max ?? undefined}
          step="any"
          value={text}
          aria-labelledby={`q-${question.id}`}
          onChange={(e) => set(e.target.value)}
        />
        {question.unit && <span className="unit">{question.unit}</span>}
      </div>
      {hasRange && (
        <>
          {/* Pointer and touch shortcut for the number field; keyboard users use the field above. */}
          <input
            type="range"
            min={question.min ?? 0}
            max={question.max ?? 0}
            step={1}
            value={sliderValue}
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => set(e.target.value)}
          />
          <p className="field-hint">
            Between {question.min} and {question.max}
            {question.unit ? ` ${question.unit}` : ''}. Type a number or drag the slider.
          </p>
        </>
      )}
    </div>
  );
}

export function QuestionStep({ question, index, total, value, onChange, onNext, onBack }: Props) {
  const [showError, setShowError] = useState(false);
  const error = validateAnswer(question, value);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (error) {
      setShowError(true);
      return;
    }
    onNext();
  };

  return (
    <form onSubmit={submit} noValidate>
      <p className="wiz-kicker">
        Question {index + 1} of {total}
      </p>
      <h2 id={`q-${question.id}`}>{question.text}</h2>
      {question.help && <p className="muted">{question.help}</p>}

      {question.type === 'single' ? (
        <div role="radiogroup" aria-labelledby={`q-${question.id}`} className="choices">
          {(question.options ?? []).map((o) => (
            <label key={o.value} className={`choice ${value === o.value ? 'is-selected' : ''}`}>
              <input type="radio" name={question.id} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} />
              <span>{o.label}</span>
            </label>
          ))}
        </div>
      ) : (
        <NumberField question={question} value={value} onChange={onChange} />
      )}

      {showError && error && (
        <p role="alert" className="wiz-error">
          {error}
        </p>
      )}

      <div className="wiz-actions">
        {onBack ? (
          <Button type="button" onClick={onBack}>
            Back
          </Button>
        ) : (
          <span />
        )}
        <Button type="submit" variant="primary">
          {index + 1 === total ? 'See my risk level' : 'Next'}
        </Button>
      </div>
    </form>
  );
}
```

- [ ] **Step 3: Write placeholder steps** (so the wizard compiles; Tasks 4 and 5 overwrite them with the final code)

`frontend/src/intake/RiskStep.tsx`:

```tsx
import type { Schemas } from '../api/client';
import type { Answers } from './logic';

export interface RiskStepProps {
  answers: Answers;
  defaults: Schemas['Defaults'];
  scoredKey: string | null;
  onScored(key: string): void;
  onBack(): void;
  onNext(): void;
}

export function RiskStep(_props: RiskStepProps) {
  return <h2>Your risk level</h2>;
}
```

`frontend/src/intake/PreferencesStep.tsx`:

```tsx
import type { Schemas } from '../api/client';

export interface PreferencesStepProps {
  defaults: Schemas['Defaults'];
  onBack(): void;
  onFinish(): void;
}

export function PreferencesStep(_props: PreferencesStepProps) {
  return <h2>Your preferences</h2>;
}
```

- [ ] **Step 4: Write `FormWizard.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type Schemas } from '../api/client';
import { useStore } from '../state/store';
import { ErrorBox, Loading } from './ApiState';
import { back, next, stageNumber, START, type AnswerValue, type Nav } from './logic';
import { unwrap } from './request';
import { useRequest } from './useRequest';
import { PreferencesStep } from './PreferencesStep';
import { QuestionStep } from './QuestionStep';
import { RiskStep } from './RiskStep';
import './intake.css';

const STEP_NAMES = ['Your situation', 'Your risk level', 'Your preferences'];

/** The v1 intake channel (spec §8.1): fills the shared store; result pages only read it. */
export function FormWizard() {
  const [state, dispatch] = useStore();
  const navigate = useNavigate();
  const [nav, setNav] = useState<Nav>(START);
  const [scoredKey, setScoredKey] = useState<string | null>(null);

  const [qn, retryQn] = useRequest(() => unwrap<Schemas['Questionnaire']>(api.GET('/api/intake/questionnaire')), []);
  const [defaults, retryDefaults] = useRequest(() => unwrap<Schemas['Defaults']>(api.GET('/api/defaults')), []);

  // Move focus to the new step when the position changes (not on first render).
  const panel = useRef<HTMLDivElement>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    panel.current?.focus();
    window.scrollTo({ top: 0 });
  }, [nav.stage, nav.index]);

  if (qn.status === 'loading' || defaults.status === 'loading') return <Loading label="Loading the questionnaire" />;
  if (qn.status === 'error' || defaults.status === 'error') {
    const message = qn.status === 'error' ? qn.message : defaults.status === 'error' ? defaults.message : '';
    return (
      <ErrorBox
        message={message}
        onRetry={() => {
          retryQn();
          retryDefaults();
        }}
      />
    );
  }

  const questions = qn.data.questions;
  const stage = stageNumber(nav.stage);
  const question = nav.stage === 'questions' ? questions[nav.index] : undefined;
  const fraction = nav.stage === 'questions' ? nav.index / questions.length : 1;

  return (
    <div className="wiz">
      <ol className="wiz-steps" aria-label="Progress">
        {STEP_NAMES.map((name, i) => (
          <li key={name} aria-current={stage === i + 1 ? 'step' : undefined} className={stage > i + 1 ? 'is-done' : ''}>
            {i + 1}. {name}
          </li>
        ))}
      </ol>
      {nav.stage === 'questions' && (
        <div
          className="wiz-progress"
          role="progressbar"
          aria-label="Questions answered"
          aria-valuemin={0}
          aria-valuemax={questions.length}
          aria-valuenow={nav.index}
        >
          <div style={{ width: `${Math.round(fraction * 100)}%` }} />
        </div>
      )}

      <div className="wiz-panel" tabIndex={-1} ref={panel}>
        {question && (
          <QuestionStep
            key={question.id}
            question={question}
            index={nav.index}
            total={questions.length}
            value={state.answers[question.id]}
            onChange={(value: AnswerValue) => dispatch({ type: 'setAnswer', id: question.id, value })}
            onNext={() => setNav(next(nav, questions, state.answers))}
            onBack={nav.index > 0 ? () => setNav(back(nav, questions.length)) : null}
          />
        )}
        {nav.stage === 'risk' && (
          <RiskStep
            answers={state.answers}
            defaults={defaults.data}
            scoredKey={scoredKey}
            onScored={setScoredKey}
            onBack={() => setNav(back(nav, questions.length))}
            onNext={() => setNav(next(nav, questions, state.answers))}
          />
        )}
        {nav.stage === 'preferences' && (
          <PreferencesStep
            defaults={defaults.data}
            onBack={() => setNav(back(nav, questions.length))}
            onFinish={() => navigate('/portfolio')}
          />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Write `pages/Start.tsx`**

```tsx
import { PageHeader } from '../components/ui';
import { FormWizard } from '../intake/FormWizard';

export default function Start() {
  return (
    <>
      <PageHeader
        title="Build your portfolio"
        lead="A few questions about your situation, then you set your own risk level. About three minutes, nothing is stored on our servers."
      />
      <FormWizard />
    </>
  );
}
```

- [ ] **Step 6: Typecheck and test**

Run: `cd frontend && npm run typecheck && npm test`
Expected: no errors; tests pass.

- [ ] **Step 7: Verify in the browser**

Run: `cd frontend && npm run dev:mock`, open `http://localhost:5740/start`.
Expected: "Loading the questionnaire…" for about 0.2 s, then the progress header and question 1 of 3 ("When will you need this money?" with a number field and slider). Clicking Next with an empty field shows "Please enter a number to continue." Answering 10 and pressing Enter advances. Question 2 shows three radio cards; selecting one highlights it; Back returns to question 1 with the value kept. Answering all three shows the placeholder "Your risk level" heading. Stop the server.

- [ ] **Step 8: Commit**

```bash
cd .. && git add frontend/src/intake frontend/src/pages/Start.tsx
git commit -m "feat(intake): wizard shell with questionnaire step, progress and error states"
```

---

### Task 4: Risk level step

**Files:**
- Modify (overwrite placeholder): `frontend/src/intake/RiskStep.tsx`

**Interfaces:**
- Consumes: `RiskStepProps` shape from Task 3 (kept identical); `useStore`; `api`; `unwrap`, `useRequest`, `Loading`, `ErrorBox`; from `logic`: `answersFor`? (not needed here), `answersKey`, `badYear`, `limitingText`, `lossProbability`, `profilePatchFromScore`, `riskLabel`, `riskNotice`, `targetVol`; `Stat`, `Button`, `pct`.
- Produces: `RiskStep` and `RiskStepProps` (unchanged signature). On success the store has `score` set and `profile.risk_level` / `profile.horizon_years` initialised from it; slider changes dispatch `setProfile({ risk_level })`.

Behaviour: scores once per distinct set of answers (`scoredKey` remembers). Coming back from preferences with unchanged answers keeps the user's slider position; changing an answer re-scores and resets the slider to the new suggestion.

- [ ] **Step 1: Write `RiskStep.tsx`**

```tsx
import { useEffect } from 'react';
import { api, type Schemas } from '../api/client';
import { Button, Stat, pct } from '../components/ui';
import { useStore } from '../state/store';
import { ErrorBox, Loading } from './ApiState';
import {
  answersKey, badYear, limitingText, lossProbability, profilePatchFromScore, riskLabel, riskNotice, targetVol,
  type Answers, type IntakeScore,
} from './logic';
import { unwrap } from './request';
import { useRequest } from './useRequest';

export interface RiskStepProps {
  answers: Answers;
  defaults: Schemas['Defaults'];
  scoredKey: string | null;
  onScored(key: string): void;
  onBack(): void;
  onNext(): void;
}

function Meter({ label, value, sub }: { label: string; value: number; sub: string }) {
  return (
    <div>
      <div className="meter-label">
        <span>{label}</span>
        <span className="num">{Math.round(value)}</span>
      </div>
      <div className="meter-track" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value)}>
        <div className="meter-fill" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
      <div className="meter-sub">{sub}</div>
    </div>
  );
}

export function RiskStep({ answers, defaults, scoredKey, onScored, onBack, onNext }: RiskStepProps) {
  const [state, dispatch] = useStore();
  const key = answersKey(answers);
  const needsScore = state.score === null || scoredKey !== key;

  const [res, retry] = useRequest<IntakeScore>(
    () => (needsScore ? unwrap<IntakeScore>(api.POST('/api/intake/score', { body: { answers } })) : Promise.resolve(state.score as IntakeScore)),
    [key],
  );

  useEffect(() => {
    if (res.status === 'ok' && needsScore) {
      dispatch({ type: 'setScore', score: res.data });
      dispatch({ type: 'setProfile', patch: profilePatchFromScore(res.data) });
      onScored(key);
    }
    // Run once per successful response.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [res]);

  if (res.status === 'loading') return <Loading label="Working out your risk profile" />;
  if (res.status === 'error') {
    return (
      <>
        <ErrorBox message={res.message} onRetry={retry} />
        <div className="wiz-actions">
          <Button type="button" onClick={onBack}>
            Back
          </Button>
          <span />
        </div>
      </>
    );
  }

  const score = res.data;
  const level = state.profile.risk_level;
  const vol = targetVol(level, defaults.vol_range);
  const notice = riskNotice(level, score.suggested_risk_level);
  const suggested = Math.round(score.suggested_risk_level);

  return (
    <div>
      <p className="wiz-kicker">Step 2 of 3</p>
      <h2>Your risk level</h2>
      <p className="muted">
        We measured two different things. How much loss your finances could absorb (capacity) and how much swing you are comfortable with (tolerance).
        The suggestion follows the lower of the two. The final number is yours to set.
      </p>

      <div className="meters">
        <Meter label="What you can afford (capacity)" value={score.capacity} sub="From your horizon, income, savings and need for the money." />
        <Meter label="What you can stomach (tolerance)" value={score.tolerance} sub="From how you react to losses and your investing experience." />
      </div>

      <div className={`callout ${score.mismatch ? 'is-warn' : ''}`}>
        {score.mismatch && <h3>Your answers point in different directions</h3>}
        <p>{score.explanation}</p>
        <p>{limitingText(score.limiting_factor)}</p>
      </div>

      <div className="field">
        <label className="field-label" htmlFor="risk-level">
          Choose your risk level (0 to 100)
        </label>
        <div className="risk-readout">
          <span className="risk-number">{Math.round(level)}</span>
          <span className="risk-name">{riskLabel(level)}</span>
        </div>
        <input
          id="risk-level"
          type="range"
          min={0}
          max={100}
          step={1}
          value={level}
          aria-valuetext={`${Math.round(level)}, ${riskLabel(level)}`}
          onChange={(e) => dispatch({ type: 'setProfile', patch: { risk_level: Number(e.target.value) } })}
        />
        <div className="risk-scale" aria-hidden="true">
          <span>Capital preservation</span>
          <span>Maximum growth</span>
        </div>
        <div className="field-row">
          <span className="field-hint">
            Suggested for you: <span className="num">{suggested}</span>
          </span>
          {Math.round(level) !== suggested && (
            <Button type="button" onClick={() => dispatch({ type: 'setProfile', patch: { risk_level: suggested } })}>
              Use the suggestion
            </Button>
          )}
        </div>
        {notice === 'above' && (
          <p className="wiz-error" role="status">
            This is well above what your answers support. That is allowed, but expect deeper and longer losses than you told us you are comfortable with.
          </p>
        )}
        {notice === 'below' && (
          <p className="field-hint" role="status">
            This is more cautious than your answers suggest. Lower risk usually means lower long-run growth.
          </p>
        )}
      </div>

      <section aria-labelledby="means-h" aria-live="polite">
        <h3 id="means-h">What this means</h3>
        <div className="live-grid">
          <Stat
            label="Target volatility"
            value={<span className="num">{pct(vol)}</span>}
            hint={`Typical yearly ups and downs. The scale runs from ${pct(defaults.vol_range[0], 0)} at level 0 to ${pct(defaults.vol_range[1], 0)} at level 100.`}
          />
          <Stat
            label="A typical bad year"
            value={<span className="num neg">{pct(badYear(vol), 0)}</span>}
            hint="Roughly 1.65 times the volatility: about one year in twenty is worse. A rough guide only."
          />
          <Stat
            label="Chance of a −30% year"
            value={<span className="num">{pct(lossProbability(vol, 0.3))}</span>}
            hint="Rough, ignores expected return. Real markets have fatter tails; the full simulation comes with your portfolio."
          />
        </div>
      </section>

      <div className="field" style={{ marginTop: 'var(--space-5)' }}>
        <label className="field-label" htmlFor="horizon">
          Investment horizon (years)
        </label>
        <input
          id="horizon"
          className="plain"
          type="number"
          min={1}
          max={60}
          step={1}
          value={state.profile.horizon_years}
          style={{ width: '6rem', minHeight: 40 }}
          onChange={(e) => {
            const n = Math.round(Number(e.target.value));
            if (Number.isFinite(n) && n >= 1 && n <= 60) dispatch({ type: 'setProfile', patch: { horizon_years: n } });
          }}
        />
        <p className="field-hint">From your answers. Change it if the money will be needed sooner or later.</p>
      </div>

      <div className="wiz-actions">
        <Button type="button" onClick={onBack}>
          Back
        </Button>
        <Button type="button" variant="primary" onClick={onNext}>
          Continue to preferences
        </Button>
      </div>
    </div>
  );
}
```

Note: `className="plain"` on the horizon input reuses the `.wiz input[type='number'].plain` rule from Task 3.

- [ ] **Step 2: Typecheck and test**

Run: `cd frontend && npm run typecheck && npm test`
Expected: no errors; tests pass. If TypeScript rejects `body: { answers }` (the `answers` union type), cast: `body: { answers: answers as Record<string, string | number> }`.

- [ ] **Step 3: Verify in the browser**

Run: `npm run dev:mock`, go through `/start` answering all three mock questions.
Expected: "Working out your risk profile…" briefly, then: capacity 72 and tolerance 48 meters, the warn-coloured callout "Your answers point in different directions", slider at 48 labelled "Balanced", readouts Target volatility 10.6%, Typical bad year −17%, Chance of a −30% year about 2.3%, horizon 10. Dragging the slider to 100 shows 20.0%, −33%, and the "well above" warning; "Use the suggestion" resets to 48. Back then Next again keeps a moved slider position. Editing an answer on the way back and returning re-scores and resets the slider. Stop the server.

- [ ] **Step 4: Commit**

```bash
cd .. && git add frontend/src/intake/RiskStep.tsx
git commit -m "feat(intake): risk level step with sub-scores, slider and live meaning"
```

---

### Task 5: Preferences step

**Files:**
- Modify (overwrite placeholder): `frontend/src/intake/PreferencesStep.tsx`

**Interfaces:**
- Consumes: `PreferencesStepProps` from Task 3; store; `api`; `unwrap`, `useRequest`, `Loading`, `ErrorBox`; from `logic`: `PREF_DEFAULTS`, `cryptoAvailable`, `deriveOptions`, `labelFor`, `percentToFraction`, `regionMode`, `sectorMode`, `setRegionMode`, `setSectorMode`, `validatePreferences`, types `RegionMode`, `SectorMode`, `FundSummary`.
- Produces: `PreferencesStep` (dispatches `setProfile({ base_currency })`, `setPreferences(patch)`); `onFinish()` is called only when validation passes, after zeroing `crypto_max` if the risk level is below `crypto_min_risk_level`.

Field notes: max TER is shown in percent (input `0.35` means 0.35%) and stored as a fraction. Crypto section appears only at `risk_level >= crypto_min_risk_level`; opting in sets `crypto_max = crypto_default_cap`; the slider runs from 1% to `crypto_hard_cap`. Region and sector lists come from `GET /api/universe`; a failure there shows an inline error with retry and does not block the rest of the form.

- [ ] **Step 1: Write `PreferencesStep.tsx`**

```tsx
import { useState, type FormEvent } from 'react';
import { api, type Schemas } from '../api/client';
import { Button, pct } from '../components/ui';
import { useStore } from '../state/store';
import { ErrorBox, Loading } from './ApiState';
import {
  PREF_DEFAULTS, cryptoAvailable, deriveOptions, labelFor, percentToFraction, regionMode, sectorMode, setRegionMode,
  setSectorMode, validatePreferences, type FundSummary, type RegionMode, type SectorMode,
} from './logic';
import { unwrap } from './request';
import { useRequest } from './useRequest';

export interface PreferencesStepProps {
  defaults: Schemas['Defaults'];
  onBack(): void;
  onFinish(): void;
}

const SECTOR_OPTIONS: { value: SectorMode; label: string }[] = [
  { value: 'neutral', label: 'Neutral' },
  { value: 'tilt5', label: 'Tilt toward: at least 5%' },
  { value: 'tilt10', label: 'Tilt toward: at least 10%' },
  { value: 'exclude', label: 'Exclude' },
];
const REGION_OPTIONS: { value: RegionMode; label: string }[] = [
  { value: 'any', label: 'Allowed' },
  { value: 'include', label: 'Focus on' },
  { value: 'exclude', label: 'Exclude' },
];

export function PreferencesStep({ defaults, onBack, onFinish }: PreferencesStepProps) {
  const [state, dispatch] = useStore();
  const prefs = state.profile.preferences ?? {};
  const level = state.profile.risk_level;
  const [errors, setErrors] = useState<string[]>([]);
  const [universe, retryUniverse] = useRequest(() => unwrap<FundSummary[]>(api.GET('/api/universe')), []);

  const set = (patch: Partial<typeof prefs>) => dispatch({ type: 'setPreferences', patch });
  const cryptoOn = cryptoAvailable(level, defaults.crypto_min_risk_level);
  const cryptoMax = prefs.crypto_max ?? PREF_DEFAULTS.crypto_max;
  const terOn = prefs.max_ter != null;
  const distribution = prefs.distribution ?? PREF_DEFAULTS.distribution;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const found = validatePreferences(prefs);
    setErrors(found);
    if (found.length > 0) return;
    if (!cryptoOn && cryptoMax > 0) set({ crypto_max: 0 });
    onFinish();
  };

  const options = universe.status === 'ok' ? deriveOptions(universe.data) : { regions: [], sectors: [] };

  return (
    <form onSubmit={submit} noValidate>
      <p className="wiz-kicker">Step 3 of 3</p>
      <h2>Your preferences</h2>
      <p className="muted">Everything here is optional. The defaults suit most people, and you can change any of it later.</p>

      <fieldset className="field">
        <legend>Base currency</legend>
        <div className="seg" role="radiogroup" aria-label="Base currency">
          {(['EUR', 'USD'] as const).map((c) => (
            <label key={c} className={state.profile.base_currency === c ? 'is-selected' : ''}>
              <input type="radio" name="base_currency" value={c} checked={state.profile.base_currency === c} onChange={() => dispatch({ type: 'setProfile', patch: { base_currency: c } })} />
              {c}
            </label>
          ))}
        </div>
        <p className="field-hint">The currency you spend in. Results are shown in it. EUR investors get UCITS funds by default.</p>
      </fieldset>

      <div className="field">
        <label className="check">
          <input type="checkbox" checked={prefs.hedge_bonds ?? PREF_DEFAULTS.hedge_bonds} onChange={(e) => set({ hedge_bonds: e.target.checked })} />
          <span>
            <strong>Hedge bond currency risk</strong>
            <br />
            <span className="field-hint">Prefers bond funds that remove currency swings, so bonds behave like bonds.</span>
          </span>
        </label>
        <label className="check">
          <input type="checkbox" checked={prefs.esg_only ?? PREF_DEFAULTS.esg_only} onChange={(e) => set({ esg_only: e.target.checked })} />
          <span>
            <strong>Sustainable (ESG) funds only</strong>
            <br />
            <span className="field-hint">Limits the choice of funds, which can slightly raise costs.</span>
          </span>
        </label>
      </div>

      <fieldset className="field">
        <legend>Regions</legend>
        <p className="field-hint">Global funds are always allowed. "Focus on" limits regional funds to the ones you pick.</p>
        {universe.status === 'loading' && <Loading label="Loading regions" />}
        {universe.status === 'error' && <ErrorBox message={universe.message} onRetry={retryUniverse} />}
        {universe.status === 'ok' && (
          <div className="pref-grid">
            {options.regions.map((r) => (
              <label key={r}>
                <span>{labelFor(r)}</span>
                <select aria-label={`${labelFor(r)} region`} value={regionMode(prefs, r)} onChange={(e) => set(setRegionMode(prefs, r, e.target.value as RegionMode))}>
                  {REGION_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        )}
      </fieldset>

      <fieldset className="field">
        <legend>Sectors</legend>
        <p className="field-hint">A tilt reserves at least that share of the portfolio for the sector. Exclude what you do not want to own.</p>
        {universe.status === 'ok' && options.sectors.length === 0 && <p className="field-hint">No sector funds in the current fund list.</p>}
        {universe.status === 'ok' && options.sectors.length > 0 && (
          <div className="pref-grid">
            {options.sectors.map((s) => (
              <label key={s}>
                <span>{labelFor(s)}</span>
                <select aria-label={`${labelFor(s)} sector`} value={sectorMode(prefs, s)} onChange={(e) => set(setSectorMode(prefs, s, e.target.value as SectorMode))}>
                  {SECTOR_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        )}
      </fieldset>

      <fieldset className="field">
        <legend>Crypto</legend>
        {cryptoOn ? (
          <>
            <label className="check">
              <input
                type="checkbox"
                checked={cryptoMax > 0}
                onChange={(e) => set({ crypto_max: e.target.checked ? defaults.crypto_default_cap : 0 })}
              />
              <span>
                <strong>Allow a small crypto position</strong>
                <br />
                <span className="field-hint">Very volatile. It can lose most of its value. Off unless you opt in.</span>
              </span>
            </label>
            {cryptoMax > 0 && (
              <div className="field">
                <label htmlFor="crypto-cap">
                  Maximum crypto share: <span className="num">{pct(cryptoMax, 0)}</span>
                </label>
                <input
                  id="crypto-cap"
                  type="range"
                  min={0.01}
                  max={defaults.crypto_hard_cap}
                  step={0.01}
                  value={cryptoMax}
                  aria-valuetext={pct(cryptoMax, 0)}
                  onChange={(e) => set({ crypto_max: Number(e.target.value) })}
                />
              </div>
            )}
          </>
        ) : (
          <p className="field-hint">
            Crypto is only offered from risk level {defaults.crypto_min_risk_level} upward. Your level is {Math.round(level)}.
          </p>
        )}
      </fieldset>

      <fieldset className="field">
        <legend>Portfolio shape and costs</legend>
        <div className="field-row">
          <label htmlFor="max-etfs">Maximum number of funds</label>
          <input
            id="max-etfs"
            className="plain"
            type="number"
            min={1}
            max={30}
            step={1}
            style={{ width: '5rem' }}
            value={prefs.max_etfs ?? PREF_DEFAULTS.max_etfs}
            onChange={(e) => {
              const n = Math.round(Number(e.target.value));
              if (Number.isFinite(n) && n >= 1 && n <= 30) set({ max_etfs: n });
            }}
          />
        </div>
        <label className="check">
          <input type="checkbox" checked={terOn} onChange={(e) => set({ max_ter: e.target.checked ? 0.005 : null })} />
          <span>Cap the yearly fee (TER) of each fund</span>
        </label>
        {terOn && (
          <div className="field-row">
            <label htmlFor="max-ter">No fund dearer than</label>
            <input
              id="max-ter"
              className="plain"
              type="number"
              min={0.05}
              max={2}
              step={0.05}
              style={{ width: '6rem' }}
              value={Number(((prefs.max_ter ?? 0.005) * 100).toFixed(2))}
              onChange={(e) => {
                const x = Number(e.target.value);
                if (Number.isFinite(x) && x > 0) set({ max_ter: percentToFraction(x) });
              }}
            />
            <span>% per year</span>
          </div>
        )}
      </fieldset>

      <fieldset className="field">
        <legend>Dividends</legend>
        <div className="seg" role="radiogroup" aria-label="Distribution">
          {(
            [
              ['any', 'No preference'],
              ['acc', 'Reinvest (accumulating)'],
              ['dist', 'Pay out (distributing)'],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className={distribution === value ? 'is-selected' : ''}>
              <input type="radio" name="distribution" value={value} checked={distribution === value} onChange={() => set({ distribution: value })} />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      {errors.length > 0 && (
        <div className="form-errors" role="alert">
          {errors.map((m) => (
            <p key={m}>{m}</p>
          ))}
        </div>
      )}

      <div className="wiz-actions">
        <Button type="button" onClick={onBack}>
          Back
        </Button>
        <Button type="submit" variant="primary">
          See my portfolio
        </Button>
      </div>
    </form>
  );
}
```

- [ ] **Step 2: Typecheck and test**

Run: `cd frontend && npm run typecheck && npm test`
Expected: no errors; tests pass. Likely fixups if `tsc` complains: (a) `api.GET('/api/universe')` requiring a second argument, use `api.GET('/api/universe', {})`; (b) `max_ter: null` not allowed by the generated type, use `max_ter: undefined` (the reducer spread then keeps the key with `undefined`, which serialises away).

- [ ] **Step 3: Verify in the browser**

Run: `npm run dev:mock`, complete the wizard to step 3 with the slider left at 48.
Expected: base currency EUR selected; hedge bonds ticked; region and sector lists appear from the mock universe; because 48 is at or above 40, the crypto opt-in checkbox is visible. Ticking it shows a 5% slider (range 1% to 10%). Going Back, setting the level to 30, and returning shows the "only offered from risk level 40" text instead. Setting sector tilts on 4 sectors and max funds to 3 then pressing "See my portfolio" shows the tilt-count error and does not navigate. Fixing it and submitting navigates to `/portfolio`. In devtools, `localStorage['roboadvisor.state.v1']` shows the chosen preferences and `profile.risk_level`. Stop the server.

- [ ] **Step 4: Commit**

```bash
cd .. && git add frontend/src/intake/PreferencesStep.tsx
git commit -m "feat(intake): preferences step with regions, sectors, ESG, crypto opt-in and costs"
```

---

### Task 6: Landing page with live example preview

**Files:**
- Create: `frontend/src/intake/ExamplePreview.tsx`, `frontend/src/pages/Landing.css`
- Modify (overwrite Phase 0 stub): `frontend/src/pages/Landing.tsx`

**Interfaces:**
- Consumes: `api`, `Schemas`; `unwrap`, `useRequest`, `Loading`, `ErrorBox`; `DEMO_PROFILE`, `mixRows`, `thresholdLabel` from `logic`; `Stat`, `Card`, `LinkButton`, `pct`; `../intake/intake.css` (for `.api-*` classes).
- Produces: `ExamplePreview(): JSX.Element` (POST `/api/portfolio` with `DEMO_PROFILE` and `settings: {}`); default export `Landing`.

Copy is real and specific; the disclaimer already lives in the Layout footer. The preview shows mix bars, expected return, volatility, yearly cost per 10,000, and drawdown probabilities as CSS bars. Bars are decorative (`aria-hidden`); every value is also text.

- [ ] **Step 1: Write `ExamplePreview.tsx`**

```tsx
import { api, type Schemas } from '../api/client';
import { pct } from '../components/ui';
import { ErrorBox, Loading } from './ApiState';
import { DEMO_PROFILE, mixRows, thresholdLabel } from './logic';
import { unwrap } from './request';
import { useRequest } from './useRequest';
import './intake.css';

const SERIES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)', 'var(--series-6)'];

export function ExamplePreview() {
  const [res, retry] = useRequest(
    () => unwrap<Schemas['Recommendation']>(api.POST('/api/portfolio', { body: { profile: DEMO_PROFILE, settings: {} } })),
    [],
  );

  if (res.status === 'loading') return <Loading label="Building the example portfolio" />;
  if (res.status === 'error') return <ErrorBox message={`The example could not be built. ${res.message}`} onRetry={retry} />;

  const { summary, downside } = res.data;
  const rows = mixRows(summary.mix);
  const horizon = DEMO_PROFILE.horizon_years;

  return (
    <div className="preview">
      <div className="preview-col">
        <h3 className="preview-h">What it holds</h3>
        <ul className="bars" aria-label="Asset mix">
          {rows.map((r, i) => (
            <li key={r.key}>
              <span className="bar-label">{r.label}</span>
              <span className="bar-track" aria-hidden="true">
                <span className="bar-fill" style={{ width: `${r.weight * 100}%`, background: SERIES[i % SERIES.length] }} />
              </span>
              <span className="num bar-value">{pct(r.weight, 0)}</span>
            </li>
          ))}
        </ul>
        <dl className="preview-stats">
          <div>
            <dt>Expected return per year</dt>
            <dd className="num">{pct(summary.expected_return)}</dd>
          </div>
          <div>
            <dt>Typical yearly swing</dt>
            <dd className="num">{pct(summary.volatility)}</dd>
          </div>
          <div>
            <dt>Fund fees per 10,000 a year</dt>
            <dd className="num">{summary.annual_cost_per_10k.toFixed(0)}</dd>
          </div>
        </dl>
      </div>

      <div className="preview-col">
        <h3 className="preview-h">What it could cost you</h3>
        <p className="muted preview-lead">Chance of a fall from a peak of at least this size at some point in {horizon} years.</p>
        <ul className="bars" aria-label="Drawdown probabilities">
          {downside.drawdown_probs.map((d) => (
            <li key={d.threshold}>
              <span className="bar-label">{thresholdLabel(d.threshold)}</span>
              <span className="bar-track" aria-hidden="true">
                <span className="bar-fill bar-neg" style={{ width: `${Math.min(100, d.probability * 100)}%` }} />
              </span>
              <span className="num bar-value">{pct(d.probability, 0)}</span>
            </li>
          ))}
        </ul>
        <p className="fineprint">Simulated from historical returns. An illustration, not a forecast or a promise.</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write `Landing.css`**

```css
.landing section { margin-bottom: var(--space-7); }
.hero { padding: var(--space-5) 0 var(--space-2); max-width: 860px; }
.hero-kicker { font-size: 13px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--accent); font-weight: 600; margin: 0 0 var(--space-3); }
.hero h1 { margin-bottom: var(--space-4); letter-spacing: -0.01em; }
.hero-pitch { font-size: clamp(1.05rem, 1vw + 0.9rem, 1.3rem); color: var(--ink-2); max-width: 40em; margin: 0 0 var(--space-5); }
.hero-actions { display: flex; align-items: center; gap: var(--space-4); flex-wrap: wrap; }
.hero .btn-primary, .cta-band .btn-primary { font-size: 17px; padding: 14px 26px; min-height: 48px; }
.hero-facts { display: flex; flex-wrap: wrap; gap: var(--space-2) var(--space-5); list-style: none; padding: var(--space-4) 0 0; margin: var(--space-5) 0 0; border-top: 1px solid var(--line); color: var(--ink-2); font-size: 14px; }

.section-head { max-width: 640px; margin-bottom: var(--space-5); }
.section-head p { color: var(--ink-2); margin: 0; }

.steps { display: grid; gap: var(--space-5); grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr)); list-style: none; padding: 0; margin: 0; counter-reset: step; }
.steps li { counter-increment: step; border-top: 1px solid var(--ink); padding-top: var(--space-3); }
.steps li::before { content: counter(step, decimal-leading-zero); font: 500 14px var(--font-mono); color: var(--accent); display: block; margin-bottom: var(--space-2); }
.steps h3 { margin-bottom: var(--space-2); }
.steps p { margin: 0; color: var(--ink-2); }

.points { display: grid; gap: var(--space-4); grid-template-columns: repeat(auto-fit, minmax(min(100%, 250px), 1fr)); }
.point { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: var(--space-5); }
.point h3 { margin-bottom: var(--space-2); }
.point p { margin: 0; color: var(--ink-2); }
.point .quote { font-family: var(--font-display); font-size: 1.05rem; color: var(--ink); margin-bottom: var(--space-2); }

.preview-card { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow); padding: var(--space-5); }
.preview-card > header p { margin: 0 0 var(--space-4); color: var(--ink-2); }
.preview { display: grid; gap: var(--space-6); grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr)); }
.preview-h { font-size: 1.05rem; margin-bottom: var(--space-2); }
.preview-lead { font-size: 14px; margin: 0 0 var(--space-3); }
.bars { list-style: none; padding: 0; margin: 0; display: grid; gap: var(--space-3); }
.bars li { display: grid; grid-template-columns: minmax(96px, 30%) 1fr 3.2rem; align-items: center; gap: var(--space-3); font-size: 14px; }
.bar-track { display: block; height: 12px; background: var(--surface-2); border-radius: 6px; overflow: hidden; }
.bar-fill { display: block; height: 100%; border-radius: 6px; }
.bar-neg { background: var(--neg); }
.bar-value { text-align: right; }
.preview-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 130px), 1fr)); gap: var(--space-4); margin: var(--space-5) 0 0; }
.preview-stats dt { font-size: 12px; color: var(--ink-2); text-transform: uppercase; letter-spacing: 0.04em; }
.preview-stats dd { margin: var(--space-1) 0 0; font-size: 1.5rem; }

.cta-band { text-align: center; background: var(--surface-2); border-radius: var(--radius); padding: var(--space-6) var(--space-4); }
.cta-band p { color: var(--ink-2); max-width: 34em; margin: 0 auto var(--space-5); }

@media (max-width: 480px) {
  .bars li { grid-template-columns: 1fr 3.2rem; }
  .bars .bar-label { grid-column: 1 / -1; }
  .bars .bar-track { grid-column: 1; }
  .hero-actions .btn { width: 100%; justify-content: center; }
}
```

- [ ] **Step 3: Write `pages/Landing.tsx`**

```tsx
import { LinkButton } from '../components/ui';
import { ExamplePreview } from '../intake/ExamplePreview';
import './Landing.css';

export default function Landing() {
  return (
    <div className="landing">
      <section className="hero" aria-labelledby="hero-h">
        <p className="hero-kicker">Rules-based ETF portfolios, explained</p>
        <h1 id="hero-h">Know what you own, and what it could cost you.</h1>
        <p className="hero-pitch">
          Answer about ten questions and get a globally diversified ETF portfolio matched to the risk you can actually carry. Every step is
          explained, the bad years are shown up front, and the fees are on the table.
        </p>
        <div className="hero-actions">
          <LinkButton to="/start" variant="primary">
            Build my portfolio
          </LinkButton>
          <span className="muted">About three minutes. No account, nothing stored on our servers.</span>
        </div>
        <ul className="hero-facts" aria-label="At a glance">
          <li>Global equities, bonds, gold and more</li>
          <li>ESG option</li>
          <li>Backtested over up to 15 years</li>
        </ul>
      </section>

      <section aria-labelledby="how-h">
        <div className="section-head">
          <h2 id="how-h">How it works</h2>
          <p>Three steps, and you stay in charge of the one decision that matters.</p>
        </div>
        <ol className="steps">
          <li>
            <h3>Tell us about your situation</h3>
            <p>Your horizon, income, savings, and how you would react if your portfolio fell 20% in a month. Plain questions, no jargon.</p>
          </li>
          <li>
            <h3>Choose your risk level</h3>
            <p>
              We suggest a number from 0 to 100, based on the lower of what you can afford to lose and what you can stomach. Then you move the
              slider and see what it means in ups and downs.
            </p>
          </li>
          <li>
            <h3>Get a portfolio you can inspect</h3>
            <p>A short list of real ETFs with weights, costs, the chance of deep losses, and a backtest. Open any step to see why it came out this way.</p>
          </li>
        </ol>
      </section>

      <section aria-labelledby="why-h">
        <div className="section-head">
          <h2 id="why-h">Built to be checked, not trusted blindly</h2>
        </div>
        <div className="points">
          <article className="point">
            <p className="quote">Explainable, not a black box.</p>
            <p>From which funds were eligible to how the weights were chosen, each step is listed with the numbers that drove it.</p>
          </article>
          <article className="point">
            <p className="quote">Honest about the downside.</p>
            <p>We show you the chance of a &minus;40% year before we talk about returns. If you cannot live with it, you will know now, not in a crash.</p>
          </article>
          <article className="point">
            <p className="quote">Low cost, shown upfront.</p>
            <p>Every fund's yearly fee (TER) is visible, with the total cost per 10,000 invested. Fees count against a fund in the selection, not just in the footnotes.</p>
          </article>
          <article className="point">
            <p className="quote">Global, with bonds and ESG.</p>
            <p>Regional and global equity, government and corporate bonds, gold and property, with sustainable funds and a currency choice of EUR or USD.</p>
          </article>
        </div>
      </section>

      <section aria-labelledby="example-h">
        <div className="section-head">
          <h2 id="example-h">See a real example</h2>
          <p>This portfolio is built live for a balanced investor with a ten-year horizon. Yours will differ with your answers.</p>
        </div>
        <div className="preview-card">
          <header>
            <p>
              <strong>Balanced, 10 years, EUR</strong>
            </p>
          </header>
          <ExamplePreview />
        </div>
      </section>

      <section className="cta-band" aria-labelledby="cta-h">
        <h2 id="cta-h">Ready to see your own?</h2>
        <p>Ten questions, one slider, and a portfolio you can take apart.</p>
        <LinkButton to="/start" variant="primary">
          Build my portfolio
        </LinkButton>
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Typecheck and test**

Run: `cd frontend && npm run typecheck && npm test && npm run build`
Expected: no type errors; tests pass; production build succeeds.

- [ ] **Step 5: Verify in the browser**

Run: `npm run dev:mock`, open `http://localhost:5740/`.
Expected: hero headline, pitch, brass "Build my portfolio" button linking to `/start`; three numbered steps; four selling points; the preview card shows "Building the example portfolio…" for about 0.2 s and then the mix bars (Equities, Bonds, Commodities, Cash from the mock), three stats, and three drawdown bars for −30%, −40%, −50% (18%, 6%, 2% in the mock). The final CTA band repeats the button; the footer disclaimer is visible. At 360px width (devtools device toolbar) there is no horizontal scroll and the bars stack label above track. Tab order reaches the CTA first with a visible focus ring. Stop the server.

- [ ] **Step 6: Commit**

```bash
cd .. && git add frontend/src/intake/ExamplePreview.tsx frontend/src/pages/Landing.tsx frontend/src/pages/Landing.css
git commit -m "feat(landing): marketing page with live example portfolio preview"
```

---

### Task 7: Manual verification of the whole flow

**Files:** none (verification only; fix defects in the files above and commit each fix separately).

**Interfaces:** none.

- [ ] **Step 1: Automated checks**

Run: `cd frontend && npm run typecheck && npm test && npm run build`
Expected: clean typecheck; all tests pass (Phase 0 store tests plus `logic` and `request` tests); build succeeds.

- [ ] **Step 2: Mock-mode walkthrough**

Run: `npm run dev:mock`, open `http://localhost:5740/`. Check each item:

1. Landing loads with no console errors; preview populates; both CTAs go to `/start`.
2. `/start`: the first question is focused-navigable by keyboard only (Tab to the input, type, Enter advances). Progress bar advances with each question.
3. Next with no answer shows an inline error announced by the screen reader (`role="alert"`) and does not advance.
4. Radio cards: arrow keys move the choice; the selected card is highlighted; focus ring visible.
5. Back keeps previous answers; refreshing the page mid-wizard restarts at question 1 but keeps typed answers (persisted store) and does not crash.
6. Risk screen: sub-score meters, mismatch callout (mock returns `mismatch: true`), slider starts at 48, readouts recompute live (level 0 → 2.0% / −3% / 0%; level 100 → 20.0% / −33% / 6.7%).
7. "Use the suggestion" resets the slider; the above/below notices appear at ±10.
8. Horizon field changes are reflected in `localStorage['roboadvisor.state.v1']` (`profile.horizon_years`).
9. Preferences: crypto block shows the opt-in at level ≥ 40 and the explanation below 40; toggling opt-in sets the cap slider to 5% (range 1–10%); the validation errors block submit; a valid submit lands on `/portfolio` and `localStorage` holds `profile.preferences` with the chosen values (`regions_include`, `sector_tilts`, `max_ter` as a fraction such as `0.005`, `crypto_max`).
10. Set the level to 30 with crypto previously opted in, submit: stored `crypto_max` is `0`.
11. At 360px width every screen has no horizontal scroll, buttons stack full width, tap targets are comfortable.
12. Dark mode: set the OS or devtools to `prefers-color-scheme: dark`; all screens stay legible (only tokens are used).

- [ ] **Step 3: Error-state check**

Stop the dev server, run `npm run dev` (real mode, backend not running), open `/` and `/start`.
Expected: the landing example shows the error box ("The example could not be built. The request failed (HTTP 500)." or a "Could not reach the server" message) with "Try again", and the rest of the landing page still works. `/start` shows the error box in place of the wizard with a working retry once the backend is up. Stop the server.

- [ ] **Step 4: Real-backend check (only if the backend and data are available)**

Start the backend (`cd backend && uv run uvicorn app.main:app --port 8740`), then `cd frontend && npm run dev`. Walk `/start` end to end. Expected: the score reflects your answers (differs by answers, unlike the mock); a domain error on `/api/portfolio` (for example `NoEligibleFunds`) is out of this lane's scope, but the landing preview must show the server's `detail` inside the error box.

- [ ] **Step 5: Commit any fixes**

```bash
cd .. && git add frontend/src/intake frontend/src/pages/Landing.tsx frontend/src/pages/Landing.css frontend/src/pages/Start.tsx
git commit -m "fix(intake): issues found in manual verification"
```

(Skip if nothing needed fixing.)

---

## Notes for the integrator

- **Component tests** are deliberately not written: they need `@testing-library/react` and `jsdom` (a Phase 0 dependency decision). If wanted, add both as devDependencies plus `test: { environment: 'jsdom' }` in `vite.config.ts`, then test `QuestionStep` (invalid Next shows an alert), `RiskStep` (slider dispatches `setProfile`) and `PreferencesStep` (crypto hidden below the minimum level). All logic they depend on is already covered in `logic.test.ts`.
- **P(−30%) on the risk screen** is a rough normal approximation (zero drift, `lossProbability`). The engine's bootstrap number appears on `/portfolio`. A precise live number would need a new endpoint (escalate if wanted).
- **Region and sector options** are derived from `GET /api/universe` because no endpoint lists them. If Lane H or Phase 2 changes the universe response or its query params, `deriveOptions` is the only consumer here.
- Landing preview issues a real `POST /api/portfolio` on every page view; the engine's cost per call matters once Phase 2 wires it up (consider caching the demo response on the server).

## Self-review

- Spec coverage: §8.2 Landing (hero + CTA, 3 steps, selling points, example preview from a real call, repeated CTA, footer disclaimer from Layout, placeholder brand) → Task 6. §8.2 `/start` (questions rendered from the questionnaire, risk level with sub-scores, mismatch, slider, target volatility, typical bad year, P(−30%), preferences) → Tasks 3 to 5. §8.1 store as the single fill target, results pages read only → all steps dispatch to the Phase 0 store. Loading/error for every API call → `useRequest` + `ApiState` used by the wizard, risk step, preferences universe call and landing preview. Pure logic with vitest → Task 1 and 2.
- Placeholder scan: no TBD/TODO; the two "placeholder" step components in Task 3 are complete, compiling code replaced with final code in Tasks 4 and 5.
- Type consistency: `RiskStepProps` and `PreferencesStepProps` are identical in Task 3 placeholders and in Tasks 4 and 5; `Nav`, `Stage`, `RegionMode`, `SectorMode` come from Task 1 and are used unchanged; `unwrap`/`useRequest` signatures match Task 2 at every call site.

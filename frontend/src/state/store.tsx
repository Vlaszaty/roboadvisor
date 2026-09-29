import { createContext, useContext, useEffect, useReducer, type Dispatch, type ReactNode } from 'react';
import type { Schemas } from '../api/client';

export type InvestorProfile = Schemas['InvestorProfile'];
export type Preferences = Schemas['Preferences'];
export type EngineSettings = Schemas['EngineSettings'];
export type IntakeScore = Schemas['IntakeScore'];

/** The single source of truth every intake channel fills (spec §8.1). */
export interface State {
  profile: InvestorProfile;
  settings: EngineSettings;
  answers: Record<string, string | number>;
  score: IntakeScore | null;
}

export type Action =
  | { type: 'setProfile'; patch: Partial<InvestorProfile> }
  | { type: 'setPreferences'; patch: Partial<Preferences> }
  | { type: 'setSettings'; patch: Partial<EngineSettings> }
  | { type: 'setAnswer'; id: string; value: string | number }
  | { type: 'setScore'; score: IntakeScore }
  | { type: 'load'; state: State }
  | { type: 'reset' };

export const initialState: State = {
  profile: { risk_level: 50, horizon_years: 10, base_currency: 'EUR', preferences: {} },
  settings: {},
  answers: {},
  score: null,
};

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'setProfile':
      return { ...state, profile: { ...state.profile, ...action.patch } };
    case 'setPreferences':
      return { ...state, profile: { ...state.profile, preferences: { ...state.profile.preferences, ...action.patch } } };
    case 'setSettings':
      return { ...state, settings: { ...state.settings, ...action.patch } };
    case 'setAnswer':
      return { ...state, answers: { ...state.answers, [action.id]: action.value } };
    case 'setScore':
      return { ...state, score: action.score };
    case 'load':
      return action.state;
    case 'reset':
      return initialState;
  }
}

const STORAGE_KEY = 'roboadvisor.state.v1';

function loadState(): State {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...initialState, ...JSON.parse(raw) } : initialState;
  } catch {
    return initialState;
  }
}

const StoreContext = createContext<[State, Dispatch<Action>] | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, loadState);
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* storage unavailable: state still works in memory */
    }
  }, [state]);
  return <StoreContext.Provider value={[state, dispatch]}>{children}</StoreContext.Provider>;
}

export function useStore(): [State, Dispatch<Action>] {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside <StoreProvider>');
  return ctx;
}

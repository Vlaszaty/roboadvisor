import { describe, expect, it } from 'vitest';
import { initialState, reducer } from './store';

describe('store reducer', () => {
  it('patches the profile and preferences without losing other fields', () => {
    let s = reducer(initialState, { type: 'setProfile', patch: { risk_level: 72 } });
    s = reducer(s, { type: 'setPreferences', patch: { esg_only: true } });
    expect(s.profile.risk_level).toBe(72);
    expect(s.profile.base_currency).toBe('EUR');
    expect(s.profile.preferences?.esg_only).toBe(true);
  });

  it('records answers and the intake score, and resets', () => {
    let s = reducer(initialState, { type: 'setAnswer', id: 'horizon', value: 12 });
    s = reducer(s, {
      type: 'setScore',
      score: { capacity: 70, tolerance: 40, suggested_risk_level: 40, limiting_factor: 'tolerance', mismatch: true, explanation: '', horizon_years: 12 },
    });
    expect(s.answers.horizon).toBe(12);
    expect(s.score?.suggested_risk_level).toBe(40);
    expect(reducer(s, { type: 'reset' })).toEqual(initialState);
  });
});

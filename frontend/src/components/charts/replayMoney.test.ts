import { describe, expect, it } from 'vitest';
import { replayMoney } from './replayMoney';

const day = (d: string) => Date.parse(`${d}T00:00:00Z`);

describe('replayMoney', () => {
  it('returns null without amounts or data', () => {
    expect(replayMoney([{ t: day('2024-01-05'), p: 1 }, { t: day('2024-02-05'), p: 1.1 }], 'p', 0, 0)).toBeNull();
    expect(replayMoney([{ t: day('2024-01-05'), p: 1 }], 'p', 100, 0)).toBeNull();
  });

  it('grows a lump sum by the final multiple', () => {
    const rows = [{ t: day('2024-01-05'), p: 1 }, { t: day('2024-06-05'), p: 1.5 }];
    expect(replayMoney(rows, 'p', 1000, 0)).toEqual({ paidIn: 1000, value: 1500 });
  });

  it('adds the monthly amount on the first row of each later month', () => {
    const rows = [
      { t: day('2024-01-05'), p: 1 },
      { t: day('2024-01-12'), p: 1.1 },
      { t: day('2024-02-02'), p: 1.2 },
      { t: day('2024-02-09'), p: 1.2 },
      { t: day('2024-03-01'), p: 1.5 },
    ];
    const r = replayMoney(rows, 'p', 0, 100)!;
    expect(r.paidIn).toBe(200); // February and March
    expect(r.value).toBeCloseTo(100 * (1.5 / 1.2) + 100 * (1.5 / 1.5), 6);
  });
});

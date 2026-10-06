export interface ReplayRow {
  t: number; // ms since epoch
  [key: string]: number | null | undefined;
}

/**
 * What the investor's own amounts would have become over a replay. `rows` carry growth multiples of 1.00
 * (the first row is the start). The one-time amount goes in on the first row, and the monthly amount on the first
 * row of every later calendar month. Each deposit grows by (final multiple / multiple on its day).
 * Returns null when there is no usable series or no amount.
 */
export function replayMoney(
  rows: readonly ReplayRow[], key: string, initial: number, monthly: number,
): { paidIn: number; value: number } | null {
  if ((initial <= 0 && monthly <= 0) || rows.length < 2) return null;
  const mult = (i: number) => rows[i][key];
  const end = rows[rows.length - 1][key];
  if (end == null) return null;
  let paidIn = 0;
  let value = 0;
  const deposit = (i: number, amount: number) => {
    const m = mult(i);
    if (amount <= 0 || m == null || m <= 0) return;
    paidIn += amount;
    value += amount * (end / m);
  };
  deposit(0, initial);
  let month = monthKey(rows[0].t);
  for (let i = 1; i < rows.length; i++) {
    const k = monthKey(rows[i].t);
    if (k !== month) {
      month = k;
      deposit(i, monthly);
    }
  }
  return { paidIn, value };
}

const monthKey = (t: number): string => new Date(t).toISOString().slice(0, 7);

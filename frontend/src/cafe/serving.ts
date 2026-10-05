import type { Order } from './recipe';

/** Presentation only: these phrases never affect the portfolio calculation. */
export function servedSentence(order: Order, fixed = false): string {
  if (fixed) return 'Alsjeblieft, een koffie als vast voorbeeld.';
  const drink = order.base === 'coffee' ? 'koffie' : 'matcha';
  if (order.milk === null || order.sugar === null) return `Alsjeblieft, hier is je ${drink}.`;
  const milk = ['zonder melk', 'met een scheutje melk', 'met half melk', 'met veel melk', 'met extra veel melk'][order.milk];
  const sugar = ['zonder suiker', 'één schepje suiker', 'twee schepjes suiker', 'drie schepjes suiker', 'extra suiker'][order.sugar];
  const joining = order.milk === 0 && order.sugar !== 0 ? ' en met ' : ' en ';
  return `Alsjeblieft, hier is je ${drink} ${milk}${joining}${sugar}.`;
}

// The engine's 2–20% target-volatility range is a visual reference, not a loss cap.
export function tastePosition(volatility: number): number {
  return Math.max(0, Math.min(1, (volatility - .02) / .18));
}

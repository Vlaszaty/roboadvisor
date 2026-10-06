import type { cafeCopy } from './language';

type Copy = ReturnType<typeof cafeCopy>;

/** Presentation only: the barista's serving line never affects the calculation. */
export function servedSentence(result: { source: string; profileId: number; base: 'coffee' | 'matcha' }, copy: Copy): string {
  const { t, profiles } = copy;
  if (result.source === 'fixed') return t('Alsjeblieft, een koffie als vast voorbeeld.', 'Here you go, a coffee as a fixed example.');
  const p = profiles[result.profileId - 1];
  const drink = result.base === 'matcha' ? 'matcha' : t('koffie', 'coffee');
  return t(`Alsjeblieft: je ${drink}, ${p.name.toLowerCase()} (${p.id} van 7).`, `Here you go: your ${drink}, ${p.name.toLowerCase()} (${p.id} of 7).`);
}

// The engine's 2–20% target-volatility range is a visual reference, not a loss cap.
export function tastePosition(volatility: number): number {
  return Math.max(0, Math.min(1, (volatility - .02) / .18));
}

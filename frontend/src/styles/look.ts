export const LOOKS = [
  { id: 'sunny', label: 'Sunny' },
  { id: 'night', label: 'Night' },
  { id: 'swiss', label: 'Swiss' },
] as const;

export type LookId = (typeof LOOKS)[number]['id'];
export const DEFAULT_LOOK: LookId = 'sunny';
const KEY = 'ballast.look';

export const isLook = (v: unknown): v is LookId => LOOKS.some((l) => l.id === v);

export function storedLook(): LookId {
  try {
    const v = localStorage.getItem(KEY);
    if (isLook(v)) return v;
  } catch {
    /* storage can be blocked: fall back to the default */
  }
  return DEFAULT_LOOK;
}

export function applyLook(look: LookId): void {
  document.documentElement.dataset.style = look;
  try {
    localStorage.setItem(KEY, look);
  } catch {
    /* ignore */
  }
}

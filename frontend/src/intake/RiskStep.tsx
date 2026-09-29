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

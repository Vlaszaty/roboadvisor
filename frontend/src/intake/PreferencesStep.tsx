import type { Schemas } from '../api/client';

export interface PreferencesStepProps {
  defaults: Schemas['Defaults'];
  onBack(): void;
  onFinish(): void;
}

export function PreferencesStep(_props: PreferencesStepProps) {
  return <h2>Your preferences</h2>;
}

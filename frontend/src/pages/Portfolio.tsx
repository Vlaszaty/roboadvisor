import { api, type Schemas } from '../api/client';
import { PortfolioView } from '../components/charts/PortfolioView';
import { useRequest } from '../components/charts/hooks';
import { isProfileTouched } from '../components/charts/transforms';
import { Async, EmptyState } from '../components/charts/Status';
import { LinkButton, PageHeader } from '../components/ui';
import { initialState, useStore } from '../state/store';

export default function Portfolio() {
  const [{ profile, settings, score }] = useStore();
  const touched = isProfileTouched(profile, initialState.profile, score);
  const { state, reload } = useRequest<Schemas['Recommendation']>(
    (signal) => api.POST('/api/portfolio', { body: { profile, settings }, signal }),
    JSON.stringify({ profile, settings }),
    touched,
  );

  if (!touched) {
    return (
      <EmptyState
        title="No portfolio yet"
        action={<LinkButton to="/start" variant="primary">Build my portfolio</LinkButton>}
      >
        Answer a few questions and we will build a portfolio around your risk level and preferences.
      </EmptyState>
    );
  }

  return (
    <>
      <PageHeader
        title="Your portfolio"
        lead={`Risk level ${Math.round(profile.risk_level)} of 100 · ${profile.horizon_years}-year horizon · ${profile.base_currency}`}
      />
      <Async state={state} onRetry={reload}>
        {(rec) => <PortfolioView rec={rec} currency={profile.base_currency} horizonYears={profile.horizon_years} />}
      </Async>
    </>
  );
}

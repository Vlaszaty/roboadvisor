import { api, type Schemas } from '../api/client';
import { PortfolioView } from '../components/charts/PortfolioView';
import { useDebounced, useLastData, useRequest } from '../components/charts/hooks';
import { isProfileTouched } from '../components/charts/transforms';
import { EmptyState, ErrorBox, Loading } from '../components/charts/Status';
import { LinkButton, PageHeader } from '../components/ui';
import { initialState, useStore } from '../state/store';
import { AmountCard } from '../intake/AmountCard';
import { RiskAdjuster } from './RiskAdjuster';

export default function Portfolio() {
  const [{ profile, settings, score }] = useStore();
  const touched = isProfileTouched(profile, initialState.profile, score);
  // Amounts are typed digit by digit, so wait a moment before asking for a new plan.
  const asked = useDebounced(profile, 300);
  const { state, reload } = useRequest<Schemas['Recommendation']>(
    (signal) => api.POST('/api/portfolio', { body: { profile: asked, settings }, signal }),
    JSON.stringify({ profile: asked, settings }),
    touched,
  );
  // Keep showing the last plan, dimmed, while a new one loads, so sliders and inputs keep their focus.
  const last = useLastData(state, 0);
  const rec = state.status === 'ok' ? state.data : last?.data;

  if (!touched) {
    return (
      <EmptyState
        title="You do not have a plan yet"
        action={<LinkButton to="/start" variant="primary">Build my plan</LinkButton>}
      >
        Answer ten short questions and we will build a plan around what you are comfortable with.
      </EmptyState>
    );
  }

  return (
    <>
      <PageHeader
        title="My plan"
        lead={`Built for a ${profile.horizon_years}-year horizon, in ${profile.base_currency}. Your risk score is ${Math.round(profile.risk_level)} out of 100.`}
      />
      {state.status === 'error' && <ErrorBox message={state.message} onRetry={reload} />}
      {rec ? (
        <div className={state.status === 'loading' ? 'stale' : undefined} aria-busy={state.status === 'loading'}>
          <PortfolioView
            rec={rec}
            currency={profile.base_currency}
            horizonYears={profile.horizon_years}
            riskLevel={profile.risk_level}
            adjuster={<><RiskAdjuster /><AmountCard title="Your amount" /></>}
          />
        </div>
      ) : (
        state.status === 'loading' && <Loading label="Building your plan" />
      )}
    </>
  );
}

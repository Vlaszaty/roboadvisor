import health from './health.json';
import defaults from './defaults.json';
import questionnaire from './questionnaire.json';
import score from './score.json';
import universe from './universe.json';
import fund from './fund.json';
import portfolio from './portfolio.json';
import backtest from './backtest.json';
import frontier from './frontier.json';
import universeFrontier from './universe_frontier.json';

const routes: Record<string, unknown> = {
  'GET /api/health': health,
  'GET /api/defaults': defaults,
  'GET /api/intake/questionnaire': questionnaire,
  'POST /api/intake/score': score,
  'GET /api/universe': universe,
  'GET /api/universe/{isin}': fund,
  'POST /api/portfolio': portfolio,
  'POST /api/backtest': backtest,
  'POST /api/frontier': frontier,
  'POST /api/universe/frontier': universeFrontier,
};

const json = { 'Content-Type': 'application/json' };

/** fetch replacement used when VITE_USE_MOCKS=1: serves the JSON files exported by the backend. */
export async function mockFetch(input: Request): Promise<Response> {
  const url = new URL(input.url);
  const exact = `${input.method} ${url.pathname}` in routes;
  const path = !exact && url.pathname.startsWith('/api/universe/') ? '/api/universe/{isin}' : url.pathname;
  const body = routes[`${input.method} ${path}`];
  await new Promise((r) => setTimeout(r, 200)); // make loading states visible
  if (body === undefined) {
    return new Response(JSON.stringify({ error: 'NoMock', detail: path }), { status: 404, headers: json });
  }
  return new Response(JSON.stringify(body), { status: 200, headers: json });
}

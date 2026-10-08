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
import textbook from './textbook.json';
import menu from './menu.json';
import menuOrder from './menu_order.json';
import menuFrontier from './menu_frontier.json';

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
  'POST /api/textbook': textbook,
  'GET /api/menu': menu,
  'POST /api/menu/order': menuOrder,
  'POST /api/menu/frontier': menuFrontier,
};

const json = { 'Content-Type': 'application/json' };

/** fetch replacement used when VITE_USE_MOCKS=1: serves the JSON files exported by the backend. */
export async function mockFetch(input: Request): Promise<Response> {
  const url = new URL(input.url);
  const exact = `${input.method} ${url.pathname}` in routes;
  const path = !exact && url.pathname.startsWith('/api/universe/') ? '/api/universe/{isin}' : url.pathname;
  let body = routes[`${input.method} ${path}`];
  // The universe chart follows the page's asset-class filter, so the mock does too.
  if (body !== undefined && `${input.method} ${path}` === 'POST /api/universe/frontier') {
    const request = (await input.clone().json().catch(() => ({}))) as { filters?: { asset_class?: string } };
    const assetClass = request.filters?.asset_class;
    const full = body as { points: Array<{ asset_class: string }> };
    if (assetClass) body = { ...full, points: full.points.filter((p) => p.asset_class === assetClass) };
  }
  await new Promise((r) => setTimeout(r, 200)); // make loading states visible
  if (body === undefined) {
    return new Response(JSON.stringify({ error: 'NoMock', detail: path }), { status: 404, headers: json });
  }
  return new Response(JSON.stringify(body), { status: 200, headers: json });
}

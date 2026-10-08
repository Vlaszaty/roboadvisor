import { describe, expect, it } from 'vitest';
import frontierMock from '../mocks/menu_frontier.json';
import orderMock from '../mocks/menu_order.json';
import type { Frontier, Order } from './method';
import {
  buildMethod, chartData, chartDescription, correlationGrid, exampleExpected, exampleMix, funnelTable, makeFmt, methodPath, mixExample,
  netReturn, parseMethodParams, readTrace, returnExample, ruleLabel,
} from './method';

const order = orderMock as unknown as Order;
const frontier = frontierMock as unknown as Frontier;
const en = makeFmt('en');
const m = buildMethod(order, frontier)!;

describe('trace reader', () => {
  it('reads the mock trace and refuses an incomplete one', () => {
    const tr = readTrace(order)!;
    expect(tr.nFunds).toBe(24);
    expect(tr.constraints.maxEtfs).toBe(10);
    expect(tr.expected.market).toEqual({ IE00B6R52259: 0.6, IE00BDBRDM35: 0.4 });
    expect(readTrace({ ...order, trace: [] })).toBeNull();
    expect(buildMethod({ ...order, trace: [] })).toBeNull();
  });
  it('names funds from holdings, then frontier markers, then the ISIN', () => {
    expect(m.name('IE00B6R52259')).toBe('Syn ACWI UCITS');
    expect(m.name('SYNHLTH00001')).toBe('Syn World Healthcare');
    expect(m.name('XX0000000000')).toBe('XX0000000000');
  });
});

describe('step 1 funnel', () => {
  it('ends exactly at n_candidates and only lists rules that removed something', () => {
    const { table, left } = funnelTable(m, en);
    const tr = m.trace;
    expect(left).toBe(tr.returns.nCandidates);
    expect(table.rows[0][2]).toBe('24');
    expect(table.rows.at(-1)![2]).toBe(String(tr.returns.nCandidates));
    const removedRows = table.rows.slice(1, -1);
    const sum = removedRows.reduce((s, r) => s + Number(String(r[1]).replace('−', '')), 0);
    expect(24 - sum).toBe(tr.returns.nCandidates);
    expect(removedRows.length).toBe(Object.values(tr.removed).filter((n) => n > 0).length + (tr.returns.shortHistory.length > 0 ? 1 : 0));
    expect(removedRows.map((r) => r[0])).toContain('US funds that may not be sold to private investors in Europe');
  });
  it('has plain names in both languages and works with the same-index rule', () => {
    expect(ruleLabel('non_ucits', makeFmt('nl'))).toMatch(/Amerikaanse fondsen/);
    const tr = m.trace;
    const more = { ...m, trace: { ...tr, nFunds: 30, removed: { ...tr.removed, same_index_duplicates: 6 }, returns: { ...tr.returns, nCandidates: 12 } } };
    expect(funnelTable(more, en).left).toBe(12);
  });
});

describe('step 3 mixing example', () => {
  it('mixes the two largest holdings half each, and the mix is below the plain average', () => {
    const x = mixExample(m)!;
    expect(x.a).toBe('Syn ACWI UCITS');
    expect(x.b).toBe('Syn Global Agg EUR Hedged');
    expect([x.volA, x.volB, x.rho]).toEqual([0.185, 0.052, -0.01]);
    // redo the sum from the numbers shown next to it
    expect(x.mix).toBeCloseTo(Math.sqrt(0.25 * 0.185 ** 2 + 0.25 * 0.052 ** 2 + 0.5 * -0.01 * 0.185 * 0.052), 3);
    expect(x.mix).toBeLessThan(x.average);
    expect(exampleMix(m, en)).toContain('18.5%');
    expect(exampleMix(m, en)).toContain('−0.01');
  });
  it('waits for the frontier instead of inventing volatilities', () => {
    const noFrontier = buildMethod(order)!;
    expect(mixExample(noFrontier)).toBeNull();
    expect(exampleMix(noFrontier, en)).toMatch(/loaded/);
  });
  it('lines the correlation grid up with the held funds', () => {
    const g = correlationGrid(m)!;
    expect(g.head).toHaveLength(m.held.length);
    expect(g.rows[0].cells[0]).toBe(1);
    expect(g.rows[0].cells[1]).toBeCloseTo(-0.01094, 4);
  });
});

describe('step 4 expected return example', () => {
  it('rf + beta x premium equals the shown expected return at displayed rounding', () => {
    const x = returnExample(m)!;
    expect(x.rf + x.beta * x.premium).toBeCloseTo(x.total, 1);
    expect(x.total).toBeCloseTo(x.exact, 1);
    expect(x.total).toBe(8.66); // 3.00 + 1.618 x 3.5 = 3.00 + 5.66
    expect(exampleExpected(m, en)).toContain('3.00% risk-free rate + beta 1.618 × 3.5% market premium = 3.00% + 5.66% = 8.66%');
  });
});

describe('step 7', () => {
  it('after costs equals expected return minus cost', () => {
    expect(netReturn(m)).toEqual({ gross: 5.79, cost: 0.15, net: 5.64 });
  });
});

describe('chart data', () => {
  it('splits candidates from held funds and places the recipe and target', () => {
    const d = chartData(m, en)!;
    expect(d.held).toHaveLength(m.held.length);
    expect(d.candidates.length + d.held.length).toBe(12);
    expect(d.recipe).toMatchObject({ x: 9, y: 5.7888 });
    expect(d.target).toBe(9);
    expect(d.frontier.map((p) => p.x)).toEqual([...d.frontier.map((p) => p.x)].sort((a, b) => a - b));
    expect(chartDescription(d, en)).toContain('9.0% swing');
    expect(chartData(buildMethod(order)!, en)).toBeNull();
  });
});

describe('URL', () => {
  it('parses base and strength', () => {
    expect(parseMethodParams('?base=matcha&strength=3')).toEqual({ base: 'matcha', strength: 3 });
  });
  it('falls back to coffee 4, each value on its own', () => {
    expect(parseMethodParams('')).toEqual({ base: 'coffee', strength: 4 });
    expect(parseMethodParams('?base=tea&strength=0')).toEqual({ base: 'coffee', strength: 4 });
    expect(parseMethodParams('?base=matcha&strength=8')).toEqual({ base: 'matcha', strength: 4 });
    expect(parseMethodParams('?strength=2.5')).toEqual({ base: 'coffee', strength: 4 });
    expect(parseMethodParams('?strength=abc&base=matcha')).toEqual({ base: 'matcha', strength: 4 });
    expect(methodPath('matcha', 1)).toBe('/cafe/method?base=matcha&strength=1');
  });
});

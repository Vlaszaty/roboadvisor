import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import mock from '../../mocks/textbook.json';
import { Steps } from '../../pages/Textbook';
import { STEPS, STEPS_NL } from './copy';
import type { Textbook } from './textbook';

const t = mock as unknown as Textbook;
const historical = { ...t, inputs: { ...t.inputs, return_model: 'historical' } } as Textbook;
const MARKERS = ['With your numbers', 'What to notice', 'Show the formula', '(used)', 'Fund', 'Expected return', 'Explain this', 'Weight', 'Volatility', 'Building block'];

describe('Steps in Dutch', () => {
  for (const [name, data] of [['capm', t], ['historical', historical]] as const) {
    it(`shows no leftover English (${name})`, () => {
      const html = renderToStaticMarkup(<Steps t={data} language="nl" />);
      for (const m of MARKERS) expect(html, m).not.toContain(m);
      expect(html).toContain('Met jouw cijfers');
      expect(html).toContain('Laat de formule zien');
      expect(html).toContain('Leg uit');
      expect(html).toContain('(gebruikt)');
      expect(html).toContain('dia’s 52–54');
      expect(html).not.toMatch(/\d\.\d+%/);
    });
  }
  it('English is the default', () => {
    const html = renderToStaticMarkup(<Steps t={t} />);
    expect(html).toContain('With your numbers');
    expect(html).toContain('(used)');
    expect(html).toContain('Explain this');
    expect(html).toBe(renderToStaticMarkup(<Steps t={t} language="en" />));
  });
  it('every English step has a Dutch twin', () => {
    expect(Object.keys(STEPS_NL)).toEqual(Object.keys(STEPS));
    for (const k of Object.keys(STEPS) as Array<keyof typeof STEPS>) expect(STEPS_NL[k].title).not.toBe(STEPS[k].title);
  });
});

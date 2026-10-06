import type { ReactNode } from 'react';

/**
 * Small line drawings for the answer tiles. Drawn with currentColor so every look can recolour them.
 * Decorative only: the tile's text carries the meaning.
 */
const Svg = ({ children }: { children: ReactNode }) => (
  <svg className="glyph" viewBox="0 0 64 48" width="64" height="48" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);

const wave = (kind: 'flat' | 'gentle' | 'variable' | 'down') => {
  const d = {
    flat: 'M6 24 H58',
    gentle: 'M6 28 C18 18 28 34 40 22 S54 24 58 20',
    variable: 'M6 30 L16 14 L26 34 L36 12 L46 36 L58 18',
    down: 'M6 12 L24 20 L34 18 L58 40',
  }[kind];
  return <Svg><path d={d} /></Svg>;
};

const pie = (frac: number) => {
  const a = frac * 2 * Math.PI;
  const x = 32 + 18 * Math.sin(a);
  const y = 24 - 18 * Math.cos(a);
  return (
    <Svg>
      <circle cx="32" cy="24" r="18" />
      <path d={`M32 24 L32 6 A18 18 0 ${frac > 0.5 ? 1 : 0} 1 ${x.toFixed(1)} ${y.toFixed(1)} Z`} fill="currentColor" />
    </Svg>
  );
};

const battery = (level: number) => (
  <Svg>
    <rect x="8" y="14" width="42" height="20" rx="3" />
    <path d="M54 20 V28" />
    {[0, 1, 2, 3].map((i) => (i < level ? <rect key={i} x={11 + i * 9.5} y="17" width="7" height="14" rx="1" fill="currentColor" stroke="none" /> : null))}
  </Svg>
);

const meter = (pos: number) => {
  const a = ((-70 + pos * (140 / 3)) * Math.PI) / 180;
  return (
    <Svg>
      <path d="M10 38 A22 22 0 0 1 54 38" />
      <path d={`M32 38 L${(32 + 18 * Math.sin(a)).toFixed(1)} ${(38 - 18 * Math.cos(a)).toFixed(1)}`} />
      <circle cx="32" cy="38" r="2.5" fill="currentColor" />
    </Svg>
  );
};

const sprout = (n: number) => {
  const parts: Record<number, ReactNode> = {
    0: <circle cx="32" cy="36" r="4" fill="currentColor" />,
    1: <path d="M32 40 V30 M32 32 C26 32 24 28 24 25 C29 25 32 28 32 32" />,
    2: <path d="M32 40 V22 M32 34 C26 34 23 30 23 27 C28 27 32 30 32 34 M32 28 C38 28 41 24 41 21 C36 21 32 24 32 28" />,
    3: (
      <>
        <path d="M32 40 V26 M32 34 L24 28 M32 32 L40 26" />
        <circle cx="32" cy="16" r="10" />
      </>
    ),
  };
  return <Svg><path d="M12 42 H52" />{parts[n]}</Svg>;
};

const range = (lo: number, hi: number) => {
  const x = (v: number) => 8 + ((v + 30) / 75) * 48;
  return (
    <Svg>
      <path d="M6 36 H58" />
      <rect x={x(lo)} y="14" width={x(hi) - x(lo)} height="16" rx="3" fill="currentColor" fillOpacity="0.25" />
      <path d={`M${x(0).toFixed(1)} 8 V36`} />
    </Svg>
  );
};

const loss = (depth: number | 'shield') =>
  depth === 'shield' ? (
    <Svg>
      <path d="M32 6 L50 12 V26 C50 36 42 42 32 44 C22 42 14 36 14 26 V12 Z" />
      <path d="M24 25 L30 31 L41 19" />
    </Svg>
  ) : (
    <Svg>
      <path d="M8 10 H56" strokeDasharray="2 6" />
      <path d={`M8 10 L22 14 L32 12 L56 ${depth}`} />
    </Svg>
  );

const trend = (kind: 'cautious' | 'careful' | 'balanced' | 'adventurous') => {
  const d = {
    cautious: 'M8 32 C24 32 40 30 56 28',
    careful: 'M8 34 C24 32 40 26 56 20',
    balanced: 'M8 36 L20 26 L30 32 L42 20 L56 14',
    adventurous: 'M8 40 L18 22 L26 32 L38 10 L44 20 L56 6',
  }[kind];
  return <Svg><path d={d} /></Svg>;
};

const GLYPHS: Record<string, Record<string, ReactNode>> = {
  income_stability: { very_stable: wave('flat'), fairly_stable: wave('gentle'), variable: wave('variable'), unstable: wave('down') },
  wealth_share: { lt_10: pie(0.07), '10_25': pie(0.17), '25_50': pie(0.37), gt_50: pie(0.65) },
  emergency_buffer: { over_12m: battery(4), '6_12m': battery(3), '3_6m': battery(2), under_3m: battery(1) },
  withdrawals: { none: meter(0), unlikely: meter(1), possible: meter(2), likely: meter(3) },
  drop_reaction: {
    sell_all: <Svg><path d="M8 24 H44 M34 14 L44 24 L34 34 M54 10 V38" /></Svg>,
    sell_some: <Svg><path d="M8 24 H32 M24 14 L32 24 L24 34 M44 12 V36 M54 12 V36" strokeDasharray="1 5" /></Svg>,
    hold: <Svg><path d="M24 12 V36 M40 12 V36" strokeWidth="6" /></Svg>,
    buy_more: <Svg><circle cx="32" cy="24" r="16" /><path d="M32 16 V32 M24 24 H40" /></Svg>,
  },
  tradeoff: { very_safe: range(-2, 6), moderate: range(-8, 12), growth: range(-18, 25), aggressive: range(-30, 45) },
  experience: { none: sprout(0), little: sprout(1), some: sprout(2), lots: sprout(3) },
  self_assessment: { cautious: trend('cautious'), careful: trend('careful'), balanced: trend('balanced'), adventurous: trend('adventurous') },
  max_loss: { none: loss('shield'), up_to_10: loss(16), up_to_20: loss(24), up_to_30: loss(32), over_30: loss(42) },
};

export const glyphFor = (questionId: string, value: string): ReactNode | null => GLYPHS[questionId]?.[value] ?? null;

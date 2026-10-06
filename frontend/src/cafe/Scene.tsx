import { useEffect, useRef, useState } from 'react';
import { useCafeLanguage } from './language';

/** Existing keyframes composited locally: the background never jumps between generated poses. */
export function Scene({ preparing }: { preparing: boolean }) {
  const { t } = useCafeLanguage();
  const ref = useRef<HTMLCanvasElement>(null);
  const preparingRef = useRef(preparing);
  const refreshRef = useRef<() => void>(() => {});
  const [failed, setFailed] = useState(false);
  useEffect(() => { preparingRef.current = preparing; refreshRef.current(); }, [preparing]);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let active = true, timer: ReturnType<typeof setTimeout> | undefined;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const images = ['/cafe/bar-clear.png', '/cafe/pose-mid.png', '/cafe/pose-dose.png'].map((src) => {
      const img = new Image(); img.src = src; return img;
    });
    let eyes: HTMLCanvasElement[] = [], arms: HTMLCanvasElement[] = [];
    function patch(img: HTMLImageElement, regions: number[][]): HTMLCanvasElement {
      const layer = document.createElement('canvas'); layer.width = 1536; layer.height = 1024;
      const c = layer.getContext('2d')!; c.drawImage(img, 0, 0);
      const mask = document.createElement('canvas'); mask.width = 1536; mask.height = 1024;
      const m = mask.getContext('2d')!; m.fillStyle = '#fff'; m.filter = 'blur(4px)';
      for (const [x, y, w, h] of regions) m.fillRect(x + 4, y + 4, w - 8, h - 8);
      c.globalCompositeOperation = 'destination-in'; c.drawImage(mask, 0, 0);
      return layer;
    }
    function draw(frame = 0) {
      if (!active) return;
      ctx!.clearRect(0, 0, 1536, 1024); ctx!.drawImage(images[0], 0, 0);
      if (frame > 0) ctx!.drawImage(eyes[frame - 1], 0, 0);
      if (preparingRef.current && !motion.matches) ctx!.drawImage(arms[frame === 1 ? 0 : 1], 0, 0);
    }
    function schedule() {
      clearTimeout(timer);
      draw();
      if (!active || motion.matches || document.hidden) return;
      timer = setTimeout(() => {
        draw(2); timer = setTimeout(() => {
          draw(1); timer = setTimeout(() => {
            draw(2); timer = setTimeout(schedule, 75);
          }, 100);
        }, 75);
      }, preparingRef.current ? 650 : 4500 + Math.random() * 1500);
    }
    const changed = () => { if (eyes.length) schedule(); };
    refreshRef.current = changed;
    Promise.all(images.map((img) => img.decode())).then(() => {
      if (!active) return;
      eyes = images.slice(1).map((img) => patch(img, [[701, 205, 148, 64]]));
      arms = images.slice(1).map((img) => patch(img, [[510, 365, 200, 430], [459, 743, 34, 70]]));
      schedule();
    }).catch(() => { if (active) setFailed(true); });
    motion.addEventListener('change', changed); document.addEventListener('visibilitychange', changed);
    return () => { active = false; refreshRef.current = () => {}; clearTimeout(timer); motion.removeEventListener('change', changed); document.removeEventListener('visibilitychange', changed); };
  }, []);
  return <>
    <canvas ref={ref} width={1536} height={1024} role="img" aria-label={t('Een vriendelijke barista in een zonnige Amsterdamse koffie- en matchazaak', 'A friendly barista in a sunny Amsterdam coffee and matcha café')} />
    {failed && <p className="cafe-art-error">{t('De illustratie kon niet laden. Je kunt hieronder wel je recept samenstellen.', 'The illustration could not load. You can still put together your recipe below.')}</p>}
  </>;
}

export function Vessel({ kind, amount = 0, base = 'matcha' }: { kind: 'tin' | 'milk' | 'sugar' | 'cup' | 'jar' | 'debt' | 'stamps'; amount?: number; base?: string }) {
  const { t } = useCafeLanguage();
  const green = base === 'matcha', color = green ? '#708747' : '#70442e';
  if (kind === 'tin') return <svg viewBox="0 0 100 108" aria-hidden="true" className="cafe-vessel">
    <ellipse cx="50" cy="99" rx="37" ry="6" fill="#654629" opacity=".16" />
    <path d="M18 21 Q50 11 82 21 L82 85 Q50 103 18 85Z" fill={green ? '#8f9d68' : '#9d6f51'} stroke="#514536" strokeWidth="2" />
    <ellipse cx="50" cy="21" rx="32" ry="9" fill={green ? '#adb689' : '#ba9272'} stroke="#514536" strokeWidth="2" />
    <path d="M27 35 Q50 41 73 35 L73 78 Q50 84 27 78Z" fill="#f4e8c9" />
    <path d={green ? 'M49 48 Q33 56 49 68 Q66 57 49 48 M49 49 L49 69' : 'M49 48 C32 44 31 67 46 70 C62 74 66 49 49 48 M47 50 Q53 57 43 67'} fill={color} stroke={color} strokeWidth="2" />
    <text x="50" y="93" textAnchor="middle" fontSize="8" fill="#fff5dd" fontFamily="Georgia">{green ? 'MATCHA' : t('KOFFIE', 'COFFEE')}</text>
  </svg>;
  if (kind === 'jar') {
    const fill = [62, 46, 28, 9][amount] ?? 0;
    return <svg viewBox="0 0 100 108" aria-hidden="true" className="cafe-vessel">
      <ellipse cx="50" cy="99" rx="31" ry="6" fill="#654629" opacity=".16" />
      <rect x="30" y="12" width="40" height="11" rx="3" fill="#b38d5d" stroke="#5b4630" strokeWidth="2" />
      <path d="M27 25 Q24 30 24 38 L24 86 Q24 95 34 95 L66 95 Q76 95 76 86 L76 38 Q76 30 73 25Z" fill="#f3e9d5" fillOpacity=".8" stroke="#575747" strokeWidth="2.5" />
      {fill > 0 && <path d={`M26 ${93 - fill} L74 ${93 - fill} L74 86 Q74 93 66 93 L34 93 Q26 93 26 86Z`} fill="#d8b55a" stroke="#9c7b33" strokeWidth="1.5" />}
      {Array.from({ length: Math.floor(fill / 14) }, (_, i) => <ellipse key={i} cx={38 + (i % 3) * 12} cy={88 - i * 13} rx="6" ry="2.2" fill="#f2d57e" stroke="#9c7b33" />)}
      <path d="M33 34 L35 78" stroke="#fff8e6" strokeWidth="3" strokeLinecap="round" opacity=".7" />
    </svg>;
  }
  if (kind === 'debt') return <svg viewBox="0 0 100 108" aria-hidden="true" className="cafe-vessel">
    <ellipse cx="50" cy="96" rx="34" ry="6" fill="#654629" opacity=".16" />
    <rect x="16" y="34" width="68" height="44" rx="6" fill={amount ? '#c98d6a' : '#e8e2c8'} stroke="#5b4630" strokeWidth="2.5" />
    <rect x="16" y="44" width="68" height="8" fill={amount ? '#7d4a35' : '#bcb497'} />
    <rect x="24" y="61" width="22" height="6" rx="2" fill="#fff6e4" opacity=".8" />
    {amount ? <path d="M60 58 L74 72 M74 58 L60 72" stroke="#fff6e4" strokeWidth="3.5" strokeLinecap="round" /> : <path d="M58 65 L64 71 L76 58" fill="none" stroke="#4f6a43" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />}
  </svg>;
  if (kind === 'stamps') return <svg viewBox="0 0 100 108" aria-hidden="true" className="cafe-vessel">
    <ellipse cx="50" cy="96" rx="36" ry="6" fill="#654629" opacity=".16" />
    <rect x="12" y="30" width="76" height="52" rx="5" fill="#fff6e4" stroke="#5b4630" strokeWidth="2.5" />
    <text x="50" y="44" textAnchor="middle" fontSize="8" fill="#5b4630" fontFamily="Georgia">{t('STEMPELKAART', 'STAMP CARD')}</text>
    {[0, 1, 2].map(i => <g key={i}>
      <circle cx={28 + i * 22} cy="64" r="8" fill={i < amount ? '#708747' : 'none'} stroke="#8f8565" strokeWidth="1.8" strokeDasharray={i < amount ? undefined : '3 2'} />
      {i < amount && <path d={`M${24 + i * 22} 64 L${27 + i * 22} 67 L${32 + i * 22} 60`} fill="none" stroke="#fff6e4" strokeWidth="2" strokeLinecap="round" />}
    </g>)}
  </svg>;
  if (kind === 'sugar') return <svg viewBox="0 0 100 108" aria-hidden="true" className="cafe-vessel">
    <ellipse cx="50" cy="91" rx="34" ry="9" fill="#f8ecd3" stroke="#a88e67" strokeWidth="1.5" />
    {amount === 0 ? <path d="M36 77 L66 67 M39 82 L69 72" stroke="#88765d" strokeWidth="3" strokeLinecap="round" /> : Array.from({ length: amount }, (_, i) => <g key={i} transform={`translate(${28 + (i % 2) * 24} ${65 - Math.floor(i / 2) * 24})`}>
      <path d="M0 7 L10 0 L27 3 L17 11Z" fill="#fff9e9" stroke="#947c56" strokeWidth="1.4" />
      <path d="M0 7 L17 11 L17 28 L0 24Z" fill="#f3e6c7" stroke="#947c56" strokeWidth="1.4" />
      <path d="M17 11 L27 3 L27 20 L17 28Z" fill="#ddcba8" stroke="#947c56" strokeWidth="1.4" />
    </g>)}
  </svg>;
  if (kind === 'cup') return <svg viewBox="0 0 140 120" aria-hidden="true" className="cafe-vessel cafe-final-cup">
    <ellipse cx="68" cy="103" rx="54" ry="12" fill="#eee0ba" stroke="#8b7757" strokeWidth="2" />
    <path d="M108 51 C142 42 140 86 109 87" fill="none" stroke="#d9c59b" strokeWidth="12" />
    <path d="M20 48 L27 87 Q67 112 108 87 L115 48Z" fill="#f2e7c9" stroke="#806e50" strokeWidth="2" />
    <ellipse cx="67" cy="48" rx="47" ry="14" fill={color} stroke="#806e50" strokeWidth="2" />
    <ellipse cx="67" cy="48" rx={12 + amount * 6} ry={4 + amount * 1.6} fill="#e7dbb7" opacity={amount ? .85 : .3} />
    <path d="M47 48 Q67 26 85 48 Q67 69 47 48 M52 48 Q67 34 80 48 Q67 60 52 48 M67 35 L67 61" fill="none" stroke="#fcf1d4" strokeWidth="2" />
  </svg>;
  const milkHeight = 7 + amount * 12;
  return <svg viewBox="0 0 100 108" aria-hidden="true" className="cafe-vessel">
    <ellipse cx="50" cy="99" rx="30" ry="6" fill="#654629" opacity=".16" />
    <path d="M26 23 L31 87 Q50 99 69 87 L74 23Z" fill="#f3e9d5" fillOpacity=".78" stroke="#575747" strokeWidth="2.5" />
    <path d={`M${31 - milkHeight / 15} ${88 - milkHeight} Q50 ${82 - milkHeight} ${69 + milkHeight / 15} ${88 - milkHeight} L69 87 Q50 96 31 87Z`} fill="#fff6e4" stroke="#96815e" strokeWidth="1.5" />
    <ellipse cx="50" cy="23" rx="24" ry="5" fill="#e6e2cb" fillOpacity=".8" stroke="#575747" strokeWidth="2.5" />
    <path d="M33 32 L36 74" stroke="#fff8e6" strokeWidth="3" strokeLinecap="round" opacity=".7" />
  </svg>;
}

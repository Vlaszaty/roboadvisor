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

export function Vessel({ kind, amount = 0, base = 'matcha' }: { kind: 'tin' | 'milk' | 'sugar' | 'cup' | 'cookies' | 'brew' | 'stamps'; amount?: number; base?: string }) {
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
  if (kind === 'cookies') {
    const n = [3, 1, 0][amount] ?? 0;
    return <svg viewBox="0 0 100 108" aria-hidden="true" className="cafe-vessel">
      <ellipse cx="50" cy="90" rx="40" ry="10" fill="#f8ecd3" stroke="#a88e67" strokeWidth="1.5" />
      <ellipse cx="50" cy="88" rx="26" ry="5" fill="none" stroke="#d8c7a3" strokeWidth="1.2" />
      {n === 0 && <path d="M38 84 Q42 80 46 84 M56 85 l2 0" stroke="#b9a582" strokeWidth="1.6" strokeLinecap="round" fill="none" />}
      {Array.from({ length: n }, (_, i) => <g key={i} transform={`translate(${n === 1 ? 50 : 34 + i * 16} ${80 - (i === 1 ? 10 : 0)})`}>
        <ellipse cx="0" cy="0" rx="14" ry="7" fill="#c98a4b" stroke="#7a4f27" strokeWidth="1.6" />
        <ellipse cx="0" cy="-2" rx="11" ry="4.5" fill="#d9a066" />
        <circle cx="-5" cy="-2" r="1.6" fill="#5b3a1e" /><circle cx="3" cy="-3" r="1.6" fill="#5b3a1e" /><circle cx="6" cy="0" r="1.4" fill="#5b3a1e" />
      </g>)}
    </svg>;
  }
  if (kind === 'brew') {
    const brown = '#6b4428', line = '#5b4630';
    return <svg viewBox="0 0 100 108" aria-hidden="true" className="cafe-vessel">
      <ellipse cx="50" cy="99" rx="32" ry="6" fill="#654629" opacity=".16" />
      {amount === 0 && <g><path d="M36 66 L39 92 Q50 98 61 92 L64 66Z" fill="#f2e7c9" stroke={line} strokeWidth="2.2" /><path d="M64 72 Q74 72 72 82 Q70 88 62 87" fill="none" stroke={line} strokeWidth="2.2" /><ellipse cx="50" cy="66" rx="14" ry="3.5" fill={brown} stroke={line} strokeWidth="1.5" /><ellipse cx="50" cy="97" rx="20" ry="3.5" fill="#eee0ba" stroke={line} strokeWidth="1.5" /></g>}
      {amount === 1 && <g><path d="M30 34 L70 34 L58 56 L42 56Z" fill="#f4ead2" stroke={line} strokeWidth="2.2" /><path d="M46 56 L46 60 M54 56 L54 60" stroke={brown} strokeWidth="2" /><path d="M32 62 L35 94 Q50 100 65 94 L68 62Z" fill="#f2e7c9" stroke={line} strokeWidth="2.2" /><path d="M68 70 Q80 72 76 84 Q73 90 66 88" fill="none" stroke={line} strokeWidth="2.2" /><ellipse cx="50" cy="66" rx="17" ry="3.5" fill={brown} /></g>}
      {amount === 2 && <g><path d="M34 14 L66 14 L54 40 L46 40Z" fill="#f4ead2" stroke={line} strokeWidth="2.2" /><path d="M46 40 L40 52 Q24 74 32 92 Q50 100 68 92 Q76 74 60 52 L54 40Z" fill="#eef1ea" fillOpacity=".8" stroke={line} strokeWidth="2.2" /><path d="M31 78 Q50 74 69 78 Q72 86 68 92 Q50 100 32 92 Q28 86 31 78Z" fill={brown} /><rect x="42" y="44" width="16" height="7" rx="2" fill="#b38d5d" /></g>}
      {amount === 3 && <g><rect x="32" y="10" width="36" height="9" rx="3" fill="#b38d5d" stroke={line} strokeWidth="2" /><path d="M30 20 L70 20 L72 30 L72 92 Q72 98 64 98 L36 98 Q28 98 28 92 L28 30Z" fill="#f3e9d5" fillOpacity=".8" stroke={line} strokeWidth="2.4" /><path d="M29 40 L71 40 L71 92 Q71 96 64 96 L36 96 Q29 96 29 92Z" fill={brown} /><path d="M35 46 L36 86" stroke="#a87a55" strokeWidth="3" strokeLinecap="round" opacity=".6" /><text x="50" y="72" textAnchor="middle" fontSize="9" fill="#f3e9d5" fontFamily="Georgia">COLD</text></g>}
      {amount === 4 && <g><path d="M32 76 L36 98 L64 98 L68 76Z" fill="#b8734a" stroke={line} strokeWidth="2.2" /><rect x="29" y="70" width="42" height="8" rx="2" fill="#c8845a" stroke={line} strokeWidth="2" /><path d="M50 70 L50 18" stroke="#5c6b3a" strokeWidth="3" /><path d="M50 56 Q34 50 30 38 Q44 38 50 52 M50 44 Q66 38 70 26 Q56 26 50 40 M50 30 Q38 24 38 12 Q48 16 50 28" fill="#708747" stroke="#4f6a43" strokeWidth="1.5" /><circle cx="56" cy="52" r="3.2" fill="#b3352a" /><circle cx="60" cy="56" r="3.2" fill="#c4443a" /><circle cx="43" cy="40" r="3" fill="#b3352a" /></g>}
    </svg>;
  }
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

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

/** A small "i" button that opens a short explanation. Click or Enter opens it, Escape or a click outside closes it. */
export function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const box = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); button.current?.focus(); } };
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('keydown', key);
    document.addEventListener('pointerdown', away);
    return () => { document.removeEventListener('keydown', key); document.removeEventListener('pointerdown', away); };
  }, [open]);
  return <span className="cafe-info" ref={box}>
    <button ref={button} type="button" className="cafe-info-button" aria-label={label} aria-expanded={open} aria-controls={id} onClick={() => setOpen(o => !o)}>i</button>
    <span id={id} role="note" className="cafe-info-pop" hidden={!open}>{children}</span>
  </span>;
}

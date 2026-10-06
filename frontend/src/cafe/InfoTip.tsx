import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

/** A small "i" button with a short explanation. A mouse shows it on hover, the keyboard on focus, touch on tap.
 * Escape or a tap elsewhere closes it. */
export function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const box = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const pointer = useRef('');
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); button.current?.focus(); } };
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('keydown', key);
    document.addEventListener('pointerdown', away);
    return () => { document.removeEventListener('keydown', key); document.removeEventListener('pointerdown', away); };
  }, [open]);
  const mouse = (e: React.PointerEvent) => e.pointerType === 'mouse';
  return <span className="cafe-info" ref={box}
    onPointerEnter={e => { if (mouse(e)) setOpen(true); }}
    onPointerLeave={e => { if (mouse(e)) setOpen(false); }}>
    <button ref={button} type="button" className="cafe-info-button" aria-label={label} aria-expanded={open} aria-describedby={open ? id : undefined}
      onPointerDown={e => { pointer.current = e.pointerType; }}
      onFocus={() => { if (!pointer.current) setOpen(true); }}
      onBlur={() => { pointer.current = ''; setOpen(false); }}
      onClick={() => { if (pointer.current !== 'mouse') setOpen(o => !o); pointer.current = ''; }}>i</button>
    <span id={id} role="tooltip" className="cafe-info-pop" hidden={!open}>{children}</span>
  </span>;
}

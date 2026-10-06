import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { explanationById } from './explanations';
import './explain.css';

interface Ctx {
  open(id: string, trigger: HTMLElement | null): void;
}
const ExplainContext = createContext<Ctx>({ open: () => {} });

/** Holds the mascot popup. Wrap the app once; any <ExplainButton> below it can open the popup. */
export function ExplainProvider({ children }: { children: ReactNode }) {
  const [id, setId] = useState<string | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const close = useCallback(() => {
    setId(null);
    trigger.current?.focus();
  }, []);
  const open = useCallback((next: string, from: HTMLElement | null) => {
    trigger.current = from;
    setId(next);
  }, []);
  const { pathname } = useLocation();
  useEffect(() => setId(null), [pathname]);
  return (
    <ExplainContext.Provider value={{ open }}>
      {children}
      {id && <Mascot id={id} onClose={close} />}
    </ExplainContext.Provider>
  );
}

function Mascot({ id, onClose }: { id: string; onClose(): void }) {
  const e = explanationById(id);
  const closeBtn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeBtn.current?.focus();
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  if (!e) return null;
  return (
    <>
      <div className="mascot-overlay" onClick={onClose} aria-hidden="true" />
      <div className="mascot" role="dialog" aria-labelledby="mascot-title" aria-modal="false">
      <div className="mascot-bubble">
        <h2 id="mascot-title" className="mascot-title">{e.title}</h2>
        {e.body.map((p) => <p key={p}>{p}</p>)}
        <button ref={closeBtn} type="button" className="btn mascot-close" onClick={onClose}>Got it</button>
      </div>
      <img className="mascot-img" src="/mascot.jpeg" alt="" width={96} height={96} />
      </div>
    </>
  );
}

/** Small "Explain this" button. `id` is a key in explanations.ts. */
export function ExplainButton({ id, label = 'Explain this' }: { id: string; label?: string }) {
  const { open } = useContext(ExplainContext);
  if (!explanationById(id)) return null;
  return (
    <button type="button" className="explain-btn" onClick={(e) => open(id, e.currentTarget)}>
      <span aria-hidden="true">?</span> {label}
    </button>
  );
}

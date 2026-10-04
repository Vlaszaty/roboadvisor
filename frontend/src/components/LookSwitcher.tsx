import { useState } from 'react';
import { applyLook, isLook, LOOKS, storedLook, type LookId } from '../styles/look';

/** Picks one of the three looks. The choice is remembered in this browser. */
export function LookSwitcher() {
  const [look, setLook] = useState<LookId>(storedLook);
  return (
    <label className="look">
      <span>Look</span>
      <select
        value={look}
        onChange={(e) => {
          const v = e.target.value;
          if (!isLook(v)) return;
          setLook(v);
          applyLook(v);
        }}
      >
        {LOOKS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
      </select>
    </label>
  );
}

import { useEffect, useRef, useState } from 'react';

const nf3 = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const nfEur = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const nfInt = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
export const dt = (n) => `${nf3.format(n)} DT`;
export const eur = (n) => nfEur.format(n);
export const int = (n) => nfInt.format(n);
export const today = () => new Date().toLocaleDateString('sv'); // YYYY-MM-DD in local time

const PATHS = {
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v5M14 11v5',
  edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM21 21l-4.3-4.3',
  box: 'M21 8 12 3 3 8v8l9 5 9-5V8ZM3 8l9 5 9-5M12 13v8',
  cart: 'M3 3h2l2.4 12.2a2 2 0 0 0 2 1.6h8.8a2 2 0 0 0 2-1.6L22 7H6M9 21h.01M18 21h.01',
  trend: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  wallet: 'M20 7H5a2 2 0 0 1 0-4h13v4M3 5v14a2 2 0 0 0 2 2h15V7M16 14h.01',
  drop: 'M12 2.7s7 7.3 7 12.3a7 7 0 0 1-14 0c0-5 7-12.3 7-12.3Z',
  sliders: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
  alert: 'M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',
  chart: 'M3 3v18h18M7 16v-5M12 16V8M17 16v-8',
  euro: 'M4 10h12M4 14h9M19 6a7.7 7.7 0 0 0-5.2-2A7.9 7.9 0 0 0 6 12c0 4.4 3.5 8 7.8 8 2 0 3.8-.8 5.2-2',
  doc: 'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9ZM14 3v6h6M8 13h8M8 17h5',
  close: 'M18 6 6 18M6 6l12 12',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12ZM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  eyeOff: 'M3 3l18 18M10.6 10.6a3 3 0 0 0 4.2 4.2M9.9 5.1A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.2M6.6 6.6C3.9 8.4 2 12 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6',
};

export const Icon = ({ name, size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={PATHS[name]} />
  </svg>
);

export function AnimatedNumber({ value, format }) {
  const [shown, setShown] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const t0 = performance.now(), v0 = from.current;
    let raf;
    const tick = (now) => {
      const t = Math.min((now - t0) / 1200, 1);
      from.current = t === 1 ? value : v0 + (value - v0) * (1 - (1 - t) ** 4); // ease-out, exact on the last frame
      setShown(from.current);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <span className="num">{format(shown)}</span>;
}

export const GlassCard = ({ className = '', delay = 0, children, ...rest }) => (
  <section className={`glass rise ${className}`} style={{ animationDelay: `${delay}s` }} {...rest}>
    {children}
  </section>
);

export const Search = ({ value, onChange, label }) => (
  <label className="search">
    <Icon name="search" size={16} />
    <input type="search" placeholder="Rechercher…" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} />
  </label>
);

export const Empty = ({ icon, children }) => (
  <div className="empty">
    <span className="empty-drop"><Icon name={icon} size={28} /></span>
    <p>{children}</p>
  </div>
);

export function Modal({ open, title, onClose, children }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  return (
    open && (
      <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        <div role="dialog" aria-modal="true" aria-label={title} className="glass modal rise">
          <header className="modal-head">
            <h2>{title}</h2>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Fermer"><Icon name="close" /></button>
          </header>
          {children}
        </div>
      </div>
    )
  );
}

export const ConfirmModal = ({ message, onConfirm, onClose }) => (
  <Modal open={!!message} title="Confirmer" onClose={onClose}>
    <p className="confirm-text">{message}</p>
    <div className="form-actions">
      <button type="button" className="btn ghost" onClick={onClose}>Annuler</button>
      <button type="button" className="btn danger" onClick={() => { onConfirm(); onClose(); }} autoFocus>Supprimer</button>
    </div>
  </Modal>
);

export function Toast({ toast, onDone }) {
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(onDone, 3200);
    return () => clearTimeout(t);
  }, [toast, onDone]);
  return (
    <div className="toast-wrap" role="status" aria-live="polite">
      {toast && (
        <div key={toast.id} className={`toast glass rise ${toast.type}`}>
          <Icon name={toast.type === 'err' ? 'alert' : 'drop'} /> {toast.msg}
        </div>
      )}
    </div>
  );
}

export const Background = () => (
  <div className="bg" aria-hidden="true">
    <div className="blob b1" />
    <div className="blob b2" />
    <div className="blob b3" />
    <svg className="waves" viewBox="0 24 150 28" preserveAspectRatio="none">
      <defs>
        <path id="wave" d="M-160 44c30 0 58-18 88-18s58 18 88 18 58-18 88-18 58 18 88 18v44h-352z" />
      </defs>
      <g className="parallax">
        <use href="#wave" x="48" y="0" />
        <use href="#wave" x="48" y="3" />
        <use href="#wave" x="48" y="5" />
        <use href="#wave" x="48" y="7" />
      </g>
    </svg>
  </div>
);

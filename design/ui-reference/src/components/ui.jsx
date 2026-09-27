import { useEffect, useId, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { ACCENTS } from '../lib/defaults.js';
import { STATE_LABEL } from '../lib/health.js';

export function SystemGlyph({ icon, accent, size = 44 }) {
  const c = ACCENTS[accent] || ACCENTS.blue;
  return (
    <span
      className="glyph"
      style={{ '--ga': c.a, '--gb': c.b, width: size, height: size, borderRadius: size * 0.28 }}
    >
      <Icon name={icon} size={Math.round(size * 0.46)} strokeWidth={1.9} />
    </span>
  );
}

export function StatusBadge({ state, compact = false }) {
  return (
    <span className={`status status--${state}`} title={STATE_LABEL[state]}>
      <span className="status__dot" />
      {!compact && <span>{STATE_LABEL[state]}</span>}
    </span>
  );
}

/** Столбиковая история проверок: высота — время ответа, цвет — результат */
export function HealthBars({ history = [], slots = 40, height = 28 }) {
  const items = history.slice(-slots);
  const pad = Array.from({ length: Math.max(0, slots - items.length) });
  const max = Math.max(200, ...items.map((h) => h.latency || 0));
  return (
    <div className="bars" style={{ height }} role="img" aria-label="История проверок">
      {pad.map((_, i) => (
        <span key={'p' + i} className="bars__bar bars__bar--empty" />
      ))}
      {items.map((h, i) => {
        const pct = h.ok ? Math.max(18, Math.min(100, ((h.latency || 0) / max) * 100)) : 100;
        return (
          <span
            key={h.ts + '-' + i}
            className={`bars__bar ${h.ok ? '' : 'bars__bar--fail'}`}
            style={{ height: pct + '%' }}
            title={`${new Date(h.ts).toLocaleTimeString('ru-RU')} · ${h.ok ? (h.latency ?? '—') + ' мс' : h.error || 'ошибка ' + (h.code ?? '')}`}
          />
        );
      })}
    </div>
  );
}

/** Линия времени отклика с заливкой и выделенной последней точкой */
export function Sparkline({ values = [], width = 120, height = 32, stroke = 'var(--accent)' }) {
  const gid = 'sg' + useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const vs = values.filter((v) => v != null);
  if (vs.length < 2) return <svg width={width} height={height} className="spark" aria-hidden="true" />;
  const min = Math.min(...vs), max = Math.max(...vs);
  const span = max - min || 1;
  const step = width / (vs.length - 1);
  const pts = vs.map((v, i) => [i * step, height - 3 - ((v - min) / span) * (height - 8)]);
  const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  const last = pts[pts.length - 1];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="spark" aria-hidden="true">
      <defs>
        <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={stroke} stopOpacity="0.28" />
          <stop offset="1" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${d} L ${width} ${height} L 0 ${height} Z`} fill={`url(#${gid})`} />
      <path d={d} fill="none" stroke={stroke} strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx={last[0] - 1.5} cy={last[1]} r="2.6" fill={stroke} />
    </svg>
  );
}

/** Выпадающее меню действий */
export function Menu({ items, label = 'Действия', align = 'right', trigger }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => !ref.current?.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div className="menu" ref={ref}>
      <button
        type="button"
        className="icon-btn"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        {trigger || <Icon name="more" />}
      </button>
      {open && (
        <div className={`menu__panel menu__panel--${align}`} role="menu">
          {items.filter(Boolean).map((it, i) =>
            it === '-' ? (
              <div key={i} className="menu__sep" />
            ) : (
              <button
                key={i}
                type="button"
                role="menuitem"
                className={`menu__item ${it.danger ? 'menu__item--danger' : ''}`}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setOpen(false);
                  it.onClick();
                }}
              >
                <Icon name={it.icon} size={16} />
                <span>{it.label}</span>
                {it.hint && <kbd>{it.hint}</kbd>}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

/** Модальное окно с фокус-ловушкой и закрытием по Esc */
export function Modal({ open, onClose, title, subtitle, children, footer, width = 560, icon }) {
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return undefined;
    const prev = document.activeElement;
    const t = setTimeout(() => {
      const el = ref.current?.querySelector('[data-autofocus]') || ref.current?.querySelector('input,button,textarea,select');
      el?.focus();
    }, 30);
    const onKey = (e) => {
      if (e.key === 'Escape') closeRef.current();
      if (e.key === 'Tab' && ref.current) {
        const f = [...ref.current.querySelectorAll('button,input,select,textarea,[tabindex]:not([tabindex="-1"])')].filter(
          (x) => !x.disabled,
        );
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [open]);
  if (!open) return null;
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: width }} role="dialog" aria-modal="true" aria-labelledby="modal-title" ref={ref}>
        <header className="modal__head">
          {icon}
          <div className="modal__titles">
            <h2 id="modal-title">{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Закрыть">
            <Icon name="x" />
          </button>
        </header>
        <div className="modal__body">{children}</div>
        {footer && <footer className="modal__foot">{footer}</footer>}
      </div>
    </div>
  );
}

export function EmptyState({ icon = 'search', title, text, action }) {
  return (
    <div className="empty">
      <span className="empty__icon">
        <Icon name={icon} size={22} />
      </span>
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {action}
    </div>
  );
}

export function Segmented({ value, onChange, options, label }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={value === o.value ? 'is-active' : ''}
          onClick={() => onChange(o.value)}
          title={o.title || o.label}
        >
          {o.icon && <Icon name={o.icon} size={16} />}
          {o.label && <span>{o.label}</span>}
        </button>
      ))}
    </div>
  );
}

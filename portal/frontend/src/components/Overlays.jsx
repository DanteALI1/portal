import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { Modal, StatusBadge, SystemGlyph } from './ui.jsx';
import { healthState } from './SystemCard.jsx';

export function ConfirmDialog({ open, title, text, confirmLabel = 'Удалить', onConfirm, onClose }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      width={440}
      icon={
        <span className="danger-glyph">
          <Icon name="alert" size={20} />
        </span>
      }
      title={title}
      footer={
        <>
          <span />
          <div className="row gap-8">
            <button type="button" className="btn btn--ghost" onClick={onClose} data-autofocus>
              Отмена
            </button>
            <button type="button" className="btn btn--danger" onClick={onConfirm}>
              <Icon name="trash" size={16} />
              {confirmLabel}
            </button>
          </div>
        </>
      }
    >
      <p className="confirm-text">{text}</p>
    </Modal>
  );
}

/** Палитра команд: Ctrl/⌘+K */
export function CommandPalette({ open, onClose, systems, health, commands }) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => {
    if (open) {
      setQ('');
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [open]);

  const items = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const match = (...xs) => !needle || xs.some((x) => (x || '').toLowerCase().includes(needle));
    const sysItems = systems
      .filter((s) => match(s.name, s.description, s.category, s.url, ...(s.tags || [])))
      .map((s) => ({ kind: 'system', id: 'sys-' + s.id, sys: s, run: () => (s.newTab ? window.open(s.url, '_blank', 'noopener') : (window.location.href = s.url)) }));
    const cmds = commands.filter((c) => match(c.label, c.keywords)).map((c) => ({ kind: 'command', id: 'cmd-' + c.label, ...c }));
    return [...sysItems, ...cmds];
  }, [q, systems, commands]);

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;

  const run = (it) => {
    onClose();
    setTimeout(() => it.run(), 0);
  };

  const onKey = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(items.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter' && items[active]) {
      e.preventDefault();
      run(items[active]);
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  let lastKind = null;
  return (
    <div className="overlay overlay--top" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Быстрый переход">
        <div className="palette__search">
          <Icon name="search" size={18} />
          <input
            id="palette-input"
            ref={inputRef}
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={items[active]?.id}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
            placeholder="Найти систему или действие…"
          />
          <kbd>Esc</kbd>
        </div>
        <div className="palette__list" id="palette-list" role="listbox" ref={listRef}>
          {items.length === 0 && <div className="palette__empty">Ничего не найдено по запросу «{q}»</div>}
          {items.map((it, i) => {
            const header = it.kind !== lastKind ? (it.kind === 'system' ? 'Системы' : 'Действия') : null;
            lastKind = it.kind;
            return (
              <div key={it.id}>
                {header && <div className="palette__group">{header}</div>}
                <button
                  id={it.id}
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  data-active={i === active}
                  className={`palette__item ${i === active ? 'is-active' : ''}`}
                  onMouseMove={() => setActive(i)}
                  onClick={() => run(it)}
                >
                  {it.kind === 'system' ? (
                    <>
                      <SystemGlyph icon={it.sys.icon} accent={it.sys.accent} size={28} />
                      <span className="palette__text">
                        <strong>{it.sys.name}</strong>
                        <span className="muted mono">{it.sys.url}</span>
                      </span>
                      <StatusBadge state={healthState(health[it.sys.id])} compact />
                    </>
                  ) : (
                    <>
                      <span className="palette__cmd-icon">
                        <Icon name={it.icon} size={16} />
                      </span>
                      <span className="palette__text">
                        <strong>{it.label}</strong>
                      </span>
                      {it.hint && <kbd>{it.hint}</kbd>}
                    </>
                  )}
                </button>
              </div>
            );
          })}
        </div>
        <div className="palette__foot">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> выбор
          </span>
          <span>
            <kbd>Enter</kbd> открыть
          </span>
        </div>
      </div>
    </div>
  );
}

export function Toasts({ toasts, onDismiss }) {
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast--${t.type}`}>
          <Icon name={t.type === 'error' ? 'alert' : t.type === 'success' ? 'check' : 'info'} size={18} />
          <div className="toast__body">
            <strong>{t.title}</strong>
            {t.text && <span>{t.text}</span>}
          </div>
          {t.action && (
            <button
              type="button"
              className="toast__action"
              onClick={() => {
                t.action.onClick();
                onDismiss(t.id);
              }}
            >
              {t.action.icon && <Icon name={t.action.icon} size={14} />}
              {t.action.label}
            </button>
          )}
          <button type="button" className="icon-btn icon-btn--sm" onClick={() => onDismiss(t.id)} aria-label="Закрыть уведомление">
            <Icon name="x" size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

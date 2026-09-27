import { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { StatusBadge, SystemGlyph } from './ui.jsx';
import { healthState } from './SystemCard.jsx';
import { config } from '../lib/config.js';
import { STATE_LABEL } from '../lib/health.js';

export const NAV = [
  { id: 'overview', label: 'Каталог систем', icon: 'dashboard' },
  { id: 'monitoring', label: 'Мониторинг', icon: 'activity' },
  { id: 'audit', label: 'Журнал действий', icon: 'audit', adminOnly: true },
  { id: 'settings', label: 'Настройки', icon: 'sliders' },
];

export function Logo() {
  return (
    <span className="logo" aria-hidden="true">
      <svg viewBox="0 0 32 32" width="32" height="32">
        <defs>
          <linearGradient id="logo-g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#4C8DFF" />
            <stop offset="1" stopColor="#14C8B4" />
          </linearGradient>
        </defs>
        <rect width="32" height="32" rx="9" fill="url(#logo-g)" />
        <path d="M9 10.5h14M9 16h9M9 21.5h14" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
        <circle cx="22.5" cy="16" r="2.2" fill="#fff" />
      </svg>
    </span>
  );
}

export function initials(user) {
  const src = (user?.name || user?.username || '?').trim();
  const parts = src.split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] || '?') + (parts[1]?.[0] || '')).toUpperCase();
}

export function Sidebar({ nav = NAV, page, onNavigate, systems, health, counts, open, onClose, collapsed, onToggleCollapse, user }) {
  const pinned = systems.filter((s) => s.pinned);
  const quick = (pinned.length ? pinned : systems).slice(0, 8);
  return (
    <>
      <div className={`scrim ${open ? 'is-open' : ''}`} onClick={onClose} />
      <aside className={`sidebar ${open ? 'is-open' : ''} ${collapsed ? 'is-collapsed' : ''}`} aria-label="Основная навигация">
        <div className="sidebar__brand">
          <Logo />
          <div className="sidebar__brand-text">
            <strong>{config.title}</strong>
            <span className="mono">{config.domain}</span>
          </div>
        </div>

        <nav className="sidebar__nav">
          <span className="sidebar__label">Навигация</span>
          {nav.map((n) => (
            <a
              key={n.id}
              href={`#${n.id}`}
              className={`nav-item ${page === n.id ? 'is-active' : ''}`}
              aria-current={page === n.id ? 'page' : undefined}
              onClick={(e) => {
                e.preventDefault();
                onNavigate(n.id);
              }}
              title={n.label}
            >
              <Icon name={n.icon} size={18} />
              <span className="nav-item__label">{n.label}</span>
              {counts[n.id] != null && (
                <span className={`nav-item__count ${n.id === 'monitoring' && counts.alerts ? 'is-alert' : ''}`}>
                  {n.id === 'monitoring' && counts.alerts ? counts.alerts : counts[n.id]}
                </span>
              )}
            </a>
          ))}
        </nav>

        <div className="sidebar__systems">
          <span className="sidebar__label">{pinned.length ? 'Избранное' : 'Системы'}</span>
          {quick.map((s) => (
            <a
              key={s.id}
              className="nav-item nav-item--sys"
              href={s.url}
              target={s.newTab ? '_blank' : undefined}
              rel="noopener"
              title={`${s.name} — ${STATE_LABEL[healthState(health[s.id])]}`}
            >
              <SystemGlyph icon={s.icon} accent={s.accent} size={22} />
              <span className="nav-item__label">{s.name}</span>
              <StatusBadge state={healthState(health[s.id])} compact />
            </a>
          ))}
        </div>

        <div className="sidebar__foot">
          <div className="sidebar__meta">
            <Icon name={user?.isAdmin ? 'key' : 'lock'} size={14} />
            <span>{user?.isAdmin ? 'Администратор каталога' : 'Единый вход · просмотр'}</span>
          </div>
          <div className="sidebar__meta mono">v{config.version}</div>
          <button type="button" className="icon-btn collapse-btn" onClick={onToggleCollapse} aria-label={collapsed ? 'Развернуть меню' : 'Свернуть меню'}>
            <Icon name={collapsed ? 'chevronRight' : 'chevronLeft'} size={16} />
          </button>
        </div>
      </aside>
    </>
  );
}

function UserMenu({ user }) {
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
  if (!user) return null;
  return (
    <div className="menu" ref={ref}>
      <button
        type="button"
        className="user-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Пользователь ${user.name}`}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="avatar" aria-hidden="true">{initials(user)}</span>
        <span className="user-btn__name hide-sm">{user.name}</span>
      </button>
      {open && (
        <div className="menu__panel menu__panel--right user-panel" role="menu">
          <div className="user-panel__head">
            <span className="avatar avatar--lg" aria-hidden="true">{initials(user)}</span>
            <span>
              <strong>{user.name}</strong>
              <span className="muted mono">{user.username}</span>
              {user.email && <span className="muted">{user.email}</span>}
            </span>
          </div>
          {user.groups?.length > 0 && (
            <ul className="tags user-panel__groups" aria-label="Группы">
              {user.groups.map((g) => (
                <li key={g} className="tag">{g}</li>
              ))}
            </ul>
          )}
          <div className="menu__sep" />
          <a className="menu__item" role="menuitem" href={config.profileUrl}>
            <Icon name="users" size={16} />
            <span>Профиль</span>
          </a>
          <a className="menu__item menu__item--danger" role="menuitem" href={config.logoutUrl}>
            <Icon name="lock" size={16} />
            <span>Выйти</span>
          </a>
        </div>
      )}
    </div>
  );
}

export function Topbar({ title, crumbs, onMenu, onPalette, theme, onTheme, gateway, alerts, onNavigate, onAdd, user }) {
  const [bellOpen, setBellOpen] = useState(false);
  const bellRef = useRef(null);
  useEffect(() => {
    if (!bellOpen) return undefined;
    const h = (e) => !bellRef.current?.contains(e.target) && setBellOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [bellOpen]);

  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  const themeIcon = theme === 'dark' ? 'moon' : theme === 'light' ? 'sun' : 'monitorCog';
  const nextTheme = theme === 'dark' ? 'light' : theme === 'light' ? 'system' : 'dark';
  const themeLabel = { dark: 'Тёмная тема', light: 'Светлая тема', system: 'Как в системе' }[theme];

  return (
    <header className="topbar">
      <button type="button" className="icon-btn only-mobile" onClick={onMenu} aria-label="Открыть меню">
        <Icon name="menu" />
      </button>
      <div className="topbar__title">
        <span className="crumbs">
          <span>{config.organization}</span>
          <Icon name="chevronRight" size={12} />
          <span>{crumbs}</span>
        </span>
        <h1>{title}</h1>
      </div>

      <button type="button" className="search-trigger" onClick={onPalette}>
        <Icon name="search" size={16} />
        <span>Поиск систем и действий</span>
        <kbd>{isMac ? '⌘' : 'Ctrl'} K</kbd>
      </button>

      <div className="topbar__actions">
        <span className={`gateway gateway--${gateway.state}`} title={`Шлюз Nginx (/health): ${STATE_LABEL[gateway.state]}`}>
          <Icon name="shieldCheck" size={15} />
          <span className="hide-sm">Шлюз</span>
          <span className="status__dot" />
        </span>

        <button type="button" className="icon-btn only-mobile" onClick={onPalette} aria-label="Поиск">
          <Icon name="search" />
        </button>

        <div className="menu" ref={bellRef}>
          <button
            type="button"
            className="icon-btn"
            aria-label={`Уведомления: ${alerts.length}`}
            aria-expanded={bellOpen}
            onClick={() => setBellOpen((o) => !o)}
          >
            <Icon name="bell" />
            {alerts.length > 0 && <span className="badge-dot">{alerts.length}</span>}
          </button>
          {bellOpen && (
            <div className="menu__panel menu__panel--right bell-panel" role="dialog" aria-label="Уведомления">
              <div className="bell-panel__head">
                <strong>Состояние систем</strong>
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => {
                    setBellOpen(false);
                    onNavigate('monitoring');
                  }}
                >
                  Мониторинг
                </button>
              </div>
              {alerts.length === 0 ? (
                <div className="bell-panel__ok">
                  <Icon name="check" size={18} />
                  <span>Все системы отвечают штатно</span>
                </div>
              ) : (
                alerts.map((a) => (
                  <div key={a.sys.id} className="bell-panel__item">
                    <SystemGlyph icon={a.sys.icon} accent={a.sys.accent} size={28} />
                    <span>
                      <strong>{a.sys.name}</strong>
                      <span className="muted">{a.message}</span>
                    </span>
                    <StatusBadge state={a.state} compact />
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        <button type="button" className="icon-btn" onClick={() => onTheme(nextTheme)} aria-label={`${themeLabel}. Переключить`} title={themeLabel}>
          <Icon name={themeIcon} />
        </button>

        {user?.isAdmin && (
          <button type="button" className="btn btn--primary hide-sm" onClick={onAdd}>
            <Icon name="plus" size={16} />
            Добавить
          </button>
        )}

        <UserMenu user={user} />
      </div>
    </header>
  );
}

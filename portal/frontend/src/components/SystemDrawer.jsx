import { useEffect, useRef } from 'react';
import Icon from './Icon.jsx';
import { HealthBars, Sparkline, StatusBadge, SystemGlyph } from './ui.jsx';
import { healthState } from './SystemCard.jsx';
import { avgLatency, uptime, STATE_LABEL } from '../lib/health.js';
import { formatMs, formatDateTime, timeAgo, fullUrl } from '../lib/format.js';
import { config } from '../lib/config.js';

/**
 * Боковая панель с подробностями системы: история проверок, аптайм,
 * последний ответ и быстрые действия. Данные — из готового мониторинга.
 */
export default function SystemDrawer({ system, health, actions, now, onClose }) {
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!system) return undefined;
    const t = setTimeout(() => ref.current?.querySelector('[data-autofocus]')?.focus(), 30);
    const onKey = (e) => e.key === 'Escape' && closeRef.current();
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', onKey);
    };
  }, [system]);

  if (!system) return null;

  const s = system;
  const h = health;
  const state = healthState(h);
  const history = h?.history || [];
  const up = uptime(history);
  const avg = avgLatency(history);
  const last = h?.last;
  const canEdit = actions.canEdit;

  const metrics = [
    { label: 'Доступность', value: up == null ? '—' : up.toFixed(up === 100 ? 0 : 1) + '%' },
    { label: 'Средний отклик', value: formatMs(avg) },
    { label: 'Последний отклик', value: formatMs(last?.latency) },
    { label: 'Код ответа', value: last?.code ? 'HTTP ' + last.code : '—' },
  ];

  const open = () => (s.newTab ? window.open(s.url, '_blank', 'noopener') : window.location.assign(s.url));

  return (
    <div className="overlay overlay--right" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={`Подробности: ${s.name}`} ref={ref}>
        <header className="drawer__head">
          <SystemGlyph icon={s.icon} accent={s.accent} size={44} />
          <div className="drawer__titles">
            <h2>{s.name}</h2>
            <span className="muted">{s.category || 'Без категории'}</span>
          </div>
          <StatusBadge state={state} />
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Закрыть" data-autofocus>
            <Icon name="x" />
          </button>
        </header>

        <div className="drawer__body">
          <p className="drawer__desc">{s.description || 'Описание не указано.'}</p>

          {s.tags?.length > 0 && (
            <ul className="tags">
              {s.tags.map((t) => (
                <li key={t} className="tag">{t}</li>
              ))}
            </ul>
          )}

          <dl className="drawer__metrics">
            {metrics.map((m) => (
              <div key={m.label}>
                <dt>{m.label}</dt>
                <dd className="mono">{m.value}</dd>
              </div>
            ))}
          </dl>

          <section className="drawer__section">
            <h3>Динамика отклика</h3>
            <Sparkline values={history.map((x) => (x.ok ? x.latency : null))} width={360} height={56} />
            <HealthBars history={history} slots={48} height={30} />
          </section>

          <dl className="drawer__facts">
            <div>
              <dt>Адрес</dt>
              <dd className="mono">{fullUrl(s.url, config.domain)}</dd>
            </div>
            {s.owner && (
              <div>
                <dt>Ответственный</dt>
                <dd>{s.owner}</dd>
              </div>
            )}
            <div>
              <dt>Состояние</dt>
              <dd>{STATE_LABEL[state]}{last?.detail ? ` · ${last.detail}` : ''}</dd>
            </div>
            <div>
              <dt>Проверено</dt>
              <dd title={last?.ts ? formatDateTime(last.ts) : ''}>{last?.ts ? timeAgo(last.ts, now) : '—'}</dd>
            </div>
          </dl>
        </div>

        <footer className="drawer__foot">
          <button type="button" className="btn btn--primary" onClick={open}>
            <Icon name={s.newTab ? 'external' : 'arrowRight'} size={16} /> Открыть
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => actions.onCheck(s)}>
            <Icon name="refresh" size={16} /> Проверить
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => actions.onCopy(s)}>
            <Icon name="copy" size={16} /> Ссылка
          </button>
          {canEdit && (
            <>
              <button type="button" className="btn btn--ghost" onClick={() => actions.onTogglePin(s)}>
                <Icon name="star" size={16} /> {s.pinned ? 'Из избранного' : 'В избранное'}
              </button>
              <button type="button" className="btn btn--ghost" onClick={() => { onClose(); actions.onEdit(s); }}>
                <Icon name="edit" size={16} /> Изменить
              </button>
            </>
          )}
        </footer>
      </aside>
    </div>
  );
}

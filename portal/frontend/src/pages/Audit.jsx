import { useMemo, useState } from 'react';
import Icon from '../components/Icon.jsx';
import { EmptyState } from '../components/ui.jsx';
import { downloadFile, formatDateTime, timeAgo } from '../lib/format.js';

export const ACTION_META = {
  create: { label: 'Добавление', icon: 'plus', tone: 'ok' },
  update: { label: 'Изменение', icon: 'edit', tone: 'info' },
  delete: { label: 'Удаление', icon: 'trash', tone: 'bad' },
  restore: { label: 'Восстановление', icon: 'undo', tone: 'info' },
  import: { label: 'Импорт', icon: 'upload', tone: 'info' },
  reset: { label: 'Сброс', icon: 'refresh', tone: 'warn' },
  status: { label: 'Статус', icon: 'activity', tone: 'warn' },
};

const author = (e) => (e.user === 'system' ? 'Мониторинг' : e.userName && e.userName !== e.user ? `${e.userName} (${e.user})` : e.user);

export default function Audit({ entries, loading, onReload, now }) {
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return entries.filter(
      (e) =>
        (filter === 'all' || e.action === filter) &&
        (!needle || [e.target, e.details, e.user, e.userName].some((x) => (x || '').toLowerCase().includes(needle))),
    );
  }, [entries, filter, q]);

  const exportCsv = () => {
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = [
      ['Время', 'Пользователь', 'Действие', 'Объект', 'Подробности'],
      ...list.map((e) => [formatDateTime(e.ts), author(e), ACTION_META[e.action]?.label || e.action, e.target, e.details]),
    ];
    downloadFile(
      `portal-audit-${new Date().toISOString().slice(0, 10)}.csv`,
      '﻿' + rows.map((r) => r.map(esc).join(';')).join('\n'),
      'text/csv;charset=utf-8',
    );
  };

  const present = [...new Set(entries.map((e) => e.action))];

  return (
    <div className="page">
      <section className="toolbar">
        <label className="search">
          <Icon name="search" size={16} />
          <input
            id="audit-search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Поиск по объекту, пользователю или подробностям"
            aria-label="Поиск по журналу"
          />
        </label>
        <select id="audit-filter" className="select" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Тип действия">
          <option value="all">Все действия</option>
          {present.map((a) => (
            <option key={a} value={a}>
              {ACTION_META[a]?.label || a}
            </option>
          ))}
        </select>
        <button type="button" className="btn btn--ghost" onClick={onReload} disabled={loading}>
          <Icon name="refresh" size={16} className={loading ? 'spin' : ''} /> Обновить
        </button>
        <button type="button" className="btn btn--ghost" onClick={exportCsv} disabled={!list.length}>
          <Icon name="download" size={16} /> CSV
        </button>
      </section>

      {list.length === 0 ? (
        <EmptyState
          icon="audit"
          title={loading ? 'Загружаем журнал…' : entries.length ? 'Записей не найдено' : 'Журнал пуст'}
          text="Здесь фиксируются добавление, изменение и удаление систем, импорт, сброс и смена статусов."
        />
      ) : (
        <ol className="timeline card">
          {list.map((e) => {
            const m = ACTION_META[e.action] || ACTION_META.update;
            return (
              <li key={e.id} className="timeline__item">
                <span className={`timeline__icon tone--${m.tone}`}>
                  <Icon name={m.icon} size={14} />
                </span>
                <div className="timeline__body">
                  <div className="timeline__line">
                    <span className={`pill tone--${m.tone}`}>{m.label}</span>
                    <strong>{e.target}</strong>
                  </div>
                  {e.details && <p className="muted">{e.details}</p>}
                  <p className="muted small audit-author">
                    <Icon name="users" size={12} /> {author(e)}
                  </p>
                </div>
                <time className="timeline__time mono" dateTime={new Date(e.ts).toISOString()} title={formatDateTime(e.ts)}>
                  {timeAgo(e.ts, now)}
                </time>
              </li>
            );
          })}
        </ol>
      )}
      <p className="footnote">
        <Icon name="info" size={14} />
        Журнал хранится на сервере портала (последние 1000 записей) и виден только администраторам.
      </p>
    </div>
  );
}
